# 004 — Animate progress with transforms

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 3 files, small

## Problem

Progress indicators transition width in apps/web/src/features/today/TodayList.tsx:516 and apps/web/src/features/team/TeamScreen.tsx:173. Base UI Progress v1.8.0 sets an inline width on ProgressIndicator. Width changes trigger layout work, even though these bars are only 4–6px tall.

Current call sites:

~~~tsx
indicatorClassName="bg-success transition-[width] duration-300"
~~~

~~~tsx
indicatorClassName="bg-success transition-[width] duration-200"
~~~

The shared wrapper is apps/web/src/components/ui/progress.tsx:43-54. Its current indicator uses transition-all.

~~~tsx
className={cn("h-full rounded-full bg-primary transition-all", className)}
~~~

## Target

Keep Base UI's numeric root value and accessibility attributes. Render determinate indicators at width 100%, set transform-origin to left center, and animate transform scaleX(value / 100). Clamp the scale between 0 and 1. For null/indeterminate values, preserve Base UI's existing indicator style unchanged.

Use motion-safe:transition-transform with the existing durations: 300ms on Today and 200ms on Team. Use the shared --ease-in-out token. Reduced-motion users see the updated value immediately.

Base UI merges caller style after its generated indicator style in v1.8.0. Set width:100%, transformOrigin:left center, and transform on the indicator style so this overrides only the visual width; retain root value for semantics.

## Repo conventions to follow

- Progress wrapper is in apps/web/src/components/ui/progress.tsx.
- Callers pass indicatorClassName in TodayList and TeamScreen.
- Keep the Base UI Progress root value, labels, and aria-labels unchanged.
- Easing tokens live in apps/web/src/index.css.

## Steps

1. In Progress, compute a clamped normalized scale only when value is numeric.
2. Pass that scale to ProgressIndicator without changing the root value.
3. In ProgressIndicator, for determinate values override generated width to 100%, set transformOrigin to left center, and set transform to scaleX(normalizedValue). Do not override Base UI's styles for null values.
4. Replace the default transition-all class with transition-transform.
5. Change TodayList and TeamScreen indicator classes to motion-safe:transition-transform with their current 300ms and 200ms durations and ease-[var(--ease-in-out)].
6. Keep track overflow hidden and rounded corners so the left-origin fill remains clipped.

## Boundaries

- Do not change progress calculations, totals, labels, colors, or Base UI semantics.
- Do not add spring overshoot to progress.
- Do not animate layout properties.
- If caller style does not override Base UI's generated width in the installed dependency, stop and report. Do not switch to an unsupported custom CSS variable.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Complete one task and watch Today progress move. Expand each team row and watch Team progress. Confirm bar fills from left, never overshoots, and aria-valuenow still matches the displayed percent. Enable reduced motion and confirm the fill updates without interpolating.
- **Done when**: Determinate progress changes use transform only; null values retain Base UI behavior.
