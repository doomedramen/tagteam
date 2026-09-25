# Plan 3 — Container, CI and Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the server as a small, non-root Docker image built and published to GitHub Container Registry by GitHub Actions, with a copy-paste `docker-compose.yml` (app + `cloudflared`) in the README — after applying the security decisions made during Plan 2 review.

**Architecture:** The server is bundled with esbuild into `dist/index.js` (+ `dist/backup.js`), keeping only the native `better-sqlite3` external. A multi-stage Dockerfile builds the bundle in a full Node image and copies bundle + migrations + a production install of `better-sqlite3` into `node:24-bookworm-slim`, running as `node` with data in a `/data` volume. CI runs typecheck/lint/tests, builds the image, smoke-tests it over HTTP with `scripts/smoke.mjs`, then pushes multi-arch (`amd64` + `arm64`) images to `ghcr.io/<owner>/<repo>` on `main` and `v*` tags.

**Tech Stack:** esbuild, Docker (multi-stage, buildx), GitHub Actions (`docker/*` actions, `pnpm/action-setup`), existing Hono/Better Auth/Drizzle server.

**Spec:** `docs/superpowers/specs/2026-09-25-tagteam-design.md` (§2 Hosting + Distribution, §3 architecture, §4 invite_code)

## Global Constraints

- Node ≥ 24, pnpm 10 (pin `"packageManager": "pnpm@10.20.0"`), ESM, TypeScript strict. Biome: tabs + double quotes; lint `rtk proxy pnpm lint`, format `rtk proxy pnpm format`.
- **No IP-based rate limiting anywhere** (user decision 2026-09-25): behind `cloudflared` every request shares the tunnel's IP. Invite redeem is limited **per user only** (5/min, 20/h). Better Auth's built-in (IP-keyed) rate limiter is **disabled**. Sign-in brute-force protection is Cloudflare Access. No code reads `cf-connecting-ip` / `x-forwarded-for`.
- Better Auth origin checks stay forced on (`advanced.disableOriginCheck: false`). Additionally, state-changing `/api/auth/*` requests whose `Origin` header is **present and not `BASE_URL`'s origin** are rejected `403 invalid_origin` (login-CSRF guard). Requests **without** `Origin` pass (non-browser clients).
- Error body shape everywhere: `{ "error": { "code": string, "message": string, "details"?: string[] } }`.
- Image: `node:24-bookworm-slim` runtime, runs as user `node`, `WORKDIR /app`, data at `/data` (`DATABASE_PATH=/data/tagteam.db`), migrations at `/app/drizzle` (`MIGRATIONS_DIR`), `EXPOSE 3000`, `HEALTHCHECK` on `/api/health`, `CMD ["node", "dist/index.js"]`.
- Registry: `ghcr.io/${{ github.repository }}` (currently `ghcr.io/doomedramen/tagteam`). Tags: `latest` (default branch), `sha-<short>`, semver `X.Y.Z` and `X.Y` from `vX.Y.Z` tags. Platforms `linux/amd64,linux/arm64`. Push only on non-PR events.
- The compose file publishes **no** app port to the network by default; `cloudflared` reaches the app on the internal network (`http://tagteam:3000`).
- Commits: Conventional Commits, no co-author trailers, never `--no-verify`. All work directly on `main`.

## Carry-over resolved by this plan

- Plan 2 → migrations path in bundle: `MIGRATIONS_DIR` config (Task 2).
- Plan 2 → `cf-connecting-ip` for Better Auth: **dropped** — no IP limits (Task 1).
- Plan 2 → native `better-sqlite3` in image: production install in build stage (Task 3).
- Plan 2 → per-process limiter: acceptable, single container (README notes it).
- Plan 2 → login CSRF hardening: untrusted-`Origin` guard (Task 1).
- Still open for Plan 4: clamp far-future event `at`; move `dueTime` into `RuleVersion`.

## File Structure

```
package.json                              + "packageManager": "pnpm@10.20.0"
.dockerignore                             build context exclusions
Dockerfile                                multi-stage image
.github/workflows/ci.yml                  test → image smoke → multi-arch push
README.md                                 overview, compose quick start, config, backup, development
docs/superpowers/specs/2026-09-25-tagteam-design.md   decision updates (Task 1)
apps/server/
  package.json                            + build / start:prod scripts, esbuild devDep
  build.mjs                               esbuild bundle → dist/index.js, dist/backup.js
  scripts/smoke.mjs                       HTTP smoke check for a running server
  src/config.ts                           + migrationsDir (MIGRATIONS_DIR)
  src/server.ts                           passes migrationsDir to openDb
  src/auth.ts                             rate limiter disabled; no options param
  src/app.ts                              + trustedOrigin dep, untrusted-Origin guard on /api/auth/*
  src/http/origin.ts                      rejectUntrustedOrigin middleware
  src/routes/invites.ts                   per-user limit only
  src/backup.ts                           backupDatabase(source, destination)
  src/backup-cli.ts                       `node dist/backup.js <dest>` entry
  src/test/harness.ts                     createAuth/createApp call updates
  tests: app.test.ts, routes/invites.test.ts, config.test.ts, backup.test.ts
```

---

### Task 1: Security decisions — no IP limits, login-CSRF Origin guard

**Files:**
- Modify: `apps/server/src/routes/invites.ts`, `apps/server/src/routes/invites.test.ts`, `apps/server/src/auth.ts`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `apps/server/src/test/harness.ts`, `apps/server/src/server.ts`
- Create: `apps/server/src/http/origin.ts`
- Modify: `docs/superpowers/specs/2026-09-25-tagteam-design.md`

**Interfaces:**
- Consumes: `fail` (`http/errors.ts`), `createRateLimiter`, `REDEEM_LIMITS`, harness helpers, `TEST_CONFIG`.
- Produces:
  - `http/origin.ts`: `rejectUntrustedOrigin(trustedOrigin: string)` Hono middleware.
  - `auth.ts`: `createAuth(db: Db, config: Config)` (the `options` parameter is removed).
  - `app.ts`: `interface AppDeps { db: Db; auth: Auth; trustedOrigin: string; now?: () => number }`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/routes/invites.test.ts`, **delete** the test `"rate limits redeem attempts per IP across users"` and add:
```ts
	it("ignores client IP headers when rate limiting", async () => {
		const { code } = await invite();
		for (let i = 0; i < 5; i++) {
			await redeem(jo, "nope", { "cf-connecting-ip": `203.0.113.${i}`, "x-forwarded-for": `198.51.100.${i}` });
		}
		expect((await redeem(jo, code, { "cf-connecting-ip": "203.0.113.99" })).status).toBe(429);

		const kim = await signUp(ctx.app, "kim@example.com", "Kim");
		expect((await redeem(kim, code)).status).toBe(200);
	});
```

Append to the `describe("server foundation", …)` block in `apps/server/src/app.test.ts`:
```ts
	const signUpFrom = (origin: string | null) =>
		ctx.app.request("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
			body: JSON.stringify({ email: "kim@example.com", password: "correct-horse-battery", name: "Kim" }),
		});

	it("rejects auth requests from an untrusted browser origin", async () => {
		const res = await signUpFrom("https://evil.example.com");
		expect(res.status).toBe(403);
		expect(await readJson<ErrorBody>(res)).toEqual({
			error: { code: "invalid_origin", message: "This request came from an untrusted site." },
		});
	});

	it("accepts auth requests from the app's own origin or without an Origin header", async () => {
		expect((await signUpFrom("http://localhost:3000")).status).toBe(200);
		const other = await ctx.app.request("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "lee@example.com", password: "correct-horse-battery", name: "Lee" }),
		});
		expect(other.status).toBe(200);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tagteam/server test`
Expected: exactly one FAIL — "rejects auth requests from an untrusted browser origin" (gets 200). The new IP-header test already passes (the per-user limit exists); it guards against IP keys coming back. Record which tests fail.

- [ ] **Step 3: Implement**

`apps/server/src/http/origin.ts`:
```ts
import { createMiddleware } from "hono/factory";
import { fail } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects state-changing requests sent by a browser from another site (login CSRF).
 * Requests without an Origin header pass: browsers always send one on cross-site POSTs,
 * and Better Auth itself requires it whenever cookies are present.
 */
export const rejectUntrustedOrigin = (trustedOrigin: string) =>
	createMiddleware(async (c, next) => {
		const origin = c.req.header("origin");
		if (!SAFE_METHODS.has(c.req.method) && origin !== undefined && origin !== trustedOrigin) {
			return fail(c, 403, "invalid_origin", "This request came from an untrusted site.");
		}
		await next();
	});
```

`apps/server/src/app.ts` — add `trustedOrigin` to `AppDeps` and register the guard **before** the auth handler:
```ts
export interface AppDeps {
	db: Db;
	auth: Auth;
	/** The app's public origin (Config.baseUrl). */
	trustedOrigin: string;
	now?: () => number;
}

export function createApp({ db, auth, trustedOrigin, now = Date.now }: AppDeps) {
	const app = new Hono();

	// Public routes are registered first: they respond without calling next(),
	// so the session middleware of the /api sub-app never runs for them.
	app.get("/api/health", (c) => c.json({ ok: true }));
	app.use("/api/auth/*", rejectUntrustedOrigin(trustedOrigin));
	app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
	// … rest unchanged
```

`apps/server/src/auth.ts` — remove the `options` parameter and disable Better Auth's IP-keyed limiter:
```ts
export function createAuth(db: Db, config: Config) {
	return betterAuth({
		// …existing options unchanged, except:
		// Better Auth's limiter keys on client IP; behind cloudflared every request shares one IP,
		// so it would throttle all users together. Sign-in brute force is stopped by Cloudflare Access.
		rateLimit: { enabled: false },
		// …
	});
}
```

`apps/server/src/routes/invites.ts` — delete `clientIp` and the per-IP attempt; the redeem handler starts:
```ts
	routes.post("/invites/redeem", async (c) => {
		const now = deps.now();
		if (!limiter.attempt(c.var.user.id, now)) {
			return fail(c, 429, "rate_limited", "Too many attempts. Try again in a minute.");
		}
		// …rest unchanged
```
(Remove the now-unused `Context` type import.)

`apps/server/src/test/harness.ts`:
```ts
	const auth = createAuth(db, TEST_CONFIG);
	const app = createApp({ db, auth, trustedOrigin: TEST_CONFIG.baseUrl, now: () => clock.now });
```

`apps/server/src/server.ts`:
```ts
	const app = createApp({ db, auth: createAuth(db, config), trustedOrigin: config.baseUrl });
```

- [ ] **Step 4: Update the spec**

In `docs/superpowers/specs/2026-09-25-tagteam-design.md`:
- §2 table, replace the `Joining groups` row value with: `6-digit numeric code, **single use**, generated by any member, shared manually; unused codes expire after 7 days; redeem attempts rate limited per user`
- §2 table, add a row after `Auth`: `| Abuse protection | No IP-based limits (cloudflared hides client IPs). Invite redeem limited per user (5/min, 20/h). Sign-in brute force is stopped by Cloudflare Access; auth POSTs from an untrusted Origin are rejected |`
- §4 `invite_code` bullet: replace `Join attempts rate limited (5/min, 20/h per user) + per-IP.` with `Redeem attempts rate limited per user (5/min, 20/h).`

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src docs/superpowers/specs/2026-09-25-tagteam-design.md
git commit -m "feat(server): drop IP rate limits and reject untrusted auth origins"
```

---

### Task 2: Production bundle, migrations location, backups, smoke script

**Files:**
- Modify: `package.json` (root), `apps/server/package.json`, `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/server.ts`
- Create: `apps/server/build.mjs`, `apps/server/scripts/smoke.mjs`, `apps/server/src/backup.ts`, `apps/server/src/backup-cli.ts`
- Test: `apps/server/src/backup.test.ts`, `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `openDb` (`db/client.ts`, signature `openDb(path, migrationsFolder?)`), `startServer`, `Config`.
- Produces:
  - `Config.migrationsDir?: string` (from `MIGRATIONS_DIR`); `startServer` passes it to `openDb`.
  - `backup.ts`: `backupDatabase(sourcePath: string, destinationPath: string): Promise<void>`
  - `dist/index.js` (server) and `dist/backup.js` (`node dist/backup.js <destination>`, reads `DATABASE_PATH`) via `pnpm --filter @tagteam/server build`.
  - `scripts/smoke.mjs <baseUrl>`: exits 0 after checking health 200, untrusted-origin sign-up 403, own-origin sign-up 200; exits 1 with a `smoke: …` message otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/config.test.ts`:
```ts
	it("passes MIGRATIONS_DIR through", () => {
		expect(loadConfig({ AUTH_SECRET: secret, MIGRATIONS_DIR: "/app/drizzle" }).migrationsDir).toBe("/app/drizzle");
		expect(loadConfig({ AUTH_SECRET: secret }).migrationsDir).toBeUndefined();
	});
```

`apps/server/src/backup.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { backupDatabase } from "./backup";
import { openDb } from "./db/client";

it("copies a live database, including its tables", async () => {
	const dir = mkdtempSync(join(tmpdir(), "tagteam-backup-"));
	try {
		const source = join(dir, "live.db");
		const { close } = openDb(source);
		const destination = join(dir, "copy.db");
		await backupDatabase(source, destination);
		close();

		const copy = new Database(destination, { readonly: true });
		const row = copy.prepare("select count(*) as n from sqlite_master where type = 'table' and name = 'profile'").get() as {
			n: number;
		};
		copy.close();
		expect(row.n).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @tagteam/server test -- src/config.test.ts src/backup.test.ts`
Expected: FAIL — `migrationsDir` undefined in first assertion; `./backup` cannot be resolved.

- [ ] **Step 3: Implement config, server, backup**

`apps/server/src/config.ts` — add to `Config`:
```ts
	/** Folder of drizzle SQL migrations; defaults to the source tree's drizzle/ (set in the Docker image). */
	migrationsDir?: string;
```
and in the returned object:
```ts
		migrationsDir: env.MIGRATIONS_DIR,
```

`apps/server/src/server.ts`:
```ts
	const { db, close } = openDb(config.databasePath, config.migrationsDir);
```

`apps/server/src/backup.ts`:
```ts
import Database from "better-sqlite3";

/** Consistent online copy of the SQLite database; safe while the server is running. */
export async function backupDatabase(sourcePath: string, destinationPath: string): Promise<void> {
	const db = new Database(sourcePath, { fileMustExist: true });
	try {
		await db.backup(destinationPath);
	} finally {
		db.close();
	}
}
```

`apps/server/src/backup-cli.ts`:
```ts
import { backupDatabase } from "./backup";

const destination = process.argv[2];
if (!destination) {
	console.error("Usage: node dist/backup.js <destination.db>");
	process.exit(2);
}
const source = process.env.DATABASE_PATH ?? "./data/tagteam.db";
await backupDatabase(source, destination);
console.log(`Backed up ${source} to ${destination}`);
```

- [ ] **Step 4: Bundle and smoke script**

Root `package.json`: add `"packageManager": "pnpm@10.20.0"`.

Install esbuild: `pnpm --filter @tagteam/server add -D esbuild`

`apps/server/package.json` scripts — add:
```json
    "build": "node build.mjs",
    "start:prod": "node dist/index.js",
    "smoke": "node scripts/smoke.mjs"
```

`apps/server/build.mjs`:
```js
// Bundles the server for production. better-sqlite3 is native, so it stays external
// and is installed next to the bundle (see Dockerfile).
import { build } from "esbuild";

await build({
	entryPoints: { index: "src/index.ts", backup: "src/backup-cli.ts" },
	outdir: "dist",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	sourcemap: true,
	external: ["better-sqlite3"],
	// Some bundled dependencies are CommonJS and call require().
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	logLevel: "info",
});
```

`apps/server/scripts/smoke.mjs`:
```js
// Usage: node scripts/smoke.mjs <baseUrl>
// Checks a running TagTeam server whose BASE_URL equals <baseUrl>.
const base = process.argv[2] ?? "http://localhost:3000";

const fail = (message) => {
	console.error(`smoke: ${message}`);
	process.exit(1);
};

const health = await fetch(`${base}/api/health`);
if (health.status !== 200) fail(`health returned ${health.status}`);

const email = `smoke-${Date.now()}@example.com`;
const signUp = (origin) =>
	fetch(`${base}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin },
		body: JSON.stringify({ email, password: "correct-horse-battery", name: "Smoke" }),
	});

const untrusted = await signUp("https://evil.example.com");
if (untrusted.status !== 403) fail(`untrusted origin returned ${untrusted.status}`);

const trusted = await signUp(new URL(base).origin);
if (trusted.status !== 200) fail(`sign-up returned ${trusted.status}: ${await trusted.text()}`);

console.log("smoke: ok");
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Verify the bundle runs**

```bash
cd apps/server && pnpm build
AUTH_SECRET=$(openssl rand -base64 32) BASE_URL=http://localhost:3998 PORT=3998 \
  DATABASE_PATH=/tmp/tagteam-dist/tagteam.db MIGRATIONS_DIR=./drizzle node dist/index.js &
SERVER=$!; sleep 2
node scripts/smoke.mjs http://localhost:3998
DATABASE_PATH=/tmp/tagteam-dist/tagteam.db node dist/backup.js /tmp/tagteam-dist/backup.db
kill $SERVER; rm -rf /tmp/tagteam-dist
```
Expected: `smoke: ok`, then `Backed up /tmp/tagteam-dist/tagteam.db to /tmp/tagteam-dist/backup.db`. No `Dynamic require` / `require is not defined` errors. Record output in the report. `dist/` is git-ignored.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/server
git commit -m "build(server): bundle for production with configurable migrations and backups"
```

---

### Task 3: Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: `pnpm --filter @tagteam/server build` → `apps/server/dist/{index,backup}.js`; `apps/server/drizzle/`; `MIGRATIONS_DIR`, `DATABASE_PATH`, `PORT` env; `apps/server/scripts/smoke.mjs`.
- Produces: image running `node dist/index.js` as `node`, data in `/data`, health-checked.

- [ ] **Step 1: Write `.dockerignore`**

```
**/node_modules
**/dist
.git
.github
.superpowers
docs
data
**/*.db
**/*.db-*
.env
.env.*
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
RUN pnpm --filter @tagteam/server build

# Runtime payload: bundle, migrations, and the one native dependency built for this platform.
WORKDIR /out
RUN cp -r /repo/apps/server/dist /repo/apps/server/drizzle . \
	&& node -e "const v = require('/repo/apps/server/node_modules/better-sqlite3/package.json').version; require('node:fs').writeFileSync('package.json', JSON.stringify({ private: true, type: 'module', dependencies: { 'better-sqlite3': v } }))" \
	&& npm install --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_PATH=/data/tagteam.db \
	MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Build and verify locally**

```bash
docker build -t tagteam:local .
docker run -d --name tagteam-smoke -p 127.0.0.1:3997:3000 \
  -e AUTH_SECRET="$(openssl rand -base64 32)" -e BASE_URL=http://localhost:3997 tagteam:local
for i in $(seq 30); do curl -fs http://127.0.0.1:3997/api/health && break; sleep 1; done
node apps/server/scripts/smoke.mjs http://localhost:3997
docker exec tagteam-smoke whoami
docker exec tagteam-smoke node dist/backup.js /data/backup.db
docker inspect --format '{{.State.Health.Status}}' tagteam-smoke   # after ~35s: healthy
docker image ls tagteam:local --format '{{.Size}}'
docker rm -f tagteam-smoke
```
Expected: health JSON `{"ok":true}`, `smoke: ok`, `node`, `Backed up /data/tagteam.db to /data/backup.db`, `healthy`, image size reported (record it; well under 400 MB expected). If `docker` is unavailable, report BLOCKED.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add production Docker image"
```

---

### Task 4: GitHub Actions — test, image smoke, publish to GHCR

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `typecheck`, `lint`, `test`; `Dockerfile`; `apps/server/scripts/smoke.mjs`; `packageManager` field (read by `pnpm/action-setup`).
- Produces: images at `ghcr.io/${{ github.repository }}` tagged per Global Constraints.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test

  image:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - name: Build image for smoke test
        uses: docker/build-push-action@v6
        with:
          context: .
          load: true
          tags: tagteam:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Smoke test image
        run: |
          docker run -d --name smoke -p 127.0.0.1:3000:3000 -e AUTH_SECRET="$(openssl rand -base64 32)" tagteam:ci
          for i in $(seq 30); do curl -fs http://127.0.0.1:3000/api/health && break; sleep 1; done
          node apps/server/scripts/smoke.mjs http://localhost:3000
          docker rm -f smoke

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}

      - name: Build and push multi-arch image
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Lint the workflow**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no findings. (If an action major version is reported as outdated/nonexistent, bump to the current major and note it.)

- [ ] **Step 3: Verify the arm64 image builds**

Run: `docker buildx build --platform linux/arm64 -t tagteam:arm64-check .`
Expected: build succeeds (the native module installs/compiles for arm64). Record duration. On an arm64 host this is native; on amd64 it uses QEMU and is slow — acceptable.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test, smoke-test and publish multi-arch image to GHCR"
```

---

### Task 5: README with docker-compose quick start

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: image name `ghcr.io/doomedramen/tagteam`, env vars (`AUTH_SECRET`, `BASE_URL`, `PORT`, `DATABASE_PATH`, `MIGRATIONS_DIR`, `RP_ID`, `RP_NAME`), `node dist/backup.js`, dev scripts.
- Produces: user-facing documentation.

- [ ] **Step 1: Write `README.md`**

````markdown
# TagTeam

Shared habits and chores for small groups. Everyone in a group sees each other's tasks — daily, weekly, monthly or every N days/weeks/months — with a full history of what was done on time, late, or missed. Built as an offline-first, mobile-first PWA.

> Status: server foundation (accounts, groups, invite codes). Task sync and the app UI are in progress.

## Run it with Docker Compose

TagTeam is designed to sit behind [Cloudflare Zero Trust](https://developers.cloudflare.com/cloudflare-one/) (Access + Tunnel). The app port is not published; `cloudflared` reaches it over the Compose network.

1. In Cloudflare Zero Trust, create a **Tunnel** and copy its token. Add a public hostname (e.g. `tagteam.example.com`) pointing to `http://tagteam:3000`.
2. Protect that hostname with an **Access application** listing who may use it.
3. Create a folder with these two files and run `docker compose up -d`.

`docker-compose.yml`:

```yaml
services:
  tagteam:
    image: ghcr.io/doomedramen/tagteam:latest
    restart: unless-stopped
    environment:
      AUTH_SECRET: ${AUTH_SECRET:?Set AUTH_SECRET in .env}
      BASE_URL: ${BASE_URL:?Set BASE_URL in .env}
    volumes:
      - tagteam-data:/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?Set TUNNEL_TOKEN in .env}
    depends_on:
      - tagteam

volumes:
  tagteam-data:
```

`.env`:

```bash
# openssl rand -base64 32
AUTH_SECRET=
# The public URL people open (must match the tunnel hostname)
BASE_URL=https://tagteam.example.com
TUNNEL_TOKEN=
```

### Try it locally without Cloudflare

```yaml
services:
  tagteam:
    image: ghcr.io/doomedramen/tagteam:latest
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      AUTH_SECRET: ${AUTH_SECRET:?Set AUTH_SECRET in .env}
      BASE_URL: http://localhost:3000
    volumes:
      - tagteam-data:/data

volumes:
  tagteam-data:
```

Passkeys need the browser to see the exact `BASE_URL` host, so use `http://localhost:3000`, not an IP address.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AUTH_SECRET` | yes | — | Signs sessions. At least 32 characters. |
| `BASE_URL` | yes (image) | `http://localhost:3000` | Public URL. Sets trusted origin and passkey relying party. |
| `PORT` | no | `3000` | HTTP port inside the container. |
| `DATABASE_PATH` | no | `/data/tagteam.db` | SQLite file (keep it on the volume). |
| `MIGRATIONS_DIR` | no | `/app/drizzle` | Set by the image; leave as is. |
| `RP_ID` | no | host of `BASE_URL` | Passkey relying-party id. |
| `RP_NAME` | no | `TagTeam` | Name shown in passkey prompts. |

### Security notes

- Keep the app behind Cloudflare Access. Sign-in attempts are not rate limited by IP (the tunnel hides client IPs), so Access is what keeps strangers from guessing passwords. Passkeys are recommended.
- Don't publish port 3000 to the internet.
- Rate limits and sessions are per container; run a single replica.

## Backups

The database is one SQLite file on the `tagteam-data` volume. Take a consistent copy while the app is running:

```bash
docker compose exec tagteam node dist/backup.js /data/backup-$(date +%F).db
docker compose cp tagteam:/data/backup-$(date +%F).db .
```

Restore by stopping the app, replacing `/data/tagteam.db` with the backup, and starting it again.

## Updating

```bash
docker compose pull && docker compose up -d
```

Database migrations run automatically on start.

## Development

Requires Node 24+ and pnpm 10.

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # then set AUTH_SECRET
pnpm --filter @tagteam/server dev              # http://localhost:3000
pnpm test && pnpm typecheck && pnpm lint
```

Build and run the image locally:

```bash
docker build -t tagteam:local .
```

Images are built by GitHub Actions and published to `ghcr.io/doomedramen/tagteam` on every push to `main` (`latest`, `sha-…`) and on `v*` tags (`X.Y.Z`, `X.Y`).
````

- [ ] **Step 2: Verify the compose files**

Save the two compose snippets to temp folders and validate them (no containers started):
```bash
mkdir -p /tmp/tt-compose && cd /tmp/tt-compose
# write docker-compose.yml from the README's first snippet, then:
AUTH_SECRET=x BASE_URL=https://t.example.com TUNNEL_TOKEN=x docker compose config --quiet && echo valid
```
Repeat for the local snippet with `AUTH_SECRET=x`. Expected: `valid` twice. Also confirm `docker compose config` fails with the `Set AUTH_SECRET in .env` message when `AUTH_SECRET` is unset. Then run the local snippet for real against `tagteam:local` (swap the image line temporarily in the temp copy only), `node apps/server/scripts/smoke.mjs http://localhost:3000` from the repo, and `docker compose down -v`. Remove `/tmp/tt-compose`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with docker compose quick start"
```
