# Ruled

Ruled is a design system for a small to-do and day-planner app. It should feel like a good notepad on a desk: warm off-white paper, a pen-drawn hand, lots of air, square corners. Everything here serves two screens — a list of tasks and an hourly day.

## Principles

- **Paper, not glass.** Surfaces are sheets (`paper-sheet`) on a desk (`paper`). Corners are square (`radius-0`); controls get at most `radius-1` (2px). No gradients, no blur, no floating cards — sheets stack (`shadow-stack`) or lie flat (`shadow-sheet`).
- **Handwriting for what you wrote, print for what the app wrote.** Tasks, titles, event names and button labels are in the hand face (`hand-*` styles, Patrick Hand). Times, counts, meta and helper text are in the sans (`sans-*` styles, Karla). Never set a paragraph of instructions in the hand face.
- **Warm, only just.** The neutrals lean a few degrees toward yellow-brown; `ochre` is the only saturated colour and appears at most once per view (the primary button or today's date). Sticky-note tints (`note-yellow`, `note-peach`, `note-sage`) are reserved for schedule events.
- **Spacious.** One task per ruled line (`rule-pitch`, 48px). Sheets get `space-6`–`space-8` of padding; sections sit `space-12` apart. When in doubt, add air, not lines.

## Voice

Short and human, like a note to yourself. Sentence case, no trailing periods on tasks, no exclamation marks, no emoji. Empty states are calm: "Nothing planned yet — enjoy the quiet." Buttons are verb first: "Add task", "Clear done".

## Colour

- Page on `paper`; lists and the schedule on a `Paper` sheet (`paper-sheet`); hover and pressed rows on `paper-sunk`.
- Text in `ink`; secondary text in `ink-muted`; completed tasks and placeholders in `ink-faint` (on paper grounds only — it is deliberately below 4.5:1 in Daylight and never carries anything you must read to act).
- Ruled lines in `rule`, the single margin line in `rule-margin`. Both are decoration: controls are outlined in `line`, which holds 3:1.
- `pencil` marks now in the schedule and is the focus ring (via `focus`): 2px solid, 2px offset, on every interactive element.
- Two themes: Daylight (default) and Lamplight, a warm dark for evenings. Every text pair above holds in both.

## Type

| style | face | use |
| --- | --- | --- |
| `hand-display` 44/48 | Patrick Hand | the day heading, once per screen |
| `hand-title` 28/34 | Patrick Hand | sheet titles |
| `hand-task` 20/28 | Patrick Hand | tasks, inputs, buttons |
| `hand-note` 17/22 | Patrick Hand | event titles |
| `sans-body` 15/22 | Karla | helper text, settings |
| `sans-label` 13/18 · 500 | Karla | counts, meta |
| `sans-time` 12/16 · 500 | Karla | hour labels, event times (tabular figures, 24h `09:00`) |

## Layout and space

Spacing steps are `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-6` 24 · `space-8` 32 · `space-12` 48 · `space-16` 64. Task rows are `rule-pitch` tall; an hour in the schedule is `hour-height`. Keep content columns narrow (about 480px for a list); on desktop place the task sheet and the day side by side with `space-12` between.

## Iconography

Only three icons, drawn as single wobbly pen strokes at 1.6px in `currentColor` (`plus`, `trash`, `settings`, via `Button icon` or `Icon`). Anything more should also be a thin, slightly uneven line — never filled glyphs or emoji.

## Motion

Barely any. The checkbox tick draws in over 220ms; hovers fade in 120ms. Nothing slides or bounces; reduced motion turns the tick off.

## Components

`Paper` (the sheet), `Button`, `Checkbox`, `Task` (a row on the list), `Input` (the underline to write on) and `Schedule` (the hourly day). That's the whole kit — compose screens from these rather than adding new chrome.

## Files

- `tokens.json` — source of truth for every token (colours per theme, type, spacing, radius, shadow).
- `tokens.css` — the same tokens as CSS custom properties, `@font-face` rules and one class per type style (`.hand-task`, `.sans-time`…). Light theme on `:root`; set `data-theme="dark"` on `<html>` for Lamplight.
- `fonts/` — Patrick Hand and Karla (woff2, Latin subset; SIL Open Font License).
- `components/bundle.js` + `bundle.css` — reference React 18 implementations exposed as `window.Ruled` (expects `window.React`); `index.d.ts` documents the props; each `components/<Name>/README.md` holds the usage rules. The `preview.html` files are fragments rendered by the design-system viewer, not standalone pages.
- `demo.html` — open it (through any local server) to see the task list and day schedule working together.

To port into your own stack, treat `tokens.css` and the component READMEs as the spec and rewrite the components in your framework.
