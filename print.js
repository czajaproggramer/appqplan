'use strict';

/* ==========================================================================
   Print — exports the day as a portrait A4 SVG (units are millimetres),
   styled with the Ruled design system.
   Uses state, formatQuarter, formatRange, QUARTERS, PRIORITY_TODOS,
   CHECK_BOX and CHECK_TICK from app.js.
   ========================================================================== */
const PAGE = {
  width: 210,
  height: 297,
  margin: 14,
  dateSize: 10,             // hand-display
  titleSize: 6.5,           // hand-title
  labelSize: 2.8,           // sans-label
  gap: 8,                   // between the to-do band and the schedule

  marginLine: 9,            // the red margin line, from the page margin
  todoRowHeight: 8.5,       // rule-pitch
  todoMaxHeight: 60,        // rows shrink if the list is longer than this
  todoTextSize: 4.4,        // hand-task
  checkSize: 4.2,
  columnGap: 8,

  scheduleStartHour: 6,     // printed schedule starts here, or earlier if an event does
  scheduleColumnGap: 9,
  labelWidth: 11,           // schedule time labels
  timeSize: 2.5,            // sans-time
  eventTextSize: 4,         // hand-note, max; shrinks if rows get too short
};

// Fonts are embedded so the SVG looks the same on any machine.
const FONT_FILES = [
  { family: 'Patrick Hand', weight: 400, url: 'ruled-design-system/fonts/patrick-hand-latin-400-normal.woff2' },
  { family: 'Karla', weight: 500, url: 'ruled-design-system/fonts/karla-latin-500-normal.woff2' },
];
let embeddedFontCss = '';

function loadEmbeddedFonts() {
  const toDataUrl = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  Promise.all(FONT_FILES.map(async (font) => {
    const blob = await (await fetch(font.url)).blob();
    const url = await toDataUrl(blob);
    return `@font-face{font-family:"${font.family}";font-weight:${font.weight};src:url(${url}) format("woff2");}`;
  }))
    .then((rules) => { embeddedFontCss = rules.join(''); })
    .catch(() => { /* print still works, with fallback fonts */ });
}

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Read colors and fonts from the design tokens.
function readTokens() {
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  return {
    hand: token('--font-hand'),
    sans: token('--font-sans'),
    sheet: token('--paper-sheet'),
    ink: token('--ink'),
    inkMuted: token('--ink-muted'),
    inkFaint: token('--ink-faint'),
    line: token('--line'),
    rule: token('--rule'),
    ruleMargin: token('--rule-margin'),
  };
}

// Resolve an event tone (a CSS colour that may use color-mix) to hex, which every SVG viewer reads.
function eventColor(tone) {
  const probe = document.createElement('div');
  probe.style.backgroundColor = `var(--event-${tone || 'peach'})`;
  document.body.append(probe);
  const computed = getComputedStyle(probe).backgroundColor;   // rgb(…) or color(srgb …) for color-mix
  probe.remove();
  const scale = computed.startsWith('color(') ? 255 : 1;
  const [r, g, b] = computed.match(/[\d.]+/g).slice(0, 3).map((v) => Math.round(v * scale));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Text measuring, so long names get an ellipsis instead of being cut mid-word.
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(str, size, family, weight = 400) {
  measureCtx.font = `${weight} ${size * 10}px ${family}`;
  return measureCtx.measureText(str).width / 10;
}
function fitText(str, maxWidth, size, family, weight) {
  if (textWidth(str, size, family, weight) <= maxWidth) return str;
  let s = str;
  while (s && textWidth(`${s}…`, size, family, weight) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function buildDaySvg() {
  const t = readTokens();
  const P = PAGE;
  const left = P.margin;
  const contentWidth = P.width - 2 * P.margin;
  const out = [];
  let y = P.margin;

  const hand = `font-family="${escapeXml(t.hand)}"`;
  const sans = `font-family="${escapeXml(t.sans)}" font-weight="500"`;
  const text = (x, yy, content, attrs = '') =>
    out.push(`<text x="${x}" y="${yy}" ${attrs}>${escapeXml(content)}</text>`);
  const line = (x1, y1, x2, y2, color, width, extra = '') =>
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`);
  const sheetTitle = (label) => {
    text(left, y + P.titleSize * 0.8, label, `${hand} font-size="${P.titleSize}" fill="${t.ink}"`);
    y += P.titleSize + 2;
  };

  // Date — hand-display
  text(left, y + P.dateSize * 0.8, document.getElementById('date').textContent,
    `${hand} font-size="${P.dateSize}" fill="${t.ink}"`);
  y += P.dateSize + 6;

  // To-do — ruled lines, a margin line, top priorities numbered in the margin
  sheetTitle('To do');
  text(left + P.marginLine + 2, y + P.labelSize, 'Top priority',
    `${sans} font-size="${P.labelSize}" letter-spacing="0.06" fill="${t.inkMuted}"`);
  y += P.labelSize + 1;

  const priority = state.todos.slice(0, PRIORITY_TODOS);
  const rest = state.todos.slice(PRIORITY_TODOS);
  const rowCount = Math.max(priority.length, rest.length);
  const rowH = Math.min(P.todoRowHeight, P.todoMaxHeight / rowCount);
  const taskSize = Math.min(P.todoTextSize, rowH * 0.55);
  const box = Math.min(P.checkSize, rowH * 0.5);
  const colLeft = left + P.marginLine + 2;
  const colW = (left + contentWidth - colLeft - P.columnGap) / 2;
  const bandTop = y;

  line(left + P.marginLine, bandTop, left + P.marginLine, bandTop + rowCount * rowH + 2, t.ruleMargin, 0.3);

  const drawTodo = (todo, x, rowY, number) => {
    const centerY = rowY + rowH / 2;
    const scale = box / 20;
    out.push(`<g transform="translate(${x} ${centerY - box / 2}) scale(${scale})" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + `<path d="${CHECK_BOX}" stroke="${t.line}" stroke-width="1.5"/>`
      + (todo.done ? `<path d="${CHECK_TICK}" stroke="${t.ink}" stroke-width="2"/>` : '')
      + '</g>');
    if (number) {
      text(left + P.marginLine / 2, centerY, number,
        `${hand} font-size="${taskSize}" text-anchor="middle" dominant-baseline="central" fill="${t.inkMuted}"`);
    }
    const label = todo.text.trim();
    if (label) {
      const textX = x + box + 3;
      text(textX, centerY, fitText(label, x + colW - textX, taskSize, t.hand),
        `${hand} font-size="${taskSize}" dominant-baseline="central" fill="${todo.done ? t.inkFaint : t.ink}"`
        + (todo.done ? ' text-decoration="line-through"' : ''));
    }
    line(x - 1, rowY + rowH, x + colW, rowY + rowH, t.rule, 0.3);
  };
  priority.forEach((todo, i) => drawTodo(todo, colLeft, bandTop + i * rowH, String(i + 1)));
  rest.forEach((todo, i) => drawTodo(todo, colLeft + colW + P.columnGap, bandTop + i * rowH));
  y = bandTop + rowCount * rowH + P.gap;

  // Schedule — from 6:00 (or the hour of the earliest event) to 0:00, in two columns
  sheetTitle('Schedule');
  const events = state.events
    .filter((ev) => ev.name.trim())
    .sort((a, b) => a.start - b.start);
  const firstHour = Math.min(P.scheduleStartHour, ...events.map((ev) => Math.floor(ev.start / 4)));
  const from = firstHour * 4;
  const split = from + Math.ceil((24 - firstHour) / 2) * 4;   // first column gets the extra hour
  const top = y + 2;                                          // room for the first label
  const slotH = (P.height - P.margin - 2 - top) / (split - from);
  const scheduleColW = (contentWidth - P.scheduleColumnGap) / 2;

  const drawColumn = (x, fromQ, toQ) => {
    const lane = x + P.labelWidth;
    const right = x + scheduleColW;
    const yAt = (qq) => top + (qq - fromQ) * slotH;

    // Hour: solid rule with its label. Half hour: dashed. Quarter: dotted.
    for (let i = fromQ; i <= toQ; i++) {
      const ly = yAt(i);
      if (i % 4 === 0 || i === fromQ || i === toQ) {
        line(lane - 1, ly, right, ly, t.rule, 0.35);
        text(x, ly, formatQuarter(i),
          `${sans} font-size="${P.timeSize}" letter-spacing="0.1" dominant-baseline="central" fill="${t.inkMuted}"`);
      } else if (i % 2 === 0) {
        line(lane, ly, right, ly, t.rule, 0.3, 'stroke-dasharray="1.2 1"');
      } else {
        line(lane, ly, right, ly, t.rule, 0.3, 'stroke-dasharray="0.1 0.9" stroke-linecap="round"');
      }
    }

    // Events — sticky notes. One crossing the column break is drawn in both columns.
    for (const ev of events) {
      const s = Math.max(ev.start, fromQ);
      const e = Math.min(ev.end, toQ);
      if (s >= e) continue;

      const ex = lane;
      const ew = right - lane;
      const ey = yAt(s) + 0.35;
      const eh = (e - s) * slotH - 0.7;
      const pad = 2.5;
      const nameSize = Math.min(P.eventTextSize, slotH * 0.62);
      const time = formatRange(ev.start, ev.end);
      const timeW = textWidth(time, P.timeSize, t.sans, 500) + 0.8;
      out.push(`<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" fill="${eventColor(ev.tone)}"/>`);

      if (ev.end - ev.start <= 2) {
        // 30 min or less: title and time on one line
        const lineY = ey + (Math.min(eh, slotH) - 0.7) / 2 + 0.35;
        const name = fitText(ev.name.trim(), ew - 2 * pad - timeW - 2, nameSize, t.hand);
        text(ex + pad, lineY, name, `${hand} font-size="${nameSize}" dominant-baseline="central" fill="${t.ink}"`);
        text(ex + pad + textWidth(name, nameSize, t.hand) + 2, lineY, time,
          `${sans} font-size="${P.timeSize}" letter-spacing="0.1" dominant-baseline="central" fill="${t.inkMuted}"`);
      } else {
        // Longer: title, then time underneath
        const nameY = ey + 1 + nameSize * 0.55;
        text(ex + pad, nameY, fitText(ev.name.trim(), ew - 2 * pad, nameSize, t.hand),
          `${hand} font-size="${nameSize}" dominant-baseline="central" fill="${t.ink}"`);
        text(ex + pad, nameY + nameSize * 0.6 + P.timeSize * 0.7, time,
          `${sans} font-size="${P.timeSize}" letter-spacing="0.1" dominant-baseline="central" fill="${t.inkMuted}"`);
      }
    }
  };

  drawColumn(left, from, split);
  drawColumn(left + scheduleColW + P.scheduleColumnGap, split, QUARTERS);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${P.width}mm" height="${P.height}mm" viewBox="0 0 ${P.width} ${P.height}">`,
    `<defs><style>${embeddedFontCss}</style></defs>`,
    `<rect width="${P.width}" height="${P.height}" fill="${t.sheet}"/>`,
    ...out,
    '</svg>',
  ].join('\n');
}

function localIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Downloads the SVG and opens it in a new tab.
function printDay() {
  const blob = new Blob([buildDaySvg()], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `day-plan-${localIsoDate(new Date())}.svg`;
  link.click();
  window.open(url, '_blank');

  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

document.getElementById('print').addEventListener('click', printDay);

// Cmd/Ctrl+P exports the SVG instead of the browser's print dialog.
// Capture phase, so it also works while typing in an event or a to-do.
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    e.stopPropagation();
    printDay();
  }
}, true);

if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.getElementById('print-shortcut').textContent = 'Ctrl+P';
}

loadEmbeddedFonts();
