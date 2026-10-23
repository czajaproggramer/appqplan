// POST /.netlify/functions/calendar-disconnect  { deleteCalendar: boolean }
// Optionally deletes the "QPlan" calendar from Google, then revokes QPlan's access and
// forgets the link. Also called before an account is deleted.
import { handle, readLink, linkAccess, deleteLink, revoke } from '../lib/calendar.mjs';

export default (req) => handle(req, async (user, { deleteCalendar }) => {
  const link = await readLink(user.uid);
  if (link) {
    if (deleteCalendar) {
      const api = await linkAccess(user.uid, link);
      try {
        await api?.('DELETE', `/calendars/${encodeURIComponent(link.calendarId)}`);
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error;   // already gone
      }
    }
    await revoke(link.refreshToken);
  }
  await deleteLink(user.uid);
  return { status: 'disconnected' };
});
