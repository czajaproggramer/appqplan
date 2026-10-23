'use strict';

/* ==========================================================================
   Google Calendar — sends QPlan blocks one way to a "QPlan" calendar in the person's
   Google account (the one they log in with), through the Netlify Functions in
   netlify/functions/. The server reads the days from Firestore itself; this file only
   connects, says "something changed", disconnects, and shows the state in the account menu.
   Connecting uses Google's own pop-up (Google Identity Services, loaded on demand).
   Uses currentUser, calendarHooks, askDialog, closeAccountMenu and accountButtonEl from
   sync.js, and dayKey and addDays from app.js. Setup: firebase/README.md.
   ========================================================================== */
const GOOGLE_CLIENT_ID = null;   // firebase/README.md "Google Calendar sync" step 3; null keeps the "Soon" placeholder
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CALENDAR_SYNC_DELAY_MS = 4000;   // waits for a pause in editing
const HEAL_DAYS = 8;                   // today and the next week are re-checked once per page load
const MAX_SYNC_ROUNDS = 20;            // each function call works for about 7 s

let calendarState = null;   // users/{uid}.calendar: { status: 'connected' | 'reconnect' | 'removed', email }
let calendarBusy = false;   // a connect, sync or disconnect call is running
let calendarConnecting = false;
let calendarAgain = false;  // a day was saved while busy: sync again afterwards
let calendarTimer = null;
let calendarHealed = false; // this page load already re-checked the coming days
let calendarMessage = '';   // an error to show under the item
let calendarLoggedIn = false;
let googleScript = null;

const calendarConnectEl = document.getElementById('calendar-connect');
const calendarLabelEl = document.getElementById('calendar-label');
const calendarNoteEl = document.getElementById('calendar-note');
const calendarDisconnectEl = document.getElementById('calendar-disconnect');
const calendarDialogEl = document.getElementById('calendar-dialog');
const deleteCalendarRowEl = document.getElementById('delete-calendar-row');
const deleteCalendarEl = document.getElementById('delete-calendar');

const CONNECT_ERRORS = {
  'wrong-account': () => `Pick the Google account you log in with (${currentUser?.email || 'the same one'}).`,
  'scope-missing': () => 'QPlan needs permission to manage its own calendar. Try again and leave that box ticked.',
  retry: () => 'Google needs one more try. Click Connect again.',
};

/* ---------- Talking to the functions ---------- */
async function callCalendar(name, body) {
  const token = await currentUser.getIdToken();
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`QPlan calendar: ${name} ${res.status}`), { code: data.error });
  return data;
}

const comingDays = () => Array.from({ length: HEAL_DAYS }, (_, i) => dayKey(addDays(new Date(), i)));

// Asks the server to send whatever changed. Calls again while it says there's more.
async function syncCalendar() {
  clearTimeout(calendarTimer);
  if (calendarState?.status !== 'connected' || !currentUser) return;
  if (calendarBusy) {
    calendarAgain = true;
    return;
  }
  calendarBusy = true;
  try {
    let heal = calendarHealed ? [] : comingDays();
    calendarHealed = true;
    for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
      const reply = await callCalendar('calendar-sync', { heal });
      heal = [];
      if (!reply.more) break;
    }
  } catch (error) {
    console.error(error);   // the server keeps track of what's unsent; the next save retries
  }
  calendarBusy = false;
  if (calendarAgain) {
    calendarAgain = false;
    scheduleCalendarSync();
  }
}

function scheduleCalendarSync() {
  clearTimeout(calendarTimer);
  calendarTimer = setTimeout(syncCalendar, CALENDAR_SYNC_DELAY_MS);
}

/* ---------- Connecting ---------- */
function loadGoogleScript() {
  googleScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      googleScript = null;
      reject(new Error('Google Identity Services did not load'));
    };
    document.head.append(script);
  });
  return googleScript;
}

// The pop-up must open right on the click, so Google's script is loaded when the account
// menu opens. If it still isn't there, this click loads it and the next one connects.
function connectCalendar() {
  if (calendarConnectEl.getAttribute('aria-disabled') === 'true' || !currentUser) return;
  if (!window.google?.accounts?.oauth2) {
    calendarMessage = 'Loading Google… click again in a moment.';
    renderCalendar();
    loadGoogleScript().then(
      () => { calendarMessage = ''; renderCalendar(); },
      () => { calendarMessage = 'Couldn\'t reach Google. Check your connection.'; renderCalendar(); },
    );
    return;
  }
  calendarMessage = '';
  google.accounts.oauth2.initCodeClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: `openid email ${CALENDAR_SCOPE}`,
    ux_mode: 'popup',
    login_hint: currentUser.email || undefined,
    select_account: false,
    callback: (response) => {
      if (response.code) finishConnecting(response.code);
      else if (response.error !== 'access_denied') showCalendarError();
    },
    error_callback: () => {},   // pop-up closed or blocked: nothing to report
  }).requestCode();
}

async function finishConnecting(code) {
  calendarBusy = true;
  calendarConnecting = true;
  renderCalendar();
  try {
    let reply = await callCalendar('calendar-connect', {
      code,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      today: dayKey(new Date()),
    });
    calendarHealed = true;   // connecting sends today onward anyway
    for (let round = 0; reply.more && round < MAX_SYNC_ROUNDS; round++) reply = await callCalendar('calendar-sync', {});
  } catch (error) {
    showCalendarError(error.code);
  }
  calendarBusy = false;
  calendarConnecting = false;
  renderCalendar();
}

function showCalendarError(code) {
  calendarMessage = CONNECT_ERRORS[code]?.() || 'Couldn\'t connect Google Calendar. Try again.';
  renderCalendar();
}

/* ---------- Disconnecting ---------- */
async function disconnectCalendar() {
  closeAccountMenu();
  const choice = await askDialog(calendarDialogEl);
  if (choice !== 'delete' && choice !== 'keep') return;
  calendarBusy = true;
  renderCalendar();
  try {
    await callCalendar('calendar-disconnect', { deleteCalendar: choice === 'delete' });
    calendarMessage = '';
  } catch (error) {
    console.error(error);
    calendarMessage = 'Couldn\'t disconnect Google Calendar. Try again.';
  }
  calendarBusy = false;
  renderCalendar();
}

/* ---------- Account menu ---------- */
function renderCalendar() {
  const status = calendarState?.status;
  const linked = status === 'connected' || status === 'reconnect';
  calendarConnectEl.hidden = calendarLoggedIn && status === 'connected';
  calendarConnectEl.setAttribute('aria-disabled', String(!calendarLoggedIn || calendarBusy));
  calendarLabelEl.textContent = calendarConnecting ? 'Connecting Google Calendar…'
    : status === 'reconnect' ? 'Reconnect Google Calendar'
      : 'Connect to Google Calendar';
  calendarDisconnectEl.hidden = !calendarLoggedIn || !linked;
  const note = calendarMessage
    || (!calendarLoggedIn ? 'Log in first to connect.'
      : status === 'connected' ? 'Google Calendar connected: your blocks show in the QPlan calendar.'
        : status === 'reconnect' ? 'Google stopped accepting QPlan\'s access.'
          : status === 'removed' ? 'The QPlan calendar was deleted in Google.' : '');
  calendarNoteEl.textContent = note;
  calendarNoteEl.hidden = !note;
  deleteCalendarRowEl.hidden = !linked;
}

if (GOOGLE_CLIENT_ID) {
  document.getElementById('calendar-soon').remove();
  calendarHooks.statusChanged = (calendar) => {
    const wasConnected = calendarState?.status === 'connected';
    calendarState = calendar || null;
    if (calendarState?.status === 'connected' && !wasConnected) syncCalendar();
    renderCalendar();
  };
  calendarHooks.daySaved = () => {
    if (calendarState?.status === 'connected') scheduleCalendarSync();
  };
  calendarHooks.loggedInChanged = (loggedIn) => {
    calendarLoggedIn = loggedIn;
    if (!loggedIn) {
      calendarState = null;
      calendarHealed = false;
    }
    renderCalendar();
  };
  // Deleting the account first ends the calendar link, so no Google access is left behind.
  calendarHooks.beforeAccountDelete = async () => {
    if (calendarState?.status !== 'connected' && calendarState?.status !== 'reconnect') return;
    await callCalendar('calendar-disconnect', { deleteCalendar: deleteCalendarEl.checked });
  };

  accountButtonEl.addEventListener('click', () => {
    if (calendarLoggedIn && calendarState?.status !== 'connected') loadGoogleScript().catch(() => {});
  });
  calendarConnectEl.addEventListener('click', connectCalendar);
  calendarDisconnectEl.addEventListener('click', disconnectCalendar);
  calendarLoggedIn = Boolean(currentUser) || syncMeta.loggedIn;   // sync.js may have shown the menu before this file loaded
  renderCalendar();
}
