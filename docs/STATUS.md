# Project status

_Last updated: 2026-10-01 (Plan 8 task suggestions complete)._

## Done (on `main`; CI green through Plan 7, Plan 8 not yet run in CI)

| Plan | Scope | Notes |
|---|---|---|
| 01 core engine | recurrence rules, slots, `deriveTask` (one open occurrence, gaps logged as missed), stats | |
| 02 server foundation | Hono, Better Auth (passkey + password), SQLite, profiles, groups, single-use 6-digit invites | |
| 03 container + CI | esbuild bundle, backup CLI, non-root Docker image, GitHub Actions → `ghcr.io/doomedramen/tagteam` (amd64), README compose | IP rate limits dropped by owner decision |
| 04 sync | per-version due times, Mutation vocabulary, tasks/events tables, push/pull with global seq, SSE `/api/live`, e2e convergence test | |
| 05 app foundation + Today | sign-in, groups, Today, offline sync, PWA, Docker hosting | Local e2e flow and hosted CI passed |
| 06 remaining screens | Team, task history/editing, profile editing, swipe-to-complete | CI passed |
| 07 push notifications | per-device web-push, due/overdue reminders, team nudges, quiet hours | Requires VAPID environment values to send push |
| 08 task suggestions | suggest a task to another member from New task; accept or decline on Today; History and task detail say who suggested it; push for suggested, accepted and declined | Spec: `2026-10-01-task-suggestions-design.md` |

## Complete — Plan 5: `docs/superpowers/plans/2026-09-25-05-app-foundation-today.md`

PWA foundation + the first real screens (Today, Add task). Executed task-by-task with reviews.

| Task | Status |
|---|---|
| 1 scaffold, tokens, icons | done |
| 2 wire types + `withScheduleVersion` in core | done |
| 3 Dexie store, applyLocal / applyPull (rebase) | done |
| 4 API client, auth client, sync engine, live + triggers | done |
| 5 UI kit + app shell | done |
| 6 Today screen | done |
| 7 Add task sheet | done — due-time validation and double-submit guard |
| 8 sign in / sign up / passkeys / session gate + router | implemented; typecheck and 375 × 812 visual checks passed; tests pending |
| 9 welcome (create/join group) + group switcher | implemented; create/join and switcher visually checked; tests pending |
| 10 service worker, server serves SPA, Docker, dev setup | implemented; PWA build, container smoke, and 375 × 812 browser review passed; tests pending |
| 11 Playwright e2e (sign up → offline completion) + CI job | implemented; local e2e, hosted CI, and actionlint passed |

Task 8 wires real routes and screens into the app. Unit tests for Tasks 8–10 remain follow-up work.
Task 11 e2e covers account creation, group setup, task creation, offline completion, and online sync.

## Complete — Plan 6

| Slice | Status |
|---|---|
| Team | Implemented member progress, inline task lists, overdue nudges, and invite code create/share/copy/revoke. Typecheck and 375 × 812 visual review passed. |
| Me passkey status | Shows registered passkey count and offers “Add another passkey”. Typecheck and visual review passed. |
| History | Implemented newest-first group activity by day with member filtering, completion status, misses, nudges, and new tasks. Typecheck and 375 × 812 visual review passed. |
| Task detail/history | Shows stats, a color-coded month grid, occurrence history, completion undo, overdue nudges, and owner actions. Owners can edit task title, repeat schedule, effective date, and due time. |
| Profile editing | Members can edit their display name and avatar color from Me. |
| Swipe-to-complete | Swipe a Today row right to complete it; the existing button remains available. |

Per-task execution ledger (rulings, review findings, deferred minors) lives in the git-ignored
`.superpowers/sdd/2026-09-25-05-app-foundation-today/progress.md` in the working checkout. The
decisions that matter are summarised below.

## Complete — Plan 7: push notifications

- VAPID configuration enables push for a self-hosted instance; missing keys leave push disabled.
- Authenticated routes register and remove per-device subscriptions and save account-level
  reminder, nudge, and quiet-hour preferences.
- A minute scheduler uses `deriveTask` to send one due and one overdue reminder per occurrence.
  Timed tasks notify at their due time and again one hour later if still open. Untimed tasks notify
  at 09:00 local time and again at 09:00 on the next period boundary. Quiet hours use profile zone.
- Successful task nudges queue push for the owner immediately; sender/task limit stays in sync core.
- Notification logs dedupe by task, occurrence, and kind. Failed deliveries retry with backoff;
  expired push endpoints are removed.
- Me screen provides device opt-in, reminders and nudge toggles, quiet hours, and timezone update.
  Service worker displays notifications and opens Today or Team when tapped.
- Reminder and nudge opt-in starts at enable time; older triggers and newly added devices receive
  no catch-up notifications.
- New tasks skip reminder triggers that predate their creation, preventing an immediate push
  when a task is added after its reminder time. Future due and overdue reminders still apply.
- Typecheck, lint, server bundle, and PWA build pass.

## Complete — Plan 8: task suggestions

- Four sync mutations (`suggestion.create|accept|decline|withdraw`). The `suggestion` table never
  deletes rows (status changes instead, so sync needs no tombstones); `task.suggestedBy` records the
  suggester of an accepted task.
- Pull returns a suggestion only to its sender and recipient. Accept inserts the task and updates the
  suggestion in the one push transaction. Leaving a group withdraws pending suggestions to or from
  the leaver and the declined ones they sent. At most 10 pending per sender and recipient per group.
- Push: "suggested" (to the recipient), "accepted" and "declined" (to the sender); gated by the
  receiving user's nudge toggle, held during their quiet hours, a held "suggested" push is dropped
  if the suggestion is no longer pending, once per suggestion per kind, nothing on withdraw.
  `notification_log.task_id` is now nullable and a `suggestion_id` column dedupes suggestion pushes.
- Migration `0004_task_suggestions.sql` is hand-edited: drizzle-kit's generated rebuild of
  `notification_log` would cascade-delete queued `notification_delivery` rows inside the migrator's
  transaction, so the file parks deliveries in a backup table first. `src/db/migrations.test.ts`
  guards this.
- Web: Dexie `version(2)` `suggestions`; "For" chips in New task (hidden with no other active member
  and when editing); incoming cards and a "Suggested by you" section on Today; History says
  "{owner} took on {title}" with "Suggested by {name}"; the Me toggle is "Nudges and suggestions".
- Checks: unit tests, typecheck, lint, and the two-user Playwright flow (WebKit `iphone` and
  `chromium` projects) passed. The 375 × 812 light/dark visual check is pending.

## Next plans

- "Team up" on shared or dependent tasks was considered and dropped (spec §1): nudges and talking
  cover it.

## Decisions to know (made during execution)

- Offline edits conflict by last-writer-wins on the client's clamped timestamp (±5 min) per field
  group; schedule edits replace everything from their effective date forward.
- Live updates use SSE, not WebSocket. Pull has no pagination (small groups).
- Rejoining a group via invite makes you a `member` even if you were admin.
- Better Auth only checks Origin on cookie-bearing requests; we add our own 403 for untrusted
  Origins on auth POSTs. Brute-force protection for sign-in relies on Cloudflare Access.
- A sync requested while a run is failing is not retried immediately; triggers (online, visibility,
  60 s timer, SSE poke) retry.
- Today computes "done today" in the browser's timezone; tasks carry their own timezone.
- Task circles now support a single tap to complete or reopen; right swipe remains a shortcut.
  A completed task uses neutral blue Reopen feedback. Drag-generated clicks remain suppressed,
  and vertical, short, reversed, and cancelled gestures do not change state.
- New tasks open a compact title-first sheet. Schedule expands on request; editing starts with
  schedule expanded. Add/Save and inline save failures sit outside the scrolling body.
- The sheet lifts and caps its height using the keyboard inset, keeping its header and footer
  visible. Button taps retain input focus so keyboard dismissal cannot move the hit target
  before release. Extra keyboard scroll padding is suppressed because the sheet already clears
  the keyboard. Drafts survive closing/reopening within the current group and page session.
- Interaction design: `docs/superpowers/specs/2026-09-28-task-interactions.md`.
- Validation includes 75 web tests, web typecheck, lint, production build, and mobile browser
  coverage for task creation, simulated keyboard geometry, taps, swipes, undo, and offline sync.
  Native iPhone keyboard animation and installed-PWA behavior still require device verification.
- Haptics are omitted because iOS PWA scripted switch clicks are unreliable.
- Suggestions: the recipient's browser computes the accepted task's `startDate` (later of the
  suggestion's start and today) and sends its own timezone; the server only enforces
  `startDate >= suggestion.startDate`. A withdraw racing an accept resolves by arrival order and the
  loser's client re-pulls. After sending a suggestion the New task sheet resets to "Me". History and
  task detail say "Suggested by you" when the viewer is the suggester. Better Auth user ids are not
  UUIDs, so `toUserId` is validated as a bounded non-empty string.

## Remaining follow-ups

- Production push needs stable `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` values.
- `deriveTask` re-runs for every task on each 30 s tick; measure before optimizing if histories grow.
