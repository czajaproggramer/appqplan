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

// Keys that jump to an hour. Press twice for the same hour +12.
const HOUR_KEYS = { Minus: 10, Equal: 11, NumpadSubtract: 10 };
for (let d = 0; d <= 9; d++) {
  HOUR_KEYS['Digit' + d] = d;
  HOUR_KEYS['Numpad' + d] = d;
}

/* ==========================================================================
   State
   ========================================================================== */
const state = {
  todos: Array.from({ length: DEFAULT_TODOS }, () => ({ text: '', done: false })),
  events: [],        // { id, start, end, name, tone } — start/end in quarters, end exclusive
  cursor: 0,         // quarter index, 0..95
  editingId: null,   // id of the event whose name is being typed
};

let nextEventId = 1;
let lastHourPress = null;   // { code, time, pm }
let pendingDelete = null;   // { id, timer }
let lastPointerType = 'mouse';

/* ==========================================================================
   Helpers
   ========================================================================== */
const $ = (sel) => document.querySelector(sel);

function formatQuarter(q) {
  const h = Math.floor(q / 4) % 24;
  const m = (q % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const formatRange = (start, end) => `${formatQuarter(start)} – ${formatQuarter(end)}`;

const ICONS = {
  plus: 'M10 4.2c.1 3.9-.1 7.8.1 11.6M4.3 10.1c3.8-.2 7.6.1 11.4-.1',
  minus: 'M4.3 10.1c3.8-.2 7.6.1 11.4-.1',
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
      label.textContent = formatQuarter(q);
      row.append(label);
    }
    fragment.append(row);
  }
  rowsEl.prepend(fragment);
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
}

function scrollToCursor(block = 'nearest') {
  cursorEl.scrollIntoView({ block });
}

function renderNowLine() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  nowEl.style.top = topAt(minutes / 15);
  nowEl.firstElementChild.textContent =
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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
  check.checked = todo.done;
  const syncDone = () => {
    li.classList.toggle('is-done', todo.done);
    label.classList.toggle('is-checked', todo.done);
  };
  check.addEventListener('change', () => {
    todo.done = check.checked;
    syncDone();
  });
  syncDone();

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'task-text';
  text.value = todo.text;
  text.addEventListener('input', () => { todo.text = text.value; });
  text.addEventListener('keydown', (e) => onTodoKey(e, index, check));

  li.append(label, text);
  return li;
}

function renderTodos(focusIndex) {
  todoPriorityEl.replaceChildren();
  todoRestEl.replaceChildren();
  state.todos.forEach((todo, i) => {
    (i < PRIORITY_TODOS ? todoPriorityEl : todoRestEl).append(createTodoEl(todo, i));
  });
  if (focusIndex !== undefined) focusTodo(focusIndex);
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
   Init
   ========================================================================== */
$('#date').textContent = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date());

buildRows();
renderTodos();
renderNowLine();
setInterval(renderNowLine, 30 * 1000);

const now = new Date();
state.cursor = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);
render();

// The schedule opens with 06:00 as the first visible hour (earlier hours are a scroll up).
const FIRST_VISIBLE_HOUR = 6;
const firstRow = rowsEl.children[FIRST_VISIBLE_HOUR * 4];
scheduleEl.scrollTop += firstRow.getBoundingClientRect().top - scheduleEl.getBoundingClientRect().top - 12;
