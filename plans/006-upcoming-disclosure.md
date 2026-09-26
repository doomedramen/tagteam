# 006 — Animate the Upcoming disclosure

- **Status**: TODO
- **Commit**: a90b17c
- **Severity**: LOW
- **Category**: Missed opportunity
- **Estimated scope**: 1 file, small

## Problem

apps/web/src/features/today/TodayList.tsx:533-550 conditionally mounts the Upcoming section. The button label changes, but the list appears or disappears with no transition.

Current disclosure:

~~~tsx
{showUpcoming ? (
	<Section
		title="Upcoming"
		rows={view.upcoming}
		now={now}
		onToggle={onToggle}
		celebratingKey={celebratingKey}
	/>
) : null}
~~~

The button already provides a clear label and the section is always the final section. The motion should stay subtle and must not delay task actions.

## Target

Wrap the conditional Upcoming section in AnimatePresence with initial={false}. Use a keyed motion.div around Section.

~~~tsx
initial={{ opacity: 0, transform: "translateY(8px)" }}
animate={{ opacity: 1, transform: "translateY(0px)" }}
exit={{ opacity: 0, transform: "translateY(-4px)" }}
transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
~~~

Keep the section's content and rows unchanged. Do not animate individual task rows or interpolate height.

## Repo conventions to follow

- Import animation APIs from motion/react.
- Plan 001 adds MotionConfig reducedMotion="user".
- Plan 002 preserves opacity feedback and drops spatial motion for reduced-motion users.
- Existing TodayList sections use the Section component in the same file.

## Steps

1. Import AnimatePresence and motion from motion/react.
2. Replace the showUpcoming ternary with AnimatePresence initial={false}.
3. When showUpcoming is true and view.upcoming is nonempty, render a motion.div keyed as "upcoming" around the existing Section call.
4. Apply the target initial, animate, exit, and transition values to that wrapper.
5. Keep the show/hide button label, local-storage state, Section label, task rows, and callbacks unchanged.
6. Do not stagger or disable inputs while the fade runs.

## Boundaries

- Do not change UPCOMING_KEY or persistence behavior.
- Do not add horizontal movement.
- Do not animate the calendar.
- Do not animate height or individual task rows.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Toggle Upcoming repeatedly and quickly. Confirm section enters from 8px below, exits with a 4px upward offset, and never restarts from zero on rerender. Check on a narrow mobile viewport. With reduced motion, confirm opacity remains but movement drops.
- **Done when**: Upcoming appears and disappears with a brief reversible transition and existing persistence remains unchanged.
