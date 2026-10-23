'use strict';

/* ==========================================================================
   Phones (≤ 720px): Export and Print live in a menu next to the logo, and a
   switch under the header shows either the to-do list or the schedule.
   On wider screens the menu is a plain row of buttons and both sheets show (styles.css).
   Uses scrollToCursor from app.js.
   ========================================================================== */
const PHONE_LAYOUT = window.matchMedia('(max-width: 720px)');   // keep in sync with styles.css
const headerMenuEl = document.getElementById('header-menu');
const menuToggleEl = document.getElementById('menu-toggle');
const pageEl = document.querySelector('.page');

function openHeaderMenu() {
  headerMenuEl.classList.add('is-open');
  menuToggleEl.setAttribute('aria-expanded', 'true');
}
function closeHeaderMenu() {
  headerMenuEl.classList.remove('is-open');
  menuToggleEl.setAttribute('aria-expanded', 'false');
}
const toggleHeaderMenu = () => (headerMenuEl.classList.contains('is-open') ? closeHeaderMenu() : openHeaderMenu());

menuToggleEl.addEventListener('click', toggleHeaderMenu);
// Every item closes the menu, and so does a tap anywhere else (the avatar included).
headerMenuEl.addEventListener('click', (e) => {
  if (e.target.closest('button')) closeHeaderMenu();
});
document.addEventListener('pointerdown', (e) => {
  if (headerMenuEl.classList.contains('is-open') && !headerMenuEl.contains(e.target) && !menuToggleEl.contains(e.target)) closeHeaderMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeHeaderMenu();
});
PHONE_LAYOUT.addEventListener('change', closeHeaderMenu);

// To do | Schedule
const viewButtons = document.querySelectorAll('.view-switch [data-view]');

function showView(view) {
  pageEl.dataset.view = view;
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  if (view === 'schedule') scrollToCursor('center');   // now on today, 06:00 on other days
  else window.scrollTo({ top: 0 });
}

for (const button of viewButtons) {
  button.addEventListener('click', () => showView(button.dataset.view));
}
