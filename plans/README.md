# Motion implementation plans

Plans record verified findings from the animation audit at commit a90b17c and their completed implementation.

| # | Plan | Severity | Status |
|---|---|---:|---|
| 001 | Add shared motion runtime | MEDIUM | DONE |
| 002 | Preserve feedback with reduced motion | MEDIUM | DONE |
| 003 | Tighten toast motion | MEDIUM | DONE |
| 004 | Animate progress with transforms | LOW | DONE |
| 005 | Animate team member disclosures | MEDIUM | DONE |
| 006 | Animate the Upcoming disclosure | LOW | DONE |
| 007 | Reveal newly created invite codes | LOW | DONE |
| 008 | Reveal the first task state | LOW | DONE |
| 009 | Keep screen-wide confetti on every completion | MEDIUM | DONE |

## Recommended execution order

1. Implement 001, then 002. They establish Motion APIs and reduced-motion behavior.
2. Implement 003 and 004. They refine existing motion and progress rendering.
3. Implement 005 and 006. These are frequent disclosures; keep transitions brief and reversible.
4. Implement 007 and 008. These add rare success and first-use reveals.
5. Implement 009. It changes celebration cadence, not the motion runtime.

Plans 003–008 depend on 001 and 002. Plan 009 is independent.

## Decisions from the audit

- Keep task-calendar cells static when paging months. Week count and date data change, so sliding the grid can imply spatial continuity that is not present. Do not animate a heading crossfade; overlapping month labels can reduce readability.
- Fire the screen-wide confetti cannon for every successful task completion. Keep the local row burst as additional task-level feedback; undo does not fire the cannon.
- Progress width transitions are small but trigger layout. Plan 004 converts determinate bars to left-origin scaleX while retaining Base UI's value and accessibility state.

## Source references

- Motion for React: https://motion.dev/docs/react-installation
- AnimatePresence: https://motion.dev/docs/react-animate-presence
- Layout animation: https://motion.dev/docs/react-layout-animations
- Reduced motion: https://motion.dev/docs/react-accessibility
- Base UI Progress v1.8.0: https://base-ui.com/react/components/progress
