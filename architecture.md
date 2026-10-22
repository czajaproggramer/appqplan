# QPlan architecture

The source of truth for how QPlan is built. Read this before changing code. Keep it current: if a change makes any part of this file wrong, update it in the same commit.

QPlan is a keyboard-first, one-day planner that runs entirely in the browser. Each day has a to-do list (the first three lines are highlighted priorities) and a 24-hour schedule in 15-minute rows. Days are saved in `localStorage`. Logging in with Google (optional) syncs days and settings across devices through Firebase. A day can be printed as an A4 PNG and its events exported as an `.ics` calendar file. Live at https://q-plan.netlify.app.

**No framework, no build step.** Plain HTML, CSS and JavaScript, served as static files. The only runtime dependency is the Firebase SDK, loaded from Google's CDN by `sync.js` only for people who log in.

---

## 1. Repository map

| Path | What it is | Deployed? |
|---|---|---|
| `index.html` | The whole page: header, to-do sheet, schedule sheet, footer form, sync dialogs. Loads the CSS and the five scripts. | Yes |
| `app.js` | Core: config, state, storage, schedule, to-do list, days, time format, startup. Everything else depends on it. | Yes |
| `picker.js` | The date picker popover opened by clicking the date. | Yes |
| `print.js` | "Print": renders the day as an A4 PNG at 300 DPI. Also owns the Cmd/Ctrl+P shortcut. | Yes |
| `export.js` | "Export events": the day's events as one `.ics` file. | Yes |
| `sync.js` | Optional log-in and cloud sync (Firebase Auth + Firestore). Holds `FIREBASE_CONFIG`. | Yes |
| `firebase/` | Firestore security rules, Firebase setup steps and the local emulator config (`README.md`). The rules are pasted into the Firebase console by hand. | Served, harmless |
| `styles.css` | All app styles. App-level tokens at the top; design-system tokens come from `ruled-design-system/tokens.css`. | Yes |
| `ruled-design-system/` | The **Ruled** design system: tokens, fonts, component specs. Treat as a vendored dependency (read it, don't edit it). Start with its `README.md`. | Yes (fonts and tokens are used by the app) |
| `logos/` | QPlan logo concepts. The app uses `1-q-tick.svg` (header) and `1-q-tick-icon.svg` (favicon). `logos/index.html` is a comparison page. | Yes |
| `netlify.toml` | Tells Netlify to publish the repo root with no build. | — |
| `CLAUDE.md` | Rules for agent sessions. Read it. | — |
| `.claude/launch.json` | Local preview server (`planner`: Python static server on port 5173). | Tracked, so possibly served; harmless |
| `.claude/skills/work/` | The `/work` skill for the growth program. Not part of the app. | Not tracked |
| `marketing/` | Node tooling for promo videos and screenshots (Playwright). Has its own `package.json`, kept out of the root so Netlify never installs it. Output in `marketing/out/` is git-ignored. See §8. | Only if committed (it's static files, harmless) |
| `progress/` | Private growth-program notes. **Git-ignored** because the repo is public. Never commit it. | No |

---

## 2. How the page runs

`index.html` loads, in this order:

```
ruled-design-system/tokens.css → styles.css
app.js → picker.js → print.js → export.js → sync.js     (classic <script> tags at the end of <body>)
```

- **Classic scripts, one shared global scope.** Top-level `const`, `let` and `function` in `app.js` are visible to the later scripts. There are no modules and no imports. `picker.js`, `print.js` and `export.js` each list the `app.js` names they use in their header comment.
- **Order matters.** `app.js` must load first. The others only add listeners and functions; none depends on another. `sync.js` replaces `syncHooks` in `app.js`.
- **Startup** is the `Init` block at the end of `app.js`: fill `[data-icon]` buttons with SVG icons → `buildRows()` → `applyTimeFormat()` → `showDay(new Date())` → refresh the "now" line every 30 s. `print.js` also starts fetching fonts for the print (`loadEmbeddedFonts()`). `sync.js` shows "Log in" if Firebase is configured, and loads Firebase straight away if this device was logged in.
- **Serve over HTTP, not `file://`.** `print.js` fetches font files, which fails from `file://`.

---

## 3. Data model

### Time: quarters

All schedule times are **quarter-hour indexes**: `0` = 00:00, `1` = 00:15, … `95` = 23:45, `96` = 00:00 at the end of the day.

- `QUARTERS = 96`. Event `end` is **exclusive**, so an event can end at `96` (midnight). The cursor is always `0..95`.
- Hour `h` is quarter `h * 4`.
- Formatting is in `formatClock`, `formatQuarter` and `formatRange` (`app.js`). They take an optional format (`'12h'` gives `9:30am`, `'24h'` gives `09:30`); the default is the user's setting.

### State (in memory, `app.js`)

```js
state = {
  date,       // the day shown, a Date at local midnight
  todos,      // [{ text, done }]; always at least DEFAULT_TODOS (5) items; the first PRIORITY_TODOS (3) are priorities
  events,     // [{ id, start, end, name, tone }]
  cursor,     // quarter 0..95
  editingId,  // id of the event whose name is being typed, or null
}
settings = { timeFormat: '12h' | '24h' }   // '12h' (am/pm) is the default
```

Module-level variables alongside: `nextEventId`, `lastHourPress` (for double-press detection), `pendingDelete` (first Delete press), `lastPointerType` (touch vs mouse), `eventEls` (`Map` of event id → DOM element).

**Event invariants**
- Events never overlap. `nextStartFrom(q, ignoreId)` gives the limit for creating or extending an event.
- An event is at least 1 quarter long. New events are `NEW_EVENT_QUARTERS` (1) long.
- `tone` is one of `EVENT_TONES` (`peach`, `sage`, `rose`, `sky`), chosen at creation by `pickTone`, which avoids the tones of touching neighbours. It maps to `--event-<tone>` in `styles.css`. Events saved without a tone render as peach.
- An event with an empty (trimmed) name is never saved, and is removed when editing ends.

### Storage (`localStorage`) — a contract, see `CLAUDE.md`

| Key | Value |
|---|---|
| `qplan:day:YYYY-MM-DD` | `{ todos: [{ text, done }], events: [{ id, start, end, name, tone }] }` |
| `qplan:settings` | `{ timeFormat: '12h' \| '24h' }` |
| `qplan:sync` | Sync bookkeeping (`sync.js`): `{ uid, loggedIn, days: { 'YYYY-MM-DD': { t, dirty } }, settings: { t, dirty } }`. `t` = when that copy was last edited (ms), `dirty` = not yet confirmed by the cloud. Written on every saved change, even while logged out. |

- **Only non-empty days are stored.** `saveDay()` removes the key when the day has no named events and no to-do text.
- Keys use the **local** date (`dayKey()`), not UTC.
- Access goes through `storageGet` / `storageSet`, which swallow errors (private mode, storage full), so the app keeps working without saving.
- A one-time migration at the top of the State section moves old `quickplanner:*` keys to `qplan:*`.
- **Never change these keys or shapes without a migration that keeps old days loading.** The marketing scripts (§8) also write these keys directly.
- `saveDay()` writes only when the day actually changed (it compares with what's stored), and then calls `syncHooks.dayChanged(key)`. Opening a day never counts as a change.

### Cloud (Firestore, only for logged-in people)

| Document | Value |
|---|---|
| `users/{uid}` | `{ settings: { timeFormat }, settingsUpdatedAt }` |
| `users/{uid}/days/{YYYY-MM-DD}` | `{ todos, events, deleted: false, updatedAt }`, or `{ todos: [], events: [], deleted: true, updatedAt }` for a day that was emptied |

- Same shapes as `localStorage`, plus `updatedAt` (ms). Emptied days stay as `deleted: true` markers so other devices remove them too. Documents are only really deleted with the account.
- `firebase/firestore.rules`: each user reads and writes only `users/{their uid}/…`.

---

## 4. Modules

### `app.js` (sections in file order)

| Section | Responsibility | Key functions |
|---|---|---|
| Config | Constants and the hour-jump key map `HOUR_KEYS` (`Digit0`–`9`, `Numpad0`–`9`, `Minus` = 10, `Equal` = 11) | — |
| State | `state`, `settings`, the storage-key migration, module variables | — |
| Helpers | Time formatting, storage, icons (`ICONS`, `icon()`), checkbox paths (`CHECK_BOX`, `CHECK_TICK`, shared with `print.js`), event lookups | `formatClock`, `formatQuarter`, `formatRange`, `storageGet`, `storageSet`, `eventAt`, `nextStartFrom`, `pickTone`, `removeEvent` |
| Schedule — DOM | Builds 96 rows once, labels them, creates and reconciles event elements | `buildRows`, `renderLabels`, `createEventEl`, `renderEvents`, `render`, `renderNowLine`, `scrollToCursor` |
| Schedule — actions | Cursor, hour jumps, creating, editing, resizing and deleting events, keyboard and pointer input | `setCursor`, `jumpToHour`, `typeAt`, `startEdit`, `resizeEditing`, `commitEdit`, `requestDelete`, `onScheduleKey`, `onScheduleClick` |
| To-do list | Renders the rows, priority highlight and numbers, hand-drawn checkboxes, keys | `createTodoEl`, `renderTodos`, `focusTodo`, `onTodoKey` |
| Days | Date format, day keys, saving and loading, day arrows | `dayKey`, `addDays`, `isViewingToday`, `hasPlans`, `saveDay`, `showDay`, `scrollToFirstHour` |
| Time format | The am/pm \| 24h switch (`[data-format]` buttons) | `applyTimeFormat` |

`syncHooks` (State section) is told about every saved day and settings change; `sync.js` replaces it. `loadDay` reads the shown day from storage; `reloadDay` redraws it after a change from another device, keeping cursor, scroll and the focused to-do.
| Init | Startup (see §2) | — |

### `picker.js`
A month calendar in a popover under the date button (`#date`). Monday-first, always 6 weeks (42 cells) so its height never changes. Today is ochre, the shown day is outlined, days with saved plans (`hasPlans`) get a dot. **Mouse only, by decision:** click a day to open it (`showDay`); Esc or a click outside closes it.

### `print.js`
`printDay()` opens a blank tab **synchronously** (otherwise it's blocked as a pop-up), awaits `renderPng()`, then downloads `qplan-YYYY-MM-DD.png` and shows it in that tab.
- `buildDaySvg()` draws the page as an SVG in **millimetres** (A4 is 210 × 297). Layout constants are in `PAGE` at the top. Colours come from the CSS tokens (`readTokens`, `eventColor`, which turns `color-mix` values into hex). The fonts are embedded as data URLs (`loadEmbeddedFonts`, awaited through `fontsReady`). Text is measured with a canvas so long names end in "…" (`fitText`).
- Print layout: date, then the to-do list in two columns (priorities numbered in the margin), then the schedule in **two columns**. The schedule starts at `PAGE.scheduleStartHour` (6:00), or at the hour of the earliest event if that's earlier, and ends at 00:00. Times are **always 24h**, whatever the setting.
- `renderPng()` draws the SVG onto a 2480 × 3508 canvas. `withDpi()` inserts a PNG `pHYs` chunk (with `crc32`) so apps treat the file as 300 DPI, which is A4 size.
- A capture-phase `keydown` listener turns Cmd/Ctrl+P into `printDay()`, even while typing in an input.

### `export.js`
`buildIcs()` writes one `VCALENDAR` with a `VEVENT` per named event. Times are local wall time converted to UTC (`…Z`), and `quarterToDate(day, 96)` rolls over to the next midnight. UIDs are stable (`YYYY-MM-DD-<id>@qplan`), so importing again updates events instead of duplicating them. Text is escaped and lines are folded at 75 bytes. The file is `qplan-events-YYYY-MM-DD.ics`. The button is disabled by `render()` when there are no named events.

### `sync.js`
Optional. Hidden entirely while `FIREBASE_CONFIG` is `null` (and not on `?emulators`).
- **Loading:** the Firebase SDK (pinned `FIREBASE_SDK` version, `firebase-app`, `-auth`, `-firestore` from gstatic) is imported on demand: when the pointer reaches "Log in" (so the pop-up opens straight on the click), or at startup if `qplan:sync` says this device is logged in.
- **Log in:** Google pop-up (`signInWithPopup`). `onAuthChanged` → first log-in of this account on this device (`syncMeta.uid` differs) runs `linkAccount`, otherwise `startSync`.
- **First log-in (`linkAccount`):** reads all the account's days. If both the device and the account have days, `#merge-dialog` asks: combine (newer edit of each date wins), keep only this device's, keep only the account's, or cancel (logs out). Whatever the device pushes gets the current time as `t`.
- **Live sync (`startSync`):** `onSnapshot` on the days collection and the user document. A remote day newer than the local `t` is written to `localStorage`; if it's the open day, `refreshOpenDay` redraws it, waiting while an event is being edited or for `REMOTE_APPLY_DELAY_MS` after local typing. Local changes are pushed by `push()` after `PUSH_DELAY_MS`; a day stays `dirty` until the server confirms, so offline edits go up later (even after a reload). The newer edit of a day wins.
- **Header status:** `#login` when logged out; otherwise `#sync-status`: green breathing dot + "synced" when the last snapshot came from the server and no write failed, grey + "offline" otherwise, grey + "syncing" while connecting. It opens `#account-menu` (email, Log out, Delete account…).
- **Log out** stops syncing and keeps the device's days.
- **Delete account:** `#delete-dialog` (Cancel focused) → Google re-authentication pop-up → deletes all the user's documents, then the auth user. Local days stay. Other logged-in devices see their days removed, reload the user and are logged out by Firebase.
- `askDialog` resolves on the form's `submit` (with `close` as the fallback for Esc), because some hidden or background tabs delay the `close` event.

### `index.html` (DOM landmarks)
- `header.page-header` holds three things:
  - `.day-nav`: `#prev-day`, the `h1.date` > `button#date`, `#next-day`, and the `#picker` popover (`#picker-prev`, `#picker-month`, `#picker-next`, `#picker-days`).
  - `img.brand`: the logo.
  - `.header-actions`: `.account` (`#login`, `#sync-status` > `.sync-dot` + `#sync-text`, `#account-menu`), `#export` and `#print` (with `#print-shortcut`).
- `main.page`:
  - `.todo-section` > a ruled paper sheet containing `#todo-priority` (rows 1–3) and `#todo-rest`.
  - `.schedule-section` > the schedule sheet, which has a `.sheet-head` (the title and the `.segmented` time-format switch) and `#schedule` (focusable, `tabindex="0"`).
    - `#schedule` > `#rows`, which holds the 96 generated `.row`s, the closing `00:00` label, and `#layer`.
    - `#layer` holds `#now`, `#cursor` and the `.event` elements.
- `footer.page-footer` > a plain **Netlify form** `product-updates` (§7). It has **no JavaScript**.
- `dialog#merge-dialog` and `dialog#delete-dialog` after the footer (`sync.js`).

### `styles.css`
- `:root` at the top holds app tokens: `--hour-height` (96px, deliberately overriding Ruled's 64px so a 15-minute row is tall enough for a title), `--row-height` = hour / 4, `--label-width`, `--lane-offset`, `--todo-width`, `--page-max-width`, the four `--event-*` tones (light tints built from Ruled tokens; yellow is reserved for the to-do highlighter), and `--status-synced` (green dot) / `--danger` (delete account), because Ruled has no status colours.
- Components are ports of Ruled specs to plain CSS: paper sheet, button (`.btn`, `--quiet`, `--ghost`, `--icon`), hand-drawn checkbox, task row, underline input, segmented switch, schedule, events, picker.
- Layout:
  - **≥ 721px:** the page fits the viewport, and the schedule scrolls inside its own sheet.
  - **≤ 720px:** one column, the to-do list on top, and the whole page scrolls.
  - **≤ 860px:** the header stacks (logo, then date, then actions).
  - **`(hover: none)` (touch screens):** trash, extend and shorten buttons are always visible on events.
- Light theme only. Ruled ships a dark theme, but **the owner rejected dark mode**. Don't enable it.

---

## 5. Key flows

### Keyboard routing
1. **Schedule focused** (`#schedule`): `onScheduleKey` handles the keys.
   - Hour keys jump (a second press within `DOUBLE_PRESS_MS` adds 12 hours).
   - ↑/↓ move the cursor 15 minutes.
   - Enter on an event edits it, keeping its name.
   - Delete/Backspace twice within `DELETE_CONFIRM_MS` deletes the event.
   - Any other printable character starts an event (`typeAt`).
2. **While editing an event**, focus is in that event's `<input>`. Its keydown handler calls `stopPropagation()` and handles ↓/↑ (resize), Enter (commit) and Esc (deliberately does nothing).
3. **Nothing focused** (`document.body`): a document-level listener focuses the schedule and forwards the key, so you can type without clicking first.
4. **To-do inputs** use `onTodoKey`:
   - Enter goes to the next line, and on the last line adds one.
   - Shift+Enter toggles done.
   - Backspace on an empty extra line (beyond 5) removes it.
   - ↑/↓ move between lines.
5. **Cmd/Ctrl+P** is caught in the capture phase by `print.js`, before all of the above.

Hour keys only navigate when there's no Shift or Alt. That's why event names can't *start* with a digit, `-` or `=`. Alt is allowed for typing so characters like Polish `ą` (Option+a) work.

### Event lifecycle
`typeAt(q, char)`:
- On an existing event, it replaces the name.
- Otherwise it pushes a new 1-quarter event and calls `startEdit`, which sets `editingId`, moves the cursor to the event's last quarter, renders, and focuses the event's input.

Then `resizeEditing(±1)` grows or shrinks the event (up to the next event or midnight; at least 1 quarter). `commitEdit()` trims the name and either removes the event (empty name) or moves the cursor just past its end. The input's blur also commits. A tap on a touch screen opens the editor directly.

### Render and save
- `render()` = position the cursor + `renderEvents()` + enable/disable Export + `saveDay()`. **Every event mutation goes through `render()`, which is what saves.** The other save points are the event-name `input` handler and the to-do handlers. Saving runs on every change, so keep `saveDay` cheap.
- `renderEvents()` **reconciles** elements by id through `eventEls`, rather than rebuilding them, so the focused input survives resizing while you type. If you ever rebuild event DOM, editing will break.
- `renderTodos()` rebuilds the list completely. That's fine because it only runs on structural changes (load, add or remove a line).

### Switching days
`showDay(date)`:
1. Commits any edit (which saves the old day).
2. Loads the new day, padding the to-dos to 5.
3. Recomputes `nextEventId`.
4. **Removes all event elements** (ids repeat across days).
5. Renders.
6. Puts the cursor at the current time today, or at 06:00 on other days.
7. Hides the "now" line except on today.
8. Scrolls the schedule so 06:00 is the first visible hour.

---

## 6. Design system: Ruled

`ruled-design-system/README.md` is the visual spec: the paper metaphor, handwriting font (Patrick Hand) for user content and Karla for app text, square corners, ochre at most once per view, and sticky-note tints for events.

The app does **not** use its React bundle (`components/bundle.js`). Components are rewritten in plain HTML/CSS in `styles.css`, following the component READMEs. Use tokens (`var(--ink)`, `var(--space-4)`…) rather than raw values.

The print reads the same tokens at runtime, so a token change shows up in both.

---

## 7. Deployment and environments

- **Netlify**, deployed automatically from the GitHub `main` branch (public repo). `netlify.toml`: `publish = "."`, no build command. Every tracked file in the root is public.
- **Netlify Forms:** the footer form (`name="product-updates"`, `data-netlify="true"`, honeypot `bot-field`) is a plain HTML POST. Netlify detects it at deploy time; that requires *Form detection* to be enabled in the site settings, and a redeploy after enabling it. Submissions show in the Netlify dashboard. Submitting locally fails (the Python server returns 501); that's expected.
- **Local preview:** `python3 -m http.server 5173` from the repo root (the `planner` entry in `.claude/launch.json`), then http://localhost:5173.
- **Firebase** (sync): project setup, authorized domains and the rules are in `firebase/README.md`. Free Spark plan, Firestore in `eur3`. The web config in `sync.js` is public by design; never commit a service-account key. When the domain changes, add it to Authentication → Authorized domains. To test sync locally without a project, run the emulators (`firebase/README.md`) and open http://localhost:5173/?emulators; a second origin (http://127.0.0.1:5173/?emulators) acts as a second device.
- **No automated tests.** Verify in a browser:
  - create, extend, rename and delete events;
  - switch days and reload (data persists);
  - toggle 24h;
  - Print (PNG is 2480 × 3508 and the fonts render);
  - Export (`.ics` times in UTC);
  - check both desktop (≥ 721px) and phone widths;
  - sync (emulators): log in on two origins, edit on one and see it on the other, first log-in dialog, log out, delete account.

---

## 8. Marketing tooling (`marketing/`)

Separate Node project (`playwright-core`, `ffmpeg` required). It drives the **real app** on `localhost:5173`, so it depends on app internals:

- `video/record.mjs` seeds `localStorage` (`qplan:day:*`, `qplan:settings`) before the app loads, then plays a scripted day from `video/days/*.json` as real key presses (`Digit8`, `Equal`, `ArrowDown`, `Enter`…). It crops the schedule sheet.
- `video/make.mjs` (`npm run video -- video/days/<name>.json`) adds a hook band and an end card styled with Ruled tokens, and builds a 1080 × 1920 video into `out/`.
- `carousel/seed.html` fills today with a sample day for screenshots.

**If you change keyboard controls, storage keys, or the schedule's DOM and layout, check that these scripts still work.**

---

## 9. Where to change things

| To change… | Edit |
|---|---|
| Default number of to-dos, priorities, new event length, double-press and delete timings, first visible hour | Config at the top of `app.js` |
| Which keys jump to which hour | `HOUR_KEYS` in `app.js` |
| What a key does in the schedule | `onScheduleKey` (and the event input's keydown in `createEventEl` for edit mode) |
| Time formats | `formatClock` in `app.js` |
| Event colours | `--event-*` in `styles.css` and `EVENT_TONES` in `app.js` (keep them in sync) |
| Row height and schedule spacing | `--hour-height`, `--label-width`, `--lane-offset` in `styles.css` |
| The printed page | `PAGE` and `buildDaySvg()` in `print.js` |
| The calendar export | `buildIcs()` in `export.js` |
| Saved data shape | `saveDay` and `showDay` in `app.js`, plus a migration (see `CLAUDE.md`), plus the marketing seed scripts |
| Header, footer, page structure | `index.html` |
| Sync, log-in, account deletion | `sync.js`; who may read/write what: `firebase/firestore.rules` (then paste into the console) |

---

## 10. Rules (from `CLAUDE.md` and owner decisions)

- The repo is public: no secrets, no `.env`, no revenue figures, nothing from `progress/`.
- Don't break saved data: keep the `qplan:day:YYYY-MM-DD` and `qplan:settings` format, or migrate.
- Don't add user-facing features that weren't asked for or approved in `progress/plan.md`. Offer them instead. Examples already rejected: dark mode, a keyboard-driven date picker.
- Keep it static: no build step, no framework, no runtime dependencies in the app, except the Firebase SDK that `sync.js` loads only for people who log in.
