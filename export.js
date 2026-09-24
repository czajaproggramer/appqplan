'use strict';

/* ==========================================================================
   Export events — the shown day's events as one iCalendar (.ics) file,
   which Apple Calendar, Google Calendar and Outlook can import.
   Uses state and dayKey from app.js.
   ========================================================================== */

// Local wall time → UTC in iCalendar form, e.g. 20260924T073000Z. DST is handled by Date.
const icsDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const icsText = (s) => s
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// iCalendar lines must be folded at 75 bytes.
function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

// Quarter 96 is midnight at the end of the day, which Date rolls into the next day.
const quarterToDate = (day, q) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, q * 15);

function buildIcs() {
  const key = dayKey(state.date);
  const stamp = icsDate(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QPlan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  state.events
    .filter((ev) => ev.name.trim())
    .sort((a, b) => a.start - b.start)
    .forEach((ev) => {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${key}-${ev.id}@qplan`,   // stable, so re-importing updates instead of duplicating
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(quarterToDate(state.date, ev.start))}`,
        `DTEND:${icsDate(quarterToDate(state.date, ev.end))}`,
        `SUMMARY:${icsText(ev.name.trim())}`,
        'END:VEVENT',
      );
    });
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

function exportEvents() {
  const url = URL.createObjectURL(new Blob([buildIcs()], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `qplan-events-${dayKey(state.date)}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

document.getElementById('export').addEventListener('click', exportEvents);
