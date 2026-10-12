// SPDX-License-Identifier: GPL-3.0-or-later
// While the game runs, body.playing hides the launcher at every pointer type
// -- the mode links, the disc picker, Start, the adapter button, the status
// line and the log -- because they would otherwise sit on top of the picture.
// Nothing else brings them back: a phone has no window chrome to scroll to and
// a desktop page no longer scrolls. So this button is the way back to the
// launcher everywhere: it toggles one class on <body> and the stylesheet
// reveals the panel.
//
// Its own module rather than touch.mjs so a test can reach it without the
// overlay, and not inline in shell.mjs so a test can reach it without booting
// the engine.
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
