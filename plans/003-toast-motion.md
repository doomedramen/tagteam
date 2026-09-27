# 003 — Tighten toast motion

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: MEDIUM
- **Category**: Easing and duration
- **Estimated scope**: 1 file, small

## Problem

apps/web/src/components/ui/toast.tsx:46 gives toast transform and opacity changes 500ms. The inner content fades in 250ms at line 71. Toasts are occasional UI feedback, so the outer card feels slow and its contents finish at a different time.

Current root transition:

~~~tsx
"[transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
~~~

Current content transition:

~~~tsx
"flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
~~~

## Target

Use 220ms for toast position changes and 180ms for opacity. Use the shared ease-out token. Remove the height transition. Keep drag tracking immediate while Base UI marks the toast as swiping.

Set the root's default class to transition-opacity duration-180. Add a motion-safe transition declaration for transform 220ms var(--ease-out-strong) and opacity 180ms var(--ease-out-strong). Add data-starting-style opacity 0. Put all starting and ending transform classes behind motion-safe. Add a data-swiping rule that sets transition duration to 0ms.

Set ToastContent to transition-opacity duration-180 ease-[var(--ease-out-strong)]. Keep data-behind and data-expanded opacity states.

## Repo conventions to follow

- Toast state comes from Base UI data attributes in apps/web/src/components/ui/toast.tsx.
- Easing tokens live in apps/web/src/index.css.
- Plan 002 removes the global reduced-motion duration override. This plan must preserve opacity fades and gate spatial motion with motion-safe.
- Base UI exposes data-swiping on Toast.Root in the installed 1.8.0 dependency.

## Steps

1. Replace the root 500ms transform/opacity/150ms height transition with the target property-specific transitions.
2. Add opacity 0 to data-starting-style so toast entry fades as it moves.
3. Prefix each data-starting-style and data-ending-style transform class, including swipe-direction exits, with motion-safe.
4. Disable transition duration while data-swiping is present. Let the swipe variable track the pointer; animate only after the gesture ends.
5. Change ToastContent opacity duration from 250ms to 180ms and use --ease-out-strong.
6. Keep toast stacking, swipe directions, viewport position, close timing, and content unchanged.

## Boundaries

- Do not animate height, width, margin, or padding.
- Do not alter auto-dismiss duration or toast stacking behavior.
- Do not add scale motion.
- Do not delay toast actions while motion runs.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Trigger a toast, stack a second toast, expand/collapse the stack, and swipe in each supported direction on a touch device. Confirm entry feels quick, text fade finishes with the card, and swipe follows the finger without lag. Enable reduced motion and confirm the toast fades without sliding.
- **Done when**: Toast transitions stay under 300ms, opacity and position timings are deliberate, and swipe tracking remains direct.
