# 009 — Keep screen-wide confetti on every completion

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: MEDIUM
- **Category**: Purpose and frequency
- **Estimated scope**: 3 files, small

## Problem

Every successful task completion triggers fireScreenConfettiCannon, which fires two canvas-confetti volleys. The completed row also renders ConfettiBurst in apps/web/src/features/today/TodayList.tsx:133. Keep both effects because the product should celebrate every task completion.

Current completion handler:

~~~tsx
await engine.enqueue({
	id,
	at: Date.now(),
	type: "task.complete",
	taskId: row.task.id,
	occurrenceKey: row.key,
});
fireScreenConfettiCannon();
const nextCelebrationKey = `${row.task.id}:${row.key}`;
setCelebratingKey(nextCelebrationKey);
~~~

Current local effect:

~~~tsx
{done && celebrating ? <ConfettiBurst /> : null}
~~~

## Target

Keep the local ConfettiBurst for each completed row. Fire the screen-wide cannon after every successful task completion, including open, overdue, and upcoming rows. Do not fire it for undo.

## Repo conventions to follow

- Keep the existing completion event and celebrationKey behavior in TodayScreen.
- The completion handler fires the cannon after the completion event is accepted.
- fireScreenConfettiCannon already uses theme colors and canvas-confetti's disableForReducedMotion option.
- ConfettiBurst uses the .confetti-piece reduced-motion rule from index.css.

## Steps

1. Call fireScreenConfettiCannon after every successful task.complete enqueue.
2. Keep the row-local celebratingKey and toast on every completion.
3. Leave undo behavior unchanged.
4. Add or update TodayScreen tests for routine and final task completion, and confirm undo does not fire the cannon.

## Boundaries

- Do not change ConfettiBurst, canvas-confetti particle settings, colors, haptics, or reduced-motion settings.
- Do not remove local task-completion feedback.
- Do not fire the cannon for undo.
- Do not change task completion, persistence, or undo behavior.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web test, pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Complete regular, overdue, and upcoming tasks and confirm each fires the screen-wide volleys. Try undo and confirm no extra cannon fires. Enable reduced motion and confirm canvas particles stay suppressed.
- **Done when**: Every successful task completion gets the screen-wide celebration, undo does not, and tests cover both paths.
