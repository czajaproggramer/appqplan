'use strict';

/* ==========================================================================
   Config
   ========================================================================== */
const QUARTERS = 96;               // 24h in 15-minute rows
const NEW_EVENT_QUARTERS = 1;      // new events are 15 min long
const DEFAULT_TODOS = 5;
const PRIORITY_TODOS = 3;
const DOUBLE_PRESS_MS = 400;       // second hour key within this time = +12h
const DELETE_CONFIRM_MS = 800;     // second Delete within this time removes the event
const EVENT_TONES = ['peach', 'sage', 'rose', 'sky'];   // see --event-* in styles.css
const FIRST_VISIBLE_HOUR = 6;      // the schedule opens scrolled to this hour
const DAY_STORAGE_PREFIX = 'qplan:day:';          // + YYYY-MM-DD, only non-empty days
const SETTINGS_STORAGE_KEY = 'qplan:settings';

// Keys that jump to an hour. Press twice for the same hour +12.
const HOUR_KEYS = { Minus: 10, Equal: 11, NumpadSubtract: 10 };
for (let d = 0; d <= 9; d++) {
  HOUR_KEYS['Digit' + d] = d;
  HOUR_KEYS['Numpad' + d] = d;
}

/* ==========================================================================
   State
   ========================================================================== */
// Data saved before the app was renamed to QPlan moves to the new keys.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('quickplanner:')) continue;
    localStorage.setItem(key.replace('quickplanner:', 'qplan:'), localStorage.getItem(key));
    localStorage.removeItem(key);
  }
} catch { /* storage blocked */ }

const state = {
  date: null,        // the day shown, local midnight
  todos: [],
  events: [],        // { id, start, end, name, tone } — start/end in quarters, end exclusive
  cursor: 0,         // quarter index, 0..95
  editingId: null,   // id of the event whose name is being typed
};

const settings = { timeFormat: '12h', ...storageGet(SETTINGS_STORAGE_KEY) };   // '12h' | '24h'

// Told about every saved change. sync.js replaces these to copy changes to the cloud.
const syncHooks = {
  dayChanged(key) {},       // key: YYYY-MM-DD
  settingsChanged() {},
};

let nextEventId = 1;
let lastHourPress = null;   // { code, time, pm }
let pendingDelete = null;   // { id, timer }
let lastPointerType = 'mouse';

/* ==========================================================================
   Helpers
   ========================================================================== */
const $ = (sel) => document.querySelector(sel);

const pad2 = (n) => String(n).padStart(2, '0');

// 24h: "09:30". am/pm: "9:30am", "9am".
function formatClock(h, m, format = settings.timeFormat) {
  if (format === '24h') return `${pad2(h)}:${pad2(m)}`;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad2(m)}${suffix}` : `${h12}${suffix}`;
}
const formatQuarter = (q, format) => formatClock(Math.floor(q / 4) % 24, (q % 4) * 15, format);
const formatRange = (start, end, format) => `${formatQuarter(start, format)} – ${formatQuarter(end, format)}`;

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked — the planner still works for this session */ }
}

const ICONS = {
  plus: 'M10 4.2c.1 3.9-.1 7.8.1 11.6M4.3 10.1c3.8-.2 7.6.1 11.4-.1',
  minus: 'M4.3 10.1c3.8-.2 7.6.1 11.4-.1',
  left: 'M12.3 4.6c-2.2 1.9-4.1 3.6-6 5.5 1.9 1.8 3.9 3.5 5.9 5.3',
  right: 'M7.7 4.6c2.2 1.9 4.1 3.6 6 5.5-1.9 1.8-3.9 3.5-5.9 5.3',
  menu: 'M4.2 5.9c3.9-.2 7.7.1 11.6-.1M4.2 10.1c3.9-.1 7.7 0 11.6-.1M4.2 14.2c3.9-.2 7.7.1 11.6-.1',
  avatar: 'M10.1 2.4c4.3-.1 7.6 3.3 7.5 7.6-.1 4.2-3.4 7.5-7.6 7.5-4.2.1-7.6-3.3-7.5-7.6.1-4.1 3.4-7.4 7.6-7.5zM10 5.2c1.6-.1 2.8 1.2 2.8 2.8 0 1.5-1.3 2.8-2.9 2.7-1.5 0-2.7-1.3-2.6-2.8.1-1.5 1.2-2.6 2.7-2.7zM5.2 15.3c1-2 2.7-3.1 4.9-3.1 2.1 0 3.8 1.1 4.8 3.2',
  trash: 'M4.5 6.1c3.7-.2 7.3.1 11-.1M8.2 5.9c0-1.1.1-1.7.2-2.2 1.1-.1 2.2 0 3.3-.1.1.6.1 1.3.1 2.2M5.9 6.4c.3 3.2.4 6.4.8 9.6 2.3.2 4.5 0 6.7.1.3-3.2.5-6.4.7-9.6',
};
const icon = (name, size = 16) =>
  `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><path d="${ICONS[name]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CHECK_BOX = 'M3.2 2.7c4.5-.4 9.4.3 14-.2.4 4.9-.2 9.8.3 14.8-4.9.5-9.8-.2-14.7.3-.4-5 .3-9.9.4-14.9z';
const CHECK_TICK = 'M5.4 10.4c1.3 1.1 2.4 2.5 3.3 4.1 2-4 4.6-7.4 8.3-10.6';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const getEvent = (id) => state.events.find((e) => e.id === id);
const eventAt = (q) => state.events.find((e) => e.start <= q && q < e.end);

// The earliest quarter at or after q where another event starts (or midnight).
function nextStartFrom(q, ignoreId) {
  let limit = QUARTERS;
  for (const e of state.events) {
    if (e.id !== ignoreId && e.start >= q && e.start < limit) limit = e.start;
  }
  return limit;
}

// A random tone, avoiding the ones of events directly touching this range when possible.
function pickTone(start, end) {
  const neighbours = state.events
    .filter((e) => e.end === start || e.start === end)
    .map((e) => e.tone);
  const free = EVENT_TONES.filter((tone) => !neighbours.includes(tone));
  const options = free.length ? free : EVENT_TONES;
  return options[Math.floor(Math.random() * options.length)];
}

function removeEvent(id) {
  state.events = state.events.filter((e) => e.id !== id);
}

/* ==========================================================================
   Schedule — DOM
   ========================================================================== */
const scheduleEl = $('#schedule');
const rowsEl = $('#rows');
const layerEl = $('#layer');
const cursorEl = $('#cursor');
const nowEl = $('#now');
const eventEls = new Map();   // id -> element

function buildRows() {
  const fragment = document.createDocumentFragment();
  for (let q = 0; q < QUARTERS; q++) {
    const row = document.createElement('div');
    row.className = 'row';
    if (q % 4 === 0) row.classList.add('is-hour');
    else if (q % 2 === 0) row.classList.add('is-half');
    if (q % 4 === 0) {
      const label = document.createElement('span');
      label.className = 'row-label sans-time';
      label.dataset.q = q;
      row.append(label);
    }
    fragment.append(row);
  }
  rowsEl.prepend(fragment);
}

function renderLabels() {
  for (const label of rowsEl.querySelectorAll('.row-label')) label.textContent = formatQuarter(Number(label.dataset.q));
}

const topAt = (q) => `calc(var(--row-height) * ${q})`;

function createEventEl(id) {
  const el = document.createElement('div');
  el.className = 'event';
  el.innerHTML = `
    <span class="event-name"></span>
    <input class="event-input" type="text" spellcheck="false" autocomplete="off">
    <span class="event-time"></span>
    <span class="event-confirm">Press delete again</span>
    <span class="event-actions">
      <button class="event-button event-resize" data-resize="-1" type="button" aria-label="Shorten">${icon('minus')}</button>
      <button class="event-button event-resize" data-resize="1" type="button" aria-label="Extend">${icon('plus')}</button>
      <button class="event-button event-delete" type="button" aria-label="Delete event">${icon('trash')}</button>
    </span>
  `;

  const input = el.querySelector('.event-input');
  input.addEventListener('input', () => {
    const ev = getEvent(id);
    if (ev) ev.name = input.value;
    saveDay();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); resizeEditing(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); resizeEditing(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); commitEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); }
  });
  input.addEventListener('blur', () => commitEdit(false));

  // Buttons must not steal focus from the input while editing.
  for (const button of el.querySelectorAll('.event-button')) {
    button.addEventListener('mousedown', (e) => e.preventDefault());
  }
  for (const button of el.querySelectorAll('.event-resize')) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      resizeEditing(Number(button.dataset.resize));
    });
  }
  el.querySelector('.event-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.editingId === id) state.editingId = null;
    clearPendingDelete();
    removeEvent(id);
    render();
    scheduleEl.focus({ preventScroll: true });
  });

  el.addEventListener('dblclick', () => {
    const ev = getEvent(id);
    if (ev && state.editingId !== id) startEdit(ev);
  });

  return el;
}

function renderEvents() {
  const seen = new Set();
  for (const ev of state.events) {
    let el = eventEls.get(ev.id);
    if (!el) {
      el = createEventEl(ev.id);
      eventEls.set(ev.id, el);
      layerEl.append(el);
    }
    seen.add(ev.id);

    const isEditing = state.editingId === ev.id;
    el.style.top = topAt(ev.start);
    el.style.height = `calc(var(--row-height) * ${ev.end - ev.start} - 3px)`;
    el.dataset.tone = ev.tone;
    el.classList.toggle('is-short', ev.end - ev.start <= 2);
    el.classList.toggle('is-single', ev.end - ev.start === 1);
    el.classList.toggle('is-editing', isEditing);
    el.classList.toggle('is-pending-delete', pendingDelete?.id === ev.id);
    el.querySelector('.event-time').textContent = formatRange(ev.start, ev.end);
    if (!isEditing) el.querySelector('.event-name').textContent = ev.name;
  }
  for (const [id, el] of eventEls) {
    if (!seen.has(id)) {
      el.remove();
      eventEls.delete(id);
    }
  }
}

function render() {
  cursorEl.style.top = topAt(state.cursor);
  // While editing, the event's own outline shows the range; a cursor on top would double the border.
  cursorEl.classList.toggle('is-hidden', state.editingId !== null);
  renderEvents();
  $('#export').disabled = !state.events.some((e) => e.name.trim());
  saveDay();
}

function scrollToCursor(block = 'nearest') {
  cursorEl.scrollIntoView({ block });
}

function renderNowLine() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  nowEl.hidden = !isViewingToday();
  nowEl.style.top = topAt(minutes / 15);
  nowEl.firstElementChild.textContent = formatClock(now.getHours(), now.getMinutes());
}

/* ==========================================================================
   Schedule — actions
   ========================================================================== */
function setCursor(q, block) {
  state.cursor = clamp(q, 0, QUARTERS - 1);
  clearPendingDelete();
  render();
  scrollToCursor(block);
}

function jumpToHour(code) {
  const now = performance.now();
  const base = HOUR_KEYS[code];
  const isSecondPress = lastHourPress
    && lastHourPress.code === code
    && !lastHourPress.pm
    && now - lastHourPress.time < DOUBLE_PRESS_MS;
  const pm = isSecondPress;
  lastHourPress = { code, time: now, pm };
  setCursor((base + (pm ? 12 : 0)) * 4, 'center');
}

// Typing on an empty slot creates a 15-min event; on an existing event it replaces the name.
function typeAt(q, text) {
  const existing = eventAt(q);
  if (existing) {
    startEdit(existing, text);
    return;
  }
  const end = Math.min(q + NEW_EVENT_QUARTERS, nextStartFrom(q));
  const ev = { id: nextEventId++, start: q, end, name: '', tone: pickTone(q, end) };
  state.events.push(ev);
  startEdit(ev, text);
}

// text === undefined keeps the current name (append mode).
function startEdit(ev, text) {
  clearPendingDelete();
  if (text !== undefined) ev.name = text;
  state.editingId = ev.id;
  state.cursor = ev.end - 1;
  render();

  const input = eventEls.get(ev.id).querySelector('.event-input');
  input.value = ev.name;
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  scrollToCursor();
}

function resizeEditing(delta) {
  const ev = getEvent(state.editingId);
  if (!ev) return;
  if (delta > 0 && ev.end < nextStartFrom(ev.end, ev.id)) ev.end++;
  if (delta < 0 && ev.end - ev.start > 1) ev.end--;
  state.cursor = ev.end - 1;
  render();
  scrollToCursor();
}

function commitEdit(refocus) {
  if (state.editingId === null) return;
  const ev = getEvent(state.editingId);
  state.editingId = null;
  if (ev) {
    ev.name = ev.name.trim();
    if (ev.name) state.cursor = Math.min(ev.end, QUARTERS - 1);
    else removeEvent(ev.id);
  }
  render();
  if (refocus) {
    scheduleEl.focus({ preventScroll: true });
    scrollToCursor();
  }
}

function clearPendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  pendingDelete = null;
}

function requestDelete() {
  const ev = eventAt(state.cursor);
  if (!ev) return;
  if (pendingDelete?.id === ev.id) {
    clearPendingDelete();
    removeEvent(ev.id);
    render();
    return;
  }
  clearPendingDelete();
  pendingDelete = {
    id: ev.id,
    timer: setTimeout(() => { pendingDelete = null; render(); }, DELETE_CONFIRM_MS),
  };
  render();
}

function onScheduleKey(e) {
  if (state.editingId !== null) return;   // the event's input handles its own keys
  if (e.metaKey || e.ctrlKey) return;

  if (e.code in HOUR_KEYS && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    jumpToHour(e.code);
    return;
  }

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      setCursor(state.cursor - 1);
      return;
    case 'ArrowDown':
      e.preventDefault();
      setCursor(state.cursor + 1);
      return;
    case 'Enter': {
      const ev = eventAt(state.cursor);
      if (ev) {
        e.preventDefault();
        startEdit(ev);
      }
      return;
    }
    case 'Backspace':
    case 'Delete':
      e.preventDefault();
      requestDelete();
      return;
  }

  if (e.key.length === 1 && e.key.trim() !== '') {
    e.preventDefault();
    typeAt(state.cursor, e.key);
  }
}

function quarterFromPointer(clientY) {
  const rect = rowsEl.getBoundingClientRect();
  const rowHeight = rowsEl.firstElementChild.getBoundingClientRect().height;
  return clamp(Math.floor((clientY - rect.top) / rowHeight), 0, QUARTERS - 1);
}

function onScheduleClick(e) {
  if (e.target.closest('.event-button, .event-input')) return;
  const q = quarterFromPointer(e.clientY);

  // Touch devices have no arrow keys or typing without an input: tap opens the editor.
  if (lastPointerType === 'touch') {
    state.cursor = q;
    const existing = eventAt(q);
    if (existing) startEdit(existing);
    else typeAt(q, '');
    return;
  }
  setCursor(q);
}

scheduleEl.addEventListener('keydown', onScheduleKey);
scheduleEl.addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType; });
rowsEl.addEventListener('click', onScheduleClick);

// Nothing focused? Keys go to the schedule, so you can just start typing.
document.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement !== document.body) return;
  if (e.metaKey || e.ctrlKey || e.key === 'Tab') return;
  scheduleEl.focus({ preventScroll: true });
  onScheduleKey(e);
});

/* ==========================================================================
   To-do list
   ========================================================================== */
const todoPriorityEl = $('#todo-priority');
const todoRestEl = $('#todo-rest');

function createTodoEl(todo, index) {
  const li = document.createElement('li');
  li.className = 'task';

  if (index < PRIORITY_TODOS) {
    li.classList.add('is-priority');
    const number = document.createElement('span');
    number.className = 'task-number hand-task';
    number.textContent = index + 1;
    li.append(number);
  }

  const label = document.createElement('label');
  label.className = 'check';
  label.innerHTML = `
    <input type="checkbox" class="check-input" aria-label="Done">
    <svg class="check-box" viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
      <path class="check-frame" d="${CHECK_BOX}"/>
      <path class="check-tick" d="${CHECK_TICK}" pathLength="1"/>
    </svg>`;
  const check = label.querySelector('.check-input');
  check.addEventListener('change', () => {
    todo.done = check.checked;
    paintDone(li, todo.done);
    saveDay();
  });

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'task-text';
  text.value = todo.text;
  text.addEventListener('input', () => {
    todo.text = text.value;
    saveDay();
  });
  text.addEventListener('keydown', (e) => onTodoKey(e, index, check));

  li.append(label, text);
  paintDone(li, todo.done);
  return li;
}

// Ticks or unticks a row. Changing an existing row animates the tick (styles.css).
function paintDone(li, done) {
  li.querySelector('.check-input').checked = done;
  li.classList.toggle('is-done', done);
  li.querySelector('.check').classList.toggle('is-checked', done);
}

function renderTodos(focusIndex) {
  todoPriorityEl.replaceChildren();
  todoRestEl.replaceChildren();
  state.todos.forEach((todo, i) => {
    (i < PRIORITY_TODOS ? todoPriorityEl : todoRestEl).append(createTodoEl(todo, i));
  });
  if (focusIndex !== undefined) focusTodo(focusIndex);
  saveDay();
}

function focusTodo(index) {
  const input = document.querySelectorAll('.task-text')[index];
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function onTodoKey(e, index, check) {
  if (e.isComposing) return;
  const isLast = index === state.todos.length - 1;

  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    check.checked = !check.checked;
    check.dispatchEvent(new Event('change'));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (isLast) {
      state.todos.push({ text: '', done: false });
      renderTodos(index + 1);
    } else {
      focusTodo(index + 1);
    }
  } else if (e.key === 'Backspace' && e.target.value === '' && index >= DEFAULT_TODOS) {
    e.preventDefault();
    state.todos.splice(index, 1);
    renderTodos(index - 1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusTodo(index + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusTodo(index - 1);
  }
}

/* ==========================================================================
   Days — navigation and browser storage (only days with something in them are kept)
   ========================================================================== */
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const dayKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const dayStorageKey = (date) => DAY_STORAGE_PREFIX + dayKey(date);
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const isViewingToday = () => state.date !== null && dayKey(state.date) === dayKey(new Date());
const hasPlans = (date) => storageGet(dayStorageKey(date)) !== null;

function saveDay() {
  if (!state.date) return;
  const events = state.events
    .filter((e) => e.name.trim())
    .map(({ id, start, end, name, tone }) => ({ id, start, end, name: name.trim(), tone }));
  const todos = state.todos.map(({ text, done }) => ({ text, done }));
  const isEmpty = events.length === 0 && todos.every((t) => !t.text.trim());
  const value = isEmpty ? null : { todos, events };
  const key = dayStorageKey(state.date);
  if (JSON.stringify(storageGet(key)) === JSON.stringify(value)) return;   // e.g. just opening a day
  storageSet(key, value);
  syncHooks.dayChanged(dayKey(state.date));
}

// Reads the shown day from storage into state and redraws the to-do list.
function loadDay() {
  readSavedDay();
  for (const el of eventEls.values()) el.remove();
  eventEls.clear();
  renderTodos();
}

function readSavedDay() {
  const saved = storageGet(dayStorageKey(state.date));
  state.todos = (saved?.todos || []).map((t) => ({ text: t.text || '', done: !!t.done }));
  while (state.todos.length < DEFAULT_TODOS) state.todos.push({ text: '', done: false });
  state.events = (saved?.events || []).map((e) => ({ ...e }));
  nextEventId = Math.max(0, ...state.events.map((e) => e.id)) + 1;
}

function showDay(date) {
  commitEdit(false);
  clearPendingDelete();

  state.date = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  $('#date').textContent = dateFormat.format(state.date);
  loadDay();
  const now = new Date();
  state.cursor = isViewingToday()
    ? Math.floor((now.getHours() * 60 + now.getMinutes()) / 15)
    : FIRST_VISIBLE_HOUR * 4;
  render();
  renderNowLine();
  scrollToFirstHour();
}

// Shows a change to the open day made on another device (sync.js). Updates the page in
// place, so ticks animate and the cursor, scroll and focused to-do line stay put.
// Not called while an event is being edited.
function reloadDay() {
  const rows = document.querySelectorAll('.task');
  const focusedTodo = [...document.querySelectorAll('.task-text')].indexOf(document.activeElement);
  const oldTodos = state.todos;
  clearPendingDelete();
  readSavedDay();   // events are reconciled by id in render()

  if (state.todos.length === oldTodos.length) {
    // The rows' handlers hold the old to-do objects, so update those.
    state.todos.forEach((todo, i) => {
      Object.assign(oldTodos[i], todo);
      const input = rows[i].querySelector('.task-text');
      if (input.value !== todo.text) input.value = todo.text;
      paintDone(rows[i], todo.done);
    });
    state.todos = oldTodos;
  } else {
    renderTodos();
    if (focusedTodo !== -1) focusTodo(Math.min(focusedTodo, state.todos.length - 1));
  }
  render();
}

// Earlier hours are a scroll up.
function scrollToFirstHour() {
  const firstRow = rowsEl.children[FIRST_VISIBLE_HOUR * 4];
  scheduleEl.scrollTop += firstRow.getBoundingClientRect().top - scheduleEl.getBoundingClientRect().top - 12;
}

$('#prev-day').addEventListener('click', () => showDay(addDays(state.date, -1)));
$('#next-day').addEventListener('click', () => showDay(addDays(state.date, 1)));

/* ==========================================================================
   Time format — am/pm (default) or 24h, remembered in the browser
   ========================================================================== */
function applyTimeFormat() {
  for (const button of document.querySelectorAll('[data-format]')) {
    button.setAttribute('aria-pressed', String(button.dataset.format === settings.timeFormat));
  }
  renderLabels();
  renderEvents();
  renderNowLine();
}

for (const button of document.querySelectorAll('[data-format]')) {
  button.addEventListener('click', () => {
    settings.timeFormat = button.dataset.format;
    storageSet(SETTINGS_STORAGE_KEY, settings);
    applyTimeFormat();
    syncHooks.settingsChanged();
  });
}

/* ==========================================================================
   Init
   ========================================================================== */
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 20);

buildRows();
applyTimeFormat();
showDay(new Date());
setInterval(renderNowLine, 30 * 1000);
