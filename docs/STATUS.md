# Project status

_Last updated: 2026-09-25 (during Plan 6)._

## Done (on `main`; CI green through Plan 5)

| Plan | Scope | Notes |
|---|---|---|
| 01 core engine | recurrence rules, slots, `deriveTask` (one open occurrence, gaps logged as missed), stats | |
| 02 server foundation | Hono, Better Auth (passkey + password), SQLite, profiles, groups, single-use 6-digit invites | |
| 03 container + CI | esbuild bundle, backup CLI, non-root Docker image, GitHub Actions → `ghcr.io/doomedramen/tagteam` (amd64), README compose | IP rate limits dropped by owner decision |
| 04 sync | per-version due times, Mutation vocabulary, tasks/events tables, push/pull with global seq, SSE `/api/live`, e2e convergence test | |
| 05 app foundation + Today | sign-in, groups, Today, offline sync, PWA, Docker hosting | Local e2e flow and hosted CI passed |

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

## In progress — Plan 6

| Slice | Status |
|---|---|
| Team | Implemented member progress, inline task lists, overdue nudges, and invite code create/share/copy/revoke. Typecheck and 375 × 812 visual review passed. |
| Me passkey status | Shows registered passkey count and offers “Add another passkey”. Typecheck and visual review passed. |
| History | Implemented newest-first group activity by day with member filtering, completion status, misses, nudges, and new tasks. Typecheck and 375 × 812 visual review passed. |
| Remaining | Task detail/history, profile editing, and swipe-to-complete. |

Per-task execution ledger (rulings, review findings, deferred minors) lives in the git-ignored
`.superpowers/sdd/2026-09-25-05-app-foundation-today/progress.md` in the working checkout. The
decisions that matter are summarised below.

## Next plans

- **Plan 6 — remaining screens:** task detail/history (calendar dots, stats, edit schedule/archive),
  profile editing, and swipe-to-complete. Mockups agreed in brainstorming; spec §6.
- **Plan 7 — push notifications:** web-push subscriptions, due/overdue scheduler, nudges as push.

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

## Known follow-ups (deferred minors)

- CI actions target Node 20 (deprecation warnings) — bump action majors.
- Maskable icon uses an 80 % box rather than the circular safe zone.
- `deriveTask` re-runs for every task on each 30 s tick; memoize if histories grow large.
- EventSource has no error handler (session expiry still surfaces via push/pull).
