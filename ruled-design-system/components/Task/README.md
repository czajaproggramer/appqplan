# Task

One row of the to-do list: a Checkbox, the task text in `hand-task`, optional `meta` (a time or count, `sans-time`) and a delete action that appears on hover.

- Props: children (the task text), `done`, `onToggle(done)`, `onDelete` (shows the trash button), `meta`.
- One row = one `rule-pitch`, so tasks sit on the Paper's ruled lines.
- Done tasks turn `ink-faint` and are struck through; keep them in place rather than hiding them — crossing things off is the reward.
- Write tasks the way people jot them: sentence case, no trailing period.
