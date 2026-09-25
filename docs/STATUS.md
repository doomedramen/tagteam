# Project status

_Last updated: 2026-09-25 (during Plan 5, Task 9)._

## Done (on `main`, CI green through Plan 4)

| Plan | Scope | Notes |
|---|---|---|
| 01 core engine | recurrence rules, slots, `deriveTask` (one open occurrence, gaps logged as missed), stats | |
| 02 server foundation | Hono, Better Auth (passkey + password), SQLite, profiles, groups, single-use 6-digit invites | |
| 03 container + CI | esbuild bundle, backup CLI, non-root Docker image, GitHub Actions → `ghcr.io/doomedramen/tagteam` (amd64), README compose | IP rate limits dropped by owner decision |
| 04 sync | per-version due times, Mutation vocabulary, tasks/events tables, push/pull with global seq, SSE `/api/live`, e2e convergence test | |

## In progress — Plan 5: `docs/superpowers/plans/2026-09-25-05-app-foundation-today.md`

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
| 10 service worker, server serves SPA, Docker, dev setup | next — `.claude/launch.json` "web" config already added; keep it |
| 11 Playwright e2e (sign up → offline completion) + CI job | |

Task 8 wires real routes and screens into the app. Task 8 and Task 9 unit tests were not run in these passes.

Per-task execution ledger (rulings, review findings, deferred minors) lives in the git-ignored
`.superpowers/sdd/2026-09-25-05-app-foundation-today/progress.md` in the working checkout. The
decisions that matter are summarised below.

## Next plans

- **Plan 6 — remaining screens:** Team (members, progress, Nudge), task detail/history (calendar dots,
  stats, edit schedule/archive), History activity feed, full Me (profile, passkeys, invite codes UI),
  swipe-to-complete. Mockups agreed in brainstorming; spec §6.
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
