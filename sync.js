'use strict';

/* ==========================================================================
   Sync — optional Google log-in that keeps days and settings in Firestore.
   localStorage stays the copy the app reads and writes; this file copies changes
   both ways. Each day is one document; the newer edit of a day wins.
   The Firebase SDK is loaded only when someone logs in (or was logged in here).
   Uses state, settings, syncHooks, storageGet, storageSet, dayKey, reloadDay,
   applyTimeFormat, DAY_STORAGE_PREFIX and SETTINGS_STORAGE_KEY from app.js.
   Setup and local emulators: firebase/README.md.
   ========================================================================== */
// The web config from firebase/README.md step 6 (public by design); null hides "Log in".
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyClyVEA3QYEvDHVBIvRYwKd5LpvR1zWuoU',
  authDomain: 'qplan-5c4d7.firebaseapp.com',
  projectId: 'qplan-5c4d7',
  storageBucket: 'qplan-5c4d7.firebasestorage.app',
  messagingSenderId: '767476665721',
  appId: '1:767476665721:web:cf845777dfb2a3f71c33a8',
};
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const SYNC_STORAGE_KEY = 'qplan:sync';
const PUSH_DELAY_MS = 1500;         // waits for a pause in typing before writing
const REMOTE_APPLY_DELAY_MS = 2000; // a change from another device waits until local typing pauses
const USE_EMULATORS = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulators');

// What this device knows about syncing. Day entries are kept even while logged out,
// so edits made then are pushed on the next log-in.
// { uid, loggedIn, days: { 'YYYY-MM-DD': { t, dirty } }, settings: { t, dirty } }
//   t: when that copy was last edited (ms); dirty: not yet written to the cloud.
const syncMeta = {
  uid: null,
  loggedIn: false,
  days: {},
  settings: { t: 0, dirty: false },
  ...storageGet(SYNC_STORAGE_KEY),
};
const saveSyncMeta = () => storageSet(SYNC_STORAGE_KEY, syncMeta);

let firebase = null;          // promise of { auth, db, a: auth module, f: firestore module }
let currentUser = null;       // set only once the account is linked and listening
let unsubscribers = [];
let pushTimer = null;
const inFlight = new Map();   // path -> t being written
let lastLocalEdit = 0;
let remoteApplyTimer = null;
let serverConfirmed = false;  // the last snapshot came from the server, not the cache
let writeFailed = false;

const accountButtonEl = document.getElementById('account-button');
const loginEl = document.getElementById('login');
const statusEl = document.getElementById('sync-status');
const statusTextEl = document.getElementById('sync-text');
const accountMenuEl = document.getElementById('account-menu');
const mergeDialogEl = document.getElementById('merge-dialog');
const deleteDialogEl = document.getElementById('delete-dialog');

// Told about the account's Google Calendar link and the days that reach the server.
// calendar.js replaces these.
const calendarHooks = {
  statusChanged(calendar) {},          // users/{uid}.calendar, or undefined
  daySaved() {},                       // a day was confirmed by the server
  loggedInChanged(loggedIn) {},
  async beforeAccountDelete() {},      // after re-authentication, before the data goes
};

/* ---------- Local changes (always tracked) ---------- */
syncHooks.dayChanged = (key) => {
  syncMeta.days[key] = { t: Date.now(), dirty: true };
  saveSyncMeta();
  lastLocalEdit = Date.now();
  schedulePush();
};
syncHooks.settingsChanged = () => {
  syncMeta.settings = { t: Date.now(), dirty: true };
  saveSyncMeta();
  schedulePush();
};

function localDayKeys() {
  const keys = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DAY_STORAGE_PREFIX)) keys.push(key.slice(DAY_STORAGE_PREFIX.length));
    }
  } catch { /* storage blocked */ }
  return keys;
}

// Writes a day that came from the cloud (data null removes it) and records it as in sync.
function writeLocalDay(key, data, t) {
  storageSet(DAY_STORAGE_PREFIX + key, data ? { todos: data.todos || [], events: data.events || [] } : null);
  syncMeta.days[key] = { t, dirty: false };
}

/* ---------- Firebase ---------- */
function loadFirebase() {
  firebase ??= (async () => {
    const [{ initializeApp }, a, f] = await Promise.all([
      import(FIREBASE_SDK + 'firebase-app.js'),
      import(FIREBASE_SDK + 'firebase-auth.js'),
      import(FIREBASE_SDK + 'firebase-firestore.js'),
    ]);
    const config = USE_EMULATORS
      ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-qplan' }
      : FIREBASE_CONFIG;
    const app = initializeApp(config);
    const auth = a.getAuth(app);
    const db = f.getFirestore(app);
    if (USE_EMULATORS) {
      a.connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      f.connectFirestoreEmulator(db, 'localhost', 8080);
    }
    a.onAuthStateChanged(auth, onAuthChanged);
    return { auth, db, a, f };
  })();
  firebase.catch(() => { firebase = null; });   // a failed load (offline) can be retried
  return firebase;
}

const daysCollection = (fb, uid) => fb.f.collection(fb.db, 'users', uid, 'days');
const userDoc = (fb, uid) => fb.f.doc(fb.db, 'users', uid);

async function onAuthChanged(user) {
  if (!user) {
    stopSync();
    if (syncMeta.loggedIn) { syncMeta.loggedIn = false; saveSyncMeta(); }
    showStatus();
    return;
  }
  if (currentUser?.uid === user.uid) return;
  if (syncMeta.uid !== user.uid) {
    showStatus('connecting');
    let linked = false;
    try {
      linked = await linkAccount(user);
    } catch (error) {
      console.error('QPlan sync:', error);
      alert('Couldn\'t reach your account. Check your connection and log in again.');
    }
    if (!linked) {
      const fb = await firebase;
      await fb.a.signOut(fb.auth);
      return;
    }
    syncMeta.uid = user.uid;
  }
  syncMeta.loggedIn = true;
  saveSyncMeta();
  await startSync(user);
}

/* ---------- First log-in on this device: combine the device's days with the account's ---------- */
async function linkAccount(user) {
  const fb = await firebase;
  const [daysSnap, userSnap] = await Promise.all([
    fb.f.getDocs(daysCollection(fb, user.uid)),
    fb.f.getDoc(userDoc(fb, user.uid)),
  ]);
  const remote = new Map();   // key -> data; deleted days don't count here
  for (const d of daysSnap.docs) if (!d.data().deleted) remote.set(d.id, d.data());
  const local = localDayKeys();

  let choice = 'combine';
  if (local.length && remote.size) choice = await askHowToCombine(local.length, remote.size);
  if (choice === 'cancel') return false;

  // Start from a clean record: entries left from another account must not be pushed here.
  // Whatever this device sends gets the current time, so every other device takes it.
  const previous = syncMeta.days;
  syncMeta.days = {};
  const now = Date.now();
  const pushDay = (key) => { syncMeta.days[key] = { t: now, dirty: true }; };
  for (const key of local) {
    const r = remote.get(key);
    if (!r && choice === 'cloud') storageSet(DAY_STORAGE_PREFIX + key, null);
    else if (!r || choice === 'device' || (choice === 'combine' && (previous[key]?.t || 0) > r.updatedAt)) pushDay(key);
    else writeLocalDay(key, r, r.updatedAt);
  }
  for (const [key, r] of remote) {
    if (local.includes(key)) continue;
    if (choice === 'device') pushDay(key);   // no local copy, so this removes it from the cloud
    else writeLocalDay(key, r, r.updatedAt);
  }

  const remoteSettings = userSnap.data();
  if (remoteSettings?.settings && choice !== 'device'
      && (choice === 'cloud' || remoteSettings.settingsUpdatedAt >= syncMeta.settings.t)) {
    applyRemoteSettings(remoteSettings);
  } else {
    syncMeta.settings = { t: now, dirty: true };
  }
  saveSyncMeta();
  refreshOpenDay();
  return true;
}

// Resolves to 'combine' | 'device' | 'cloud' | 'cancel'.
function askHowToCombine(localCount, remoteCount) {
  const days = (n) => `${n} saved ${n === 1 ? 'day' : 'days'}`;
  document.getElementById('merge-local').textContent = days(localCount);
  document.getElementById('merge-cloud').textContent = days(remoteCount);
  return askDialog(mergeDialogEl);
}

// Opens a <dialog> and resolves to the value of the button that closed it, or 'cancel' for Esc.
function askDialog(dialog) {
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.querySelector('form').addEventListener('submit', (e) => resolve(e.submitter?.value || 'cancel'), { once: true });
    dialog.addEventListener('close', () => resolve(dialog.returnValue || 'cancel'), { once: true });
  });
}

/* ---------- Live sync ---------- */
async function startSync(user) {
  const fb = await firebase;
  currentUser = user;
  serverConfirmed = false;
  writeFailed = false;
  document.getElementById('account-email').textContent = user.email || '';
  unsubscribers = [
    fb.f.onSnapshot(daysCollection(fb, user.uid), { includeMetadataChanges: true }, (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'removed') applyRemoteDay(change.doc.id, change.doc.data());
        // Days are never removed, only marked deleted, except when the account is deleted on
        // another device. Reloading the user then fails and Firebase logs this device out.
        else fb.auth.currentUser?.reload().catch(() => {});
      }
      serverConfirmed = !snap.metadata.fromCache;
      showStatus();
    }, onSyncError),
    fb.f.onSnapshot(userDoc(fb, user.uid), (snap) => {
      const data = snap.data();
      if (data?.settings && data.settingsUpdatedAt > syncMeta.settings.t) {
        applyRemoteSettings(data);
        saveSyncMeta();
      }
      calendarHooks.statusChanged(data?.calendar);
    }, onSyncError),
  ];
  push();
}

function stopSync() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  currentUser = null;
  clearTimeout(pushTimer);
  inFlight.clear();
}

function applyRemoteDay(key, data) {
  const local = syncMeta.days[key];
  if (local && local.t >= data.updatedAt) {
    if (local.t > data.updatedAt && !local.dirty) { local.dirty = true; schedulePush(); }
    return;   // our own write coming back, or this device has a newer edit
  }
  writeLocalDay(key, data.deleted ? null : data, data.updatedAt);
  saveSyncMeta();
  if (state.date && key === dayKey(state.date)) refreshOpenDay();
}

// Redraws the open day, but never under someone typing: an event being edited, or a
// to-do typed into in the last moments, waits. Whatever is saved last wins.
function refreshOpenDay() {
  clearTimeout(remoteApplyTimer);
  const wait = lastLocalEdit + REMOTE_APPLY_DELAY_MS - Date.now();
  if (state.editingId !== null || wait > 0) {
    remoteApplyTimer = setTimeout(refreshOpenDay, Math.max(wait, 500));
    return;
  }
  reloadDay();
}

function applyRemoteSettings(data) {
  if (data.settings.timeFormat === '12h' || data.settings.timeFormat === '24h') {
    settings.timeFormat = data.settings.timeFormat;
    storageSet(SETTINGS_STORAGE_KEY, settings);
    applyTimeFormat();
  }
  syncMeta.settings = { t: data.settingsUpdatedAt, dirty: false };
}

function schedulePush() {
  if (!currentUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DELAY_MS);
}

// Writes every unsynced day and the settings. Each write is marked done only when the
// server confirms it, so anything unconfirmed is retried after a reload.
async function push() {
  if (!currentUser) return;
  const fb = await firebase;
  const uid = currentUser.uid;

  const write = (ref, data, t, onDone) => {
    if (inFlight.get(ref.path) === t) return;
    inFlight.set(ref.path, t);
    fb.f.setDoc(ref, data, { merge: true }).then(() => {
      if (inFlight.get(ref.path) === t) inFlight.delete(ref.path);
      if (currentUser?.uid !== uid) return;
      onDone();
      saveSyncMeta();
      writeFailed = false;
      showStatus();
    }, (error) => {
      inFlight.delete(ref.path);
      onSyncError(error);
    });
  };

  for (const [key, meta] of Object.entries(syncMeta.days)) {
    if (!meta.dirty) continue;
    const t = meta.t;
    const day = storageGet(DAY_STORAGE_PREFIX + key);
    // tz: the zone this day was planned in (Google Calendar sync). serverUpdatedAt lets the
    // calendar function find days saved since its last run, whatever the device clocks say.
    const data = {
      ...(day ? { todos: day.todos, events: day.events, deleted: false } : { todos: [], events: [], deleted: true }),
      updatedAt: t,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      serverUpdatedAt: fb.f.serverTimestamp(),
    };
    write(fb.f.doc(daysCollection(fb, uid), key), data, t, () => {
      if (syncMeta.days[key]?.t === t) syncMeta.days[key].dirty = false;
      calendarHooks.daySaved();
    });
  }
  if (syncMeta.settings.dirty) {
    const t = syncMeta.settings.t;
    write(userDoc(fb, uid), { settings: { timeFormat: settings.timeFormat }, settingsUpdatedAt: t }, t, () => {
      if (syncMeta.settings.t === t) syncMeta.settings.dirty = false;
    });
  }
}

function onSyncError(error) {
  console.error('QPlan sync:', error);
  writeFailed = true;
  showStatus();
}

/* ---------- Avatar menu: "Log in", or the account, its synced / offline status and actions ---------- */
function showStatus(override) {
  // syncMeta.loggedIn covers a logged-in device that can't load Firebase (offline at start).
  const loggedIn = Boolean(currentUser) || syncMeta.loggedIn || override === 'connecting';
  loginEl.hidden = loggedIn;
  for (const el of accountMenuEl.querySelectorAll('[data-logged-in]')) el.hidden = !loggedIn;
  calendarHooks.loggedInChanged(loggedIn);
  if (!loggedIn) return;
  const status = override
    || (navigator.onLine && serverConfirmed && !writeFailed ? 'synced' : 'offline');
  statusEl.dataset.status = status;
  statusTextEl.textContent = status === 'connecting' ? 'syncing' : status;
}

async function logIn() {
  const fb = await loadFirebase();
  try {
    await fb.a.signInWithPopup(fb.auth, new fb.a.GoogleAuthProvider());
  } catch (error) {
    // Closing the pop-up is not an error. A blocked pop-up works on the next click,
    // now that Firebase is loaded.
    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
      console.error('QPlan sync:', error);
    }
    showStatus();
  }
}

async function logOut() {
  closeAccountMenu();
  const fb = await firebase;
  stopSync();
  syncMeta.loggedIn = false;
  saveSyncMeta();
  await fb.a.signOut(fb.auth);
  showStatus();
}

// Two steps: the confirmation dialog, then Google asks the person to sign in again.
async function deleteAccount() {
  closeAccountMenu();
  if (await askDialog(deleteDialogEl) !== 'delete') return;

  const fb = await firebase;
  const user = fb.auth.currentUser;
  try {
    await fb.a.reauthenticateWithPopup(user, new fb.a.GoogleAuthProvider());
  } catch (error) {
    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
      console.error('QPlan sync:', error);
    }
    return;
  }
  stopSync();
  showStatus('connecting');
  try {
    await calendarHooks.beforeAccountDelete();
    const days = await fb.f.getDocs(daysCollection(fb, user.uid));
    const refs = [...days.docs.map((d) => d.ref), userDoc(fb, user.uid)];
    for (let i = 0; i < refs.length; i += 400) {
      const batch = fb.f.writeBatch(fb.db);
      for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
      await batch.commit();
    }
    await user.delete();
  } catch (error) {
    console.error('QPlan sync:', error);
    alert('Your account could not be deleted. Check your connection and try again.');
    await startSync(user);
    return;
  }
  // The days on this device stay. A later log-in counts as a first log-in again.
  syncMeta.uid = null;
  syncMeta.loggedIn = false;
  for (const meta of Object.values(syncMeta.days)) meta.dirty = false;
  syncMeta.settings.dirty = false;
  saveSyncMeta();
  showStatus();
}

function openAccountMenu() {
  accountMenuEl.hidden = false;
  accountButtonEl.setAttribute('aria-expanded', 'true');
}
function closeAccountMenu() {
  accountMenuEl.hidden = true;
  accountButtonEl.setAttribute('aria-expanded', 'false');
}

if (FIREBASE_CONFIG || USE_EMULATORS) {
  accountButtonEl.parentElement.hidden = false;
  showStatus();
  // Start fetching Firebase as soon as the avatar is approached, so the sign-in pop-up
  // opens right on the "Log in" click (browsers block pop-ups opened too long after it).
  for (const type of ['pointerenter', 'focus', 'touchstart']) {
    accountButtonEl.addEventListener(type, () => loadFirebase().catch(() => {}), { once: true, passive: true });
  }
  accountButtonEl.addEventListener('click', () => (accountMenuEl.hidden ? openAccountMenu() : closeAccountMenu()));
  loginEl.addEventListener('click', () => {
    closeAccountMenu();
    logIn();
  });
  document.getElementById('logout').addEventListener('click', logOut);
  document.getElementById('delete-account').addEventListener('click', deleteAccount);
  document.addEventListener('pointerdown', (e) => {
    if (!accountMenuEl.hidden && !accountMenuEl.contains(e.target) && !accountButtonEl.contains(e.target)) closeAccountMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !accountMenuEl.hidden) closeAccountMenu();
  });
  window.addEventListener('online', () => {
    if (syncMeta.loggedIn) loadFirebase().catch(() => {});
    showStatus();
  });
  window.addEventListener('offline', () => showStatus());

  if (syncMeta.loggedIn) {
    showStatus('connecting');
    loadFirebase().catch(() => showStatus());
  }
}
