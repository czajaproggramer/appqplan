// POST /.netlify/functions/calendar-sync  { heal?: ['YYYY-MM-DD', …] }
// Sends every day saved since the last sync to Google (QPlan wins), then re-checks the
// "heal" days. Replies { status, more }: with more: true the browser calls again.
import { handle, syncUser } from '../lib/calendar.mjs';

export default (req) => handle(req, (user, { heal }) => syncUser(user.uid, { heal: Array.isArray(heal) ? heal : [] }));
