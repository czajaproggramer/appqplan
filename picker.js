'use strict';

/* ==========================================================================
   Date picker — a month calendar in the Ruled style, opened by clicking the date.
   Mouse only: click a day to open it. Esc or a click outside closes the picker.
   Uses state, showDay, dayKey, hasPlans and addDays from app.js.
   ========================================================================== */
const pickerEl = document.getElementById('picker');
const pickerDaysEl = document.getElementById('picker-days');
const dateButtonEl = document.getElementById('date');
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
let pickerMonth = null;   // first day of the month shown

function renderPicker() {
  document.getElementById('picker-month').textContent = monthFormat.format(pickerMonth);

  // Six Monday-first weeks, so the picker never changes height.
  const offset = (pickerMonth.getDay() + 6) % 7;
  const first = addDays(pickerMonth, -offset);
  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(state.date);

  pickerDaysEl.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const date = addDays(first, i);
    const key = dayKey(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-day';
    button.textContent = date.getDate();
    button.setAttribute('aria-label', dateFormat.format(date));
    button.classList.toggle('is-outside', date.getMonth() !== pickerMonth.getMonth());
    button.classList.toggle('is-today', key === todayKey);
    button.classList.toggle('is-selected', key === selectedKey);
    button.classList.toggle('has-plans', hasPlans(date));
    button.addEventListener('click', () => {
      closePicker();
      showDay(date);
    });
    pickerDaysEl.append(button);
  }
}

function openPicker() {
  pickerMonth = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
  renderPicker();
  pickerEl.hidden = false;
  dateButtonEl.setAttribute('aria-expanded', 'true');
}

function closePicker() {
  pickerEl.hidden = true;
  dateButtonEl.setAttribute('aria-expanded', 'false');
}

function changePickerMonth(delta) {
  pickerMonth = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + delta, 1);
  renderPicker();
}

dateButtonEl.addEventListener('click', () => (pickerEl.hidden ? openPicker() : closePicker()));
document.getElementById('picker-prev').addEventListener('click', () => changePickerMonth(-1));
document.getElementById('picker-next').addEventListener('click', () => changePickerMonth(1));

document.addEventListener('mousedown', (e) => {
  if (!pickerEl.hidden && !pickerEl.contains(e.target) && !dateButtonEl.contains(e.target)) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pickerEl.hidden) closePicker();
});
