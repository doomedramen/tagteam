# 005 — Animate team member disclosures

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: MEDIUM
- **Category**: Missed opportunity
- **Estimated scope**: 1 file, small

## Problem

apps/web/src/features/team/TeamScreen.tsx:177-186 animates the chevron for 150ms, but mounts and removes the member's task details instantly.

Current disclosure:

~~~tsx
{expanded ? (
	<div id={id} className="border-t border-line pb-3 pl-12 pr-1">
		{children}
	</div>
) : null}
~~~

The chevron class at line 179 uses transition-transform duration-150 and conditionally adds rotate-180. The member rows are list items. Opening one changes its height and shifts every row below it.

## Target

Keep aria-expanded and aria-controls unchanged. Animate the detail panel with opacity and a small vertical offset. Animate member row layout with transforms so later rows move with the disclosure.

Use this entry and exit:

~~~tsx
initial={{ opacity: 0, transform: "translateY(8px)" }}
animate={{ opacity: 1, transform: "translateY(0px)" }}
exit={{ opacity: 0, transform: "translateY(-4px)" }}
transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
~~~

Use a 220ms layout transition with ease [0.77, 0, 0.175, 1]. Keep chevron rotation at 150ms and gate its transform with motion-safe.

## Repo conventions to follow

- Import React animation APIs from motion/react.
- Plan 001 adds MotionConfig reducedMotion="user".
- Plan 002 sets the reduced-motion policy.
- Keep expansion state in TeamScreen; do not move it into MemberRow.

## Steps

1. Change each MemberRow list item to motion.li with layout enabled. Apply the 220ms layout transition so sibling rows retarget when one row changes height.
2. Wrap the conditional detail panel in AnimatePresence with initial={false} and mode="sync".
3. Render the detail panel as motion.div with the target initial, animate, exit, and transition values.
4. Keep its id, border, padding, children, aria-expanded, and aria-controls unchanged.
5. Keep the existing chevron rotation at 150ms. Prefix its transform transition and rotate state with motion-safe.
6. Do not stagger task rows. All controls must become interactive immediately.

## Boundaries

- Do not change member ordering, task grouping, task actions, or expansion state.
- Do not animate the avatar, member name, progress value, or each task row.
- Do not add a fixed height or clip overflowing task controls.
- Do not change list or disclosure semantics.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Expand and collapse one member, then rapidly toggle two different members. Confirm the active panel fades and shifts slightly; rows below move without jumping; actions remain usable. Enable reduced motion and confirm details fade without moving.
- **Done when**: Team detail content has a reversible enter/exit, row positions retarget smoothly, and disclosure accessibility remains intact.
