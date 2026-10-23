// POST /.netlify/functions/calendar-connect  { code, tz, today }
// Swaps the pop-up's one-time code for a lasting Google token, checks it belongs to the
// Google account the person logs in with, creates the "QPlan" calendar (or keeps the existing
// one when reconnecting), then starts sending today and later days.
import {
  CALENDAR_SCOPE, HttpError, handle, exchangeCode, decodeIdToken, revoke, calendarApi,
  createCalendar, calendarExists, readLink, saveLink, syncUser, isDayKey, isTimeZone,
} from '../lib/calendar.mjs';

export default (req) => handle(req, async (user, { code, tz, today }) => {
  if (typeof code !== 'string' || !isTimeZone(tz) || !isDayKey(today)) throw new HttpError(400, 'bad-request');

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch {
    throw new HttpError(400, 'bad-code');
  }
  const refuse = async (status, reason) => {
    await revoke(tokens.access_token);
    throw new HttpError(status, reason);
  };
  // Google lets people untick the calendar permission on the consent screen.
  if (!(tokens.scope || '').split(' ').includes(CALENDAR_SCOPE)) await refuse(400, 'scope-missing');
  // Same Google account as the QPlan log-in.
  const google = decodeIdToken(tokens.id_token);
  const loginSub = user.firebase?.identities?.['google.com']?.[0];
  if (!google.sub || google.sub !== loginSub) await refuse(400, 'wrong-account');
  // Google only hands out a lasting token on a fresh consent. An older grant was still
  // active; revoking it makes the next try a fresh consent.
  if (!tokens.refresh_token) await refuse(409, 'retry');

  const api = calendarApi(tokens.access_token);
  const old = await readLink(user.uid);
  const calendarId = old?.calendarId && await calendarExists(api, old.calendarId)
    ? old.calendarId
    : await createCalendar(api, tz);

  await saveLink(user.uid, {
    refreshToken: tokens.refresh_token,
    calendarId,
    googleSub: google.sub,
    email: google.email || user.email || '',
    tz,
    backfillFrom: today,
  });
  return syncUser(user.uid);
});
