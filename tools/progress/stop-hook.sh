#!/usr/bin/env bash
# Claude Code Stop hook for the progress-board gate. NOT active until you merge
# tools/progress/claude-settings.json into the repo's .claude/settings.json
# (merge the "hooks" key; do not replace an existing file).
# Blocks the stop on a hard gate failure when the tree is dirty or the session
# is a /loop; otherwise only prints a systemMessage. Never loops: exits at once
# when stop_hook_active is true.
input=$(cat)
field() { printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1]) or "")' "$1"; }
[ "$(field stop_hook_active)" = "True" ] && exit 0
cd "$(field cwd)" 2>/dev/null || true
cd "$(git rev-parse --show-toplevel)" || exit 0

enforce=0
[ -n "$(git status --porcelain)" ] && enforce=1
tp=$(field transcript_path)
[ -n "$tp" ] && [ -f "$tp" ] && grep -q '<command-name>/loop</command-name>' "$tp" && enforce=1

out=$(python3 tools/progress/build.py --gate 2>&1); rc=$?
line=$(printf '%s\n' "$out" | grep '^gate:' | tail -1)
hard=$(printf '%s' "$line" | sed -n 's/.*hard=\([0-9]*\).*/\1/p')
unread=$(printf '%s' "$line" | sed -n 's/.*unread=\([0-9]*\).*/\1/p')
hard=${hard:-0}; unread=${unread:-0}
# a crash (no gate: line, or rc outside 0/1) must not pass silently
if [ -z "$line" ] || { [ "$rc" != 0 ] && [ "$rc" != 1 ]; }; then
  hard=1; line="gate crashed (rc=$rc): $(printf '%s' "$out" | tail -c 300)"
fi

emit() { python3 -c 'import json,sys; print(json.dumps({sys.argv[1]: sys.argv[2], **({"decision":"block"} if sys.argv[1]=="reason" else {})}))' "$1" "$2"; }
if [ "$enforce" = 1 ] && [ "$hard" -gt 0 ]; then
  emit reason "$(printf '%s\n' "$out" | tail -c 1500)"
elif [ "$unread" -gt 0 ] || [ "$hard" -gt 0 ]; then
  emit systemMessage "board gate: $line"
fi
exit 0
