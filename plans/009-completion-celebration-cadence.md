# 009 — Reserve screen-wide confetti for all done

- **Status**: TODO
- **Commit**: a90b17c
- **Severity**: MEDIUM
- **Category**: Purpose and frequency
- **Estimated scope**: 3 files, small

## Problem

apps/web/src/features/today/TodayScreen.tsx:78-92 calls fireScreenConfettiCannon after every task completion. That function fires two canvas-confetti volleys. The completed row also renders ConfettiBurst in apps/web/src/features/today/TodayList.tsx:133. This creates both local and screen-wide effects for a routine action.

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

Keep the local ConfettiBurst for each completed row. Fire the screen-wide cannon only when this completion makes TodayList's existing allDone predicate true after the update:

~~~tsx
view.total > 0 &&
view.overdue.length === 0 &&
view.today.every((row) => row.kind === "done")
~~~

Compute the projected post-completion state before enqueueing. Match occurrences by task id and key. Only project rows currently present in overdue or today; never fire for upcoming rows. For an open-today row, replace that row's kind with done in the projected today list. For an overdue row, remove it from projected overdue and append it as a done row to projected today. Set projected total to projected today length plus projected overdue length. Apply the quoted allDone predicate to this projected view. Do not fire the cannon for undo.

## Repo conventions to follow

- Keep the existing completion event and celebrationKey behavior in TodayScreen.
- TodayList's allDone predicate is the source of truth for the completion condition.
- fireScreenConfettiCannon already uses theme colors and canvas-confetti's disableForReducedMotion option.
- ConfettiBurst uses the .confetti-piece reduced-motion rule from index.css.

## Steps

1. Add a small pure helper in TodayScreen.tsx that receives TodayView and the row being completed and returns whether the projected view meets the existing allDone predicate.
2. Match rows by both task id and occurrence key so recurring occurrences remain distinct.
3. Call fireScreenConfettiCannon only when the helper returns true. Keep the row-local celebratingKey and toast on every completion.
4. Leave undo behavior unchanged.
5. Add or update TodayScreen tests for: ordinary completion does not call the cannon; the final eligible completion calls it once; undo does not call it.

## Boundaries

- Do not change ConfettiBurst, canvas-confetti particle settings, colors, haptics, or reduced-motion settings.
- Do not remove local task-completion feedback.
- Do not fire a celebration when overdue or open-today rows remain.
- Do not change task completion, persistence, or undo behavior.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web test, pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Complete a regular task and confirm only its row bursts. Complete the final eligible task and confirm the two screen-edge volleys fire once. Try undo and confirm no screen-wide effect returns. Enable reduced motion and confirm canvas particles stay suppressed.
- **Done when**: Routine completion has local delight, end-of-day completion gets the screen-wide celebration, and tests cover both paths.
