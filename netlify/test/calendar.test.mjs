// Runs the real calendar functions against the Firestore/Auth emulators and a fake Google.
// Start the emulators first (firebase/README.md), then: npm run test:calendar
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_PROJECT_ID = 'demo-qplan';
process.env.GCLOUD_PROJECT = 'demo-qplan';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const lib = await import('../lib/calendar.mjs');
const connect = (await import('../functions/calendar-connect.mjs')).default;
const sync = (await import('../functions/calendar-sync.mjs')).default;
const disconnect = (await import('../functions/calendar-disconnect.mjs')).default;
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${extra}`}`);
  if (!ok) failures++;
};

/* ---------- Fake Google ---------- */
const google = {
  revoked: new Set(),
  calendars: new Map(),   // id -> { events: Map(id -> event) }
  calls: [],
  sub: 'erin-google-sub',
};
const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
function offsetMinutes(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const get = (t) => +parts.find((p) => p.type === t).value;
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms) / 60000;
}
const instant = (time) => {
  if (/[+-]\d\d:\d\d$|Z$/.test(time.dateTime)) return Date.parse(time.dateTime);
  const guess = Date.parse(`${time.dateTime}Z`);
  return guess - offsetMinutes(guess, time.timeZone) * 60000;
};
const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });

lib.net.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const method = init.method || 'GET';
  google.calls.push(`${method} ${url.pathname}`);
  if (url.host === 'oauth2.googleapis.com') {
    const p = new URLSearchParams(init.body);
    if (url.pathname === '/revoke') { google.revoked.add(p.get('token')); return reply(200, {}); }
    if (p.get('grant_type') === 'refresh_token') {
      return google.revoked.has(p.get('refresh_token')) ? reply(400, { error: 'invalid_grant' }) : reply(200, { access_token: 'access-1' });
    }
    const code = p.get('code');
    if (code === 'bad') return reply(400, { error: 'invalid_grant' });
    return reply(200, {
      access_token: `access-${code}`,
      refresh_token: code === 'norefresh' ? undefined : `refresh-${code}-${Date.now()}`,
      scope: code === 'noscope' ? 'openid email' : `openid email ${lib.CALENDAR_SCOPE}`,
      id_token: jwt({ sub: code === 'other' ? 'someone-else' : google.sub, email: 'erin@example.com' }),
    });
  }
  // Calendar API
  const parts = url.pathname.replace('/calendar/v3/', '').split('/').map(decodeURIComponent);
  const body = init.body ? JSON.parse(init.body) : null;
  if (parts[0] === 'calendars' && parts.length === 1 && method === 'POST') {
    const id = `cal${google.calendars.size + 1}@group.calendar.google.com`;
    google.calendars.set(id, { summary: body.summary, timeZone: body.timeZone, events: new Map() });
    return reply(200, { id });
  }
  const cal = google.calendars.get(parts[1]);
  if (!cal) return reply(404, { error: { message: 'Not Found' } });
  if (parts.length === 2) {
    if (method === 'DELETE') { google.calendars.delete(parts[1]); return reply(204); }
    return reply(200, { id: parts[1] });
  }
  const events = cal.events;
  const id = parts[3];
  if (method === 'GET') {
    const q = url.searchParams;
    let items = [...events.values()].filter((e) => e.status !== 'cancelled');
    const prop = q.get('privateExtendedProperty');
    if (prop) {
      const [k, v] = prop.split('=');
      items = items.filter((e) => e.extendedProperties?.private?.[k] === v);
    }
    if (q.get('timeMin')) {
      const min = Date.parse(q.get('timeMin'));
      const max = Date.parse(q.get('timeMax'));
      items = items.filter((e) => instant(e.end) > min && instant(e.start) < max);
    }
    return reply(200, { items: structuredClone(items) });
  }
  if (method === 'POST') {
    if (events.has(body.id)) return reply(409, { error: { message: 'The requested identifier already exists.' } });
    events.set(body.id, { ...body, status: 'confirmed' });
    return reply(200, body);
  }
  if (method === 'PUT') {
    if (!events.has(id)) return reply(404, {});
    events.set(id, { ...body, id });
    return reply(200, body);
  }
  if (method === 'DELETE') {
    const e = events.get(id);
    if (!e || e.status === 'cancelled') return reply(410, {});
    e.status = 'cancelled';   // Google keeps deleted events
    return reply(204);
  }
  return reply(500, {});
};

/* ---------- Helpers ---------- */
await lib.readLink("init");   // initialises Firebase Admin
const db = getFirestore();
const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requestUri: 'http://localhost', returnSecureToken: true, postBody: `id_token=${JSON.stringify({ sub: google.sub, email: 'erin@example.com', email_verified: true })}&providerId=google.com` }),
});
const { idToken, localId: uid } = await res.json();
const call = async (fn, body) => {
  const r = await fn(new Request('http://localhost/x', { method: 'POST', headers: { authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (offset) => keyOf(new Date(Date.now() + offset * 86400000));
const [yesterday, today, tomorrow] = [day(-1), day(0), day(1)];
const tz = 'Europe/Warsaw';
const writeDay = (key, events, extra = {}) => db.doc(`users/${uid}/days/${key}`).set({
  todos: [], events, deleted: false, updatedAt: Date.now(), tz, serverUpdatedAt: FieldValue.serverTimestamp(), ...extra,
});
const ev = (id, start, end, name, tone = 'sage') => ({ id, start, end, name, tone });
const calendarEvents = (key) => {
  const cal = [...google.calendars.values()][0];
  return [...cal.events.values()].filter((e) => e.status !== 'cancelled' && (!key || e.extendedProperties?.private?.qplanDay === key));
};
const status = async () => (await db.doc(`users/${uid}`).get()).get('calendar');

// Clean slate for this test user
for (const d of (await db.collection(`users/${uid}/days`).get()).docs) await d.ref.delete();
await db.doc(`calendarLinks/${uid}`).delete();

/* ---------- Tests ---------- */
await writeDay(yesterday, [ev(1, 32, 36, 'Old day')]);
await writeDay(today, [ev(1, 36, 37, 'Gym'), ev(2, 40, 44, 'Meeting', 'sky'), ev(3, 92, 96, 'Late')]);
await writeDay(tomorrow, [ev(1, 24, 28, 'Breakfast', 'peach'), ev(5, 50, 52, '   ')]);

check('refuses a Google account other than the log-in', (await call(connect, { code: 'other', tz, today })).body.error === 'wrong-account');
check('refuses when the calendar permission is unticked', (await call(connect, { code: 'noscope', tz, today })).body.error === 'scope-missing');
check('asks to retry when Google gives no lasting token', (await call(connect, { code: 'norefresh', tz, today })).body.error === 'retry');
check('refuses bad input', (await call(connect, { code: 'good', tz: 'Mars/Base', today })).status === 400);
check('nothing created after refusals', google.calendars.size === 0);

let r = await call(connect, { code: 'good', tz, today });
check('connect succeeds', r.status === 200 && r.body.status === 'connected', JSON.stringify(r));
check('one QPlan calendar created in the device zone', google.calendars.size === 1 && [...google.calendars.values()][0].summary === 'QPlan' && [...google.calendars.values()][0].timeZone === tz);
check('status mirrored for the browser', (await status())?.status === 'connected');
check('past days are not sent', calendarEvents(yesterday).length === 0);
check('today sent (3 events)', calendarEvents(today).length === 3, JSON.stringify(calendarEvents(today).map((e) => e.summary)));
const late = calendarEvents(today).find((e) => e.summary === 'Late');
check('event ending at 24:00 ends next day 00:00', late?.end.dateTime === `${tomorrow}T00:00:00` && late.start.dateTime === `${today}T23:00:00`, JSON.stringify(late?.end));
const gym = calendarEvents(today).find((e) => e.summary === 'Gym');
check('times, zone, colour, no reminders', gym.start.dateTime === `${today}T09:00:00` && gym.end.dateTime === `${today}T09:15:00` && gym.start.timeZone === tz && gym.colorId === '2' && gym.reminders.useDefault === false);
check('unnamed events are skipped', calendarEvents(tomorrow).length === 1);

// Edits in QPlan: rename, remove, add
await writeDay(today, [ev(1, 36, 38, 'Gym + stretch'), ev(3, 92, 96, 'Late'), ev(4, 60, 64, 'Lunch', 'rose')]);
google.calls.length = 0;
r = await call(sync, {});
check('sync after edit', r.body.status === 'connected', JSON.stringify(r));
check('day matches QPlan after edits', JSON.stringify(calendarEvents(today).map((e) => e.summary).sort()) === JSON.stringify(['Gym + stretch', 'Late', 'Lunch']));
check('unchanged event is not rewritten', !google.calls.some((c) => c.includes(encodeURIComponent(lib.googleEventId(today, 3)))));

// Nothing changed → no writes
google.calls.length = 0;
await call(sync, {});
check('no Google calls when nothing changed', google.calls.filter((c) => !c.startsWith('POST /token')).length === 0, google.calls.join(', '));

// Edits made in Google are undone by heal
const cal = [...google.calendars.values()][0];
cal.events.get(lib.googleEventId(today, 1)).summary = 'Renamed in Google';
cal.events.get(lib.googleEventId(today, 4)).start = { dateTime: `${today}T16:30:00`, timeZone: tz };
cal.events.set('handmade1', { id: 'handmade1', summary: 'Added by hand', start: { dateTime: `${today}T18:00:00`, timeZone: tz }, end: { dateTime: `${today}T19:00:00`, timeZone: tz } });
r = await call(sync, { heal: [today, tomorrow] });
check('heal restores renamed and moved events', calendarEvents(today).some((e) => e.summary === 'Gym + stretch') && calendarEvents(today).find((e) => e.summary === 'Lunch').start.dateTime === `${today}T15:00:00`);
check('heal removes events added by hand', cal.events.get('handmade1')?.status === 'cancelled');

// Reused QPlan event number: id 4 was deleted, then a new event gets id 4
await writeDay(today, [ev(1, 36, 38, 'Gym + stretch'), ev(3, 92, 96, 'Late')]);
await call(sync, {});
check('deleted event gone', !calendarEvents(today).some((e) => e.summary === 'Lunch'));
await writeDay(today, [ev(1, 36, 38, 'Gym + stretch'), ev(3, 92, 96, 'Late'), ev(4, 70, 72, 'Call')]);
r = await call(sync, {});
check('reused event number restores the deleted Google event', calendarEvents(today).some((e) => e.summary === 'Call' && e.status === 'confirmed'), JSON.stringify(r));

// Emptied day (deleted marker) and an edit to a past day
await writeDay(tomorrow, [], { deleted: true });
await writeDay(yesterday, [ev(1, 32, 36, 'Old day, edited')]);
await call(sync, {});
check('emptied day removes its events', calendarEvents(tomorrow).length === 0);
check('editing a past day after connecting sends it', calendarEvents(yesterday).length === 1);

// Days in another zone
await writeDay(tomorrow, [ev(1, 36, 40, 'NYC breakfast')], { tz: 'America/New_York' });
await call(sync, {});
check('each day keeps its own zone', calendarEvents(tomorrow)[0]?.start.timeZone === 'America/New_York');

// Calendar deleted in Google → removed
const linkBefore = (await db.doc(`calendarLinks/${uid}`).get()).data();
google.calendars.clear();
await writeDay(today, [ev(1, 36, 38, 'After deletion')]);
r = await call(sync, {});
check('deleted calendar → status removed', r.body.status === 'removed' && (await status())?.status === 'removed', JSON.stringify(r));
check('link and Google access dropped', !(await db.doc(`calendarLinks/${uid}`).get()).exists && google.revoked.has(linkBefore.refreshToken));

// Reconnect, then access revoked in Google → reconnect
r = await call(connect, { code: 'good', tz, today });
check('reconnect creates a new calendar', r.body.status === 'connected' && google.calendars.size === 1);
const link2 = (await db.doc(`calendarLinks/${uid}`).get()).data();
google.revoked.add(link2.refreshToken);
r = await call(sync, {});
check('revoked access → status reconnect', r.body.status === 'reconnect' && (await status())?.status === 'reconnect');
google.revoked.delete(link2.refreshToken);

// Disconnect keeping the calendar, then reconnect and disconnect deleting it
r = await call(disconnect, { deleteCalendar: false });
check('disconnect (keep) leaves the calendar', r.body.status === 'disconnected' && google.calendars.size === 1);
check('disconnect clears link and status', !(await db.doc(`calendarLinks/${uid}`).get()).exists && (await status()) === undefined);
check('disconnect revokes access', google.revoked.has(link2.refreshToken));
google.calendars.clear();
await call(connect, { code: 'good', tz, today });
r = await call(disconnect, { deleteCalendar: true });
check('disconnect (delete) removes the calendar', r.body.status === 'disconnected' && google.calendars.size === 0);

// Requests without a valid log-in
const anon = await sync(new Request('http://localhost/x', { method: 'POST', body: '{}' }));
check('rejects calls without a log-in', anon.status === 401);
const get = await sync(new Request('http://localhost/x', { method: 'GET' }));
check('rejects GET', get.status === 405);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
