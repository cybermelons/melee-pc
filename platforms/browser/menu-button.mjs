// SPDX-License-Identifier: GPL-3.0-or-later
// body.playing hides the page's own controls -- the mode links, the disc
// picker, Start, the adapter button, the status line and the log -- because
// they would otherwise sit on top of the picture. Nothing else brings them
// back: there is no window chrome to scroll to on a phone, and on a desktop
// the canvas is fixed over the whole viewport. So this button toggles one
// class on <body> and the stylesheet reveals the panel.
//
// Its own module rather than touch.mjs because that overlay only exists on a
// coarse pointer, which would leave a desktop player with no way back; and not
// inline in shell.mjs so a test can reach it without booting the engine.
export function addMenuButton() {
  if (document.getElementById('pad-menu')) return null;
  const menu = document.createElement('button');
  menu.id = 'pad-menu';
  menu.type = 'button';
  menu.textContent = '☰';
  menu.setAttribute('aria-label', 'Menu');
  // click, not pointerdown: a page control must not latch a game frame.
  menu.addEventListener('click', () => {
    document.body.classList.toggle('menu');
    menu.setAttribute('aria-expanded', String(document.body.classList.contains('menu')));
  });
  menu.setAttribute('aria-expanded', 'false');
  document.body.append(menu);
  return menu;
}
