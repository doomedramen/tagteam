# 007 — Reveal newly created invite codes

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: LOW
- **Category**: Missed opportunity
- **Estimated scope**: 1 file, small

## Problem

apps/web/src/features/team/InviteSheet.tsx:70-80 stores the newly created code in latest. At lines 156-191, the new-code card appears immediately. Code creation is a rare success moment and the card is the user's next action target.

Current state update:

~~~tsx
const invite: InviteDto = { ...result, createdAt: now };
setInvites((current) => [invite, ...current]);
setLatest(invite);
~~~

Current card insertion:

~~~tsx
{latest ? (
	<Card className="mb-4 gap-0 rounded-2xl border-0 bg-accent-soft p-4 shadow-none ring-0">
		<CardContent className="p-0">
~~~

The card continues with the code, expiration, copy, share, and revoke controls before closing.

## Target

Wrap the card in AnimatePresence with initial={false}. Render the card inside a motion.div keyed by latest.code.

~~~tsx
initial={{ opacity: 0, transform: "translateY(8px)" }}
animate={{ opacity: 1, transform: "translateY(0px)" }}
exit={{ opacity: 0, transform: "translateY(-4px)" }}
transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
~~~

Keep the Card content unchanged. This is a success cue, not a loading animation.

## Repo conventions to follow

- Import animation APIs from motion/react.
- Plan 001 adds MotionConfig reducedMotion="user".
- Plan 002 keeps opacity while dropping transform motion for reduced-motion users.
- InviteSheet owns latest and already clears it when the sheet opens.

## Steps

1. Import AnimatePresence and motion from motion/react.
2. Replace the latest ternary with AnimatePresence initial={false}.
3. Render the existing Card inside motion.div with key={latest.code} and the target values.
4. Keep copy, share, revoke, expiration, error, and loading behavior unchanged.
5. Keep the card's existing insertion order and spacing. Do not add confetti or haptics.

## Boundaries

- Do not alter invite creation or revocation API calls.
- Do not change the displayed code or actions.
- Do not animate the entire invite sheet.
- Do not delay copy or share actions.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Create one invite, then create another while the first card is present. Confirm each new code gets one short reveal and the latest code stays actionable throughout. Enable reduced motion and confirm fade remains while translation drops.
- **Done when**: Each newly created code card reveals once and all invite actions work during the reveal.
