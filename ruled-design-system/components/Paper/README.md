# Paper

The sheet every list and schedule sits on: `paper-sheet` with square corners, ruled lines every `rule-pitch` in `rule`, and one faint `rule-margin` line on the left.

- Provide the content as children. Props: `ruled` (default true), `margin` (default true), `stacked` (adds `shadow-stack` — use for the main task pad only).
- Turn `ruled` off for the schedule (it draws its own hour lines) and for settings.
- Never round a sheet, never give it a border — the edge comes from the shadow.
- One stacked sheet per screen.
