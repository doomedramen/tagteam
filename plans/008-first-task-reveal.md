# 008 — Reveal the first task state

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: LOW
- **Category**: Missed opportunity
- **Estimated scope**: 1 file, small

## Problem

apps/web/src/features/today/TodayList.tsx:475-493 returns the empty state early. Lines 500-518 return the populated state separately. Creating the first task replaces the empty state immediately and changes the top margin from mt-20 to mt-2.

Current empty branch:

~~~tsx
if (!view.hasTasks) {
	return (
		<Empty className="mt-20 gap-3 border-0 p-0">
~~~

Current populated branch begins:

~~~tsx
return (
	<div>
		<div className="mt-2">
			<h1 className="text-[26px] font-semibold tracking-tight">
~~~

TodayView.hasTasks means the current user owns at least one active task in the active group. This is the actual first-task boundary, not merely an empty due-today list.

## Target

Replace the early return with a keyed empty/populated branch inside AnimatePresence with initial={false} and mode="sync". Wrap each branch in motion.div.

Use opacity and an 8px vertical offset. Use a 220ms ease-out transition with [0.23, 1, 0.32, 1]. On exit, use opacity 0 and translateY(-4px). Keep both branches interactive during the short transition.

## Repo conventions to follow

- Import animation APIs from motion/react.
- Plan 001 adds MotionConfig reducedMotion="user".
- Plan 002 preserves opacity and disables movement for reduced-motion users.
- TodayList derives the branch directly from view.hasTasks.

## Steps

1. Remove the early return and keep a single return from TodayList.
2. Wrap the conditional empty/populated branch in AnimatePresence initial={false} mode="sync".
3. Give the empty and populated motion.div elements stable keys, "empty" and "populated".
4. Apply initial opacity 0 and transform translateY(8px); animate to opacity 1 and transform translateY(0px).
5. Apply exit opacity 0 and transform translateY(-4px). Use duration 0.22 and ease [0.23, 1, 0.32, 1].
6. Keep Empty, Add task, progress, sections, Upcoming toggle, and task actions unchanged.
7. Do not animate the first page load while Today data is loading. Animate only when the mounted TodayList changes between empty and populated.

## Boundaries

- Do not change the meaning or calculation of hasTasks.
- Do not use AnimatePresence mode="wait"; it would delay the new state.
- Do not add page-wide entrance motion or stagger task rows.
- Do not delay the Add task button.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: With no active tasks, add the first task and confirm empty content exits while the populated state appears without a blank pause. Add a second task and confirm the populated branch does not replay. With reduced motion, confirm opacity feedback remains and vertical movement drops.
- **Done when**: First-task transition is keyed, reversible, does not replay on unrelated Today updates, and does not delay controls.
