// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'assert/strict';
import { SETTINGS, LIVE, INPUT_PREFS, TABS, isOn, buildSearch, readSearch } from '../../platforms/browser/settings.mjs';

test('a default-valued setting stays out of the URL', () => {
  assert.equal(buildSearch({ MELEE_20XX: '', MELEE_BOOT_SCENE: '' }), '');
});

test('only the changed settings reach the URL', () => {
  const search = buildSearch({ MELEE_20XX: '1', MELEE_HITBOXES: '', MELEE_BOOT_SCENE: 'vs' });
  const params = new URLSearchParams(search);
  assert.equal(params.get('MELEE_20XX'), '1');
  assert.equal(params.get('MELEE_BOOT_SCENE'), 'vs');
  assert.equal(params.has('MELEE_HITBOXES'), false);
});

test('parameters the settings do not own are preserved', () => {
  // A room link is how a second player joins; applying a setting must not
  // drop them out of the room.
  const search = buildSearch({ MELEE_20XX: '1' }, 'room=abc&signal=http://h:8101');
  const params = new URLSearchParams(search);
  assert.equal(params.get('room'), 'abc');
  assert.equal(params.get('signal'), 'http://h:8101');
  assert.equal(params.get('MELEE_20XX'), '1');
});

test('an unknown MELEE_ parameter survives, since it still works as a flag', () => {
  const params = new URLSearchParams(buildSearch({}, 'MELEE_SIM_HZ=120'));
  assert.equal(params.get('MELEE_SIM_HZ'), '120');
});

test('clearing a setting removes it rather than writing an empty value', () => {
  // ?MELEE_20XX= would be truthy to URLSearchParams but falsy to env_is_set;
  // leaving the key out avoids relying on that agreement.
  const search = buildSearch({ MELEE_20XX: '' }, 'MELEE_20XX=1');
  assert.equal(new URLSearchParams(search).has('MELEE_20XX'), false);
});

test('a URL round-trips through the controls', () => {
  const start = 'MELEE_BOOT_SCENE=training&MELEE_HITBOXES=1';
  assert.equal(
    new URLSearchParams(buildSearch(readSearch(start))).toString(),
    new URLSearchParams(start).toString());
});

test('isOn matches env_is_set: 0 and empty are off', () => {
  // src/pc/input_poll.c: on = e != NULL && e[0] != '\0' && e[0] != '0'
  for (const off of ['', '0', null, undefined]) assert.equal(isOn(off), false, `${off}`);
  for (const on of ['1', 'true', 'yes']) assert.equal(isOn(on), true, on);
});

test('readSearch normalizes a flag to 1 or empty', () => {
  assert.equal(readSearch('MELEE_20XX=yes').MELEE_20XX, '1');
  assert.equal(readSearch('MELEE_20XX=0').MELEE_20XX, '');
});

test('every setting has a control the page can build', () => {
  for (const setting of SETTINGS) {
    assert.match(setting.key, /^MELEE_[A-Z0-9_]+$/, setting.key);
    assert.ok(setting.label, `${setting.key} needs a label`);
    assert.ok(['flag', 'choice'].includes(setting.kind), `${setting.key} kind`);
    if (setting.kind === 'choice') {
      assert.ok(setting.options.length > 1, `${setting.key} needs options`);
      // The first option is the default, and a default must be omittable.
      assert.equal(setting.options[0][0], '', `${setting.key} default must be empty`);
    }
  }
});

test('the shell turns every settings key into an environment variable', async () => {
  // shell.mjs only forwards /^MELEE_[A-Z0-9_]+$/, so a key that fails that
  // regex would be a control with no effect.
  const shell = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../../platforms/browser/shell.mjs', import.meta.url), 'utf8'));
  const pattern = shell.match(/\/\^MELEE_\[A-Z0-9_\]\+\$\//);
  assert.ok(pattern, 'shell.mjs no longer filters MELEE_ parameters as expected');
  for (const { key } of SETTINGS) assert.match(key, /^MELEE_[A-Z0-9_]+$/);
});

// addSettings builds DOM, so it needs one. Hand-written like the overlay's
// stub in touch.test.mjs, for the same reason: jsdom is not a dependency, and
// this host has no browser to render against.
function stubDom(search) {
  const make = (tag) => {
    const el = {
      tagName: tag, id: '', className: '', textContent: '', value: '', name: '',
      type: tag === 'select' ? 'select-one' : '', checked: false, readOnly: false,
      selected: false, children: [], attrs: {}, handlers: new Map(),
      append(...kids) { el.children.push(...kids); for (const k of kids) if (k) k.parent = el; },
      addEventListener(type, fn) { el.handlers.set(type, fn); },
      setAttribute(n, v) { el.attrs[n] = v; },
      getAttribute(n) { return el.attrs[n]; },
      // Depth-first, matching [name=X], #id and a tag name -- the only forms
      // the tests below and the module itself use.
      querySelector(sel) { return el.querySelectorAll(sel)[0] ?? null; },
      querySelectorAll(sel) {
        const name = sel.match(/^\[name=(.+)\]$/);
        const cls = sel.match(/^\.(.+)$/);
        const byId = sel.match(/^#(.+)$/);
        const out = [];
        const walk = (node) => {
          // createTextNode returns a bare {text}, which has no children.
          for (const kid of node.children ?? []) {
            if (name && kid.name === name[1]) out.push(kid);
            // A class selector matches any class in the list, the way a real
            // document does. An exact string match would miss "setting child"
            // for ".setting" and silently undercount the rows.
            else if (cls && (kid.className ?? '').split(' ').includes(cls[1])) out.push(kid);
            else if (byId && kid.id === byId[1]) out.push(kid);
            else if (!name && !cls && !byId && kid.tagName === sel) out.push(kid);
            walk(kid);
          }
        };
        walk(el);
        return out;
      },
    };
    return el;
  };
  const host = make('div');
  host.id = 'menu-panel';
  globalThis.document = { createElement: make, createTextNode: (t) => ({ text: t }) };
  // http, not https: the page is served over http on the tailnet, and a stub
  // that disagrees with the deployment can hide a scheme-dependent fault.
  globalThis.location = { search, href: `http://example.test/${search}`, pathname: '/' };
  return host;
}

// Rows come in two kinds: boot rows (query-string settings) and live rows
// (class "setting live"). Both carry .setting, so a count must say which.
const isLive = (el) => el.className.split(' ').includes('live');
const isInput = (el) => el.className.split(' ').includes('input');
const bootRows = (form) => form.querySelectorAll('.setting').filter((r) => !isLive(r) && !isInput(r));
const liveRows = (form) => form.querySelectorAll('.setting').filter(isLive);

test('every built row carries the ctl- id the board pins it by', async () => {
  // The board's --gate proves a closed pin by querying its anchor in the real
  // page, so a row with no id reads as a control that was never built. Four
  // shipped controls were reported REGRESSED for exactly that reason. The ids
  // are read out of the spec rather than listed here, so a spec rename cannot
  // leave this green.
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host);
  const built = new Set([...form.querySelectorAll('.setting')].map((r) => r.id).filter(Boolean));
  const spec = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../../tools/progress/mockup.py', import.meta.url), 'utf8'));
  for (const setting of SETTINGS) {
    const id = `ctl-${setting.key}`;
    assert.ok(built.has(id), `${setting.key} is built but carries no #${id}, so the board cannot pin it`);
    assert.ok(spec.includes(`'${id}'`), `${id} is not declared in mockup.py, so the demo and the page disagree`);
  }
  for (const d of LIVE) {
    assert.ok(built.has(d.ctl), `${d.ctl} is not in the built form`);
  }
});

test('the form renders one row per setting, with the URL applied', async () => {
  const host = stubDom('?MELEE_20XX=1&MELEE_BOOT_SCENE=training');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host);
  assert.equal(form.id, 'settings');
  assert.equal(bootRows(form).length, SETTINGS.length);
  assert.equal(liveRows(form).length, LIVE.length);
  assert.equal(form.querySelectorAll('.setting').length, SETTINGS.length + LIVE.length + INPUT_PREFS.length);
  assert.equal(form.querySelector('[name=MELEE_20XX]').checked, true);
  assert.equal(form.querySelector('[name=MELEE_HITBOXES]').checked, false);
  // The select reflects the URL by selecting the matching option.
  const scene = form.querySelector('[name=MELEE_BOOT_SCENE]');
  assert.equal(scene.children.find((o) => o.selected).value, 'training');
});

test('Apply navigates to the settings it shows, not to the current URL', async () => {
  const host = stubDom('?MELEE_20XX=1');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  let went = null;
  const form = addSettings(host, { reload: (search) => { went = search; } });
  // Turn 20XX off and hitboxes on, the way a player would.
  form.querySelector('[name=MELEE_20XX]').checked = false;
  form.querySelector('[name=MELEE_HITBOXES]').checked = true;
  form.querySelectorAll('button').find((b) => b.id === 'settings-apply').handlers.get('click')();
  const params = new URLSearchParams(went);
  assert.equal(params.has('MELEE_20XX'), false, 'a cleared flag must leave the URL');
  assert.equal(params.get('MELEE_HITBOXES'), '1');
});

test('the shareable link updates when a control changes', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const link = form.querySelectorAll('input').find((i) => i.id === 'settings-link');
  const before = link.value;
  form.querySelector('[name=MELEE_HITBOXES]').checked = true;
  form.handlers.get('change')();
  assert.notEqual(link.value, before);
  assert.match(link.value, /MELEE_HITBOXES=1/);
});

test('a page without the panel degrades instead of throwing', async () => {
  stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  assert.equal(addSettings(null), null);
});

test('the rows are grouped into tabs, one head per pane', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const heads = form.querySelectorAll('.tab').concat(form.querySelectorAll('.tab on'));
  const used = new Set([...SETTINGS.map((s) => s.tab ?? TABS[0]), ...LIVE.map((d) => d.tab), ...INPUT_PREFS.map((d) => d.tab)]);
  assert.equal(heads.length, used.size, 'one head per tab that has a row');
  // Every row still reaches the form, so no setting is lost in a pane.
  assert.equal(bootRows(form).length, SETTINGS.length);
  assert.equal(form.querySelectorAll('.setting').length, SETTINGS.length + LIVE.length + INPUT_PREFS.length);
});

test('exactly one pane is in front, and a head switches it', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const panes = () => form.querySelectorAll('.pane');
  const front = () => panes().filter((p) => !p.className.split(' ').includes('off')).length;
  assert.equal(front(), 1, 'one pane in front at the start');
  const heads = form.querySelector('.tab-heads');
  // Press the second head. The first pane must leave the front, and the
  // count must stay at one: two panes in front is the bug a stacked layout
  // hides, because both are drawn in the same grid cell.
  assert.equal(panes().length, TABS.length, 'one pane per tab');
  heads.children[1].handlers.get('click')();
  assert.equal(front(), 1, 'still exactly one pane in front after a switch');
  assert.equal(heads.children[1].className, 'tab on');
  assert.equal(heads.children[0].className, 'tab');
});

test('a setting that names no tab still gets a control', async () => {
  for (const setting of SETTINGS) {
    assert.ok(setting.tab == null || TABS.includes(setting.tab),
      `${setting.key} names a tab that is not in TABS`);
  }
  // Every shipped setting names a tab, so SETTINGS alone cannot exercise the
  // fallback. A flag added without one must still get a control rather than
  // vanish, so the case is supplied here.
  const host = stubDom('');
  const mod = await import('../../platforms/browser/settings.mjs');
  const loose = { key: 'MELEE_NO_TAB', kind: 'flag', label: 'No tab' };
  SETTINGS.push(loose);
  try {
    const form = mod.addSettings(host, { reload: () => {} });
    assert.equal(bootRows(form).length, SETTINGS.length);
    assert.equal(form.querySelectorAll('.setting').length, SETTINGS.length + LIVE.length + INPUT_PREFS.length);
    assert.ok(form.querySelector('[name=MELEE_NO_TAB]'), 'the untabbed row is missing');
  } finally {
    SETTINGS.pop();
  }
});

test('a child that agrees with its parent stays out of the URL', () => {
  // env_flag_or_20xx reads an absent child as "follow the parent", so writing
  // the agreement would add noise to a shared link without changing anything.
  const search = buildSearch({ MELEE_20XX: '1', MELEE_BOOT_CSS: '1', MELEE_20XX_RULES: '1' });
  const params = new URLSearchParams(search);
  assert.equal(params.get('MELEE_20XX'), '1');
  assert.equal(params.has('MELEE_BOOT_CSS'), false);
  assert.equal(params.has('MELEE_20XX_RULES'), false);
});

test('a child that disagrees is written, including when it is off', () => {
  // This is the one case an omitted key cannot express: off while the parent
  // is on. env_flag_or_20xx checks presence, so "0" is a real answer.
  const off = new URLSearchParams(
    buildSearch({ MELEE_20XX: '1', MELEE_BOOT_CSS: '', MELEE_20XX_RULES: '1' }));
  assert.equal(off.get('MELEE_BOOT_CSS'), '0');
  assert.equal(off.has('MELEE_20XX_RULES'), false);
  // And on while the parent is off.
  const on = new URLSearchParams(
    buildSearch({ MELEE_20XX: '', MELEE_BOOT_CSS: '1' }));
  assert.equal(on.get('MELEE_BOOT_CSS'), '1');
  assert.equal(on.has('MELEE_20XX'), false);
});

test('a child the URL does not name displays its parent state', async () => {
  const host = stubDom('?MELEE_20XX=1');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  assert.equal(form.querySelector('[name=MELEE_20XX]').checked, true);
  assert.equal(form.querySelector('[name=MELEE_BOOT_CSS]').checked, true,
    'an unnamed child must show the parent, not an unchecked box');
  // An explicit 0 overrides the parent, which is what the C side reads.
  const host2 = stubDom('?MELEE_20XX=1&MELEE_BOOT_CSS=0');
  const form2 = addSettings(host2, { reload: () => {} });
  assert.equal(form2.querySelector('[name=MELEE_BOOT_CSS]').checked, false);
});

test('the parent re-displays an untouched child, and leaves a touched one', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const parent = form.querySelector('[name=MELEE_20XX]');
  const css = form.querySelector('[name=MELEE_BOOT_CSS]');
  const rules = form.querySelector('[name=MELEE_20XX_RULES]');
  // The player sets one child by hand, then ticks the parent.
  rules.checked = true;
  rules.handlers.get('change')();
  parent.checked = true;
  parent.handlers.get('change')();
  assert.equal(css.checked, true, 'the untouched child follows the parent');
  assert.equal(rules.checked, true, 'the touched child keeps its own value');
  // Untick the parent: the untouched child follows back down.
  parent.checked = false;
  parent.handlers.get('change')();
  assert.equal(css.checked, false);
  assert.equal(rules.checked, true);
});

test('a child row is marked as one, and its parent as a parent', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const row = (key) => form.querySelector(`[name=${key}]`).parent;
  assert.ok(row('MELEE_BOOT_CSS').className.split(' ').includes('child'));
  assert.ok(row('MELEE_20XX').className.split(' ').includes('parent'));
  assert.equal(row('MELEE_HITBOXES').className, 'setting');
});

test('every child names a parent that is a flag in SETTINGS', () => {
  const byKey = new Map(SETTINGS.map((s) => [s.key, s]));
  for (const setting of SETTINGS) {
    if (!setting.parent) continue;
    const parent = byKey.get(setting.parent);
    assert.ok(parent, `${setting.key} names a parent that is not a setting`);
    assert.equal(parent.kind, 'flag', `${setting.parent} is not a flag`);
    assert.equal(setting.kind, 'flag', `${setting.key} is a child but not a flag`);
    assert.equal(setting.tab, parent.tab, `${setting.key} is on another tab than its parent`);
  }
});

test('the children sit open under the parent, in one box and with no fold', async () => {
  // #29 comments 3181 and 3809 ruled against the fold twice: the children sit
  // open under the parent and the "Individual settings" summary is gone.
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const boxes = form.querySelectorAll('.kids');
  assert.equal(boxes.length, 1, 'one box per parent');
  assert.equal(boxes[0].tagName, 'div', 'the box must not be a details again');
  assert.equal(boxes[0].querySelectorAll('summary').length, 0, 'no summary row');
  // Every child is a direct child of the box, so nothing hides them and the
  // group costs no click. One level, not two: the .kid-grid is gone with the
  // fold, and mockup.py emits the same single div.
  for (const setting of SETTINGS.filter((s) => s.parent)) {
    const row = form.querySelector(`[name=${setting.key}]`).parent;
    assert.equal(row.parent, boxes[0], `${setting.key} is not directly in the box`);
  }
  assert.equal(boxes[0].parent.parent.className.split(' ').includes('pane'), true);
});

test('a hint is a tooltip, so it costs no row', async () => {
  // #29 comment 3809: "don't add more text bloat that could just be tooltips".
  // A hint used to render as a .setting-hint span with flex-basis 100%, which
  // is a line of its own under the control.
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  assert.equal(form.querySelectorAll('.setting-hint').length, 0,
    'a hint must not render as a row');
  const withHints = SETTINGS.filter((s) => s.hint);
  assert.ok(withHints.length > 0, 'no hinted setting to check');
  for (const setting of withHints) {
    const row = form.querySelector(`[name=${setting.key}]`).parent;
    assert.equal(row.title, setting.hint, `${setting.key} does not carry its hint as a title`);
  }
});

test('the render scale hint is gone: the option labels carry the pixel counts', () => {
  // #17: the user asked for the explanatory hint removed twice. The options
  // already read "1.0 · 960x720", which is the information the hint repeated.
  const scale = SETTINGS.find((s) => s.key === 'MELEE_SCALE');
  assert.equal(scale.hint, undefined, 'MELEE_SCALE must carry no hint');
  for (const [, text] of scale.options) assert.match(text, /\d+x\d+/, text);
});

test('the 20XX family stays condensed, and keeps the pausing fact', () => {
  // #29: fewer words, less vertical space. A hint that grows back past a
  // short phrase is the bloat the user asked to be rid of.
  const family = SETTINGS.filter(
    (s) => s.key === 'MELEE_20XX' || s.parent === 'MELEE_20XX');
  assert.ok(family.length >= 3, '20XX and its children');
  for (const s of family) {
    const words = (s.hint ?? '').split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 8, `${s.key} hint is ${words} words, budget is 8`);
    assert.ok(s.label.split(/\s+/).length <= 2, `${s.key} label too long`);
  }
  // The rules/pause interaction is real -- src/pc/input_poll.c:202, MELEE_PAUSE
  // opts back in -- so it must be stated on one side or the other.
  const rules = SETTINGS.find((s) => s.key === 'MELEE_20XX_RULES');
  const pause = SETTINGS.find((s) => s.key === 'MELEE_PAUSE');
  assert.match(`${rules.hint} ${pause.hint}`, /paus/i,
    'nothing tells the player that tournament rules and pausing interact');
});

test('every boot setting has a real env reader the browser compiles (#28)', async () => {
  // A boot control reaches the engine only through Module.ENV and getenv, so a
  // row for a key no compiled file reads does nothing at all.
  //
  // This used to be two hardcoded lists, and it stayed green for three waves on
  // a false fact: it said MELEE_UNLOCK_ALL had no getenv while pc_stubs.c read
  // it, because the list was written off launcher.cpp, which the browser target
  // replaces. So the reader is grepped out of the tree now, and only the files
  // the browser does not compile are excluded. A key that gains or loses a
  // reader moves this test on its own.
  const { execFileSync } = await import('node:child_process');
  const root = new URL('../../', import.meta.url).pathname;

  // pc_stubs.c stands in for these two, so an env read that lives only here
  // never runs in the browser. Keep in step with the comment at
  // platforms/browser/CMakeLists.txt:24-30.
  const NOT_COMPILED = ['src/pc/launcher.cpp', 'src/pc/file_cache.cpp'];

  const readers = (key) => {
    let out;
    try {
      out = execFileSync('grep', ['-rl', `"${key}"`, '--include=*.c', '--include=*.cpp',
        'src', 'platforms'], { cwd: root, encoding: 'utf8' });
    } catch {
      return [];  // grep exits 1 on no match
    }
    return out.split('\n').filter(Boolean).filter((f) => !NOT_COMPILED.includes(f));
  };

  // MELEE_SCALE never reaches C: shell.mjs reads it off the query string to size
  // the canvas before the runtime starts. A boot control is satisfied by either
  // reader, so the shell counts too.
  const shellText = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../../platforms/browser/shell.mjs', import.meta.url), 'utf8'));

  // Prove the grep and the exclusion both work before trusting a verdict from
  // them: a key with a known reader must be found, and a key read only in an
  // excluded file must not count as reachable.
  assert.ok(readers('MELEE_UNLOCK_ALL').some((f) => f.endsWith('pc_stubs.c')),
    'the grep found no reader for a key pc_stubs.c demonstrably reads');
  assert.deepEqual(readers('MELEE_CACHE_MAX_MB'), [],
    'a key read only in an excluded file must not count as reachable');

  const live = new Set(LIVE.map((d) => d.key));
  for (const setting of SETTINGS) {
    if (live.has(setting.key)) continue;  // a live control uses its setter, not getenv
    assert.ok(readers(setting.key).length > 0 || shellText.includes(setting.key),
      `${setting.key} has a control but neither a compiled file nor shell.mjs reads it, `
      + 'so the row does nothing');
  }
});

test('the free camera is refused in a netplay session', async () => {
  // The camera feeds back into the simulation (src/melee/cm/camera.c:1972 sets
  // pause_eye_distance from it), so one player moving it desyncs lockstep.
  // launcher.cpp:1854 guards the native path with !pc_net_deterministic() and
  // the browser stub dropped the guard, which made the control a desync switch
  // in exactly the mode the board is building toward.
  const fs = await import('node:fs/promises');
  const stubs = await fs.readFile(
    new URL('../../platforms/browser/pc_stubs.c', import.meta.url), 'utf8');
  const fn = stubs.match(/bool pc_is_free_camera_enabled\(void\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'pc_is_free_camera_enabled is gone from pc_stubs.c');
  assert.match(fn[1], /!pc_net_deterministic\(\)/,
    'the free camera no longer refuses a netplay session, so the control can desync lockstep');
  // The guard needs its declaration; without the include this is an implicit
  // decl that returns int, and -sERROR_ON_UNDEFINED_SYMBOLS would not catch it.
  assert.match(stubs, /#include "pc\/net\.h"/,
    'pc_net_deterministic is called with no declaration in scope');
});

test('every live descriptor names a function the wasm exports', async () => {
  // Read the real link line, not a copy of it: a renamed or mistyped fn must
  // fail here, where a hardcoded list would stay green.
  const fs = await import('node:fs/promises');
  const cmake = await fs.readFile(
    new URL('../../platforms/browser/CMakeLists.txt', import.meta.url), 'utf8');
  const line = cmake.match(/-sEXPORTED_FUNCTIONS=(\S+)/);
  assert.ok(line, 'CMakeLists.txt no longer has a -sEXPORTED_FUNCTIONS= value');
  const exported = new Set(line[1].replace(/^["']|["']$/g, '').split(','));
  assert.ok(exported.has('_main'), 'parsed export list looks wrong');
  for (const d of LIVE) {
    assert.ok(exported.has('_' + d.fn), `${d.fn} is not in -sEXPORTED_FUNCTIONS, so Module._${d.fn} never exists`);
  }
});

test('a slider move drives the engine with the scaled value and stores the UI value', async () => {
  const host = stubDom('');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  const calls = [];
  globalThis.Module = { _pc_audio_set_volume: (v) => calls.push(v) };
  try {
    const { addSettings } = await import('../../platforms/browser/settings.mjs');
    const form = addSettings(host, { reload: () => {} });
    const row = form.querySelector('#ctl-volume');
    assert.ok(row, 'ctl-volume row missing');
    const range = row.children.find((c) => c.type === 'range');
    assert.ok(range, 'ctl-volume has no range input');
    range.value = '50';
    range.handlers.get('input')();
    assert.deepEqual(calls, [0.5], 'the engine takes 0..1, not the 0..100 UI value');
    assert.equal(store.get('melee.live.pc_audio_set_volume'), '50');
  } finally {
    delete globalThis.Module;
    delete globalThis.localStorage;
  }
});

test('the new flags reach the URL, and stay out of it when off', () => {
  const on = new URLSearchParams(
    buildSearch({ MELEE_UCF: '1', MELEE_FROZEN_STADIUM: '1' }));
  assert.equal(on.get('MELEE_UCF'), '1');
  assert.equal(on.get('MELEE_FROZEN_STADIUM'), '1');
  // Neither is a child, so off means "leave the launcher preference alone"
  // and the key must be omitted rather than written as 0.
  const off = new URLSearchParams(
    buildSearch({ MELEE_UCF: '', MELEE_FROZEN_STADIUM: '' }));
  assert.equal(off.has('MELEE_UCF'), false);
  assert.equal(off.has('MELEE_FROZEN_STADIUM'), false);
});

test('a non-default net delay round-trips through readSearch', () => {
  for (const value of ['auto', '0', '3']) {
    assert.equal(readSearch(`MELEE_NET_DELAY=${value}`).MELEE_NET_DELAY, value,
      `${value} must survive the read unchanged, not be squashed to a flag`);
    assert.equal(
      new URLSearchParams(buildSearch(readSearch(`MELEE_NET_DELAY=${value}`)))
        .get('MELEE_NET_DELAY'), value);
  }
  // "Saved" is the default and carries no key.
  assert.equal(new URLSearchParams(buildSearch({ MELEE_NET_DELAY: '' }))
    .has('MELEE_NET_DELAY'), false);
});

test('every net delay option is a value src/pc/net.c accepts', () => {
  // net.c:2171 -- "auto", else atoi() and rejected unless 0 <= n < RING/2.
  const delay = SETTINGS.find((s) => s.key === 'MELEE_NET_DELAY');
  for (const [value] of delay.options) {
    if (value === '' || value === 'auto') continue;
    const n = Number(value);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 32, `${value} is out of net.c's range`);
  }
});

test('the Netplay tab exists and holds the net delay row', async () => {
  assert.ok(TABS.includes('Netplay'), 'MELEE_NET_DELAY needs a tab to live on');
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const row = form.querySelector('[name=MELEE_NET_DELAY]').parent;
  assert.equal(row.parent.parent.className.split(' ').includes('pane'), true,
    'the row must be a loose row in a pane, not folded under a parent');
  const heads = form.querySelector('.tab-heads');
  assert.ok(heads.children.some((h) => h.textContent === 'Netplay'));
});

test('the new rows stay condensed: short labels, no hints (#29)', () => {
  for (const key of ['MELEE_UCF', 'MELEE_FROZEN_STADIUM', 'MELEE_NET_DELAY']) {
    const s = SETTINGS.find((x) => x.key === key);
    assert.equal(s.hint, undefined, `${key} must carry no hint`);
    assert.ok(s.label.split(/\s+/).length <= 2, `${key} label too long`);
  }
});

test('the new settings are not children, so the parent logic is untouched', () => {
  const parents = new Set(SETTINGS.filter((s) => s.parent).map((s) => s.key));
  for (const key of ['MELEE_UCF', 'MELEE_FROZEN_STADIUM', 'MELEE_NET_DELAY']) {
    assert.equal(parents.has(key), false, `${key} must not be a child`);
  }
  // Still exactly one group: every child hangs off MELEE_20XX. A count of the
  // children would move with each row added; the invariant is the single group,
  // because addSettings makes one .kids box per distinct parent.
  const groups = new Set(SETTINGS.filter((s) => s.parent).map((s) => s.parent));
  assert.deepEqual([...groups], ['MELEE_20XX']);
});

test('the shell pushes stored live values once the runtime is up', async () => {
  // applyStoredLive is the only thing that replays a stored live value into the
  // engine. Exported but uncalled, every live control still works for the
  // session and silently forgets across a reload, which reads as the storage
  // being broken rather than the call being absent.
  const shell = await import('node:fs/promises')
    .then((fs) => fs.readFile(new URL('../../platforms/browser/shell.mjs', import.meta.url), 'utf8'));
  assert.match(shell, /import \{[^}]*\bapplyStoredLive\b[^}]*\} from '\.\/settings\.mjs'/,
    'shell.mjs does not import applyStoredLive');
  // The setters it pushes are Module exports, so the call is only valid after
  // the runtime exists. Bound to onRuntimeInitialized's body, not the file, so
  // moving the call out to module scope fails here instead of at runtime.
  const hook = shell.match(/onRuntimeInitialized: \(\) => \{([\s\S]*?)\n  \},/);
  assert.ok(hook, 'shell.mjs no longer defines onRuntimeInitialized as expected');
  assert.match(hook[1], /\bapplyStoredLive\(\)/,
    'onRuntimeInitialized does not call applyStoredLive()');
});

// ---- Input tab (board pin 32) ----
const INPUT_IDS = ['ctl-tap-jump', 'ctl-deadzone', 'ctl-curve', 'ctl-cstick'];

function stubStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  return store;
}

test('the four Input rows exist with class setting, inside the Input pane', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  for (const id of INPUT_IDS) {
    const row = form.querySelector(`#${id}`);
    assert.ok(row, `${id} missing`);
    assert.ok(row.className.split(' ').includes('setting'), `${id} lacks class setting`);
    assert.ok(row.children.some((c) => c.className === 'setting-label'), `${id} lacks setting-label`);
    assert.equal(row.parent.parent.className.split(' ').includes('pane'), true, `${id} not a loose row in a pane`);
  }
  const pane = form.querySelector('#ctl-tap-jump').parent;
  for (const id of INPUT_IDS) assert.equal(form.querySelector(`#${id}`).parent, pane, `${id} in another pane`);
  assert.equal(TABS.join(), 'Game,Video,Audio,Input,Netplay');
});

test('the Input tab head exists and switching to it brings the rows forward', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const heads = form.querySelector('.tab-heads');
  const at = heads.children.findIndex((h) => h.textContent === 'Input');
  assert.equal(at, 3, 'Input sits between Audio and Netplay');
  heads.children[at].handlers.get('click')();
  assert.equal(form.querySelector('#ctl-deadzone').parent.parent.className, 'pane');
  assert.equal(form.querySelector('#ctl-volume').parent.parent.className, 'pane off');
});

test('an Input control stores under melee.input and inputPref reads it back', async () => {
  const host = stubDom('');
  const store = stubStorage();
  try {
    const { addSettings, inputPref } = await import('../../platforms/browser/settings.mjs');
    assert.equal(inputPref('ctl-tap-jump'), false);
    assert.equal(inputPref('ctl-curve'), 'eased');
    const form = addSettings(host, { reload: () => {} });
    const box = form.querySelector('#ctl-tap-jump').children.find((c) => c.type === 'checkbox');
    box.checked = true;
    box.handlers.get('change')();
    assert.equal(store.get('melee.input.ctl-tap-jump'), '1');
    assert.equal(inputPref('ctl-tap-jump'), true);
  } finally { delete globalThis.localStorage; }
});

test('a Wide deadzone reads a 0.25 deflection as centred, Default does not', async () => {
  const { shapeStick } = await import('../../platforms/browser/touch.mjs');
  try {
    stubStorage();
    assert.notEqual(shapeStick(0.25, 0).x, 0, 'Default reports at 0.25');
    stubStorage({ 'melee.input.ctl-deadzone': 'wide' });
    assert.equal(shapeStick(0.25, 0).x, 0, 'Wide is still centred at 0.25');
    assert.notEqual(shapeStick(0.4, 0).x, 0, 'Wide reports at 0.4');
  } finally { delete globalThis.localStorage; }
});

test('Linear and Eased differ at mid travel and agree at full deflection', async () => {
  const { shapeStick } = await import('../../platforms/browser/touch.mjs');
  try {
    stubStorage({ 'melee.input.ctl-curve': 'linear' });
    const linearMid = shapeStick(0.5, 0).x;
    const linearFull = shapeStick(1, 0).x;
    stubStorage({ 'melee.input.ctl-curve': 'eased' });
    const easedMid = shapeStick(0.5, 0).x;
    const easedFull = shapeStick(1, 0).x;
    assert.equal(linearMid, 30, 'linear: (0.5-0.2)/0.8 of 80');
    assert.equal(easedMid, 44, 'eased: 0.28 + 0.375*0.72 of 80');
    assert.equal(linearFull, 80);
    assert.equal(easedFull, 80);
  } finally { delete globalThis.localStorage; }
});

test('Tap to jump lets the upward axis reach full in one frame, off takes several', async () => {
  const { createUpRamp } = await import('../../platforms/browser/touch.mjs');
  try {
    stubStorage({ 'melee.input.ctl-tap-jump': '1' });
    assert.equal(createUpRamp()(80), 80, 'checked: instant');
    stubStorage();
    const ramp = createUpRamp();
    const frames = [];
    for (let i = 0; i < 12; i++) frames.push(ramp(80));
    assert.equal(frames[0], 8, 'unchecked: first frame is a tenth');
    assert.equal(frames.indexOf(80), 9, 'unchecked: ten frames to full');
  } finally { delete globalThis.localStorage; }
});

// The demo styles rows through .pane-grid, the Apply row through .apply-row and
// the Apply button through .primary. All three were added for CSS only, so
// nothing else in this suite reads them: deleting all three left 170/170 green.
// This is the gate that fails when one goes missing.
test('the demo wrapper classes the stylesheet targets are all emitted', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });

  // Every row sits in a .pane-grid, which is itself in a .pane.
  const row = form.querySelector('#ctl-MELEE_PAUSE');
  assert.equal(row.parent.className, 'pane-grid', 'a row must sit in .pane-grid');
  assert.equal(row.parent.parent.className.split(' ').includes('pane'), true);

  // The Apply row wraps the link, the button and the note, in that order.
  const apply = form.querySelector('#settings-apply');
  assert.equal(apply.parent.className, 'apply-row', 'Apply must sit in .apply-row');
  assert.equal(apply.className.split(' ').includes('primary'), true,
    'the Apply button carries .primary, which is what colours it');
  const ids = apply.parent.children.map((c) => c.id);
  assert.deepEqual(ids, ['settings-link', 'settings-apply', 'settings-note']);
});
