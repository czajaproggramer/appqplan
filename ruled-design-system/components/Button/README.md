# Button

Three quiet variants set in the hand face: `quiet` (default, `line` outline), `primary` (`ochre` fill, `on-ochre` label) and `ghost` (no outline — icon actions like add and delete).

- Props: `variant`, `icon` (`plus`, `trash`, `settings` — hand-drawn strokes), children for the label, plus any button attribute.
- **Primary at most once per view**, for the one thing the screen is for ("Add task").
- Icon-only buttons need an `aria-label`.
- Labels are short, lowercase-friendly and verb first: "Add task", "Clear done".
