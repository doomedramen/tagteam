# 002 — Preserve feedback with reduced motion

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 10 files, medium

## Problem

apps/web/src/index.css:229-241 reduces every CSS animation and transition to 0.01ms. This removes opacity and color feedback along with spatial motion.

Current rule:

~~~css
@media (prefers-reduced-motion: reduce) {
	.confetti-piece {
		animation: none;
		opacity: 0.7;
	}
	*,
	*::before,
	*::after {
		animation-duration: 0.01ms !important;
		transition-duration: 0.01ms !important;
	}
}
~~~

Existing transform motion also appears in apps/web/src/components/ui/button.tsx:6, apps/web/src/app/AppShell.tsx:89, apps/web/src/components/ui/switch.tsx:25, apps/web/src/app/SyncChip.tsx:48, apps/web/src/components/ui/dropdown-menu.tsx:44 and :141, and apps/web/src/components/ui/drawer.tsx:122. Removing the blanket rule without gating these movements would expose them to reduced-motion users.

## Target

Reduced motion keeps useful opacity and color transitions. It removes nonessential transforms and continuous rotation. Direct drawer swipes remain attached to the user's finger.

Keep only this global rule in apps/web/src/index.css:

~~~css
@media (prefers-reduced-motion: reduce) {
	.confetti-piece {
		animation: none;
		opacity: 0.7;
	}
}
~~~

Use Tailwind's motion-safe variant on nonessential movement. Preserve opacity, color, and focus transitions in reduced mode.

## Repo conventions to follow

- Existing theme tokens live in apps/web/src/index.css.
- Use Tailwind variants inside the existing class strings.
- Motion components use MotionConfig from plan 001.
- Keep current confetti behavior: canvas-confetti already has disableForReducedMotion, and .confetti-piece already stops in the reduced-motion query.

## Steps

1. In apps/web/src/components/ui/button.tsx, replace transition-all with transition-[background-color,border-color,color,opacity] duration-150 ease. Prefix active translate-y-px with motion-safe.
2. In apps/web/src/app/AppShell.tsx, prefix the add button's scale-95, transition-transform, and duration-150 classes with motion-safe.
3. In apps/web/src/components/ui/switch.tsx, prefix the thumb's transition-transform and checked translate-x classes with motion-safe. Keep the switch track's color transition active.
4. In apps/web/src/components/ui/dropdown-menu.tsx, apply motion-safe to slide-in-from-* and zoom-in/out classes for both menu content and submenu content. Keep fade-in/fade-out active.
5. In apps/web/src/components/ui/spinner.tsx, change animate-spin to motion-safe:animate-spin. Keep the status role and label.
6. In apps/web/src/app/SyncChip.tsx, keep its 180ms opacity transition active. Prefix translate-y classes and sync-badge-in animation with motion-safe. In reduced mode, the chip fades without moving.
7. In apps/web/src/components/ui/drawer.tsx, keep an opacity transition in the base class. Put panel transform transition and data-starting-style/data-ending-style closed transforms behind motion-safe. Keep data-swiping movement direct, with duration zero during the gesture.
8. Replace the universal duration overrides in index.css with the target .confetti-piece rule. Search all CSS transition and animation classes after edits. Every nonessential transform or rotation must use motion-safe; opacity, color, and focus feedback must remain available.
9. In apps/web/src/components/ui/toggle.tsx and badge.tsx, replace transition-all with transition-[background-color,border-color,color,opacity] duration-150 ease. Keep their existing visual states.

## Boundaries

- Do not disable opacity, color, or focus feedback in reduced mode.
- Do not remove direct manipulation from drawer swipes.
- Do not modify canvas-confetti settings.
- Do not add movement to hover states on touch devices.
- Do not add animation dependencies beyond Motion from plan 001.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Enable prefers-reduced-motion in browser DevTools. Check buttons, dropdowns, switch, drawer, sync chip, and spinner. Confirm no nonessential element translates, scales, rotates, or spins. Confirm opacity/color/focus feedback remains. Test drawer swipe on a real touch device; panel must track the finger.
- **Done when**: The universal CSS duration override is gone, listed spatial effects respect motion preference, and feedback remains visible.
