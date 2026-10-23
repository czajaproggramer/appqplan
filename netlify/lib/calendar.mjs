/* ==========================================================================
   Google Calendar sync — shared by the functions in netlify/functions/.
   One way: QPlan → a "QPlan" calendar the app creates in the user's Google account
   (scope calendar.app.created). Firestore is the source of truth: every sync makes a
   day in Google match the day in Firestore exactly (QPlan wins).

   Firestore (Admin SDK, so the security rules don't apply here):
     calendarLinks/{uid}  { refreshToken, calendarId, googleSub, email, tz,
                            syncedUntil, backfillFrom, connectedAt }   — never readable by browsers
     users/{uid}.calendar { status: 'connected' | 'reconnect' | 'removed', email }   — read by calendar.js
   Environment (Netlify): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FIREBASE_PROJECT_ID,
   FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. Setup: firebase/README.md.
   ========================================================================== */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const QUARTERS = 96;
const TIME_BUDGET_MS = 7000;   // Netlify stops a function at 10 s; the browser calls again for the rest
const CHANGED_PAGE = 50;
const MAX_HEAL_DAYS = 14;
const EVENT_COLOR = '5';   // Google's "Banana": every QPlan block is yellow
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Replaceable in tests.
export const net = { fetch: (...args) => fetch(...args) };

/* ---------- Requests ---------- */
export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// Every function: POST only, a Firebase ID token in Authorization, a JSON body.
export async function handle(req, run) {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  try {
    const user = await caller(req);
    const body = await req.json().catch(() => ({}));
    return json(200, await run(user, body));
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.code });
    console.error(error);
    return json(500, { error: 'server' });
  }
}

function firebase() {
  if (!getApps().length) {
    const env = process.env;
    initializeApp(env.FIRESTORE_EMULATOR_HOST
      ? { projectId: env.FIREBASE_PROJECT_ID }
      : {
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        }),
      });
  }
  return { auth: getAuth(), db: getFirestore() };
}

async function caller(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  try {
    return await firebase().auth.verifyIdToken(token);
  } catch {
    throw new HttpError(401, 'unauthenticated');
  }
}

export const isDayKey = (key) => typeof key === 'string' && DAY_KEY.test(key);

export function isTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ---------- Google OAuth ---------- */
async function tokenRequest(params) {
  const res = await net.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Google token: ${data.error || res.status}`), { oauthError: data.error });
  return data;
}

// The code comes from the Google Identity Services pop-up, which uses redirect_uri "postmessage".
export const exchangeCode = (code) => tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });

// Throws { accessLost: true } when the person revoked QPlan's access in Google.
async function accessToken(refreshToken) {
  try {
    return (await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })).access_token;
  } catch (error) {
    if (error.oauthError === 'invalid_grant') error.accessLost = true;
    throw error;
  }
}

// Revoking any token of a grant ends the whole grant. Failures don't matter here.
export async function revoke(token) {
  if (!token) return;
  await net.fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => {});
}

// The ID token comes straight from Google's token endpoint over TLS, so its payload is trusted as is.
export function decodeIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
  } catch {
    return {};
  }
}

/* ---------- Google Calendar API ---------- */
// Returns api(method, path, { query, body }) for one access token.
export function calendarApi(token) {
  return async (method, path, { query, body } = {}) => {
    const url = new URL(CALENDAR_API + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    const res = await net.fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`Google ${method} ${path}: ${res.status}`), { status: res.status, data });
    return data;
  };
}

const eventsPath = (calendarId, id) =>
  `/calendars/${encodeURIComponent(calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ''}`;

async function listEvents(api, calendarId, query) {
  const items = [];
  let pageToken;
  do {
    const page = await api('GET', eventsPath(calendarId), { query: { ...query, maxResults: 250, pageToken } });
    items.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

export async function createCalendar(api, tz) {
  const calendar = await api('POST', '/calendars', {
    body: {
      summary: 'QPlan',
      description: 'Time blocks from QPlan (q-plan.netlify.app). Edit them in QPlan: changes made here are undone at the next sync.',
      timeZone: tz,
    },
  });
  return calendar.id;
}

export async function calendarExists(api, calendarId) {
  try {
    await api('GET', `/calendars/${encodeURIComponent(calendarId)}`);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

/* ---------- One day ---------- */
function shiftDay(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Wall time of a quarter on a day; quarter 96 is 00:00 the next day.
function wallTime(key, quarter) {
  const date = shiftDay(key, Math.floor(quarter / QUARTERS));
  const q = quarter % QUARTERS;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date}T${pad(Math.floor(q / 4))}:${pad((q % 4) * 15)}:00`;
}

// Google event ids use base32hex (0-9, a-v): "qp" + date + "e" + QPlan event id.
export const googleEventId = (key, id) => `qp${key.replaceAll('-', '')}e${id}`;

// The events a QPlan day should have in Google. Only named, valid events.
export function desiredEvents(key, day, tz) {
  if (!day || day.deleted) return [];
  return (day.events || [])
    .filter((e) => Number.isInteger(e.id) && e.id >= 0
      && Number.isInteger(e.start) && Number.isInteger(e.end)
      && e.start >= 0 && e.end <= QUARTERS && e.start < e.end
      && typeof e.name === 'string' && e.name.trim())
    .map((e) => ({
      id: googleEventId(key, e.id),
      summary: e.name.trim(),
      start: { dateTime: wallTime(key, e.start), timeZone: tz },
      end: { dateTime: wallTime(key, e.end), timeZone: tz },
      colorId: EVENT_COLOR,
      reminders: { useDefault: false },
      extendedProperties: { private: { qplanDay: key, qplanId: String(e.id) } },
      status: 'confirmed',
    }));
}

const wall = (time) => time?.dateTime?.slice(0, 19);
const isSame = (have, want) => have.summary === want.summary
  && have.colorId === want.colorId
  && wall(have.start) === want.start.dateTime && wall(have.end) === want.end.dateTime
  && have.start?.timeZone === want.start.timeZone
  && have.reminders?.useDefault === false && !have.reminders?.overrides?.length;

// Makes one day in the QPlan calendar match QPlan: updates, adds and removes events,
// including ones moved or added by hand in Google.
export async function syncDay(api, calendarId, key, day, tz) {
  const desired = desiredEvents(key, day, tz);
  const wanted = new Set(desired.map((e) => e.id));
  // Google returns times in this zone, so they compare with QPlan's wall times.
  const [ours, nearby] = await Promise.all([
    // Events QPlan made for this day, wherever they were moved to in Google
    listEvents(api, calendarId, { privateExtendedProperty: `qplanDay=${key}`, timeZone: tz }),
    // Anything added by hand around this date, in a window wide enough for every time zone
    listEvents(api, calendarId, {
      timeMin: `${key}T00:00:00+14:00`,
      timeMax: `${shiftDay(key, 1)}T00:00:00-12:00`,
      timeZone: tz,
    }),
  ]);
  const strays = nearby.filter((e) => !e.extendedProperties?.private?.qplanDay);

  for (const event of [...ours.filter((e) => !wanted.has(e.id)), ...strays]) {
    try {
      await api('DELETE', eventsPath(calendarId, event.id));
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;   // already gone
    }
  }
  for (const want of desired) {
    const have = ours.find((e) => e.id === want.id);
    if (have && isSame(have, want)) continue;
    if (have) {
      await api('PUT', eventsPath(calendarId, want.id), { body: want });
      continue;
    }
    try {
      await api('POST', eventsPath(calendarId), { body: want });
    } catch (error) {
      // The id belongs to an event deleted earlier (QPlan reuses event numbers): restore it.
      if (error.status !== 409) throw error;
      await api('PUT', eventsPath(calendarId, want.id), { body: want });
    }
  }
}

/* ---------- Everything that needs syncing for one person ---------- */
const linkRef = (db, uid) => db.doc(`calendarLinks/${uid}`);

export async function setStatus(db, uid, calendar) {
  await db.doc(`users/${uid}`).set({ calendar: calendar ?? FieldValue.delete() }, { merge: true });
}

export async function saveLink(uid, link) {
  const { db } = firebase();
  await linkRef(db, uid).set({ ...link, connectedAt: FieldValue.serverTimestamp(), syncedUntil: Timestamp.now() });
  await setStatus(db, uid, { status: 'connected', email: link.email });
}

export async function readLink(uid) {
  return (await linkRef(firebase().db, uid).get()).data() || null;
}

export async function deleteLink(uid) {
  const { db } = firebase();
  await linkRef(db, uid).delete();
  await setStatus(db, uid, null);
}

// Access for an existing link, or null after marking it for reconnecting.
export async function linkAccess(uid, link) {
  try {
    return calendarApi(await accessToken(link.refreshToken));
  } catch (error) {
    if (!error.accessLost) throw error;
    await setStatus(firebase().db, uid, { status: 'reconnect', email: link.email });
    return null;
  }
}

// Order of work, each step resumable when time runs out (the reply says more: true):
//   1. after connecting: every day from backfillFrom onward, in date order;
//   2. days saved since the last sync (by server time, so device clocks don't matter);
//   3. heal: days the browser asks for (today and the next week), to undo edits made in Google.
export async function syncUser(uid, { heal = [] } = {}) {
  const { db } = firebase();
  const ref = linkRef(db, uid);
  const link = (await ref.get()).data();
  if (!link) return { status: 'disconnected' };
  const api = await linkAccess(uid, link);
  if (!api) return { status: 'reconnect' };

  const started = Date.now();
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS;
  const days = db.collection(`users/${uid}/days`);
  const done = new Set();
  const syncKey = async (key, snap) => {
    if (done.has(key)) return;
    done.add(key);
    const day = (snap || await days.doc(key).get()).data();
    await syncDay(api, link.calendarId, key, day, isTimeZone(day?.tz) ? day.tz : link.tz);
  };

  try {
    if (link.backfillFrom) {
      const snaps = await days.where(FieldPath.documentId(), '>=', link.backfillFrom).orderBy(FieldPath.documentId()).get();
      for (const snap of snaps.docs) {
        if (outOfTime()) {
          await ref.update({ backfillFrom: snap.id });
          return { status: 'connected', more: true };
        }
        await syncKey(snap.id, snap);
      }
      await ref.update({ backfillFrom: null });
    }

    const changed = await days.where('serverUpdatedAt', '>', link.syncedUntil)
      .orderBy('serverUpdatedAt').limit(CHANGED_PAGE).get();
    for (const snap of changed.docs) {
      if (outOfTime()) return { status: 'connected', more: true };
      await syncKey(snap.id, snap);
      await ref.update({ syncedUntil: snap.get('serverUpdatedAt') });
    }
    if (changed.size === CHANGED_PAGE) return { status: 'connected', more: true };

    for (const key of heal.filter(isDayKey).slice(0, MAX_HEAL_DAYS)) {
      if (outOfTime()) break;
      await syncKey(key);
    }
    return { status: 'connected' };
  } catch (error) {
    // The QPlan calendar was deleted in Google: that counts as disconnecting.
    if (error.status === 404 && !(await calendarExists(api, link.calendarId))) {
      await ref.delete();
      await revoke(link.refreshToken);
      await setStatus(db, uid, { status: 'removed', email: link.email });
      return { status: 'removed' };
    }
    throw error;
  }
}
