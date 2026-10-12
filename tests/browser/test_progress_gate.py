"""build.py --gate: REGRESSED for a closed pin whose control is gone, UNREAD
for new tracker comments (wave notes skipped, pinnotate notes counted), and
--ack folding them in. Runs against a temp copy of issues.json, a fixture page
and a fake tea, so it touches no live state.
"""
import functools
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILD = os.path.join(ROOT, 'tools/progress/build.py')

FAKE_TEA = '''#!/usr/bin/env python3
import json, os, sys
if sys.argv[1] == 'api':
    m = __import__('re').search(r'page=(\\d+)', sys.argv[-1])
    pg = int(m.group(1)) if m else 1
    print(json.dumps(json.load(open(os.environ['FAKE_COMMENTS']))[(pg - 1) * 50:pg * 50]))
else:
    d = json.load(open(os.environ['PROGRESS_DATA']))
    print(json.dumps([{'index': str(i['n']), 'state': i['state']}
                      for i in d['issues'] if 'base' not in i]))
'''


FAKE_GH = '''#!/usr/bin/env python3
import json, sys
assert sys.argv[1:3] == ['api', '--paginate'], sys.argv
if 'issues/comments' in sys.argv[-1]:
    u = 'https://api.github.com/repos/o/r/issues/'
    print(json.dumps([[{'id': 5, 'body': 'new', 'issue_url': u + '7'},
                       {'id': 6, 'body': 'old', 'issue_url': u + '8'}]]))
else:
    print(json.dumps([[{'number': 7, 'state': 'open'}, {'number': 8, 'state': 'closed'},
                       {'number': 9, 'state': 'open', 'pull_request': {}}]]))
'''


def github():
    """A github.com base reads through gh: PRs dropped, comments mapped."""
    sys.path.insert(0, os.path.dirname(BUILD))
    import build
    tmp = tempfile.mkdtemp()
    gh = os.path.join(tmp, 'gh')
    open(gh, 'w').write(FAKE_GH)
    os.chmod(gh, 0o755)
    os.environ['GH'] = gh
    data = {'repo': 'o/r', 'base': 'https://github.com/o/r/issues/', 'issues': [
        {'n': 7, 'state': 'open', 'seen': 0}, {'n': 8, 'state': 'closed', 'seen': 6}]}
    try:
        assert build.tracker(data, 'issues') == [
            {'index': 7, 'state': 'open'}, {'index': 8, 'state': 'closed'}]
        assert build.audit(data) == 0  # PR #9 is not reported as missing from the board
        assert build.unread(data) == (0, 1)  # #7 has comment 5 > seen 0; #8 read
    finally:
        shutil.rmtree(tmp)


def gate(env, *extra):
    r = subprocess.run([sys.executable, BUILD, '--gate', *extra], env=env,
                       capture_output=True, text=True, cwd=ROOT)
    return r.returncode, r.stdout + r.stderr


def main():
    tmp = tempfile.mkdtemp()
    data_path = os.path.join(tmp, 'issues.json')
    shutil.copy(os.path.join(ROOT, 'tools/progress/issues.json'), data_path)
    data = json.load(open(data_path))
    issues = data['issues']

    # Fixture page: every anchor except the victim's.
    anchors = [i['anchor'] for i in issues]
    victim = next(i for i in issues if i['state'] == 'closed' and 'base' not in i
                  and anchors.count(i['anchor']) == 1)
    page = ''.join(f'<div id="{a.lstrip("#")}"></div>' for a in set(anchors) - {victim['anchor']})
    web = os.path.join(tmp, 'www')
    os.mkdir(web)
    open(os.path.join(web, 'index.html'), 'w').write(f'<!doctype html><body>{page}</body>')
    srv = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=web))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    board = [i['n'] for i in issues if 'base' not in i and i['n'] != victim['n']]
    a, b, c = board[:3]
    next(i for i in issues if i['n'] == a and 'base' not in i)['seen'] = 100
    json.dump(data, open(data_path, 'w'), indent=2, ensure_ascii=False)
    open(data_path, 'a').write('\n')
    url = lambda n: f'http://noel:4530/api/v1/repos/cybermelon/melee-pc/issues/{n}'
    comments = os.path.join(tmp, 'comments.json')
    filler = [{'id': 1, 'body': 'filler', 'issue_url': url(9999)} for _ in range(50)]
    json.dump(filler + [
        {'id': 100, 'body': 'already read', 'issue_url': url(a)},
        {'id': 101, 'body': 'new', 'issue_url': url(a)},
        {'id': 102, 'body': 'x <!-- wave -->', 'issue_url': url(b)},
        {'id': 103, 'body': '<!-- wave --> <!-- pinnotate: x -->', 'issue_url': url(c)},
    ], open(comments, 'w'))
    tea = os.path.join(tmp, 'tea')
    open(tea, 'w').write(FAKE_TEA)
    os.chmod(tea, 0o755)

    env = dict(os.environ, PROGRESS_DATA=data_path, TEA=tea, FAKE_COMMENTS=comments,
               PROGRESS_ARTIFACT_URL=f'http://127.0.0.1:{srv.server_address[1]}/index.html')
    try:
        rc, out = gate(env)
        print(out)
        assert rc == 1, rc
        assert f'REGRESSED #{victim["n"]} ' in out, out
        assert out.count('REGRESSED') == 1, out
        assert f'UNREAD #{a} (1)' in out, out
        assert f'UNREAD #{b}' not in out, out
        assert f'UNREAD #{c} (1)' in out, out
        assert re.search(r'^gate: FAIL hard=1 unread=2 ready=\d+ \d+\.\ds$', out, re.M), out

        rc, out = gate(env, '--ack', str(a))
        print(out)
        assert f'acked #{a} seen=101' in out and f'UNREAD #{a}' not in out, out
        assert f'UNREAD #{c} (1)' in out, out
        seen = next(i for i in json.load(open(data_path))['issues'] if i['n'] == a and 'base' not in i)['seen']
        assert seen == 101, seen

        rc, out = gate(env)
        assert f'UNREAD #{a}' not in out and 'unread=1' in out, out

        # Stop hook re-entry guard: exits silently without running the gate.
        r = subprocess.run([os.path.join(ROOT, 'tools/progress/stop-hook.sh')],
                           input=json.dumps({'stop_hook_active': True, 'cwd': ROOT}),
                           capture_output=True, text=True)
        assert r.stdout == '' and r.returncode == 0, (r.returncode, r.stdout, r.stderr)
    finally:
        srv.shutdown()
        shutil.rmtree(tmp)
    github()
    print('ok')


if __name__ == '__main__':
    main()
