# Checkbox

A hand-drawn square whose tick is drawn in with a short pen stroke when checked.

- Props: `checked` + `onChange(checked)` (controlled) or `defaultChecked`; `label` (optional); any input attribute. Without a `label`, pass `aria-label`.
- Outline in `line`, tick in `ink`; focus ring `focus`, 2px, offset 2px.
- The tick animation is off under reduced motion.
- Don't recolour the tick — the checkbox never uses ochre.
