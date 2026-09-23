# Schedule

The hourly day view: hour labels in `sans-time`, an hour line in `rule` every `hour-height`, a dashed half-hour line, events as sticky-note tints and a `pencil` line marking now.

- Props: `start` / `end` (whole hours, default 8–18), `events` (`{start, end, title, tone}` with times as `"09:30"` strings or hour numbers; `tone` `yellow` default, `peach`, `sage`), `now` (a time; omit on days other than today).
- Place it inside a `Paper` with `ruled={false}` — the labels are knocked out of `paper-sheet`.
- Use tones for kinds of events, not decoration; three at most. Events ≤ 30 minutes collapse onto one line.
- Overlapping events are not laid out side by side — keep the day simple.
