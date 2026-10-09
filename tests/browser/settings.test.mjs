// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'assert/strict';
import { SETTINGS, TABS, isOn, buildSearch, readSearch } from '../../platforms/browser/settings.mjs';

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
        const out = [];
        const walk = (node) => {
          // createTextNode returns a bare {text}, which has no children.
          for (const kid of node.children ?? []) {
            if (name && kid.name === name[1]) out.push(kid);
            // A class selector matches any class in the list, the way a real
            // document does. An exact string match would miss "setting child"
            // for ".setting" and silently undercount the rows.
            else if (cls && (kid.className ?? '').split(' ').includes(cls[1])) out.push(kid);
            else if (!name && !cls && kid.tagName === sel) out.push(kid);
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
  globalThis.location = { search, href: `https://example.test/${search}`, pathname: '/' };
  return host;
}

test('the form renders one row per setting, with the URL applied', async () => {
  const host = stubDom('?MELEE_20XX=1&MELEE_BOOT_SCENE=training');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host);
  assert.equal(form.id, 'settings');
  assert.equal(form.querySelectorAll('.setting').length, SETTINGS.length);
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
  const used = new Set(SETTINGS.map((s) => s.tab ?? TABS[0]));
  assert.equal(heads.length, used.size, 'one head per tab that has a row');
  // Every row still reaches the form, so no setting is lost in a pane.
  assert.equal(form.querySelectorAll('.setting').length, SETTINGS.length);
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
    assert.equal(form.querySelectorAll('.setting').length, SETTINGS.length);
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

test('the children sit in one fold under the parent, not as loose rows', async () => {
  const host = stubDom('');
  const { addSettings } = await import('../../platforms/browser/settings.mjs');
  const form = addSettings(host, { reload: () => {} });
  const folds = form.querySelectorAll('.kids');
  assert.equal(folds.length, 1, 'one fold per parent');
  // Every child is inside it, so the pane costs one row for the group rather
  // than one per child.
  for (const setting of SETTINGS.filter((s) => s.parent)) {
    const row = form.querySelector(`[name=${setting.key}]`).parent;
    assert.equal(row.parent, folds[0], `${setting.key} is not in the fold`);
  }
  assert.equal(folds[0].parent.className.split(' ').includes('pane'), true);
});
