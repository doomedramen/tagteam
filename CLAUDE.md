# TagTeam — agent guide

Offline-first, mobile-first PWA for small groups sharing recurring tasks (habits/chores), with full
history (on time / late / missed). Self-hosted as one Docker image behind Cloudflare Zero Trust.

**Start here:** read `docs/STATUS.md` (where the project is, what's next, open decisions), then the
design spec `docs/superpowers/specs/2026-09-25-tagteam-design.md`.

## Layout

```
packages/core   @tagteam/core — pure TS: recurrence rules, occurrence/history engine (deriveTask),
                sync Mutation vocabulary + validator, JSON wire types shared by server and web
apps/server     @tagteam/server — Hono API, Better Auth (passkey + password), Drizzle/SQLite,
                sync push/pull, SSE live pokes; serves the built web app when WEB_DIR is set
apps/web        @tagteam/web — Vite + React 19 PWA, Tailwind 4, Dexie (IndexedDB) local-first store,
                sync engine, Serwist service worker
docs/superpowers/specs   approved design spec (binding authority)
docs/superpowers/plans   one implementation plan per phase (01…); each ends with carry-over notes
```

## Commands

```bash
pnpm install
pnpm test                      # all packages (vitest)
pnpm typecheck
rtk proxy pnpm lint            # Biome. Plain `pnpm lint` is mangled by a local RTK shell hook
rtk proxy pnpm format          # Biome write (tabs, double quotes)
pnpm --filter @tagteam/server dev    # API on :3000 (needs apps/server/.env: AUTH_SECRET, BASE_URL)
pnpm --filter @tagteam/web dev       # app on :5173, proxies /api to :3000
docker build -t tagteam:local .      # production image (amd64 in CI)
```

For local dev, `apps/server/.env` must have `BASE_URL=http://localhost:5173` (the Vite origin) so
auth origin checks pass through the Vite proxy. `.claude/launch.json` has `server` and `web` configs.

## Working rules (from the project owner)

- **Commit directly on `main`.** No feature branches or worktrees. Never push unless asked.
- **Conventional Commits.** Never add Co-authored-by or any attribution trailer. Never `--no-verify`.
- **Check your work visually:** run the app and look at it in a browser at phone size (375×812) after
  runtime-visible changes, not only tests.
- Work plan-by-plan: brainstorm → spec → plan in `docs/superpowers/plans/` → execute task-by-task with
  TDD and a review per task (superpowers subagent-driven-development). Sub-agents: Haiku or Sonnet only.
- Keep `docs/STATUS.md` current at the end of every task/plan so another agent can take over.

## Conventions

- Instants are epoch ms numbers; calendar dates are `YYYY-MM-DD` strings in the task's IANA timezone;
  times are `HH:MM`. Due time lives on each rule version (`RuleVersion.dueTime`).
- History is derived, never stored: `deriveTask(schedule, events, now)` in core.
- Every client write is a `Mutation` (core `mutations.ts`) → local outbox → `POST /api/sync/push`
  (idempotent by id) → `GET /api/sync/pull?cursor=` (global `seq`). Server validates with
  `mutationErrors`; web must only enqueue mutations that pass it.
- Server errors are always `{ error: { code, message, details? } }`; inaccessible resources → 404.
- UI: mobile first, ≥44 px tap targets, safe-area insets, light/dark via `prefers-color-scheme`,
  status never colour-only, sentence-case copy without "please"/exclamation marks.
- Security decisions: no IP-based rate limits (cloudflared hides client IPs); Better Auth origin
  checks forced on; auth POSTs from an untrusted `Origin` get 403; 1 MB request body cap.
