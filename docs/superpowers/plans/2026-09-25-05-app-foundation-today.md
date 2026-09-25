# Plan 5 — PWA Foundation, Today and Add Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the installable, offline-first TagTeam web app with real screens: sign up / sign in (password or passkey), create or join a group, switch groups, **Today** (tap to complete, undo, overdue + missed, show upcoming) and the **Add task** sheet (once / daily / weekly / monthly / custom), all working offline and syncing through the Plan 4 API.

**Architecture:** `apps/web` is a Vite + React SPA. Screens read only from IndexedDB (Dexie live queries); every user action becomes a `Mutation` that is written to a local outbox and applied optimistically. A sync engine pushes the outbox, pulls changes since a cursor, and re-applies still-pending mutations on top (rebase). SSE pokes, `online`, visibility and a timer trigger sync. History and "what's due" are computed on the client with `deriveTask` from `@tagteam/core`. A Serwist service worker precaches the app shell; the Hono server serves the built SPA in production (one Docker image).

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind CSS 4, react-router 8, Dexie 4 + dexie-react-hooks, Better Auth client + `@better-auth/passkey/client`, Serwist 9, lucide-react, Vitest 5 + jsdom + Testing Library + fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-tagteam-design.md` (§1 product, §3 architecture, §3.3 Access expiry, §3.6 sync, §5 engine, §6 UI — especially §6.1, §6.2, §6.4, §6.8)

## Global Constraints

- Node ≥ 24, pnpm 10, ESM, TypeScript strict + `verbatimModuleSyntax`. Biome (tabs, double quotes): `rtk proxy pnpm lint` / `rtk proxy pnpm format`. Commit directly on `main`; never push.
- **Mobile first.** Design for a 375 × 812 viewport first. Tap targets ≥ 44 px. Inputs use 16 px text (no iOS zoom). Respect safe areas (`env(safe-area-inset-*)`). Light and dark themes via `prefers-color-scheme`. Motion 150–250 ms and disabled under `prefers-reduced-motion`.
- **Local-first:** screens never wait on the network; no spinners for local data. Every write goes through `engine.enqueue(mutation)`.
- **Status never colour-only:** always an icon and/or text too.
- Copy: sentence case, no "please", no exclamation marks, verbs on buttons ("Add task", "Create group").
- Today shows **only the signed-in user's own tasks in the active group** (spec §6.2). Upcoming is hidden behind "Show upcoming", remembered per device.
- Task timezone = the browser's IANA zone when created; the profile timezone is kept in sync with the browser.
- Access expiry: an `/api` response that is a redirect or not JSON means the Cloudflare Access session ended → banner "Your session expired" with a "Reconnect" button (full page reload). Outbox is kept.
- Commits: Conventional Commits, no co-author trailers, never `--no-verify`.

## Out of scope (Plan 6)

Team screen + nudges, task detail/history (calendar, stats, edit/archive), History feed, full Me screen (profile edit, passkey management, invite codes UI), swipe-to-complete.

## File Structure

```
packages/core/src/wire.ts               JSON wire types shared by server and web        (new)
packages/core/src/schedule.ts           + withScheduleVersion()
apps/server/src/...                     re-export wire types from core; use withScheduleVersion; serve SPA (WEB_DIR)
apps/web/
  package.json, tsconfig.json, tsconfig.sw.json, vite.config.ts, vitest.config.ts, index.html
  playwright.config.ts, e2e/app.spec.ts
  public/manifest.webmanifest, public/icon.svg, public/icon-maskable.svg, public/icons/*.png
  scripts/icons.mjs, scripts/check-build.mjs
  src/main.tsx, src/sw.ts, src/index.css
  src/lib/cx.ts, src/lib/api.ts, src/lib/auth.ts, src/lib/time.ts, src/lib/storage.ts
  src/store/db.ts, src/store/apply.ts
  src/sync/engine.ts, src/sync/http-api.ts, src/sync/live.ts, src/sync/triggers.ts, src/sync/use-sync-status.ts
  src/ui/Button.tsx, TextField.tsx, Sheet.tsx, Toast.tsx, Banner.tsx, Avatar.tsx, Chip.tsx, Spinner.tsx
  src/app/AppShell.tsx, src/app/SyncChip.tsx, src/app/router.tsx, src/app/App.tsx
  src/session/session.ts, src/session/boot.ts, src/session/SessionGate.tsx
  src/features/auth/SignInScreen.tsx, SignUpScreen.tsx, AddPasskeyScreen.tsx
  src/features/groups/WelcomeScreen.tsx, GroupSwitcher.tsx
  src/features/today/model.ts, labels.ts, TodayList.tsx, TodayScreen.tsx
  src/features/add-task/draft.ts, AddTaskSheet.tsx
  src/features/me/MeScreen.tsx, src/features/placeholder/ComingSoon.tsx
  src/test/setup.ts, src/test/fakes.tsx
Dockerfile, .github/workflows/ci.yml, apps/server/scripts/smoke.mjs, README.md, .claude/launch.json
```

---

### Task 1: Web app scaffold, design tokens, manifest and icons

**Files:**
- Modify: root `package.json` (`pnpm.onlyBuiltDependencies` + `"sharp"`), `biome.json` (Tailwind directives if needed)
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/index.css`, `src/app/App.tsx`, `src/test/setup.ts`, `src/lib/cx.ts`, `public/manifest.webmanifest`, `public/icon.svg`, `public/icon-maskable.svg`, `scripts/icons.mjs`, `public/icons/*.png` (generated)
- Test: `apps/web/src/app/App.test.tsx`

**Interfaces:**
- Produces: `@tagteam/web` package with scripts `dev`, `build`, `preview`, `test`, `typecheck`, `icons`; Tailwind colour utilities `bg-bg`, `bg-surface`, `bg-surface-2`, `ring-line`/`border-line`, `text-text`, `text-text-2`, `text-text-3`, `bg-accent`/`text-accent`, `text-on-accent`, `bg-accent-soft`, `success`/`warning`/`danger` (+ `-soft`) variants; avatar classes `avatar-<colour>`; keyframes `sheet-up`, `fade-in`, `toast-in`; `cx(...classes)` helper.

- [ ] **Step 1: Create the package**

`apps/web/package.json`:
```json
{
  "name": "@tagteam/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p .",
    "icons": "node scripts/icons.mjs"
  }
}
```

Install:
```bash
pnpm --filter @tagteam/web add react react-dom react-router dexie dexie-react-hooks better-auth @better-auth/passkey @serwist/window lucide-react @tagteam/core@workspace:*
pnpm --filter @tagteam/web add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite @serwist/vite serwist vitest jsdom fake-indexeddb @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test sharp
```
Add `"sharp"` to root `package.json` `pnpm.onlyBuiltDependencies` (keep `"better-sqlite3"`), then `pnpm install`.

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"],
  "exclude": ["src/sw.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		// The API server (apps/server) runs on 3000 in development.
		proxy: { "/api": { target: "http://localhost:3000" } },
	},
});
```

`apps/web/vitest.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
```

`apps/web/src/test/setup.ts`:
```ts
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
		<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)" />
		<meta name="theme-color" content="#141413" media="(prefers-color-scheme: dark)" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-status-bar-style" content="default" />
		<meta name="apple-mobile-web-app-title" content="TagTeam" />
		<link rel="manifest" href="/manifest.webmanifest" />
		<link rel="icon" href="/icon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
		<title>TagTeam</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="/src/main.tsx"></script>
	</body>
</html>
```

- [ ] **Step 2: Design tokens**

`apps/web/src/index.css`:
```css
@import "tailwindcss";

:root {
	color-scheme: light dark;
	--bg: #f7f7f5;
	--surface: #ffffff;
	--surface-2: #efefec;
	--line: rgb(0 0 0 / 0.08);
	--text: #1c1c1a;
	--text-2: #5f5e5a;
	--text-3: #8a8983;
	--accent: #2563eb;
	--on-accent: #ffffff;
	--accent-soft: #e6effd;
	--success: #2f8a3e;
	--success-soft: #e6f3e8;
	--warning: #a1620b;
	--warning-soft: #fbf0dc;
	--danger: #c93131;
	--danger-soft: #fbe9e9;
	--av-blue: #dbe8fd; --av-blue-fg: #1d4ed8;
	--av-green: #dcf0df; --av-green-fg: #2f6f38;
	--av-amber: #fbecd2; --av-amber-fg: #8a5207;
	--av-coral: #fbe2d9; --av-coral-fg: #a33c1c;
	--av-purple: #e8e5fb; --av-purple-fg: #4c3fb0;
	--av-teal: #d7f1ea; --av-teal-fg: #0f6655;
	--av-pink: #fae1ea; --av-pink-fg: #97304f;
	--av-gray: #ebeae6; --av-gray-fg: #4f4e4a;
}

@media (prefers-color-scheme: dark) {
	:root {
		--bg: #141413;
		--surface: #1d1d1b;
		--surface-2: #272725;
		--line: rgb(255 255 255 / 0.09);
		--text: #f1f0ec;
		--text-2: #b4b2a9;
		--text-3: #85847d;
		--accent: #6b9af2;
		--on-accent: #0b1220;
		--accent-soft: #1c2a45;
		--success: #5fbf6c;
		--success-soft: #1b2e1e;
		--warning: #e2a54a;
		--warning-soft: #33280f;
		--danger: #ef6b6b;
		--danger-soft: #3a1c1c;
		--av-blue: #1c2a45; --av-blue-fg: #9dbcf6;
		--av-green: #1b2e1e; --av-green-fg: #93d49c;
		--av-amber: #33280f; --av-amber-fg: #efc27c;
		--av-coral: #3a2119; --av-coral-fg: #f2a78d;
		--av-purple: #262245; --av-purple-fg: #b7aef2;
		--av-teal: #13302a; --av-teal-fg: #7fd3bd;
		--av-pink: #3a1d27; --av-pink-fg: #f0a3bc;
		--av-gray: #2a2a28; --av-gray-fg: #c9c7bf;
	}
}

@theme inline {
	--color-bg: var(--bg);
	--color-surface: var(--surface);
	--color-surface-2: var(--surface-2);
	--color-line: var(--line);
	--color-text: var(--text);
	--color-text-2: var(--text-2);
	--color-text-3: var(--text-3);
	--color-accent: var(--accent);
	--color-on-accent: var(--on-accent);
	--color-accent-soft: var(--accent-soft);
	--color-success: var(--success);
	--color-success-soft: var(--success-soft);
	--color-warning: var(--warning);
	--color-warning-soft: var(--warning-soft);
	--color-danger: var(--danger);
	--color-danger-soft: var(--danger-soft);
	--font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

@keyframes sheet-up {
	from { transform: translateY(100%); }
}
@keyframes fade-in {
	from { opacity: 0; }
}
@keyframes toast-in {
	from { opacity: 0; transform: translateY(8px); }
}

.avatar-blue { background: var(--av-blue); color: var(--av-blue-fg); }
.avatar-green { background: var(--av-green); color: var(--av-green-fg); }
.avatar-amber { background: var(--av-amber); color: var(--av-amber-fg); }
.avatar-coral { background: var(--av-coral); color: var(--av-coral-fg); }
.avatar-purple { background: var(--av-purple); color: var(--av-purple-fg); }
.avatar-teal { background: var(--av-teal); color: var(--av-teal-fg); }
.avatar-pink { background: var(--av-pink); color: var(--av-pink-fg); }
.avatar-gray { background: var(--av-gray); color: var(--av-gray-fg); }

html,
body,
#root {
	min-height: 100%;
}

body {
	@apply bg-bg font-sans text-text antialiased;
	-webkit-tap-highlight-color: transparent;
	overscroll-behavior-y: none;
}

@media (prefers-reduced-motion: reduce) {
	*,
	*::before,
	*::after {
		animation-duration: 0.01ms !important;
		transition-duration: 0.01ms !important;
	}
}
```
If Biome fails to parse `@theme`/`@apply`, add to `biome.json`: `"css": { "parser": { "tailwindDirectives": true } }`.

`apps/web/src/lib/cx.ts`:
```ts
/** Joins truthy class names. */
export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(" ");
```

- [ ] **Step 3: Write the failing test**

`apps/web/src/app/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the app name", () => {
	render(<App />);
	expect(screen.getByText("TagTeam")).toBeInTheDocument();
});
```

Run: `pnpm --filter @tagteam/web test`
Expected: FAIL — `./App` missing.

- [ ] **Step 4: Minimal app**

`apps/web/src/app/App.tsx` (replaced by the router in Task 8):
```tsx
export function App() {
	return <p className="p-4 text-lg font-semibold">TagTeam</p>;
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
```

- [ ] **Step 5: Manifest and icons**

`apps/web/public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#2563eb"/>
  <path d="M136 268l64 64 128-144" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M248 332l28 28 104-116" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`apps/web/public/icon-maskable.svg` (full-bleed background, artwork inside the 80 % safe zone):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#2563eb"/>
  <g transform="translate(51.2 51.2) scale(0.8)">
    <path d="M136 268l64 64 128-144" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M248 332l28 28 104-116" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
```

`apps/web/scripts/icons.mjs`:
```js
// Renders PNG app icons from the SVG sources. Run after changing public/icon*.svg: pnpm --filter @tagteam/web icons
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });
const render = (svg, size, name) =>
	sharp(new URL(`../public/${svg}`, import.meta.url).pathname)
		.resize(size, size)
		.png()
		.toFile(new URL(name, out).pathname);

await render("icon.svg", 192, "icon-192.png");
await render("icon.svg", 512, "icon-512.png");
await render("icon-maskable.svg", 512, "icon-maskable-512.png");
await render("icon-maskable.svg", 180, "apple-touch-icon.png");
console.log("icons written");
```
Run: `pnpm --filter @tagteam/web icons` → four PNGs in `public/icons/` (commit them).

`apps/web/public/manifest.webmanifest`:
```json
{
  "name": "TagTeam",
  "short_name": "TagTeam",
  "description": "Shared habits and chores for small groups.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f7f7f5",
  "theme_color": "#f7f7f5",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 6: Verify**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint && pnpm --filter @tagteam/web build`
Expected: all PASS; `apps/web/dist/manifest.webmanifest` and `dist/icons/*.png` exist.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml biome.json apps/web
git commit -m "feat(web): scaffold the PWA with design tokens and app icons"
```

---

### Task 2: Shared wire types and schedule-edit helper in core

**Files:**
- Create: `packages/core/src/wire.ts`
- Modify: `packages/core/src/schedule.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`, `packages/core/src/schedule.test.ts`
- Modify (type re-exports only): `apps/server/src/services/sync-pull.ts`, `apps/server/src/services/sync-push.ts`, `apps/server/src/routes/me.ts`, `apps/server/src/services/groups.ts`, `apps/server/src/services/profiles.ts`, `apps/server/src/http/session.ts`, `apps/server/src/http/errors.ts`

**Interfaces:**
- Produces (from `@tagteam/core`): `GroupDto`, `MemberDto`, `TaskDto`, `EventDto`, `PullResponse`, `MutationResult`, `PushResponse`, `ProfileDto`, `MyGroup`, `SessionUser`, `MeResponse`, `ErrorBody`, `InviteDto`; `withScheduleVersion(startDate: LocalDate, rules: RuleVersion[], version: RuleVersion): RuleVersion[]`.
- The server keeps exporting the same names from the same modules (now `export type { X } from "@tagteam/core"`), so no server import changes elsewhere.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/schedule.test.ts` (import `withScheduleVersion`):
```ts
describe("withScheduleVersion", () => {
	const daily = { effectiveFrom: "2026-09-21", rule: { freq: "day", interval: 1 }, dueTime: "08:00" } as const;
	const weekly = { effectiveFrom: "2026-10-05", rule: { freq: "week", interval: 1, weekdays: [1] }, dueTime: null } as const;

	it("replaces everything when the edit starts on the start date", () => {
		const once = { effectiveFrom: "2026-09-21", rule: null, dueTime: null };
		expect(withScheduleVersion("2026-09-21", [daily, weekly], once)).toEqual([once]);
	});

	it("keeps earlier versions and drops later ones", () => {
		const edit = { effectiveFrom: "2026-10-01", rule: { freq: "day", interval: 2 }, dueTime: "20:00" } as const;
		expect(withScheduleVersion("2026-09-21", [daily, weekly], edit)).toEqual([daily, edit]);
	});
});
```
Add `"withScheduleVersion"` to the list in `packages/core/src/index.test.ts`.

Run: `pnpm --filter @tagteam/core test` → FAIL (not exported).

- [ ] **Step 2: Implement**

Append to `packages/core/src/schedule.ts`:
```ts
/**
 * Rule versions after a schedule edit effective from `version.effectiveFrom`:
 * earlier versions are kept, the edit replaces everything from its date onward.
 */
export function withScheduleVersion(startDate: LocalDate, rules: RuleVersion[], version: RuleVersion): RuleVersion[] {
	if (version.effectiveFrom === startDate) return [version];
	return [...rules.filter((v) => v.effectiveFrom < version.effectiveFrom), version];
}
```

`packages/core/src/wire.ts`:
```ts
import type { RuleVersion } from "./rule";

/** JSON shapes exchanged between apps/server and apps/web. */

export interface ErrorBody {
	error: { code: string; message: string; details?: string[] };
}

export interface SessionUser {
	id: string;
	email: string;
	name: string;
}

export interface ProfileDto {
	displayName: string;
	avatarColor: string;
	timezone: string;
	activeGroupId: string | null;
}

export interface MyGroup {
	id: string;
	name: string;
	role: "admin" | "member";
	joinedAt: number;
}

export interface MeResponse {
	user: SessionUser;
	profile: ProfileDto;
	groups: MyGroup[];
}

export interface InviteDto {
	code: string;
	createdAt: number;
	expiresAt: number;
}

export interface GroupDto {
	id: string;
	name: string;
}

export interface MemberDto {
	groupId: string;
	userId: string;
	displayName: string;
	avatarColor: string;
	role: "admin" | "member";
	joinedAt: number;
	leftAt: number | null;
}

export interface TaskDto {
	id: string;
	groupId: string;
	ownerId: string;
	title: string;
	notes: string | null;
	timezone: string;
	startDate: string;
	rules: RuleVersion[];
	archivedAt: number | null;
	createdAt: number;
}

export interface EventDto {
	id: string;
	taskId: string;
	userId: string;
	type: "completed" | "uncompleted" | "nudged";
	occurrenceKey: string | null;
	refEventId: string | null;
	at: number;
}

export interface PullResponse {
	cursor: number;
	groups: GroupDto[];
	members: MemberDto[];
	tasks: TaskDto[];
	events: EventDto[];
	removedGroupIds: string[];
}

export interface MutationResult {
	id: string;
	status: "applied" | "duplicate" | "rejected";
	reason?: string;
}

export interface PushResponse {
	results: MutationResult[];
}
```
Add `export * from "./wire";` to `packages/core/src/index.ts`.

- [ ] **Step 3: Server uses the shared types**

In each server module below, delete the local interface and re-export the core type under the same name (keep all other code):
- `services/sync-pull.ts`: `GroupDto`, `MemberDto`, `TaskDto`, `EventDto`, `PullResponse` → `import type { EventDto, GroupDto, MemberDto, PullResponse, TaskDto } from "@tagteam/core"; export type { EventDto, GroupDto, MemberDto, PullResponse, TaskDto };`
- `services/sync-push.ts`: `MutationResult`; and replace the inline schedule splice with `withScheduleVersion(current.startDate, current.rules, version)`.
- `routes/me.ts`: `MeResponse`. `services/groups.ts`: `MyGroup`. `services/profiles.ts`: `ProfileDto`. `http/session.ts`: `SessionUser`. `http/errors.ts`: `ErrorBody`.

If a core type is stricter or looser than the server's inferred row type (e.g. `role` literal union), keep the core type and fix the server side with a typed mapping — never with `as any`.

- [ ] **Step 4: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (server behaviour unchanged).

```bash
git add packages/core apps/server/src
git commit -m "feat(core): share wire types and the schedule-edit rule with the web app"
```

---

### Task 3: Local store — Dexie mirror, optimistic apply, rebase

**Files:**
- Create: `apps/web/src/store/db.ts`, `apps/web/src/store/apply.ts`
- Test: `apps/web/src/store/apply.test.ts`

**Interfaces:**
- Consumes: wire types, `Mutation`, `withScheduleVersion` (`@tagteam/core`).
- Produces:
  - `db.ts`: `class TagTeamDb extends Dexie` with tables `groups: EntityTable<GroupDto,"id">`, `members: Table<MemberDto,[string,string]>` (key `[groupId+userId]`, index `groupId`), `tasks: EntityTable<TaskDto,"id">` (index `groupId`), `events: EntityTable<EventDto,"id">` (index `taskId`), `outbox: EntityTable<OutboxRow,"seq">` (`++seq`), `meta: EntityTable<MetaRow,"key">`; `interface OutboxRow { seq?: number; mutation: Mutation }`; `type MetaKey = "cursor" | "me" | "activeGroupId" | "pendingActiveGroupId"`; `getMeta<T>(db, key)`, `setMeta(db, key, value)`, `clearStore(db)`; `const db = new TagTeamDb()` (default instance, name `"tagteam"`).
  - `apply.ts`: `interface LocalUser { userId: string }`, `applyLocal(db, m: Mutation, me: LocalUser): Promise<void>`, `applyPull(db, pull: PullResponse, me: LocalUser, options?: { reset?: boolean }): Promise<void>`.

Rules: `applyLocal` mirrors the server (Plan 4 Task 4) for the caller's own mutations, without authorization or clocks: create puts a task (`ownerId` = me, `rules = [{ effectiveFrom: startDate, rule, dueTime }]`, `archivedAt: null`, `createdAt: at`); update sets present fields (title trimmed); schedule uses `withScheduleVersion`; archive sets `archivedAt = archived ? at : null`; complete/uncomplete/nudge put an `EventDto` with `id = m.id`, `userId` = me. Missing task → no-op. `applyPull` (one transaction): if `reset`, clear groups/members/tasks/events; delete everything of `removedGroupIds` (group, its members, its tasks and their events); `bulkPut` groups, members, tasks, events; re-apply every outbox row in `seq` order with `applyLocal`; store `cursor`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/store/apply.test.ts`:
```ts
import type { Mutation, PullResponse, TaskDto } from "@tagteam/core";
import { beforeEach, describe, expect, it } from "vitest";
import { applyLocal, applyPull } from "./apply";
import { getMeta, TagTeamDb } from "./db";

const me = { userId: "u1" };
const groupId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const at = Date.UTC(2026, 8, 21, 7);
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const serverTask = (title: string): TaskDto => ({
	id: taskId,
	groupId,
	ownerId: "u1",
	title,
	notes: null,
	timezone: "Europe/London",
	startDate: "2026-09-21",
	rules: [{ effectiveFrom: "2026-09-21", rule: { freq: "day", interval: 1 }, dueTime: "08:00" }],
	archivedAt: null,
	createdAt: at,
});
const pull = (patch: Partial<PullResponse>): PullResponse => ({
	cursor: 1,
	groups: [],
	members: [],
	tasks: [],
	events: [],
	removedGroupIds: [],
	...patch,
});

let db: TagTeamDb;
beforeEach(() => {
	db = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

describe("applyLocal", () => {
	it("creates, edits, reschedules and archives a task", async () => {
		await applyLocal(db, { id: id(), at, type: "task.create", taskId, groupId, title: " Floss ", notes: null, timezone: "Europe/London", startDate: "2026-09-21", dueTime: null, rule: null }, me);
		await applyLocal(db, { id: id(), at, type: "task.update", taskId, notes: "gently" }, me);
		await applyLocal(db, { id: id(), at, type: "task.schedule", taskId, effectiveFrom: "2026-09-21", dueTime: "21:00", rule: { freq: "day", interval: 1 } }, me);
		await applyLocal(db, { id: id(), at: at + 5, type: "task.archive", taskId, archived: true }, me);
		expect(await db.tasks.get(taskId)).toMatchObject({
			title: "Floss",
			notes: "gently",
			ownerId: "u1",
			rules: [{ effectiveFrom: "2026-09-21", rule: { freq: "day", interval: 1 }, dueTime: "21:00" }],
			archivedAt: at + 5,
		});
	});

	it("records completions, undos and nudges as events", async () => {
		await db.tasks.put(serverTask("Brush teeth"));
		const done = id();
		await applyLocal(db, { id: done, at, type: "task.complete", taskId, occurrenceKey: "2026-09-21" }, me);
		await applyLocal(db, { id: id(), at, type: "task.uncomplete", taskId, refEventId: done }, me);
		const events = await db.events.where("taskId").equals(taskId).toArray();
		expect(events.map((e) => [e.type, e.occurrenceKey, e.refEventId, e.userId])).toEqual([
			["completed", "2026-09-21", null, "u1"],
			["uncompleted", null, done, "u1"],
		]);
	});

	it("ignores changes to tasks it does not have", async () => {
		await applyLocal(db, { id: id(), at, type: "task.update", taskId, title: "x" }, me);
		expect(await db.tasks.count()).toBe(0);
	});
});

describe("applyPull", () => {
	it("mirrors server rows and stores the cursor", async () => {
		await applyPull(db, pull({ cursor: 7, groups: [{ id: groupId, name: "Smiths" }], tasks: [serverTask("Brush teeth")] }), me);
		expect(await db.groups.toArray()).toEqual([{ id: groupId, name: "Smiths" }]);
		expect((await db.tasks.get(taskId))?.title).toBe("Brush teeth");
		expect(await getMeta<number>(db, "cursor")).toBe(7);
	});

	it("re-applies pending local changes on top of older server data", async () => {
		await db.tasks.put(serverTask("Brush teeth"));
		const rename: Mutation = { id: id(), at, type: "task.update", taskId, title: "Brush teeth (2 min)" };
		await db.outbox.add({ mutation: rename });
		await applyPull(db, pull({ tasks: [serverTask("Brush teeth")] }), me);
		expect((await db.tasks.get(taskId))?.title).toBe("Brush teeth (2 min)");
	});

	it("drops everything of groups the user left", async () => {
		await applyPull(db, pull({ groups: [{ id: groupId, name: "Smiths" }], tasks: [serverTask("Brush teeth")], events: [{ id: id(), taskId, userId: "u1", type: "completed", occurrenceKey: "2026-09-21", refEventId: null, at }] }), me);
		await applyPull(db, pull({ removedGroupIds: [groupId] }), me);
		expect([await db.groups.count(), await db.tasks.count(), await db.events.count()]).toEqual([0, 0, 0]);
	});

	it("rebuilds from scratch on reset", async () => {
		await db.tasks.put({ ...serverTask("Local only"), id: "33333333-3333-4333-8333-333333333333" });
		await applyPull(db, pull({ tasks: [serverTask("Brush teeth")] }), me, { reset: true });
		expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(["Brush teeth"]);
	});
});
```

Run: `pnpm --filter @tagteam/web test -- src/store/apply.test.ts` → FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/web/src/store/db.ts`:
```ts
import type { EventDto, GroupDto, MemberDto, Mutation, TaskDto } from "@tagteam/core";
import Dexie, { type EntityTable, type Table } from "dexie";

export interface OutboxRow {
	seq?: number;
	mutation: Mutation;
}

export type MetaKey = "cursor" | "me" | "activeGroupId" | "pendingActiveGroupId";

export interface MetaRow {
	key: MetaKey;
	value: unknown;
}

/** Local mirror of the server data the user can see, plus the outbox of unsent changes. */
export class TagTeamDb extends Dexie {
	groups!: EntityTable<GroupDto, "id">;
	members!: Table<MemberDto, [string, string]>;
	tasks!: EntityTable<TaskDto, "id">;
	events!: EntityTable<EventDto, "id">;
	outbox!: EntityTable<OutboxRow, "seq">;
	meta!: EntityTable<MetaRow, "key">;

	constructor(name = "tagteam") {
		super(name);
		this.version(1).stores({
			groups: "id",
			members: "[groupId+userId], groupId",
			tasks: "id, groupId",
			events: "id, taskId",
			outbox: "++seq",
			meta: "key",
		});
	}
}

export const db = new TagTeamDb();

export async function getMeta<T>(store: TagTeamDb, key: MetaKey): Promise<T | undefined> {
	return (await store.meta.get(key))?.value as T | undefined;
}

export async function setMeta(store: TagTeamDb, key: MetaKey, value: unknown): Promise<void> {
	await store.meta.put({ key, value });
}

/** Removes all local data (sign-out or a different user signing in). */
export async function clearStore(store: TagTeamDb): Promise<void> {
	await store.transaction("rw", store.tables, async () => {
		for (const table of store.tables) await table.clear();
	});
}
```

`apps/web/src/store/apply.ts`:
```ts
import { type EventDto, type Mutation, type PullResponse, withScheduleVersion } from "@tagteam/core";
import { setMeta, type TagTeamDb } from "./db";

export interface LocalUser {
	userId: string;
}

/** Applies one of the user's own mutations to the local mirror (optimistic update). */
export async function applyLocal(store: TagTeamDb, m: Mutation, me: LocalUser): Promise<void> {
	const event = (fields: Pick<EventDto, "type" | "occurrenceKey" | "refEventId">) =>
		store.events.put({ id: m.id, taskId: m.taskId, userId: me.userId, at: m.at, ...fields });

	switch (m.type) {
		case "task.create":
			await store.tasks.put({
				id: m.taskId,
				groupId: m.groupId,
				ownerId: me.userId,
				title: m.title.trim(),
				notes: m.notes,
				timezone: m.timezone,
				startDate: m.startDate,
				rules: [{ effectiveFrom: m.startDate, rule: m.rule, dueTime: m.dueTime }],
				archivedAt: null,
				createdAt: m.at,
			});
			return;
		case "task.update": {
			const changes: { title?: string; notes?: string | null } = {};
			if (m.title !== undefined) changes.title = m.title.trim();
			if (m.notes !== undefined) changes.notes = m.notes;
			await store.tasks.update(m.taskId, changes);
			return;
		}
		case "task.schedule": {
			const task = await store.tasks.get(m.taskId);
			if (!task) return;
			const rules = withScheduleVersion(task.startDate, task.rules, {
				effectiveFrom: m.effectiveFrom,
				rule: m.rule,
				dueTime: m.dueTime,
			});
			await store.tasks.update(m.taskId, { rules });
			return;
		}
		case "task.archive":
			await store.tasks.update(m.taskId, { archivedAt: m.archived ? m.at : null });
			return;
		case "task.complete":
			if (await store.tasks.get(m.taskId)) await event({ type: "completed", occurrenceKey: m.occurrenceKey, refEventId: null });
			return;
		case "task.uncomplete":
			if (await store.tasks.get(m.taskId)) await event({ type: "uncompleted", occurrenceKey: null, refEventId: m.refEventId });
			return;
		case "task.nudge":
			if (await store.tasks.get(m.taskId)) await event({ type: "nudged", occurrenceKey: null, refEventId: null });
			return;
	}
}

async function removeGroup(store: TagTeamDb, groupId: string): Promise<void> {
	const taskIds = await store.tasks.where("groupId").equals(groupId).primaryKeys();
	await store.events.where("taskId").anyOf(taskIds).delete();
	await store.tasks.bulkDelete(taskIds);
	await store.members.where("groupId").equals(groupId).delete();
	await store.groups.delete(groupId);
}

/** Writes a pull response into the mirror, then re-applies still-pending local mutations on top. */
export async function applyPull(
	store: TagTeamDb,
	pull: PullResponse,
	me: LocalUser,
	options: { reset?: boolean } = {},
): Promise<void> {
	await store.transaction("rw", [store.groups, store.members, store.tasks, store.events, store.outbox, store.meta], async () => {
		if (options.reset) {
			await Promise.all([store.groups.clear(), store.members.clear(), store.tasks.clear(), store.events.clear()]);
		}
		for (const groupId of pull.removedGroupIds) await removeGroup(store, groupId);
		await store.groups.bulkPut(pull.groups);
		await store.members.bulkPut(pull.members);
		await store.tasks.bulkPut(pull.tasks);
		await store.events.bulkPut(pull.events);
		const pending = await store.outbox.orderBy("seq").toArray();
		for (const row of pending) await applyLocal(store, row.mutation, me);
		await setMeta(store, "cursor", pull.cursor);
	});
}
```

- [ ] **Step 3: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src/store
git commit -m "feat(web): add the local store with optimistic apply and rebase"
```

---

### Task 4: API client, auth client and sync engine

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/sync/engine.ts`, `apps/web/src/sync/http-api.ts`, `apps/web/src/sync/live.ts`, `apps/web/src/sync/triggers.ts`, `apps/web/src/sync/use-sync-status.ts`
- Test: `apps/web/src/lib/api.test.ts`, `apps/web/src/sync/engine.test.ts`, `apps/web/src/sync/triggers.test.ts`

**Interfaces:**
- Consumes: store (Task 3); `MAX_BATCH`, wire types (`@tagteam/core`).
- Produces:
  - `api.ts`: `class ApiError extends Error { status; code; details? }`, `class AccessExpiredError`, `class OfflineError`, `apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>` — `credentials: "same-origin"`, `redirect: "manual"`; network failure → `OfflineError`; any redirect / opaque redirect / non-JSON (other than 204) → `AccessExpiredError`; non-2xx JSON → `ApiError`.
  - `auth.ts`: `authClient` (`createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth", plugins: [passkeyClient()] })`).
  - `engine.ts`: `type SyncState = "idle" | "syncing" | "offline" | "reauth" | "signedOut" | "error"`, `interface SyncStatus { state; pending: number; lastSyncedAt: number | null }`, `interface SyncApi { push(m: Mutation[]): Promise<MutationResult[]>; pull(cursor: number): Promise<PullResponse> }`, `interface SyncEngine { enqueue(m: Mutation): Promise<void>; sync(): Promise<void>; getStatus(): SyncStatus; subscribe(fn: (s: SyncStatus) => void): () => void; dispose(): void }`, `createSyncEngine(opts: { store: TagTeamDb; api: SyncApi; me: LocalUser; debounceMs?: number; now?: () => number }): SyncEngine`.
  - `http-api.ts`: `httpSyncApi: SyncApi`.
  - `live.ts`: `connectLive(onPoke: () => void, EventSourceImpl?: typeof EventSource): () => void` (listens to `ready` and `poke`).
  - `triggers.ts`: `startSyncTriggers(engine: Pick<SyncEngine, "sync">, opts?: { connect?: (onPoke: () => void) => () => void; intervalMs?: number }): () => void` — syncs on `online`, on becoming visible, every `intervalMs` (default 60 000) while visible, and on live pokes.
  - `use-sync-status.ts`: `useSyncStatus(engine): SyncStatus` (via `useSyncExternalStore`).

Engine semantics: `enqueue` adds to the outbox and applies locally in one transaction, updates `pending`, and schedules `sync()` after `debounceMs` (default 400). `sync()` is single-flight (a call while running schedules one more run). A run: push the outbox in batches of `MAX_BATCH`, deleting each pushed row whatever its status; if any result is `rejected`, pull from cursor 0 with `reset: true`, otherwise from the stored cursor; then `idle` with `lastSyncedAt`. Errors map to `offline` (`OfflineError`), `reauth` (`AccessExpiredError`), `signedOut` (`ApiError` 401), else `error`; the outbox is kept.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessExpiredError, ApiError, apiFetch, OfflineError } from "./api";

const respond = (body: BodyInit | null, init: ResponseInit & { type?: ResponseType } = {}) => {
	const res = new Response(body, init);
	if (init.type) Object.defineProperty(res, "type", { value: init.type });
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
};
const json = { "content-type": "application/json" };

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
	it("returns parsed JSON and sends JSON bodies", async () => {
		respond(JSON.stringify({ ok: true }), { headers: json });
		expect(await apiFetch("/api/x", { method: "POST", body: { a: 1 } })).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledWith("/api/x", expect.objectContaining({ method: "POST", body: '{"a":1}', redirect: "manual", credentials: "same-origin" }));
	});

	it("throws ApiError with the server's code and details", async () => {
		respond(JSON.stringify({ error: { code: "invalid_request", message: "Bad", details: ["x"] } }), { status: 400, headers: json });
		await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 400, code: "invalid_request", message: "Bad", details: ["x"] });
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(ApiError);
	});

	it("treats redirects and HTML as an expired Access session", async () => {
		respond(null, { status: 0 as never, type: "opaqueredirect" });
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(AccessExpiredError);
		respond("<html>login</html>", { headers: { "content-type": "text/html" } });
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(AccessExpiredError);
	});

	it("treats network failures as offline", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(OfflineError);
	});

	it("returns undefined for 204", async () => {
		respond(null, { status: 204 });
		expect(await apiFetch("/api/x")).toBeUndefined();
	});
});
```
(If constructing a `Response` with status 0 throws in this runtime, build the opaque-redirect stub as a plain object `{ type: "opaqueredirect", status: 0, headers: new Headers(), ok: false }` cast to `Response`.)

`apps/web/src/sync/engine.test.ts`:
```ts
import type { Mutation, MutationResult, PullResponse } from "@tagteam/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessExpiredError, OfflineError } from "../lib/api";
import { getMeta, TagTeamDb } from "../store/db";
import { createSyncEngine, type SyncApi } from "./engine";

const groupId = "11111111-1111-4111-8111-111111111111";
const me = { userId: "u1" };
const emptyPull = (cursor: number): PullResponse => ({ cursor, groups: [], members: [], tasks: [], events: [], removedGroupIds: [] });
const create = (taskId = crypto.randomUUID()): Mutation => ({
	id: crypto.randomUUID(),
	at: Date.now(),
	type: "task.create",
	taskId,
	groupId,
	title: "Bins",
	notes: null,
	timezone: "UTC",
	startDate: "2026-09-21",
	dueTime: null,
	rule: null,
});

function fakeApi(results: (m: Mutation[]) => MutationResult[] = (ms) => ms.map((m) => ({ id: m.id, status: "applied" }))) {
	const api = {
		push: vi.fn(async (ms: Mutation[]) => results(ms)),
		pull: vi.fn(async (cursor: number) => emptyPull(cursor + 1)),
	} satisfies SyncApi;
	return api;
}

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

describe("sync engine", () => {
	it("applies locally at once, then pushes, empties the outbox and pulls", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		const m = create();
		await engine.enqueue(m);
		expect(await store.tasks.count()).toBe(1);
		expect(engine.getStatus().pending).toBe(1);

		await engine.sync();
		expect(api.push).toHaveBeenCalledWith([m]);
		expect(api.pull).toHaveBeenCalledWith(0);
		expect(await store.outbox.count()).toBe(0);
		expect(await getMeta(store, "cursor")).toBe(1);
		expect(engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
		engine.dispose();
	});

	it("syncs automatically after the debounce", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 5 });
		await engine.enqueue(create());
		await vi.waitFor(() => expect(api.pull).toHaveBeenCalled());
		engine.dispose();
	});

	it("rebuilds from scratch after a rejection", async () => {
		const api = fakeApi((ms) => ms.map((m) => ({ id: m.id, status: "rejected", reason: "not a member of this group" })));
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await engine.enqueue(create());
		await engine.sync();
		expect(api.pull).toHaveBeenCalledWith(0);
		expect(await store.tasks.count()).toBe(0);
		engine.dispose();
	});

	it("pushes large outboxes in batches of 100", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		for (let i = 0; i < 150; i++) await engine.enqueue(create());
		await engine.sync();
		expect(api.push.mock.calls.map((c) => c[0].length)).toEqual([100, 50]);
		engine.dispose();
	});

	it("keeps the outbox and reports offline or expired sessions", async () => {
		const api = fakeApi();
		api.push.mockRejectedValueOnce(new OfflineError());
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await engine.enqueue(create());
		await engine.sync();
		expect(engine.getStatus()).toMatchObject({ state: "offline", pending: 1 });

		api.push.mockRejectedValueOnce(new AccessExpiredError());
		await engine.sync();
		expect(engine.getStatus().state).toBe("reauth");
		expect(await store.outbox.count()).toBe(1);
		engine.dispose();
	});

	it("runs once more when sync is requested mid-run", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
		expect(api.pull).toHaveBeenCalledTimes(2);
		engine.dispose();
	});

	it("notifies subscribers", async () => {
		const engine = createSyncEngine({ store, api: fakeApi(), me, debounceMs: 10_000 });
		const states: string[] = [];
		const stop = engine.subscribe((s) => states.push(s.state));
		await engine.sync();
		stop();
		expect(states).toContain("syncing");
		expect(states.at(-1)).toBe("idle");
		engine.dispose();
	});
});
```

`apps/web/src/sync/triggers.test.ts`:
```ts
import { afterEach, expect, it, vi } from "vitest";
import { connectLive } from "./live";
import { startSyncTriggers } from "./triggers";

afterEach(() => vi.useRealTimers());

it("syncs when coming online, on live pokes, and on a timer", () => {
	vi.useFakeTimers();
	const engine = { sync: vi.fn(async () => {}) };
	let poke = () => {};
	const stop = startSyncTriggers(engine, {
		intervalMs: 1000,
		connect: (onPoke) => {
			poke = onPoke;
			return () => {};
		},
	});
	window.dispatchEvent(new Event("online"));
	poke();
	vi.advanceTimersByTime(1000);
	expect(engine.sync).toHaveBeenCalledTimes(3);
	stop();
	window.dispatchEvent(new Event("online"));
	expect(engine.sync).toHaveBeenCalledTimes(3);
});

it("listens for ready and poke events on the live stream", () => {
	const listeners: Record<string, () => void> = {};
	class FakeEventSource {
		closed = false;
		constructor(public url: string) {}
		addEventListener(type: string, fn: () => void) {
			listeners[type] = fn;
		}
		close() {
			this.closed = true;
		}
	}
	const onPoke = vi.fn();
	const disconnect = connectLive(onPoke, FakeEventSource as unknown as typeof EventSource);
	listeners.ready?.();
	listeners.poke?.();
	expect(onPoke).toHaveBeenCalledTimes(2);
	disconnect();
});
```

Run: `pnpm --filter @tagteam/web test` → FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/web/src/lib/api.ts`:
```ts
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: string[],
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** The Cloudflare Access session ended: API calls are redirected to its login page. */
export class AccessExpiredError extends Error {
	constructor() {
		super("Your session expired.");
		this.name = "AccessExpiredError";
	}
}

export class OfflineError extends Error {
	constructor() {
		super("You're offline.");
		this.name = "OfflineError";
	}
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: init.method ?? "GET",
			credentials: "same-origin",
			redirect: "manual",
			headers: init.body === undefined ? {} : { "content-type": "application/json" },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
	} catch {
		throw new OfflineError();
	}
	if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new AccessExpiredError();
	if (res.status === 204) return undefined as T;
	if (!res.headers.get("content-type")?.includes("application/json")) throw new AccessExpiredError();
	const body = (await res.json()) as unknown;
	if (!res.ok) {
		const error = (body as { error?: { code?: string; message?: string; details?: string[] } }).error ?? {};
		throw new ApiError(res.status, error.code ?? "unknown", error.message ?? "Something went wrong.", error.details);
	}
	return body as T;
}
```

`apps/web/src/lib/auth.ts`:
```ts
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: window.location.origin,
	basePath: "/api/auth",
	plugins: [passkeyClient()],
});
```

`apps/web/src/sync/engine.ts`:
```ts
import { MAX_BATCH, type Mutation, type MutationResult, type PullResponse } from "@tagteam/core";
import { AccessExpiredError, ApiError, OfflineError } from "../lib/api";
import { applyLocal, applyPull, type LocalUser } from "../store/apply";
import { getMeta, type TagTeamDb } from "../store/db";

export type SyncState = "idle" | "syncing" | "offline" | "reauth" | "signedOut" | "error";

export interface SyncStatus {
	state: SyncState;
	pending: number;
	lastSyncedAt: number | null;
}

export interface SyncApi {
	push(mutations: Mutation[]): Promise<MutationResult[]>;
	pull(cursor: number): Promise<PullResponse>;
}

export interface SyncEngine {
	enqueue(mutation: Mutation): Promise<void>;
	sync(): Promise<void>;
	getStatus(): SyncStatus;
	subscribe(listener: (status: SyncStatus) => void): () => void;
	dispose(): void;
}

const stateFor = (err: unknown): SyncState => {
	if (err instanceof OfflineError) return "offline";
	if (err instanceof AccessExpiredError) return "reauth";
	if (err instanceof ApiError && err.status === 401) return "signedOut";
	return "error";
};

export function createSyncEngine(opts: {
	store: TagTeamDb;
	api: SyncApi;
	me: LocalUser;
	debounceMs?: number;
	now?: () => number;
}): SyncEngine {
	const { store, api, me, debounceMs = 400, now = Date.now } = opts;
	let status: SyncStatus = { state: "idle", pending: 0, lastSyncedAt: null };
	const listeners = new Set<(s: SyncStatus) => void>();
	let running: Promise<void> | null = null;
	let again = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const update = (patch: Partial<SyncStatus>) => {
		status = { ...status, ...patch };
		for (const listener of listeners) listener(status);
	};
	const refreshPending = async () => update({ pending: await store.outbox.count() });

	async function runOnce(): Promise<void> {
		update({ state: "syncing" });
		try {
			let rejected = false;
			for (;;) {
				const batch = await store.outbox.orderBy("seq").limit(MAX_BATCH).toArray();
				if (batch.length === 0) break;
				const results = await api.push(batch.map((row) => row.mutation));
				if (results.some((r) => r.status === "rejected")) rejected = true;
				await store.outbox.bulkDelete(batch.map((row) => row.seq as number));
				await refreshPending();
			}
			const cursor = rejected ? 0 : ((await getMeta<number>(store, "cursor")) ?? 0);
			await applyPull(store, await api.pull(cursor), me, { reset: rejected });
			update({ state: "idle", lastSyncedAt: now() });
		} catch (err) {
			update({ state: stateFor(err) });
		}
	}

	const engine: SyncEngine = {
		async enqueue(mutation) {
			await store.transaction("rw", [store.outbox, store.tasks, store.events], async () => {
				await store.outbox.add({ mutation });
				await applyLocal(store, mutation, me);
			});
			await refreshPending();
			clearTimeout(timer);
			timer = setTimeout(() => void engine.sync(), debounceMs);
		},
		sync() {
			if (running) {
				again = true;
				return running;
			}
			running = (async () => {
				do {
					again = false;
					await runOnce();
				} while (again && status.state === "idle");
			})().finally(() => {
				running = null;
			});
			return running;
		},
		getStatus: () => status,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			clearTimeout(timer);
			listeners.clear();
		},
	};
	void refreshPending();
	return engine;
}
```

`apps/web/src/sync/http-api.ts`:
```ts
import type { PullResponse, PushResponse } from "@tagteam/core";
import { apiFetch } from "../lib/api";
import type { SyncApi } from "./engine";

export const httpSyncApi: SyncApi = {
	push: async (mutations) => (await apiFetch<PushResponse>("/api/sync/push", { method: "POST", body: { mutations } })).results,
	pull: (cursor) => apiFetch<PullResponse>(`/api/sync/pull?cursor=${cursor}`),
};
```

`apps/web/src/sync/live.ts`:
```ts
/** Opens the server's SSE stream; calls `onPoke` when it connects and whenever data changed. Returns a disconnect function. */
export function connectLive(onPoke: () => void, EventSourceImpl: typeof EventSource = EventSource): () => void {
	const source = new EventSourceImpl("/api/live", { withCredentials: true });
	source.addEventListener("ready", onPoke);
	source.addEventListener("poke", onPoke);
	return () => source.close();
}
```

`apps/web/src/sync/triggers.ts`:
```ts
import type { SyncEngine } from "./engine";
import { connectLive } from "./live";

export function startSyncTriggers(
	engine: Pick<SyncEngine, "sync">,
	opts: { connect?: (onPoke: () => void) => () => void; intervalMs?: number } = {},
): () => void {
	const { connect = connectLive, intervalMs = 60_000 } = opts;
	const sync = () => void engine.sync();
	const onVisible = () => {
		if (document.visibilityState === "visible") sync();
	};
	window.addEventListener("online", sync);
	document.addEventListener("visibilitychange", onVisible);
	const interval = setInterval(onVisible, intervalMs);
	const disconnect = connect(sync);
	return () => {
		window.removeEventListener("online", sync);
		document.removeEventListener("visibilitychange", onVisible);
		clearInterval(interval);
		disconnect();
	};
}
```

`apps/web/src/sync/use-sync-status.ts`:
```ts
import { useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "./engine";

export function useSyncStatus(engine: SyncEngine): SyncStatus {
	return useSyncExternalStore(engine.subscribe, engine.getStatus);
}
```
(`engine.subscribe`'s return type must be `() => void`; wrap it if `Set.delete`'s boolean return leaks through.)

- [ ] **Step 3: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src/lib apps/web/src/sync
git commit -m "feat(web): add the API client and offline sync engine"
```

---

### Task 5: UI kit and app shell

**Files:**
- Create: `apps/web/src/ui/Spinner.tsx`, `Button.tsx`, `TextField.tsx`, `Chip.tsx`, `Sheet.tsx`, `Toast.tsx`, `Banner.tsx`, `Avatar.tsx`, `apps/web/src/app/AppShell.tsx`, `apps/web/src/app/SyncChip.tsx`
- Test: `apps/web/src/ui/ui.test.tsx`, `apps/web/src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `cx` (Task 1), `SyncStatus` (Task 4).
- Produces:
  - `Button(props: ButtonHTMLAttributes & { variant?: "primary" | "secondary" | "ghost" | "danger"; block?: boolean; busy?: boolean })`
  - `TextField(props: InputHTMLAttributes & { label: string; error?: string; hint?: string; ref?: Ref<HTMLInputElement> })`
  - `Chip(props: { selected: boolean; onClick(): void; children; role?: "radio" | "checkbox" })` — `aria-checked` reflects `selected`
  - `Sheet(props: { open: boolean; onClose(): void; label: string; children })` — portal, backdrop click and Escape close, locks body scroll
  - `ToastProvider`, `useToast(): { show(t: { message: string; action?: { label: string; onClick(): void }; durationMs?: number }): void }`
  - `Banner(props: { tone: "warning" | "danger"; children; action?: { label: string; onClick(): void } })`
  - `Avatar(props: { name: string; color: string; size?: "sm" | "md" })`
  - `syncLabel(s: SyncStatus): string | null`, `SyncChip(props: { status: SyncStatus })`
  - `AppShell(props: { title: ReactNode; trailing?: ReactNode; banner?: ReactNode; onAdd?: () => void; children })` — sticky header, bottom navigation (Today `/`, Team `/team`, History `/history`, Me `/me`) with a centre "Add task" button when `onAdd` is given.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/ui/ui.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";
import { TextField } from "./TextField";
import { ToastProvider, useToast } from "./Toast";

describe("UI kit", () => {
	it("buttons default to type=button and report busy", () => {
		render(<Button busy>Save</Button>);
		const button = screen.getByRole("button", { name: "Save" });
		expect(button).toHaveAttribute("type", "button");
		expect(button).toHaveAttribute("aria-busy", "true");
	});

	it("text fields link labels and errors", () => {
		render(<TextField label="Email" error="Enter an email" />);
		const input = screen.getByLabelText("Email");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAccessibleDescription("Enter an email");
	});

	it("chips expose their checked state", async () => {
		const onClick = vi.fn();
		render(<Chip selected onClick={onClick}>Daily</Chip>);
		const chip = screen.getByRole("radio", { name: "Daily" });
		expect(chip).toHaveAttribute("aria-checked", "true");
		await userEvent.click(chip);
		expect(onClick).toHaveBeenCalled();
	});

	it("sheets close on Escape and backdrop", async () => {
		const onClose = vi.fn();
		render(<Sheet open onClose={onClose} label="Add task"><p>Body</p></Sheet>);
		expect(screen.getByRole("dialog", { name: "Add task" })).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("toasts show a message with an action", async () => {
		const onUndo = vi.fn();
		function Trigger() {
			const toast = useToast();
			return <Button onClick={() => toast.show({ message: "Done", action: { label: "Undo", onClick: onUndo } })}>Go</Button>;
		}
		render(<ToastProvider><Trigger /></ToastProvider>);
		await userEvent.click(screen.getByRole("button", { name: "Go" }));
		expect(screen.getByRole("status")).toHaveTextContent("Done");
		await userEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(onUndo).toHaveBeenCalled();
		expect(screen.queryByRole("status")).not.toHaveTextContent("Done");
	});
});
```

`apps/web/src/app/AppShell.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { syncLabel } from "./SyncChip";

describe("AppShell", () => {
	it("shows navigation with the current tab marked", () => {
		render(
			<MemoryRouter initialEntries={["/team"]}>
				<AppShell title="Smiths" onAdd={vi.fn()}>
					<p>content</p>
				</AppShell>
			</MemoryRouter>,
		);
		for (const name of ["Today", "Team", "History", "Me", "Add task"]) {
			expect(screen.getByRole(name === "Add task" ? "button" : "link", { name })).toBeInTheDocument();
		}
		expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
	});
});

describe("syncLabel", () => {
	it("is hidden when synced and explains offline or pending work", () => {
		expect(syncLabel({ state: "idle", pending: 0, lastSyncedAt: 1 })).toBeNull();
		expect(syncLabel({ state: "offline", pending: 0, lastSyncedAt: 1 })).toBe("Offline");
		expect(syncLabel({ state: "offline", pending: 2, lastSyncedAt: 1 })).toBe("Offline · 2 queued");
		expect(syncLabel({ state: "syncing", pending: 3, lastSyncedAt: 1 })).toBe("Syncing 3");
	});
});
```

Run: `pnpm --filter @tagteam/web test` → FAIL (modules missing).

- [ ] **Step 2: Implement**

`apps/web/src/ui/Spinner.tsx`:
```tsx
export function Spinner() {
	return <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
```

`apps/web/src/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
	primary: "bg-accent text-on-accent active:opacity-90",
	secondary: "bg-surface text-text ring-1 ring-line active:bg-surface-2",
	ghost: "text-accent active:bg-accent-soft",
	danger: "text-danger ring-1 ring-danger/40 active:bg-danger-soft",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	block?: boolean;
	busy?: boolean;
}

export function Button({ variant = "secondary", block, busy, className, children, disabled, ...rest }: ButtonProps) {
	return (
		<button
			type="button"
			{...rest}
			disabled={disabled || busy}
			aria-busy={busy || undefined}
			className={cx(
				"inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-[opacity,background-color] duration-150 disabled:opacity-50",
				VARIANTS[variant],
				block && "w-full",
				className,
			)}
		>
			{busy ? <Spinner /> : null}
			{children}
		</button>
	);
}
```

`apps/web/src/ui/TextField.tsx`:
```tsx
import { type InputHTMLAttributes, type Ref, useId } from "react";
import { cx } from "../lib/cx";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	error?: string;
	hint?: string;
	ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, error, hint, id, className, ref, ...rest }: TextFieldProps) {
	const autoId = useId();
	const inputId = id ?? autoId;
	const note = error ?? hint;
	return (
		<div className={cx("flex flex-col gap-1.5", className)}>
			<label htmlFor={inputId} className="text-[13px] font-medium text-text-2">
				{label}
			</label>
			<input
				ref={ref}
				id={inputId}
				aria-invalid={error ? true : undefined}
				aria-describedby={note ? `${inputId}-note` : undefined}
				{...rest}
				className="min-h-12 rounded-xl bg-surface px-3.5 text-base text-text outline-none ring-1 ring-line placeholder:text-text-3 focus:ring-2 focus:ring-accent aria-invalid:ring-danger"
			/>
			{note ? (
				<p id={`${inputId}-note`} className={cx("text-[13px]", error ? "text-danger" : "text-text-3")}>
					{note}
				</p>
			) : null}
		</div>
	);
}
```

`apps/web/src/ui/Chip.tsx`:
```tsx
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export function Chip({
	selected,
	onClick,
	children,
	role = "radio",
}: {
	selected: boolean;
	onClick: () => void;
	children: ReactNode;
	role?: "radio" | "checkbox";
}) {
	return (
		<button
			type="button"
			role={role}
			aria-checked={selected}
			onClick={onClick}
			className={cx(
				"inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors duration-150",
				selected ? "bg-accent text-on-accent" : "bg-surface text-text ring-1 ring-line active:bg-surface-2",
			)}
		>
			{children}
		</button>
	);
}
```

`apps/web/src/ui/Sheet.tsx`:
```tsx
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

/** Bottom sheet dialog. Closes on backdrop tap and Escape. */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = previous;
		};
	}, [open, onClose]);

	if (!open) return null;
	return createPortal(
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 bg-black/40 animate-[fade-in_150ms_ease-out]"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className="relative max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-[sheet-up_240ms_cubic-bezier(0.32,0.72,0,1)]"
			>
				<div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />
				{children}
			</div>
		</div>,
		document.body,
	);
}
```

`apps/web/src/ui/Toast.tsx`:
```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface ToastInput {
	message: string;
	action?: { label: string; onClick: () => void };
	durationMs?: number;
}

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const show = useCallback((next: ToastInput) => {
		clearTimeout(timer.current);
		setToast({ ...next, id: Date.now() });
		timer.current = setTimeout(() => setToast(null), next.durationMs ?? 4000);
	}, []);
	useEffect(() => () => clearTimeout(timer.current), []);
	const value = useMemo(() => ({ show }), [show]);

	return (
		<ToastContext.Provider value={value}>
			{children}
			<div
				role="status"
				aria-live="polite"
				className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
			>
				{toast ? (
					<div
						key={toast.id}
						className="pointer-events-auto flex max-w-sm flex-1 items-center gap-3 rounded-2xl bg-text px-4 py-3 text-[14px] text-bg shadow-lg animate-[toast-in_180ms_ease-out]"
					>
						<span className="min-w-0 flex-1 truncate">{toast.message}</span>
						{toast.action ? (
							<button
								type="button"
								className="-my-2 min-h-11 px-2 font-semibold"
								onClick={() => {
									toast.action?.onClick();
									setToast(null);
								}}
							>
								{toast.action.label}
							</button>
						) : null}
					</div>
				) : null}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast() {
	const value = useContext(ToastContext);
	if (!value) throw new Error("useToast needs a ToastProvider");
	return value;
}
```

`apps/web/src/ui/Banner.tsx`:
```tsx
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export function Banner({ tone, children, action }: { tone: "warning" | "danger"; children: ReactNode; action?: { label: string; onClick: () => void } }) {
	return (
		<div
			role="alert"
			className={cx(
				"mx-4 mt-2 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[14px]",
				tone === "warning" ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger",
			)}
		>
			<span className="flex-1">{children}</span>
			{action ? (
				<button type="button" onClick={action.onClick} className="-my-1 min-h-11 font-semibold underline-offset-2 hover:underline">
					{action.label}
				</button>
			) : null}
		</div>
	);
}
```

`apps/web/src/ui/Avatar.tsx`:
```tsx
import { cx } from "../lib/cx";

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("") || "?";

export function Avatar({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" }) {
	return (
		<span
			aria-hidden
			className={cx(
				`avatar-${color}`,
				"inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
				size === "sm" ? "size-7 text-[11px]" : "size-9 text-[13px]",
			)}
		>
			{initials(name)}
		</span>
	);
}
```

`apps/web/src/app/SyncChip.tsx`:
```tsx
import { CloudOff, RefreshCw } from "lucide-react";
import type { SyncStatus } from "../sync/engine";

export function syncLabel(status: SyncStatus): string | null {
	if (status.state === "offline") return status.pending > 0 ? `Offline · ${status.pending} queued` : "Offline";
	if (status.pending > 0) return `Syncing ${status.pending}`;
	return null;
}

export function SyncChip({ status }: { status: SyncStatus }) {
	const label = syncLabel(status);
	if (!label) return null;
	const Icon = status.state === "offline" ? CloudOff : RefreshCw;
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning">
			<Icon aria-hidden className="size-3.5" />
			{label}
		</span>
	);
}
```

`apps/web/src/app/AppShell.tsx`:
```tsx
import { CircleCheck, History, Plus, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cx } from "../lib/cx";

const TABS = [
	{ to: "/", label: "Today", icon: CircleCheck, end: true },
	{ to: "/team", label: "Team", icon: Users, end: false },
	{ to: "/history", label: "History", icon: History, end: false },
	{ to: "/me", label: "Me", icon: UserRound, end: false },
] as const;

function Tab({ to, label, icon: Icon, end }: (typeof TABS)[number]) {
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				cx("flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-accent" : "text-text-3")
			}
		>
			<Icon aria-hidden className="size-6" strokeWidth={1.75} />
			{label}
		</NavLink>
	);
}

export function AppShell({
	title,
	trailing,
	banner,
	onAdd,
	children,
}: {
	title: ReactNode;
	trailing?: ReactNode;
	banner?: ReactNode;
	onAdd?: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-30 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
				<div className="flex min-h-14 items-center justify-between gap-3 px-4">
					<div className="min-w-0">{title}</div>
					{trailing}
				</div>
			</header>
			{banner}
			<main className="flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
			<nav
				aria-label="Main"
				className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
			>
				<div className="mx-auto flex max-w-md items-center justify-around px-2 py-1.5">
					<Tab {...TABS[0]} />
					<Tab {...TABS[1]} />
					{onAdd ? (
						<button
							type="button"
							aria-label="Add task"
							onClick={onAdd}
							className="flex size-12 items-center justify-center rounded-full bg-accent text-on-accent shadow-md active:scale-95 transition-transform duration-150"
						>
							<Plus aria-hidden className="size-6" strokeWidth={2.25} />
						</button>
					) : null}
					<Tab {...TABS[2]} />
					<Tab {...TABS[3]} />
				</div>
			</nav>
		</div>
	);
}
```

- [ ] **Step 3: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src/ui apps/web/src/app
git commit -m "feat(web): add the UI kit and app shell"
```

---

### Task 6: Today — model, labels and screen

**Files:**
- Create: `apps/web/src/lib/time.ts`, `apps/web/src/lib/storage.ts`, `apps/web/src/features/today/model.ts`, `labels.ts`, `TodayList.tsx`, `TodayScreen.tsx`, `apps/web/src/session/session.ts`, `apps/web/src/test/fakes.tsx`
- Test: `apps/web/src/lib/time.test.ts`, `apps/web/src/features/today/model.test.ts`, `apps/web/src/features/today/TodayScreen.test.tsx`

**Interfaces:**
- Consumes: `deriveTask`, `TaskDto`, `EventDto`, `TaskEvent`, `MeResponse` (core); store, engine, UI kit.
- Produces:
  - `time.ts`: `localDate(ms: number, tz?: string): LocalDate`, `dayBounds(now: number): { start: number; end: number }` (local midnight → next local midnight), `formatWhen(ms: number, now: number, opts?: { time?: boolean; tz?: string; locale?: string }): string` ("08:00" / "Today" / "Tomorrow 08:00" / "Mon 08:00" / "4 Oct"), `formatTime(ms, opts?)`, `useNow(intervalMs?: number): number`, `browserTimeZone(): string`.
  - `storage.ts`: `readFlag(key: string, fallback: boolean): boolean`, `writeFlag(key: string, value: boolean): void` (localStorage wrapped in try/catch).
  - `session/session.ts`: `interface Session { me: MeResponse; store: TagTeamDb; engine: SyncEngine; activeGroupId: string | null; setActiveGroup(id: string): Promise<void>; refreshMe(): Promise<MeResponse>; signOut(): Promise<void> }`, `SessionContext`, `useSession()`.
  - `model.ts`: `type RowKind = "overdue" | "open" | "done" | "upcoming"`, `interface TodayRow { task: TaskDto; kind: RowKind; key: string; periodStart: number; dueAt: number; timed: boolean; recurring: boolean; missed: number; completedAt?: number; completionId?: string }`, `interface TodayView { overdue: TodayRow[]; today: TodayRow[]; upcoming: TodayRow[]; done: number; total: number; hasTasks: boolean }`, `buildToday(input: { tasks: TaskDto[]; events: EventDto[]; userId: string; groupId: string; now: number; day: { start: number; end: number } }): TodayView`.
  - `labels.ts`: `rowLabel(row: TodayRow, now: number, opts?: { tz?: string; locale?: string }): string`.
  - `TodayList(props: { view: TodayView; now: number; showUpcoming: boolean; onToggleUpcoming(): void; onToggle(row: TodayRow): void; onAdd(): void })`.
  - `TodayScreen()` — reads the active group's tasks/events with `useLiveQuery`, completes/undoes through `engine.enqueue`, shows the undo toast.
  - `test/fakes.tsx`: `fakeEngine(): SyncEngine & { enqueue: Mock }`, `renderWithSession(ui, overrides?: Partial<Session>)` (wraps `SessionContext`, `ToastProvider`, `MemoryRouter`), `ME: MeResponse` fixture (user `u1`, group `g1` "Smiths").

Model rules (spec §5, §6.2): only tasks with `groupId === groupId`, `ownerId === userId`, `archivedAt === null`. For each, `deriveTask(schedule, events, now)`:
- every entry with status `on_time`/`late` whose `completedAt` falls in `[day.start, day.end)` → a `done` row (carries `completionId`);
- `current.status`: `overdue` → overdue row (`missed = missedWhileOpen`); `open` → today row; `upcoming` → upcoming row.
Sorting: overdue by `dueAt`; today: open rows by `dueAt`, then done rows by `completedAt`; upcoming by `dueAt`. `done` = number of done rows; `total` = today rows + overdue rows. `timed` = the rule version in force for `key` has a `dueTime`. `recurring` = any version has a non-null rule.

Labels: overdue → `Since <when>` (timed: `formatWhen(dueAt, {time})`; untimed: `formatWhen(periodStart)`), lower-casing a leading Today/Yesterday, plus ` · N missed` when `missed > 0`; open → timed and due today: `By HH:MM`; timed later: `Due <when with time>`; untimed ending today: `Today`; untimed later: `Due <day before dueAt>`; done → `Done HH:MM`; upcoming → timed: `formatWhen(dueAt, {time})`, untimed: `formatWhen(periodStart)`.

Interaction (spec §6.2): tapping the circle of an open/overdue/upcoming row enqueues `task.complete` for `row.key` (`navigator.vibrate?.(10)`), and shows a 5 s toast "Done · <title>" with **Undo** (enqueues `task.uncomplete` with the new completion's id). Tapping a done row's circle enqueues `task.uncomplete` for its `completionId`. "Show upcoming (N)" / "Hide upcoming" toggle, remembered under `tagteam.showUpcoming`. Header: weekday name, "X of Y done today", progress bar (`role="progressbar"`). Empty group: "Add your first task" + **Add task** button. Everything done: "All done for today".

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatWhen, localDate } from "./time";

const tz = "Europe/London";
const opts = { tz, locale: "en-GB" };
const at = (iso: string) => Date.parse(iso);
const now = at("2026-09-24T11:00:00Z"); // Thu 12:00 BST

describe("time helpers", () => {
	it("gives the local date in a timezone", () => {
		expect(localDate(at("2026-09-23T23:30:00Z"), tz)).toBe("2026-09-24");
	});

	it("formats relative days, weekdays and dates", () => {
		expect(formatWhen(at("2026-09-24T17:00:00Z"), now, { ...opts, time: true })).toBe("18:00");
		expect(formatWhen(at("2026-09-24T17:00:00Z"), now, opts)).toBe("Today");
		expect(formatWhen(at("2026-09-25T07:00:00Z"), now, { ...opts, time: true })).toBe("Tomorrow 08:00");
		expect(formatWhen(at("2026-09-23T07:00:00Z"), now, opts)).toBe("Yesterday");
		expect(formatWhen(at("2026-09-21T07:00:00Z"), now, { ...opts, time: true })).toBe("Mon 08:00");
		expect(formatWhen(at("2026-10-04T07:00:00Z"), now, opts)).toBe("4 Oct");
	});
});
```

`apps/web/src/features/today/model.test.ts`:
```ts
import { atTime, type EventDto, type TaskDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import { rowLabel } from "./labels";
import { buildToday } from "./model";

const TZ = "Europe/London";
const at = (date: string, time: string) => atTime(date, time, TZ);
const opts = { tz: TZ, locale: "en-GB" };
const day = (date: string) => ({ start: at(date, "00:00"), end: at(date, "00:00") + 86_400_000 });

const task = (id: string, patch: Partial<TaskDto> = {}): TaskDto => ({
	id,
	groupId: "g1",
	ownerId: "u1",
	title: id,
	notes: null,
	timezone: TZ,
	startDate: "2026-09-21",
	rules: [{ effectiveFrom: "2026-09-21", rule: { freq: "day", interval: 1 }, dueTime: "08:00" }],
	archivedAt: null,
	createdAt: 0,
	...patch,
});
const done = (taskId: string, key: string, when: number, id = `${taskId}-${key}`): EventDto => ({
	id,
	taskId,
	userId: "u1",
	type: "completed",
	occurrenceKey: key,
	refEventId: null,
	at: when,
});

describe("buildToday", () => {
	it("puts an old open occurrence under overdue with its missed count", () => {
		const now = at("2026-09-23", "09:00");
		const view = buildToday({ tasks: [task("teeth")], events: [], userId: "u1", groupId: "g1", now, day: day("2026-09-23") });
		expect(view.overdue.map((r) => [r.task.id, r.key, r.missed])).toEqual([["teeth", "2026-09-21", 2]]);
		expect(rowLabel(view.overdue[0]!, now, opts)).toBe("Since Mon 08:00 · 2 missed");
		expect(view.total).toBe(1);
	});

	it("shows today's completions as done and the next one as upcoming", () => {
		const now = at("2026-09-21", "09:00");
		const view = buildToday({
			tasks: [task("teeth")],
			events: [done("teeth", "2026-09-21", at("2026-09-21", "07:42"))],
			userId: "u1",
			groupId: "g1",
			now,
			day: day("2026-09-21"),
		});
		expect(view.today.map((r) => [r.kind, r.key, r.completionId])).toEqual([["done", "2026-09-21", "teeth-2026-09-21"]]);
		expect(rowLabel(view.today[0]!, now, opts)).toBe("Done 07:42");
		expect(view.upcoming.map((r) => r.key)).toEqual(["2026-09-22"]);
		expect(rowLabel(view.upcoming[0]!, now, opts)).toBe("Tomorrow 08:00");
		expect([view.done, view.total]).toEqual([1, 1]);
	});

	it("labels open occurrences by due time or day", () => {
		const now = at("2026-09-21", "07:00");
		const untimed = task("read", { rules: [{ effectiveFrom: "2026-09-21", rule: { freq: "day", interval: 1 }, dueTime: null }] });
		const weekly = task("bins", { startDate: "2026-09-19", rules: [{ effectiveFrom: "2026-09-19", rule: { freq: "week", interval: 1, weekdays: [6] }, dueTime: null }] });
		const view = buildToday({ tasks: [task("teeth"), untimed, weekly], events: [], userId: "u1", groupId: "g1", now, day: day("2026-09-21") });
		expect(view.today.map((r) => [r.task.id, rowLabel(r, now, opts)])).toEqual([
			["teeth", "By 08:00"],
			["read", "Today"],
			["bins", "Due Fri"],
		]);
	});

	it("ignores other people's, other groups' and archived tasks", () => {
		const now = at("2026-09-21", "07:00");
		const view = buildToday({
			tasks: [task("theirs", { ownerId: "u2" }), task("other", { groupId: "g2" }), task("old", { archivedAt: 1 })],
			events: [],
			userId: "u1",
			groupId: "g1",
			now,
			day: day("2026-09-21"),
		});
		expect([view.overdue, view.today, view.upcoming, view.hasTasks]).toEqual([[], [], [], false]);
	});
});
```

`apps/web/src/features/today/TodayScreen.test.tsx`:
```tsx
import type { TaskDto } from "@tagteam/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEngine, ME, renderWithSession } from "../../test/fakes";
import { TodayScreen } from "./TodayScreen";

const today = new Date();
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const brushTeeth: TaskDto = {
	id: "t1",
	groupId: "g1",
	ownerId: "u1",
	title: "Brush teeth",
	notes: null,
	timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	startDate: iso(today),
	rules: [{ effectiveFrom: iso(today), rule: { freq: "day", interval: 1 }, dueTime: "23:59" }],
	archivedAt: null,
	createdAt: 0,
};

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	localStorage.clear();
});

describe("TodayScreen", () => {
	it("invites adding a first task in an empty group", async () => {
		renderWithSession(<TodayScreen />, { store });
		expect(await screen.findByText("Add your first task")).toBeInTheDocument();
	});

	it("completes a task and offers undo", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		await userEvent.click(await screen.findByRole("button", { name: "Complete Brush teeth" }));
		expect(engine.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "task.complete", taskId: "t1", occurrenceKey: iso(today) }));
		const completionId = engine.enqueue.mock.calls[0]?.[0].id;

		await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
		expect(engine.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ type: "task.uncomplete", taskId: "t1", refEventId: completionId }));
	});

	it("hides upcoming until asked and remembers the choice", async () => {
		await store.tasks.put(brushTeeth);
		await store.events.put({ id: "e1", taskId: "t1", userId: "u1", type: "completed", occurrenceKey: iso(today), refEventId: null, at: Date.now() });
		renderWithSession(<TodayScreen />, { store });

		expect(await screen.findByText("1 of 1 done today")).toBeInTheDocument();
		expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
		const toggle = screen.getByRole("button", { name: "Show upcoming (1)" });
		await userEvent.click(toggle);
		await waitFor(() => expect(screen.getByRole("button", { name: "Hide upcoming" })).toBeInTheDocument());
		expect(localStorage.getItem("tagteam.showUpcoming")).toBe("true");
		expect(ME.groups[0]?.name).toBe("Smiths");
	});
});
```

Run: `pnpm --filter @tagteam/web test` → FAIL (modules missing).

- [ ] **Step 2: Implement helpers and session context**

`apps/web/src/lib/time.ts`:
```ts
import type { LocalDate } from "@tagteam/core";
import { useEffect, useState } from "react";

export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function localDate(ms: number, tz = browserTimeZone()): LocalDate {
	return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/** Local midnight today → local midnight tomorrow, in the browser's timezone. */
export function dayBounds(now: number): { start: number; end: number } {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start: start.getTime(), end: end.getTime() };
}

export function formatTime(ms: number, opts: { tz?: string; locale?: string } = {}): string {
	return new Intl.DateTimeFormat(opts.locale, { timeZone: opts.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

export function formatWhen(ms: number, now: number, opts: { time?: boolean; tz?: string; locale?: string } = {}): string {
	const tz = opts.tz ?? browserTimeZone();
	const days = Math.round((Date.parse(localDate(ms, tz)) - Date.parse(localDate(now, tz))) / 86_400_000);
	const time = opts.time ? formatTime(ms, { tz, locale: opts.locale }) : "";
	const withTime = (label: string) => (time ? `${label} ${time}` : label);
	if (days === 0) return time || "Today";
	if (days === 1) return withTime("Tomorrow");
	if (days === -1) return withTime("Yesterday");
	if (Math.abs(days) < 7) return withTime(new Intl.DateTimeFormat(opts.locale, { timeZone: tz, weekday: "short" }).format(ms));
	return withTime(new Intl.DateTimeFormat(opts.locale, { timeZone: tz, day: "numeric", month: "short" }).format(ms));
}

/** Current time, refreshed every `intervalMs` so relative labels stay correct. */
export function useNow(intervalMs = 30_000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
	return now;
}
```

`apps/web/src/lib/storage.ts`:
```ts
/** Per-device UI preferences. Storage can be unavailable (private mode), so failures fall back silently. */
export function readFlag(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value === "true";
	} catch {
		return fallback;
	}
}

export function writeFlag(key: string, value: boolean): void {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Preference is not persisted; the UI still works.
	}
}
```

`apps/web/src/session/session.ts`:
```ts
import type { MeResponse } from "@tagteam/core";
import { createContext, useContext } from "react";
import type { TagTeamDb } from "../store/db";
import type { SyncEngine } from "../sync/engine";

export interface Session {
	me: MeResponse;
	store: TagTeamDb;
	engine: SyncEngine;
	activeGroupId: string | null;
	setActiveGroup(id: string): Promise<void>;
	refreshMe(): Promise<MeResponse>;
	signOut(): Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
	const session = useContext(SessionContext);
	if (!session) throw new Error("useSession must be used inside the signed-in app");
	return session;
}
```

`apps/web/src/test/fakes.tsx`:
```tsx
import type { MeResponse } from "@tagteam/core";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { type Mock, vi } from "vitest";
import { type Session, SessionContext } from "../session/session";
import { TagTeamDb } from "../store/db";
import type { SyncEngine } from "../sync/engine";
import { ToastProvider } from "../ui/Toast";

export const ME: MeResponse = {
	user: { id: "u1", email: "sam@example.com", name: "Sam" },
	profile: { displayName: "Sam", avatarColor: "blue", timezone: "UTC", activeGroupId: "g1" },
	groups: [{ id: "g1", name: "Smiths", role: "admin", joinedAt: 0 }],
};

export function fakeEngine(): SyncEngine & { enqueue: Mock; sync: Mock } {
	const status = { state: "idle" as const, pending: 0, lastSyncedAt: null };
	return {
		enqueue: vi.fn(async () => {}),
		sync: vi.fn(async () => {}),
		getStatus: () => status,
		subscribe: () => () => {},
		dispose: () => {},
	};
}

export function renderWithSession(ui: ReactElement, overrides: Partial<Session> = {}, route = "/") {
	const session: Session = {
		me: ME,
		store: new TagTeamDb(`test-${crypto.randomUUID()}`),
		engine: fakeEngine(),
		activeGroupId: "g1",
		setActiveGroup: vi.fn(async () => {}),
		refreshMe: vi.fn(async () => ME),
		signOut: vi.fn(async () => {}),
		...overrides,
	};
	const result = render(
		<MemoryRouter initialEntries={[route]}>
			<SessionContext.Provider value={session}>
				<ToastProvider>{ui}</ToastProvider>
			</SessionContext.Provider>
		</MemoryRouter>,
	);
	return { ...result, session };
}
```

- [ ] **Step 3: Implement the model and labels**

`apps/web/src/features/today/model.ts`:
```ts
import { deriveTask, type EventDto, startOfDay, type TaskDto, type TaskEvent } from "@tagteam/core";

export type RowKind = "overdue" | "open" | "done" | "upcoming";

export interface TodayRow {
	task: TaskDto;
	kind: RowKind;
	key: string;
	/** Start of the occurrence day in the task's timezone (epoch ms). */
	periodStart: number;
	dueAt: number;
	timed: boolean;
	recurring: boolean;
	missed: number;
	completedAt?: number;
	completionId?: string;
}

export interface TodayView {
	overdue: TodayRow[];
	today: TodayRow[];
	upcoming: TodayRow[];
	done: number;
	total: number;
	hasTasks: boolean;
}

/** Due time of the rule version in force on `key`. */
const dueTimeFor = (task: TaskDto, key: string): string | null => {
	let dueTime: string | null = null;
	for (const version of task.rules) if (version.effectiveFrom <= key) dueTime = version.dueTime;
	return dueTime;
};

export function buildToday(input: {
	tasks: TaskDto[];
	events: EventDto[];
	userId: string;
	groupId: string;
	now: number;
	day: { start: number; end: number };
}): TodayView {
	const { tasks, events, userId, groupId, now, day } = input;
	const eventsByTask = new Map<string, EventDto[]>();
	for (const event of events) eventsByTask.set(event.taskId, [...(eventsByTask.get(event.taskId) ?? []), event]);

	const view: TodayView = { overdue: [], today: [], upcoming: [], done: 0, total: 0, hasTasks: false };
	const doneRows: TodayRow[] = [];
	for (const task of tasks) {
		if (task.groupId !== groupId || task.ownerId !== userId || task.archivedAt !== null) continue;
		view.hasTasks = true;
		const schedule = { startDate: task.startDate, timezone: task.timezone, rules: task.rules, archivedAt: task.archivedAt };
		// EventDto rows are the wire form of TaskEvent (nullable columns for unused variant fields).
		const derived = deriveTask(schedule, (eventsByTask.get(task.id) ?? []) as unknown as TaskEvent[], now);
		const recurring = task.rules.some((v) => v.rule !== null);
		const row = (kind: RowKind, key: string, dueAt: number): TodayRow => ({
			task,
			kind,
			key,
			periodStart: startOfDay(key, task.timezone),
			dueAt,
			timed: dueTimeFor(task, key) !== null,
			recurring,
			missed: 0,
		});

		for (const entry of derived.entries) {
			const { completedAt } = entry;
			const closed = entry.status === "on_time" || entry.status === "late";
			if (closed && completedAt !== undefined && completedAt >= day.start && completedAt < day.end) {
				doneRows.push({ ...row("done", entry.key, entry.dueAt), completedAt, completionId: entry.completionId });
			}
		}
		const current = derived.current;
		if (!current) continue;
		if (current.status === "overdue") view.overdue.push({ ...row("overdue", current.key, current.dueAt), missed: derived.missedWhileOpen });
		else if (current.status === "open") view.today.push(row("open", current.key, current.dueAt));
		else view.upcoming.push(row("upcoming", current.key, current.dueAt));
	}

	const byDue = (a: TodayRow, b: TodayRow) => a.dueAt - b.dueAt;
	view.overdue.sort(byDue);
	view.today.sort(byDue);
	view.upcoming.sort(byDue);
	doneRows.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
	view.today.push(...doneRows);
	view.done = doneRows.length;
	view.total = view.today.length + view.overdue.length;
	return view;
}
```

`apps/web/src/features/today/labels.ts`:
```ts
import { formatTime, formatWhen } from "../../lib/time";
import type { TodayRow } from "./model";

const relative = /^(Today|Tomorrow|Yesterday)/;
const inline = (label: string) => label.replace(relative, (word) => word.toLowerCase());

export function rowLabel(row: TodayRow, now: number, opts: { tz?: string; locale?: string } = {}): string {
	switch (row.kind) {
		case "overdue": {
			const since = row.timed ? formatWhen(row.dueAt, now, { ...opts, time: true }) : formatWhen(row.periodStart, now, opts);
			return `Since ${inline(since)}${row.missed > 0 ? ` · ${row.missed} missed` : ""}`;
		}
		case "open": {
			if (row.timed) {
				const when = formatWhen(row.dueAt, now, { ...opts, time: true });
				return /^\d/.test(when) ? `By ${when}` : `Due ${inline(when)}`;
			}
			const lastDay = formatWhen(row.dueAt - 1, now, opts);
			return lastDay === "Today" ? "Today" : `Due ${inline(lastDay)}`;
		}
		case "done":
			return `Done ${formatTime(row.completedAt ?? now, opts)}`;
		case "upcoming":
			return row.timed ? formatWhen(row.dueAt, now, { ...opts, time: true }) : formatWhen(row.periodStart, now, opts);
	}
}
```

- [ ] **Step 4: Implement the list and screen**

`apps/web/src/features/today/TodayList.tsx`:
```tsx
import { Check, Repeat } from "lucide-react";
import { cx } from "../../lib/cx";
import { Button } from "../../ui/Button";
import { rowLabel } from "./labels";
import type { TodayRow, TodayView } from "./model";

function CheckCircle({ row, onToggle }: { row: TodayRow; onToggle: (row: TodayRow) => void }) {
	const done = row.kind === "done";
	return (
		<button
			type="button"
			aria-label={done ? `Undo ${row.task.title}` : `Complete ${row.task.title}`}
			aria-pressed={done}
			onClick={() => onToggle(row)}
			className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-full active:scale-90 transition-transform duration-150"
		>
			<span
				className={cx(
					"flex size-[26px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150",
					done && "border-success bg-success text-bg",
					row.kind === "overdue" && "border-danger",
					row.kind === "open" && "border-text-3",
					row.kind === "upcoming" && "border-dashed border-text-3",
				)}
			>
				{done ? <Check aria-hidden className="size-4" strokeWidth={3} /> : null}
			</span>
		</button>
	);
}

function Row({ row, now, onToggle }: { row: TodayRow; now: number; onToggle: (row: TodayRow) => void }) {
	return (
		<li className="flex items-center gap-3 border-b border-line py-3 last:border-0">
			<CheckCircle row={row} onToggle={onToggle} />
			<div className="min-w-0 flex-1">
				<p className={cx("truncate text-[15px]", row.kind === "done" && "text-text-3 line-through", row.kind === "upcoming" && "text-text-2")}>
					{row.task.title}
				</p>
				<p className={cx("text-[13px]", row.kind === "overdue" ? "text-danger" : "text-text-2")}>{rowLabel(row, now)}</p>
			</div>
			{row.recurring ? <Repeat aria-label="Repeats" className="size-4 shrink-0 text-text-3" /> : null}
		</li>
	);
}

function Section({ title, rows, now, onToggle }: { title: string; rows: TodayRow[]; now: number; onToggle: (row: TodayRow) => void }) {
	if (rows.length === 0) return null;
	return (
		<section aria-label={title} className="mt-5">
			<h2 className="mb-1 text-[13px] font-medium text-text-2">{title}</h2>
			<ul className="rounded-2xl bg-surface px-4 ring-1 ring-line">
				{rows.map((row) => (
					<Row key={`${row.kind}-${row.task.id}-${row.key}`} row={row} now={now} onToggle={onToggle} />
				))}
			</ul>
		</section>
	);
}

export function TodayList({
	view,
	now,
	showUpcoming,
	onToggleUpcoming,
	onToggle,
	onAdd,
}: {
	view: TodayView;
	now: number;
	showUpcoming: boolean;
	onToggleUpcoming: () => void;
	onToggle: (row: TodayRow) => void;
	onAdd: () => void;
}) {
	if (!view.hasTasks) {
		return (
			<div className="mt-20 flex flex-col items-center gap-3 text-center">
				<p className="text-lg font-semibold">Add your first task</p>
				<p className="max-w-64 text-[14px] text-text-2">Things you want to do every day, week or month — or just once.</p>
				<Button variant="primary" onClick={onAdd}>
					Add task
				</Button>
			</div>
		);
	}
	const percent = view.total === 0 ? 100 : Math.round((view.done / view.total) * 100);
	const allDone = view.overdue.length === 0 && view.today.every((r) => r.kind === "done");
	return (
		<div>
			<div className="mt-2">
				<h1 className="text-[26px] font-semibold tracking-tight">{new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now)}</h1>
				<p className="text-[14px] text-text-2">
					{view.done} of {view.total} done today
				</p>
				<div role="progressbar" aria-label="Done today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
					<div className="h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${percent}%` }} />
				</div>
			</div>
			{allDone ? <p className="mt-6 text-center text-[14px] text-text-2">All done for today</p> : null}
			<Section title="Overdue" rows={view.overdue} now={now} onToggle={onToggle} />
			<Section title="Today" rows={view.today} now={now} onToggle={onToggle} />
			{view.upcoming.length > 0 ? (
				<div className="mt-4 flex justify-center">
					<Button variant="ghost" onClick={onToggleUpcoming}>
						{showUpcoming ? "Hide upcoming" : `Show upcoming (${view.upcoming.length})`}
					</Button>
				</div>
			) : null}
			{showUpcoming ? <Section title="Upcoming" rows={view.upcoming} now={now} onToggle={onToggle} /> : null}
		</div>
	);
}
```

`apps/web/src/features/today/TodayScreen.tsx`:
```tsx
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { readFlag, writeFlag } from "../../lib/storage";
import { dayBounds, useNow } from "../../lib/time";
import { useSession } from "../../session/session";
import { useToast } from "../../ui/Toast";
import { buildToday, type TodayRow } from "./model";
import { TodayList } from "./TodayList";

const UPCOMING_KEY = "tagteam.showUpcoming";

export function TodayScreen() {
	const { store, engine, me, activeGroupId } = useSession();
	const outlet = useOutletContext<{ openAdd?: () => void } | undefined>();
	const toast = useToast();
	const now = useNow();
	const [showUpcoming, setShowUpcoming] = useState(() => readFlag(UPCOMING_KEY, false));
	const tasks = useLiveQuery(() => store.tasks.where("groupId").equals(activeGroupId ?? "").toArray(), [store, activeGroupId]);
	const events = useLiveQuery(async () => {
		const ids = (tasks ?? []).map((t) => t.id);
		return ids.length === 0 ? [] : store.events.where("taskId").anyOf(ids).toArray();
	}, [store, tasks]);
	if (!tasks || !events || !activeGroupId) return null;

	const view = buildToday({ tasks, events, userId: me.user.id, groupId: activeGroupId, now, day: dayBounds(now) });

	const uncomplete = (taskId: string, refEventId: string) =>
		engine.enqueue({ id: crypto.randomUUID(), at: Date.now(), type: "task.uncomplete", taskId, refEventId });

	const onToggle = async (row: TodayRow) => {
		if (row.kind === "done") {
			if (row.completionId) await uncomplete(row.task.id, row.completionId);
			return;
		}
		const id = crypto.randomUUID();
		navigator.vibrate?.(10);
		await engine.enqueue({ id, at: Date.now(), type: "task.complete", taskId: row.task.id, occurrenceKey: row.key });
		toast.show({ message: `Done · ${row.task.title}`, action: { label: "Undo", onClick: () => void uncomplete(row.task.id, id) }, durationMs: 5000 });
	};

	return (
		<TodayList
			view={view}
			now={now}
			showUpcoming={showUpcoming}
			onToggleUpcoming={() => {
				setShowUpcoming((value) => {
					writeFlag(UPCOMING_KEY, !value);
					return !value;
				});
			}}
			onToggle={(row) => void onToggle(row)}
			onAdd={() => outlet?.openAdd?.()}
		/>
	);
}
```

- [ ] **Step 5: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src
git commit -m "feat(web): add the Today screen with complete, undo and upcoming"
```

---

### Task 7: Add task sheet

**Files:**
- Create: `apps/web/src/features/add-task/draft.ts`, `apps/web/src/features/add-task/AddTaskSheet.tsx`
- Test: `apps/web/src/features/add-task/draft.test.ts`, `apps/web/src/features/add-task/AddTaskSheet.test.tsx`

**Interfaces:**
- Consumes: `Rule`, `Weekday`, `weekdayOf`, `Mutation`, `LocalDate` (core); `localDate`, `browserTimeZone` (Task 6); session; UI kit.
- Produces:
  - `type Repeat = "once" | "daily" | "weekly" | "monthly" | "custom"`, `type Unit = "day" | "week" | "month"`, `interface TaskDraft { title: string; repeat: Repeat; every: number; unit: Unit; weekdays: Weekday[]; monthDay: number | "last"; startDate: LocalDate; dueTime: string | null }`, `newDraft(today: LocalDate): TaskDraft`, `draftRule(d: TaskDraft): Rule | null`, `draftErrors(d: TaskDraft): { title?: string; every?: string }`, `draftMutation(d, ctx: { groupId: string; timezone: string; at: number }): Mutation`.
  - `AddTaskSheet(props: { open: boolean; onClose(): void })` — uses the session's engine and active group.

Rules: once → `null`; daily → `{ day, 1 }`; weekly → `{ week, 1, [weekday of startDate] }`; monthly → `{ month, 1, day-of-month of startDate }`; custom → `{ day | week | month, every }`, weeks use the selected weekdays (default: startDate's weekday), months use `monthDay`. Title 1–100 characters after trimming ("Give it a name"); `every` an integer 1–366 ("Enter a number from 1 to 366").

UI (spec §6.4): sheet opens with the title field focused (`autoFocus`, `enterKeyHint="done"`); **Enter submits**. Repeat chips in a `radiogroup` labelled "Repeat". Custom reveals "Every [N] [days|weeks|months]" plus weekday toggles (M T W T F S S, `aria-pressed`) for weeks or a day-of-month select ("Day 1" … "Day 31", "Last day") for months. "Starts" chip showing "Starts today" (or the date) reveals a date input; "Add time" chip reveals a time input with a "Remove time" button. Primary **Add task**. On submit: enqueue `task.create`, close, reset, toast "Added · <title>".

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/add-task/draft.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { draftErrors, draftMutation, draftRule, newDraft } from "./draft";

const base = newDraft("2026-09-23"); // Wednesday

describe("task drafts", () => {
	it("maps repeat choices to rules", () => {
		expect(draftRule({ ...base, repeat: "once" })).toBeNull();
		expect(draftRule({ ...base, repeat: "daily" })).toEqual({ freq: "day", interval: 1 });
		expect(draftRule({ ...base, repeat: "weekly" })).toEqual({ freq: "week", interval: 1, weekdays: [3] });
		expect(draftRule({ ...base, repeat: "monthly" })).toEqual({ freq: "month", interval: 1, monthDay: 23 });
		expect(draftRule({ ...base, repeat: "custom", every: 3, unit: "day" })).toEqual({ freq: "day", interval: 3 });
		expect(draftRule({ ...base, repeat: "custom", every: 2, unit: "week", weekdays: [1, 3] })).toEqual({ freq: "week", interval: 2, weekdays: [1, 3] });
		expect(draftRule({ ...base, repeat: "custom", every: 2, unit: "week", weekdays: [] })).toEqual({ freq: "week", interval: 2, weekdays: [3] });
		expect(draftRule({ ...base, repeat: "custom", every: 1, unit: "month", monthDay: "last" })).toEqual({ freq: "month", interval: 1, monthDay: "last" });
	});

	it("validates the title and interval", () => {
		expect(draftErrors({ ...base, title: "   " })).toEqual({ title: "Give it a name" });
		expect(draftErrors({ ...base, title: "Bins", repeat: "custom", every: 0 })).toEqual({ every: "Enter a number from 1 to 366" });
		expect(draftErrors({ ...base, title: "Bins" })).toEqual({});
	});

	it("builds a create mutation", () => {
		const m = draftMutation({ ...base, title: " Brush teeth ", repeat: "daily", dueTime: "08:00" }, { groupId: "g1", timezone: "Europe/London", at: 5 });
		expect(m).toMatchObject({ type: "task.create", groupId: "g1", title: "Brush teeth", notes: null, timezone: "Europe/London", startDate: "2026-09-23", dueTime: "08:00", rule: { freq: "day", interval: 1 }, at: 5 });
		expect(m.id).not.toBe((m as { taskId: string }).taskId);
	});
});
```

`apps/web/src/features/add-task/AddTaskSheet.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeEngine, renderWithSession } from "../../test/fakes";
import { AddTaskSheet } from "./AddTaskSheet";

describe("AddTaskSheet", () => {
	it("adds a one-off task on Enter", async () => {
		const engine = fakeEngine();
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, { engine });
		const title = screen.getByLabelText("Task");
		expect(title).toHaveFocus();
		await userEvent.type(title, "Call grandma{Enter}");
		expect(engine.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "task.create", title: "Call grandma", rule: null, groupId: "g1" }));
		expect(onClose).toHaveBeenCalled();
	});

	it("builds a custom weekly schedule with a due time", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Clean room");
		await userEvent.click(screen.getByRole("radio", { name: "Custom" }));
		const every = screen.getByLabelText("Every");
		await userEvent.clear(every);
		await userEvent.type(every, "2");
		await userEvent.selectOptions(screen.getByLabelText("Unit"), "week");
		await userEvent.click(screen.getByRole("button", { name: "Monday" }));
		await userEvent.click(screen.getByRole("button", { name: "Add time" }));
		const time = screen.getByLabelText("Due by");
		await userEvent.clear(time);
		await userEvent.type(time, "18:30");
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		const m = engine.enqueue.mock.calls[0]?.[0];
		expect(m).toMatchObject({ rule: { freq: "week", interval: 2 }, dueTime: "18:30" });
		expect(m.rule.weekdays).toContain(1);
	});

	it("explains a missing name instead of adding", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		expect(screen.getByText("Give it a name")).toBeInTheDocument();
		expect(engine.enqueue).not.toHaveBeenCalled();
	});
});
```

Run: `pnpm --filter @tagteam/web test` → FAIL (modules missing).

- [ ] **Step 2: Implement the draft model**

`apps/web/src/features/add-task/draft.ts`:
```ts
import { type LocalDate, MAX_INTERVAL, MAX_TITLE, type Mutation, type Rule, type Weekday, weekdayOf } from "@tagteam/core";

export type Repeat = "once" | "daily" | "weekly" | "monthly" | "custom";
export type Unit = "day" | "week" | "month";

export interface TaskDraft {
	title: string;
	repeat: Repeat;
	every: number;
	unit: Unit;
	weekdays: Weekday[];
	monthDay: number | "last";
	startDate: LocalDate;
	dueTime: string | null;
}

export const newDraft = (today: LocalDate): TaskDraft => ({
	title: "",
	repeat: "once",
	every: 1,
	unit: "day",
	weekdays: [],
	monthDay: Number(today.slice(8)),
	startDate: today,
	dueTime: null,
});

export function draftRule(d: TaskDraft): Rule | null {
	const startWeekday = weekdayOf(d.startDate);
	switch (d.repeat) {
		case "once":
			return null;
		case "daily":
			return { freq: "day", interval: 1 };
		case "weekly":
			return { freq: "week", interval: 1, weekdays: [startWeekday] };
		case "monthly":
			return { freq: "month", interval: 1, monthDay: Number(d.startDate.slice(8)) };
		case "custom":
			if (d.unit === "day") return { freq: "day", interval: d.every };
			if (d.unit === "week") {
				const weekdays = d.weekdays.length > 0 ? [...d.weekdays].sort((a, b) => a - b) : [startWeekday];
				return { freq: "week", interval: d.every, weekdays };
			}
			return { freq: "month", interval: d.every, monthDay: d.monthDay };
	}
}

export function draftErrors(d: TaskDraft): { title?: string; every?: string } {
	const errors: { title?: string; every?: string } = {};
	const length = d.title.trim().length;
	if (length < 1 || length > MAX_TITLE) errors.title = "Give it a name";
	if (d.repeat === "custom" && (!Number.isInteger(d.every) || d.every < 1 || d.every > MAX_INTERVAL)) {
		errors.every = `Enter a number from 1 to ${MAX_INTERVAL}`;
	}
	return errors;
}

export function draftMutation(d: TaskDraft, ctx: { groupId: string; timezone: string; at: number }): Mutation {
	return {
		id: crypto.randomUUID(),
		at: ctx.at,
		type: "task.create",
		taskId: crypto.randomUUID(),
		groupId: ctx.groupId,
		title: d.title.trim(),
		notes: null,
		timezone: ctx.timezone,
		startDate: d.startDate,
		dueTime: d.dueTime,
		rule: draftRule(d),
	};
}
```
(`MAX_INTERVAL` and `MAX_TITLE` are exported by `@tagteam/core`.)

- [ ] **Step 3: Implement the sheet**

`apps/web/src/features/add-task/AddTaskSheet.tsx`:
```tsx
import type { Weekday } from "@tagteam/core";
import { CalendarDays, Clock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { browserTimeZone, formatWhen, localDate } from "../../lib/time";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";
import { draftErrors, draftMutation, newDraft, type Repeat, type TaskDraft, type Unit } from "./draft";

const REPEATS: { value: Repeat; label: string }[] = [
	{ value: "once", label: "Once" },
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "custom", label: "Custom" },
];
const WEEKDAYS: { value: Weekday; short: string; name: string }[] = [
	{ value: 1, short: "M", name: "Monday" },
	{ value: 2, short: "T", name: "Tuesday" },
	{ value: 3, short: "W", name: "Wednesday" },
	{ value: 4, short: "T", name: "Thursday" },
	{ value: 5, short: "F", name: "Friday" },
	{ value: 6, short: "S", name: "Saturday" },
	{ value: 7, short: "S", name: "Sunday" },
];
const selectClass = "min-h-11 rounded-xl bg-surface px-3 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-accent";

export function AddTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { engine, activeGroupId } = useSession();
	const toast = useToast();
	const today = localDate(Date.now());
	const [draft, setDraft] = useState<TaskDraft>(() => newDraft(today));
	const [errors, setErrors] = useState<ReturnType<typeof draftErrors>>({});
	const [showDate, setShowDate] = useState(false);
	const update = (patch: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...patch }));
	const close = () => {
		setDraft(newDraft(today));
		setErrors({});
		setShowDate(false);
		onClose();
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const problems = draftErrors(draft);
		setErrors(problems);
		if (Object.keys(problems).length > 0 || !activeGroupId) return;
		await engine.enqueue(draftMutation(draft, { groupId: activeGroupId, timezone: browserTimeZone(), at: Date.now() }));
		toast.show({ message: `Added · ${draft.title.trim()}` });
		close();
	};

	const startLabel = draft.startDate === today ? "Starts today" : `Starts ${formatWhen(Date.parse(`${draft.startDate}T12:00:00`), Date.now()).toLowerCase()}`;

	return (
		<Sheet open={open} onClose={close} label="Add task">
			<form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<label htmlFor="task-title" className="sr-only">
						Task
					</label>
					<input
						id="task-title"
						autoFocus
						enterKeyHint="done"
						placeholder="Brush teeth"
						value={draft.title}
						onChange={(e) => update({ title: e.target.value })}
						aria-invalid={errors.title ? true : undefined}
						aria-describedby={errors.title ? "task-title-error" : undefined}
						className="min-h-12 border-b-2 border-accent bg-transparent text-xl outline-none placeholder:text-text-3"
					/>
					{errors.title ? (
						<p id="task-title-error" className="text-[13px] text-danger">
							{errors.title}
						</p>
					) : null}
				</div>

				<div>
					<p id="repeat-label" className="mb-2 text-[13px] font-medium text-text-2">
						Repeat
					</p>
					<div role="radiogroup" aria-labelledby="repeat-label" className="flex flex-wrap gap-2">
						{REPEATS.map((r) => (
							<Chip key={r.value} selected={draft.repeat === r.value} onClick={() => update({ repeat: r.value })}>
								{r.label}
							</Chip>
						))}
					</div>
				</div>

				{draft.repeat === "custom" ? (
					<div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
						<div className="flex items-center gap-2">
							<label htmlFor="every" className="text-[15px]">
								Every
							</label>
							<input
								id="every"
								type="number"
								inputMode="numeric"
								min={1}
								max={366}
								value={Number.isNaN(draft.every) ? "" : draft.every}
								onChange={(e) => update({ every: e.target.valueAsNumber })}
								className={`${selectClass} w-20 text-center`}
							/>
							<label htmlFor="unit" className="sr-only">
								Unit
							</label>
							<select id="unit" value={draft.unit} onChange={(e) => update({ unit: e.target.value as Unit })} className={selectClass}>
								<option value="day">days</option>
								<option value="week">weeks</option>
								<option value="month">months</option>
							</select>
						</div>
						{errors.every ? <p className="text-[13px] text-danger">{errors.every}</p> : null}
						{draft.unit === "week" ? (
							<div className="flex justify-between">
								{WEEKDAYS.map((d) => {
									const on = draft.weekdays.includes(d.value);
									return (
										<button
											key={d.value}
											type="button"
											aria-label={d.name}
											aria-pressed={on}
											onClick={() => update({ weekdays: on ? draft.weekdays.filter((w) => w !== d.value) : [...draft.weekdays, d.value] })}
											className={`size-10 rounded-full text-[14px] font-medium ${on ? "bg-accent text-on-accent" : "bg-surface ring-1 ring-line"}`}
										>
											{d.short}
										</button>
									);
								})}
							</div>
						) : null}
						{draft.unit === "month" ? (
							<div className="flex items-center gap-2">
								<label htmlFor="month-day" className="text-[15px]">
									On
								</label>
								<select
									id="month-day"
									value={String(draft.monthDay)}
									onChange={(e) => update({ monthDay: e.target.value === "last" ? "last" : Number(e.target.value) })}
									className={selectClass}
								>
									{Array.from({ length: 31 }, (_, i) => (
										<option key={i + 1} value={i + 1}>
											Day {i + 1}
										</option>
									))}
									<option value="last">Last day</option>
								</select>
							</div>
						) : null}
					</div>
				) : null}

				<div className="flex flex-wrap items-center gap-2">
					<Chip role="checkbox" selected={showDate} onClick={() => setShowDate((v) => !v)}>
						<CalendarDays aria-hidden className="size-4" />
						{startLabel}
					</Chip>
					{draft.dueTime === null ? (
						<Button variant="secondary" className="rounded-full" onClick={() => update({ dueTime: "08:00" })}>
							<Clock aria-hidden className="size-4" />
							Add time
						</Button>
					) : (
						<div className="flex items-center gap-2">
							<label htmlFor="due-time" className="text-[14px] text-text-2">
								Due by
							</label>
							<input id="due-time" type="time" value={draft.dueTime} onChange={(e) => update({ dueTime: e.target.value || null })} className={selectClass} />
							<Button variant="ghost" onClick={() => update({ dueTime: null })}>
								Remove time
							</Button>
						</div>
					)}
				</div>
				{showDate ? (
					<div className="flex items-center gap-2">
						<label htmlFor="start-date" className="text-[14px] text-text-2">
							Start date
						</label>
						<input
							id="start-date"
							type="date"
							value={draft.startDate}
							onChange={(e) => e.target.value && update({ startDate: e.target.value, monthDay: Number(e.target.value.slice(8)) })}
							className={selectClass}
						/>
					</div>
				) : null}

				<Button type="submit" variant="primary" block>
					Add task
				</Button>
			</form>
		</Sheet>
	);
}
```

- [ ] **Step 4: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src/features/add-task
git commit -m "feat(web): add the add-task sheet with repeat options"
```

---

### Task 8: Sign in, sign up, passkeys and the session gate

**Files:**
- Create: `apps/web/src/session/boot.ts`, `apps/web/src/session/SessionGate.tsx`, `apps/web/src/features/auth/SignInScreen.tsx`, `SignUpScreen.tsx`, `AddPasskeyScreen.tsx`, `apps/web/src/features/me/MeScreen.tsx`, `apps/web/src/features/placeholder/ComingSoon.tsx`, `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx`, `apps/web/src/main.tsx`
- Test: `apps/web/src/session/boot.test.ts`, `apps/web/src/features/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` + errors, `authClient` (Task 4); store; engine + `httpSyncApi` + `startSyncTriggers`; `Session`/`SessionContext` (Task 6); AppShell, SyncChip, Banner, Toast (Task 5); `TodayScreen`, `AddTaskSheet`.
- Produces:
  - `boot.ts`: `type BootResult = { phase: "ready"; me: MeResponse; online: boolean } | { phase: "signedOut" } | { phase: "offline" }`, `boot(store: TagTeamDb): Promise<BootResult>` — fetches `/api/me`; on success clears the store if the cached `me` belongs to another user, caches `me`, sets `activeGroupId` to `pendingActiveGroupId ?? me.profile.activeGroupId`, and PATCHes `timezone` when it differs from `browserTimeZone()` (errors ignored); `401` → `signedOut`; offline/Access errors → `ready` with the cached `me` (`online: false`) or `offline` when nothing is cached.
  - `SessionGate` — runs `boot`, renders a splash while loading, redirects to `/sign-in` when signed out, shows "You're offline" with **Try again** when there is no cached session, otherwise creates the engine (`createSyncEngine({ store: db, api: httpSyncApi, me: { userId } })`), starts triggers, and provides `SessionContext` + `ToastProvider` around `<Outlet />`. `setActiveGroup(id)` writes `activeGroupId` and `pendingActiveGroupId` to meta then PATCHes `/api/me`; pending is cleared on success and retried whenever the engine returns to `idle`. `refreshMe()` refetches `/api/me` and caches it. `signOut()` calls `authClient.signOut()`, disposes the engine, clears the store and goes to `/sign-in`.
  - `MainLayout` (in `router.tsx`) — `AppShell` with title = active group name (the group switcher button arrives in Task 9; until then plain text), `trailing` = `SyncChip`, `banner` = "Your session expired" + **Reconnect** (`location.reload()`) when the engine state is `reauth`, `onAdd` opens `AddTaskSheet`, `<Outlet context={{ openAdd }} />`; redirects to `/welcome` when the user has no groups (Task 9 adds that screen; until then route `/welcome` renders `ComingSoon`).
  - Routes: `/sign-in`, `/sign-up` (public); inside `SessionGate`: `/passkey`, `/welcome`, and `MainLayout` with `/` → Today, `/team`, `/history` → `ComingSoon`, `/me` → `MeScreen`.
  - `MeScreen` — shows name + email, **Add a passkey** (`authClient.passkey.addPasskey()`, toast on success/failure) and **Sign out**.
  - Auth screens: Sign in (email, password, **Sign in**, **Use a passkey**, link "Create an account"); Sign up (name, email, password with hint "At least 10 characters", **Create account**, link "I already have an account"); after sign-up → `/passkey` ("Sign in faster next time" — **Add passkey** / **Not now**). After a successful sign-in/sign-up/passkey: `window.location.assign("/")` (fresh boot). Errors from Better Auth (`{ error }` results) are shown under the form.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/session/boot.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, OfflineError } from "../lib/api";
import { getMeta, setMeta, TagTeamDb } from "../store/db";
import { ME } from "../test/fakes";
import { boot } from "./boot";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), apiFetch }));

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	apiFetch.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("boot", () => {
	it("caches the signed-in user and their active group", async () => {
		apiFetch.mockResolvedValue({ ...ME, profile: { ...ME.profile, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
		expect(await boot(store)).toMatchObject({ phase: "ready", online: true });
		expect((await getMeta<typeof ME>(store, "me"))?.user.id).toBe("u1");
		expect(await getMeta(store, "activeGroupId")).toBe("g1");
	});

	it("clears another user's data", async () => {
		await setMeta(store, "me", { ...ME, user: { ...ME.user, id: "someone-else" } });
		await store.groups.put({ id: "old", name: "Old" });
		apiFetch.mockResolvedValue(ME);
		await boot(store);
		expect(await store.groups.count()).toBe(0);
	});

	it("keeps working offline with a cached session", async () => {
		await setMeta(store, "me", ME);
		apiFetch.mockRejectedValue(new OfflineError());
		expect(await boot(store)).toMatchObject({ phase: "ready", online: false });
	});

	it("reports offline without a cached session, and signed out on 401", async () => {
		apiFetch.mockRejectedValue(new OfflineError());
		expect(await boot(store)).toEqual({ phase: "offline" });
		apiFetch.mockRejectedValue(new ApiError(401, "unauthorized", "Sign in first."));
		expect(await boot(store)).toEqual({ phase: "signedOut" });
	});

	it("updates the profile timezone to the browser's", async () => {
		apiFetch.mockResolvedValueOnce({ ...ME, profile: { ...ME.profile, timezone: "Pacific/Chatham" } }).mockResolvedValue({});
		await boot(store);
		expect(apiFetch).toHaveBeenCalledWith("/api/me", { method: "PATCH", body: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
	});
});
```

`apps/web/src/features/auth/auth.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInScreen } from "./SignInScreen";
import { SignUpScreen } from "./SignUpScreen";

const auth = vi.hoisted(() => ({
	signIn: { email: vi.fn(), passkey: vi.fn() },
	signUp: { email: vi.fn() },
}));
vi.mock("../../lib/auth", () => ({ authClient: auth }));

const assign = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("location", { ...window.location, assign });
});

const renderAt = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("sign in", () => {
	it("signs in with email and password", async () => {
		auth.signIn.email.mockResolvedValue({ data: {}, error: null });
		renderAt(<SignInScreen />);
		await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(auth.signIn.email).toHaveBeenCalledWith({ email: "sam@example.com", password: "correct-horse-battery" });
		expect(assign).toHaveBeenCalledWith("/");
	});

	it("shows the server's error", async () => {
		auth.signIn.email.mockResolvedValue({ data: null, error: { message: "Invalid email or password" } });
		renderAt(<SignInScreen />);
		await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
		expect(assign).not.toHaveBeenCalled();
	});

	it("signs in with a passkey", async () => {
		auth.signIn.passkey.mockResolvedValue({ data: {}, error: null });
		renderAt(<SignInScreen />);
		await userEvent.click(screen.getByRole("button", { name: "Use a passkey" }));
		expect(auth.signIn.passkey).toHaveBeenCalled();
		expect(assign).toHaveBeenCalledWith("/");
	});
});

describe("sign up", () => {
	it("creates an account and offers a passkey", async () => {
		auth.signUp.email.mockResolvedValue({ data: {}, error: null });
		renderAt(<SignUpScreen />);
		await userEvent.type(screen.getByLabelText("Name"), "Sam");
		await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery");
		await userEvent.click(screen.getByRole("button", { name: "Create account" }));
		expect(auth.signUp.email).toHaveBeenCalledWith({ name: "Sam", email: "sam@example.com", password: "correct-horse-battery" });
		expect(assign).toHaveBeenCalledWith("/passkey");
	});

	it("checks the password length before sending", async () => {
		renderAt(<SignUpScreen />);
		await userEvent.type(screen.getByLabelText("Name"), "Sam");
		await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "short");
		await userEvent.click(screen.getByRole("button", { name: "Create account" }));
		expect(screen.getByText("At least 10 characters")).toHaveClass("text-danger");
		expect(auth.signUp.email).not.toHaveBeenCalled();
	});
});
```

Replace `apps/web/src/app/App.test.tsx` with:
```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());

it("sends signed-out visitors to sign in", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { code: "unauthorized", message: "Sign in first." } }), {
				status: 401,
				headers: { "content-type": "application/json" },
			}),
		),
	);
	window.history.pushState({}, "", "/");
	render(<App />);
	expect(await screen.findByRole("heading", { name: "Sign in to TagTeam" })).toBeInTheDocument();
});
```

Run: `pnpm --filter @tagteam/web test` → FAIL.

- [ ] **Step 2: Implement boot**

`apps/web/src/session/boot.ts`:
```ts
import type { MeResponse } from "@tagteam/core";
import { ApiError, apiFetch } from "../lib/api";
import { browserTimeZone } from "../lib/time";
import { clearStore, getMeta, setMeta, type TagTeamDb } from "../store/db";

export type BootResult = { phase: "ready"; me: MeResponse; online: boolean } | { phase: "signedOut" } | { phase: "offline" };

export async function boot(store: TagTeamDb): Promise<BootResult> {
	const cached = await getMeta<MeResponse>(store, "me");
	let me: MeResponse;
	try {
		me = await apiFetch<MeResponse>("/api/me");
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) return { phase: "signedOut" };
		return cached ? { phase: "ready", me: cached, online: false } : { phase: "offline" };
	}
	if (cached && cached.user.id !== me.user.id) await clearStore(store);
	await setMeta(store, "me", me);
	const pending = await getMeta<string>(store, "pendingActiveGroupId");
	await setMeta(store, "activeGroupId", pending ?? me.profile.activeGroupId);
	const timezone = browserTimeZone();
	if (me.profile.timezone !== timezone) {
		apiFetch("/api/me", { method: "PATCH", body: { timezone } }).catch(() => {});
	}
	return { phase: "ready", me, online: true };
}
```

- [ ] **Step 3: Implement the gate, screens and router**

`apps/web/src/session/SessionGate.tsx`:
```tsx
import type { MeResponse } from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router";
import { apiFetch } from "../lib/api";
import { authClient } from "../lib/auth";
import { clearStore, db, getMeta, setMeta } from "../store/db";
import { createSyncEngine } from "../sync/engine";
import { httpSyncApi } from "../sync/http-api";
import { startSyncTriggers } from "../sync/triggers";
import { Button } from "../ui/Button";
import { ToastProvider } from "../ui/Toast";
import { type BootResult, boot } from "./boot";
import { type Session, SessionContext } from "./session";

function Splash() {
	return <div className="flex min-h-dvh items-center justify-center text-text-3">TagTeam</div>;
}

function SignedIn({ initialMe }: { initialMe: MeResponse }) {
	const navigate = useNavigate();
	const [me, setMe] = useState(initialMe);
	const engine = useMemo(() => createSyncEngine({ store: db, api: httpSyncApi, me: { userId: initialMe.user.id } }), [initialMe.user.id]);
	const activeGroupId = useLiveQuery(() => getMeta<string | null>(db, "activeGroupId"), [], undefined) ?? null;

	const flushActiveGroup = useCallback(async () => {
		const pending = await getMeta<string>(db, "pendingActiveGroupId");
		if (!pending) return;
		try {
			await apiFetch("/api/me", { method: "PATCH", body: { activeGroupId: pending } });
			await db.meta.delete("pendingActiveGroupId");
		} catch {
			// Retried the next time sync succeeds.
		}
	}, []);

	useEffect(() => {
		const stopTriggers = startSyncTriggers(engine);
		const stopListening = engine.subscribe((s) => {
			if (s.state === "idle") void flushActiveGroup();
		});
		void engine.sync();
		return () => {
			stopTriggers();
			stopListening();
			engine.dispose();
		};
	}, [engine, flushActiveGroup]);

	const session: Session = {
		me,
		store: db,
		engine,
		activeGroupId,
		async setActiveGroup(id) {
			await setMeta(db, "activeGroupId", id);
			await setMeta(db, "pendingActiveGroupId", id);
			await flushActiveGroup();
		},
		async refreshMe() {
			const next = await apiFetch<MeResponse>("/api/me");
			await setMeta(db, "me", next);
			setMe(next);
			return next;
		},
		async signOut() {
			await authClient.signOut().catch(() => {});
			engine.dispose();
			await clearStore(db);
			navigate("/sign-in", { replace: true });
		},
	};

	return (
		<SessionContext.Provider value={session}>
			<ToastProvider>
				<Outlet />
			</ToastProvider>
		</SessionContext.Provider>
	);
}

export function SessionGate() {
	const [result, setResult] = useState<BootResult | null>(null);
	const run = useCallback(() => {
		setResult(null);
		void boot(db).then(setResult);
	}, []);
	useEffect(run, [run]);

	if (!result) return <Splash />;
	if (result.phase === "signedOut") return <Navigate to="/sign-in" replace />;
	if (result.phase === "offline") {
		return (
			<div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
				<p className="text-lg font-semibold">You're offline</p>
				<p className="text-[14px] text-text-2">Connect once to sign in. After that TagTeam works offline.</p>
				<Button variant="primary" onClick={run}>
					Try again
				</Button>
			</div>
		);
	}
	return <SignedIn initialMe={result.me} />;
}
```

`apps/web/src/features/auth/SignInScreen.tsx`:
```tsx
import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { authClient } from "../../lib/auth";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";

export function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
			<div className="flex flex-col items-center gap-3 text-center">
				<img src="/icon.svg" alt="" className="size-14 rounded-2xl" />
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			</div>
			{children}
		</div>
	);
}

export function SignInScreen() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"password" | "passkey" | null>(null);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy("password");
		const result = await authClient.signIn.email({ email, password });
		setBusy(null);
		if (result.error) return setError(result.error.message ?? "Couldn't sign in. Try again.");
		window.location.assign("/");
	};
	const passkey = async () => {
		setBusy("passkey");
		const result = await authClient.signIn.passkey();
		setBusy(null);
		if (result?.error) return setError(result.error.message ?? "Couldn't use a passkey. Try your password.");
		window.location.assign("/");
	};

	return (
		<AuthLayout title="Sign in to TagTeam">
			<form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
				<TextField label="Email" type="email" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} />
				<TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
				{error ? (
					<p role="alert" className="text-[14px] text-danger">
						{error}
					</p>
				) : null}
				<Button type="submit" variant="primary" block busy={busy === "password"}>
					Sign in
				</Button>
			</form>
			<Button variant="secondary" block busy={busy === "passkey"} onClick={() => void passkey()}>
				<KeyRound aria-hidden className="size-4" />
				Use a passkey
			</Button>
			<p className="text-center text-[14px] text-text-2">
				New here?{" "}
				<Link to="/sign-up" className="font-medium text-accent">
					Create an account
				</Link>
			</p>
		</AuthLayout>
	);
}
```

`apps/web/src/features/auth/SignUpScreen.tsx`:
```tsx
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { authClient } from "../../lib/auth";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { AuthLayout } from "./SignInScreen";

const MIN_PASSWORD = 10;

export function SignUpScreen() {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [tooShort, setTooShort] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (password.length < MIN_PASSWORD) return setTooShort(true);
		setBusy(true);
		const result = await authClient.signUp.email({ name: name.trim(), email, password });
		setBusy(false);
		if (result.error) return setError(result.error.message ?? "Couldn't create your account. Try again.");
		window.location.assign("/passkey");
	};

	return (
		<AuthLayout title="Create your account">
			<form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
				<TextField label="Name" autoComplete="given-name" required value={name} onChange={(e) => setName(e.target.value)} />
				<TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
				<TextField
					label="Password"
					type="password"
					autoComplete="new-password"
					required
					value={password}
					onChange={(e) => {
						setPassword(e.target.value);
						setTooShort(false);
					}}
					hint={tooShort ? undefined : "At least 10 characters"}
					error={tooShort ? "At least 10 characters" : undefined}
				/>
				{error ? (
					<p role="alert" className="text-[14px] text-danger">
						{error}
					</p>
				) : null}
				<Button type="submit" variant="primary" block busy={busy}>
					Create account
				</Button>
			</form>
			<p className="text-center text-[14px] text-text-2">
				<Link to="/sign-in" className="font-medium text-accent">
					I already have an account
				</Link>
			</p>
		</AuthLayout>
	);
}
```

`apps/web/src/features/auth/AddPasskeyScreen.tsx`:
```tsx
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { authClient } from "../../lib/auth";
import { Button } from "../../ui/Button";
import { AuthLayout } from "./SignInScreen";

export function AddPasskeyScreen() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const add = async () => {
		setBusy(true);
		const result = await authClient.passkey.addPasskey();
		setBusy(false);
		if (result?.error) return setError(result.error.message ?? "Couldn't add a passkey. You can try again from Me.");
		navigate("/", { replace: true });
	};
	return (
		<AuthLayout title="Sign in faster next time">
			<p className="text-center text-[15px] text-text-2">Use Face ID, Touch ID or your screen lock instead of typing a password.</p>
			{error ? (
				<p role="alert" className="text-center text-[14px] text-danger">
					{error}
				</p>
			) : null}
			<Button variant="primary" block busy={busy} onClick={() => void add()}>
				<Fingerprint aria-hidden className="size-5" />
				Add passkey
			</Button>
			<Button variant="ghost" block onClick={() => navigate("/", { replace: true })}>
				Not now
			</Button>
		</AuthLayout>
	);
}
```

`apps/web/src/features/placeholder/ComingSoon.tsx`:
```tsx
export function ComingSoon({ title }: { title: string }) {
	return (
		<div className="mt-20 text-center">
			<h1 className="text-xl font-semibold">{title}</h1>
			<p className="mt-2 text-[14px] text-text-2">Coming in the next update.</p>
		</div>
	);
}
```

`apps/web/src/features/me/MeScreen.tsx`:
```tsx
import { Fingerprint, LogOut } from "lucide-react";
import { authClient } from "../../lib/auth";
import { useSession } from "../../session/session";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";

export function MeScreen() {
	const { me, signOut } = useSession();
	const toast = useToast();
	const addPasskey = async () => {
		const result = await authClient.passkey.addPasskey();
		toast.show({ message: result?.error ? "Couldn't add a passkey." : "Passkey added." });
	};
	return (
		<div className="mt-4 flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<Avatar name={me.profile.displayName} color={me.profile.avatarColor} />
				<div className="min-w-0">
					<p className="truncate text-lg font-semibold">{me.profile.displayName}</p>
					<p className="truncate text-[14px] text-text-2">{me.user.email}</p>
				</div>
			</div>
			<div className="flex flex-col gap-3">
				<Button block onClick={() => void addPasskey()}>
					<Fingerprint aria-hidden className="size-5" />
					Add a passkey
				</Button>
				<Button variant="danger" block onClick={() => void signOut()}>
					<LogOut aria-hidden className="size-5" />
					Sign out
				</Button>
			</div>
		</div>
	);
}
```

`apps/web/src/app/router.tsx`:
```tsx
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AddTaskSheet } from "../features/add-task/AddTaskSheet";
import { AddPasskeyScreen } from "../features/auth/AddPasskeyScreen";
import { SignInScreen } from "../features/auth/SignInScreen";
import { SignUpScreen } from "../features/auth/SignUpScreen";
import { MeScreen } from "../features/me/MeScreen";
import { ComingSoon } from "../features/placeholder/ComingSoon";
import { TodayScreen } from "../features/today/TodayScreen";
import { SessionGate } from "../session/SessionGate";
import { useSession } from "../session/session";
import { useSyncStatus } from "../sync/use-sync-status";
import { Banner } from "../ui/Banner";
import { AppShell } from "./AppShell";
import { SyncChip } from "./SyncChip";

function MainLayout() {
	const { me, store, engine, activeGroupId, setActiveGroup } = useSession();
	const status = useSyncStatus(engine);
	const [adding, setAdding] = useState(false);
	const openAdd = useCallback(() => setAdding(true), []);
	const closeAdd = useCallback(() => setAdding(false), []);
	const localGroups = useLiveQuery(() => store.groups.toArray(), [store]);
	const groups = localGroups && localGroups.length > 0 ? localGroups : me.groups;
	const active = groups.find((g) => g.id === activeGroupId) ?? groups[0];
	// No stored active group (or it was left): fall back to the first group, persisted like a manual switch.
	useEffect(() => {
		if (localGroups !== undefined && active && active.id !== activeGroupId) void setActiveGroup(active.id);
	}, [localGroups, active, activeGroupId, setActiveGroup]);
	if (localGroups === undefined) return null;
	if (!active) return <Navigate to="/welcome" replace />;

	return (
		<AppShell
			title={<span className="truncate text-[17px] font-semibold">{active?.name}</span>}
			trailing={<SyncChip status={status} />}
			banner={
				status.state === "reauth" ? (
					<Banner tone="warning" action={{ label: "Reconnect", onClick: () => window.location.reload() }}>
						Your session expired.
					</Banner>
				) : null
			}
			onAdd={openAdd}
		>
			<Outlet context={{ openAdd }} />
			<AddTaskSheet open={adding} onClose={closeAdd} />
		</AppShell>
	);
}

export const router = createBrowserRouter([
	{ path: "/sign-in", element: <SignInScreen /> },
	{ path: "/sign-up", element: <SignUpScreen /> },
	{
		element: <SessionGate />,
		children: [
			{ path: "/passkey", element: <AddPasskeyScreen /> },
			{ path: "/welcome", element: <ComingSoon title="Welcome" /> },
			{
				element: <MainLayout />,
				children: [
					{ index: true, element: <TodayScreen /> },
					{ path: "team", element: <ComingSoon title="Team" /> },
					{ path: "history", element: <ComingSoon title="History" /> },
					{ path: "me", element: <MeScreen /> },
				],
			},
		],
	},
	{ path: "*", element: <Navigate to="/" replace /> },
]);

```

`apps/web/src/app/App.tsx`:
```tsx
import { RouterProvider } from "react-router";
import { router } from "./router";

export function App() {
	return <RouterProvider router={router} />;
}
```

- [ ] **Step 4: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src
git commit -m "feat(web): add sign-in, sign-up, passkeys and the offline-aware session gate"
```

---

### Task 9: Welcome (create or join a group) and the group switcher

**Files:**
- Create: `apps/web/src/features/groups/WelcomeScreen.tsx`, `apps/web/src/features/groups/GroupSwitcher.tsx`
- Modify: `apps/web/src/app/router.tsx` (use both)
- Test: `apps/web/src/features/groups/groups.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError`, `OfflineError`; session (`refreshMe`, `setActiveGroup`, `engine`, `store`, `activeGroupId`); UI kit.
- Produces:
  - `WelcomeScreen` at `/welcome` (`?mode=create|join` preselects; default shows both): **Create a group** (name 1–40, "Create group") → `POST /api/groups`; **Join with a code** (6-digit `inputMode="numeric"`, `autoComplete="one-time-code"`, "Join group") → `POST /api/invites/redeem`. On success: `refreshMe()`, `setActiveGroup(group.id)`, `engine.sync()`, navigate `/`. Error copy: `invalid_code` → "That code isn't valid. Ask for a new one.", `rate_limited` → "Too many tries. Wait a minute and try again.", `already_member` → "You're already in this group.", offline → "You need to be online to create or join a group.", `invalid_request` → the server's first detail. Shows a "Back" link to `/` only when the user already has a group.
  - `GroupSwitcher` — header button: active group name + chevron (`aria-haspopup="dialog"`); opens a `Sheet` "Your groups" listing groups (radio semantics, check icon on active), tap → `setActiveGroup` and close; **Create group** → `/welcome?mode=create`; **Join with code** → `/welcome?mode=join`.
  - `router.tsx`: `/welcome` → `WelcomeScreen`; `MainLayout` title → `<GroupSwitcher groups={groups} activeId={active.id} />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/groups/groups.test.tsx`:
```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, OfflineError } from "../../lib/api";
import { fakeEngine, renderWithSession } from "../../test/fakes";
import { GroupSwitcher } from "./GroupSwitcher";
import { WelcomeScreen } from "./WelcomeScreen";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), apiFetch }));

beforeEach(() => apiFetch.mockReset());

describe("WelcomeScreen", () => {
	it("creates a group and makes it active", async () => {
		apiFetch.mockResolvedValue({ group: { id: "g9", name: "Flat 4" } });
		const engine = fakeEngine();
		const { session } = renderWithSession(<WelcomeScreen />, { engine }, "/welcome?mode=create");
		await userEvent.type(screen.getByLabelText("Group name"), "Flat 4");
		await userEvent.click(screen.getByRole("button", { name: "Create group" }));
		expect(apiFetch).toHaveBeenCalledWith("/api/groups", { method: "POST", body: { name: "Flat 4" } });
		expect(session.setActiveGroup).toHaveBeenCalledWith("g9");
		expect(engine.sync).toHaveBeenCalled();
	});

	it("joins with a code and explains bad codes", async () => {
		apiFetch.mockRejectedValueOnce(new ApiError(404, "invalid_code", "That code isn't valid."));
		renderWithSession(<WelcomeScreen />, {}, "/welcome?mode=join");
		await userEvent.type(screen.getByLabelText("Invite code"), "123456");
		await userEvent.click(screen.getByRole("button", { name: "Join group" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't valid. Ask for a new one.");
		expect(apiFetch).toHaveBeenCalledWith("/api/invites/redeem", { method: "POST", body: { code: "123456" } });
	});

	it("says when you need to be online", async () => {
		apiFetch.mockRejectedValueOnce(new OfflineError());
		renderWithSession(<WelcomeScreen />, {}, "/welcome?mode=create");
		await userEvent.type(screen.getByLabelText("Group name"), "Flat 4");
		await userEvent.click(screen.getByRole("button", { name: "Create group" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("You need to be online to create or join a group.");
	});
});

describe("GroupSwitcher", () => {
	it("switches the active group", async () => {
		const { session } = renderWithSession(
			<GroupSwitcher groups={[{ id: "g1", name: "Smiths" }, { id: "g2", name: "Work" }]} activeId="g1" />,
		);
		await userEvent.click(screen.getByRole("button", { name: /Smiths/ }));
		expect(screen.getByRole("radio", { name: "Smiths" })).toHaveAttribute("aria-checked", "true");
		await userEvent.click(screen.getByRole("radio", { name: "Work" }));
		expect(session.setActiveGroup).toHaveBeenCalledWith("g2");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});
```

Run: `pnpm --filter @tagteam/web test` → FAIL.

- [ ] **Step 2: Implement**

`apps/web/src/features/groups/WelcomeScreen.tsx`:
```tsx
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError, apiFetch, OfflineError } from "../../lib/api";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";

const MESSAGES: Record<string, string> = {
	invalid_code: "That code isn't valid. Ask for a new one.",
	rate_limited: "Too many tries. Wait a minute and try again.",
	already_member: "You're already in this group.",
};

function describe(err: unknown): string {
	if (err instanceof OfflineError) return "You need to be online to create or join a group.";
	if (err instanceof ApiError) return MESSAGES[err.code] ?? err.details?.[0] ?? err.message;
	return "Something went wrong. Try again.";
}

export function WelcomeScreen() {
	const { me, engine, refreshMe, setActiveGroup } = useSession();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const mode = params.get("mode");
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<{ form: "create" | "join"; message: string } | null>(null);
	const [busy, setBusy] = useState<"create" | "join" | null>(null);

	const finish = async (groupId: string) => {
		await refreshMe().catch(() => undefined);
		await setActiveGroup(groupId);
		void engine.sync();
		navigate("/", { replace: true });
	};
	const run = async (form: "create" | "join", action: () => Promise<{ group: { id: string } }>) => {
		setError(null);
		setBusy(form);
		try {
			const { group } = await action();
			await finish(group.id);
		} catch (err) {
			setError({ form, message: describe(err) });
		} finally {
			setBusy(null);
		}
	};
	const create = (e: FormEvent) => {
		e.preventDefault();
		void run("create", () => apiFetch("/api/groups", { method: "POST", body: { name: name.trim() } }));
	};
	const join = (e: FormEvent) => {
		e.preventDefault();
		void run("join", () => apiFetch("/api/invites/redeem", { method: "POST", body: { code } }));
	};
	const errorFor = (form: "create" | "join") =>
		error?.form === form ? (
			<p role="alert" className="text-[14px] text-danger">
				{error.message}
			</p>
		) : null;

	return (
		<div className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
			{me.groups.length > 0 ? (
				<Link to="/" className="min-h-11 self-start py-2 text-[15px] font-medium text-accent">
					Back
				</Link>
			) : null}
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Start a group or join one</h1>
				<p className="mt-1 text-[15px] text-text-2">Everyone in a group can see each other's tasks.</p>
			</div>
			{mode !== "join" ? (
				<form onSubmit={create} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
					<h2 className="font-semibold">Create a group</h2>
					<TextField label="Group name" placeholder="Smith family" maxLength={40} required value={name} onChange={(e) => setName(e.target.value)} />
					{errorFor("create")}
					<Button type="submit" variant="primary" block busy={busy === "create"}>
						Create group
					</Button>
				</form>
			) : null}
			{mode !== "create" ? (
				<form onSubmit={join} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
					<h2 className="font-semibold">Join with a code</h2>
					<TextField
						label="Invite code"
						inputMode="numeric"
						autoComplete="one-time-code"
						pattern="\d{6}"
						maxLength={6}
						placeholder="123456"
						required
						value={code}
						onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
						hint="Ask someone in the group for a 6-digit code."
					/>
					{errorFor("join")}
					<Button type="submit" variant={mode === "join" ? "primary" : "secondary"} block busy={busy === "join"}>
						Join group
					</Button>
				</form>
			) : null}
		</div>
	);
}
```

`apps/web/src/features/groups/GroupSwitcher.tsx`:
```tsx
import { Check, ChevronDown, Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";

export function GroupSwitcher({ groups, activeId }: { groups: { id: string; name: string }[]; activeId: string }) {
	const { setActiveGroup } = useSession();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const active = groups.find((g) => g.id === activeId);
	const go = (path: string) => {
		setOpen(false);
		navigate(path);
	};

	return (
		<>
			<button
				type="button"
				aria-haspopup="dialog"
				onClick={() => setOpen(true)}
				className="-ml-2 flex min-h-11 max-w-full items-center gap-1 rounded-xl px-2 text-[17px] font-semibold active:bg-surface-2"
			>
				<span className="truncate">{active?.name}</span>
				<ChevronDown aria-hidden className="size-4 shrink-0 text-text-2" />
			</button>
			<Sheet open={open} onClose={() => setOpen(false)} label="Your groups">
				<h2 className="mb-2 text-[13px] font-medium text-text-2">Your groups</h2>
				<div role="radiogroup" aria-label="Your groups" className="flex flex-col">
					{[...groups]
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((g) => (
							<button
								key={g.id}
								type="button"
								role="radio"
								aria-checked={g.id === activeId}
								aria-label={g.name}
								onClick={() => {
									void setActiveGroup(g.id);
									setOpen(false);
								}}
								className="flex min-h-12 items-center justify-between border-b border-line text-left text-[16px] last:border-0"
							>
								<span className="truncate">{g.name}</span>
								{g.id === activeId ? <Check aria-hidden className="size-5 text-accent" /> : null}
							</button>
						))}
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<Button block onClick={() => go("/welcome?mode=create")}>
						<Plus aria-hidden className="size-4" />
						Create group
					</Button>
					<Button block onClick={() => go("/welcome?mode=join")}>
						<Ticket aria-hidden className="size-4" />
						Join with code
					</Button>
				</div>
			</Sheet>
		</>
	);
}
```

Wire into `router.tsx`: import both; route `/welcome` → `<WelcomeScreen />`; in `MainLayout`, `title={<GroupSwitcher groups={groups} activeId={active.id} />}`.

- [ ] **Step 3: Verify and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`

```bash
git add apps/web/src
git commit -m "feat(web): create, join and switch groups"
```

---

### Task 10: Service worker, server serves the app, Docker, dev setup

**Files:**
- Create: `apps/web/src/sw.ts`, `apps/web/tsconfig.sw.json`, `apps/web/scripts/check-build.mjs`
- Modify: `apps/web/vite.config.ts`, `apps/web/package.json` (typecheck script), `apps/web/src/main.tsx`
- Modify: `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/app.ts`, `apps/server/src/server.ts`, `apps/server/src/test/harness.ts`, `apps/server/.env.example`, `apps/server/scripts/smoke.mjs`
- Create: `apps/server/src/static.test.ts`
- Modify: `Dockerfile`, `.github/workflows/ci.yml`, `.claude/launch.json`, `README.md`

**Interfaces:**
- Consumes: built `apps/web/dist`.
- Produces:
  - Service worker: precaches the build (`index.html`, JS, CSS, icons, manifest); navigation requests outside `/api/` fall back to precached `index.html`; `/api/*` is network-only; `skipWaiting` + `clientsClaim`. Registered only in production builds.
  - `Config.webDir?: string` (`WEB_DIR`); `AppDeps.webDir?: string`. When set, the server serves files from it for non-`/api` GET/HEAD requests: `/assets/*` with `cache-control: public, max-age=31536000, immutable`; everything else (incl. `sw.js`, `index.html`, `manifest.webmanifest`) with `cache-control: no-cache`; unknown non-API paths fall back to `index.html`. `/api/*` behaviour is unchanged (JSON 404s stay JSON).
  - `createTestContext(options?: { webDir?: string })`.
  - Docker image contains the built web app at `/app/web` (`WEB_DIR=/app/web`).
  - `smoke.mjs <baseUrl> [--web]`: with `--web`, also checks `GET /` returns HTML containing `<div id="root">`.

- [ ] **Step 1: Service worker**

`apps/web/src/sw.ts`:
```ts
/// <reference lib="webworker" />
import { NavigationRoute, NetworkOnly, type PrecacheEntry, type RuntimeCaching, Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] };

const runtimeCaching: RuntimeCaching[] = [
	// API calls always go to the network; the app handles offline itself.
	{ matcher: ({ url }) => url.pathname.startsWith("/api/"), handler: new NetworkOnly() },
];

const serwist = new Serwist({
	precacheEntries: self.__SW_MANIFEST,
	skipWaiting: true,
	clientsClaim: true,
	navigationPreload: true,
	runtimeCaching,
});

// Every app route (not the API) is served from the precached index.html, so the app opens offline.
serwist.registerCapture(new NavigationRoute(serwist.precacheStrategy, { denylist: [/^\/api\//] }));
serwist.addEventListeners();
```
If `NavigationRoute` needs a handler bound to `index.html` specifically in this Serwist version, use `serwist.createHandlerBoundToURL("/index.html")` (check `serwist`'s `.d.ts`); the requirement is that an offline navigation to `/team` renders the app.

`apps/web/tsconfig.sw.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "WebWorker"], "types": [] },
  "include": ["src/sw.ts"]
}
```
`apps/web/package.json` script: `"typecheck": "tsc -p . && tsc -p tsconfig.sw.json"`.

`apps/web/vite.config.ts` — add the plugin:
```ts
import { serwist } from "@serwist/vite";
// …
	plugins: [
		react(),
		tailwindcss(),
		serwist({
			swSrc: "src/sw.ts",
			swDest: "sw.js",
			globDirectory: "dist",
			globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
			injectionPoint: "self.__SW_MANIFEST",
		}),
	],
```

`apps/web/src/main.tsx` — after rendering:
```ts
if ("serviceWorker" in navigator && import.meta.env.PROD) {
	void import("@serwist/window").then(({ Serwist }) => new Serwist("/sw.js", { type: "classic" }).register());
}
```

`apps/web/scripts/check-build.mjs`:
```js
// Verifies a production build contains a service worker with a precache manifest and the web manifest.
import { existsSync, readFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const fail = (message) => {
	console.error(`check-build: ${message}`);
	process.exit(1);
};
const sw = new URL("sw.js", dist);
if (!existsSync(sw)) fail("dist/sw.js missing");
const source = readFileSync(sw, "utf8");
if (source.includes("self.__SW_MANIFEST")) fail("precache manifest was not injected");
if (!source.includes("index.html")) fail("index.html is not precached");
if (!existsSync(new URL("manifest.webmanifest", dist))) fail("dist/manifest.webmanifest missing");
console.log("check-build: ok");
```
Run: `pnpm --filter @tagteam/web build && node apps/web/scripts/check-build.mjs` → `check-build: ok`.

- [ ] **Step 2: Server serves the SPA — failing test**

`apps/server/src/static.test.ts`:
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestContext, signUp, type TestContext } from "./test/harness";

describe("serving the web app", () => {
	let dir: string;
	let ctx: TestContext;
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "tagteam-web-"));
		mkdirSync(join(dir, "assets"));
		writeFileSync(join(dir, "index.html"), '<!doctype html><div id="root"></div>');
		writeFileSync(join(dir, "sw.js"), "self.addEventListener('install', () => {});");
		writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
		ctx = createTestContext({ webDir: dir });
	});
	afterAll(() => {
		ctx.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("serves index.html for app routes without caching", async () => {
		for (const path of ["/", "/team", "/welcome?mode=join"]) {
			const res = await ctx.app.request(path);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('<div id="root">');
			expect(res.headers.get("cache-control")).toBe("no-cache");
		}
	});

	it("caches hashed assets forever and the service worker never", async () => {
		const asset = await ctx.app.request("/assets/app-abc123.js");
		expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		const sw = await ctx.app.request("/sw.js");
		expect(sw.status).toBe(200);
		expect(sw.headers.get("cache-control")).toBe("no-cache");
	});

	it("keeps API responses as JSON", async () => {
		expect((await ctx.app.request("/api/health")).headers.get("content-type")).toContain("application/json");
		const cookie = await signUp(ctx.app);
		const missing = await api(ctx.app, cookie, "GET", "/api/nope");
		expect(missing.status).toBe(404);
		expect(missing.headers.get("content-type")).toContain("application/json");
	});
});
```
Add to `apps/server/src/config.test.ts`: `expect(loadConfig({ AUTH_SECRET: secret, WEB_DIR: "/app/web" }).webDir).toBe("/app/web");`.

Run: `pnpm --filter @tagteam/server test -- src/static.test.ts` → FAIL.

- [ ] **Step 3: Server — implement**

- `config.ts`: add `/** Built web app to serve (production image); unset in development where Vite serves it. */ webDir?: string;` and `webDir: env.WEB_DIR,`.
- `server.ts`: `createApp({ …, webDir: config.webDir })`.
- `test/harness.ts`: `createTestContext(options: { webDir?: string } = {})` passes `webDir` to `createApp`.
- `app.ts`: add `webDir?: string` to `AppDeps`; after `app.route("/api", api)` and before `app.notFound`:
```ts
	if (webDir) {
		const isApi = (path: string) => path === "/api" || path.startsWith("/api/");
		const noCache = (_path: string, c: Context) => c.header("cache-control", "no-cache");
		const files = serveStatic({
			root: webDir,
			onFound: (path, c) =>
				c.header("cache-control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"),
		});
		const appShell = serveStatic({ root: webDir, path: "index.html", onFound: noCache });
		app.get("*", (c, next) => (isApi(c.req.path) ? next() : files(c, next)));
		app.get("*", (c, next) => (isApi(c.req.path) ? next() : appShell(c, next)));
	}
```
(`import { serveStatic } from "@hono/node-server/serve-static"` and `type Context` from `hono`.) If `serveStatic` in this version rejects absolute `root` paths, pass `path.relative(process.cwd(), webDir)`; the tests use an absolute temp dir, so they will catch this.
- `.env.example`: add `# WEB_DIR=../web/dist   # serve a built web app (set by the Docker image)` and a comment on `BASE_URL`: `# In development open the Vite app on http://localhost:5173 and set BASE_URL=http://localhost:5173`.
- `scripts/smoke.mjs`: when `process.argv.includes("--web")`, fetch `${base}/` and fail unless status 200 and the body contains `<div id="root">`. (Parse the base URL as the first non-flag argument.)

- [ ] **Step 4: Docker, CI, dev launch, README**

`Dockerfile` build stage — add `COPY apps/web/package.json apps/web/` next to the other package.json copies (before `pnpm install`), `COPY apps/web apps/web` after copying sources, and `RUN pnpm --filter @tagteam/web build` after the server build; in the `/out` step add `&& cp -r /repo/apps/web/dist web`. Runtime `ENV` gains `WEB_DIR=/app/web`.

`.github/workflows/ci.yml` smoke step: run `node apps/server/scripts/smoke.mjs http://localhost:3000 --web`.

`.claude/launch.json` — add a configuration:
```json
    {
      "name": "web",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@tagteam/web", "dev"],
      "port": 5173
    }
```

`README.md` Development section — replace the dev commands with:
````markdown
```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # set AUTH_SECRET, and BASE_URL=http://localhost:5173
pnpm --filter @tagteam/server dev              # API on :3000
pnpm --filter @tagteam/web dev                 # app on http://localhost:5173 (proxies /api)
pnpm test && pnpm typecheck && pnpm lint
```
````
Also remove "Task sync and the app UI are in progress." from the status line and replace with "Status: accounts, groups, tasks with recurrence, offline sync, and the Today screen."

- [ ] **Step 5: Verify**

```bash
rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint
pnpm --filter @tagteam/web build && node apps/web/scripts/check-build.mjs
docker build -t tagteam:local .
docker run -d --name tt-web -p 127.0.0.1:3995:3000 -e AUTH_SECRET="$(openssl rand -base64 32)" -e BASE_URL=http://localhost:3995 tagteam:local
for i in $(seq 30); do curl -fs http://127.0.0.1:3995/api/health && break; sleep 1; done
node apps/server/scripts/smoke.mjs http://localhost:3995 --web
docker rm -f tt-web
```
Expected: all pass, `check-build: ok`, `smoke: ok`.

- [ ] **Step 6: Commit**

```bash
git add apps/web apps/server Dockerfile .github/workflows/ci.yml .claude/launch.json README.md
git commit -m "feat: serve the offline PWA from the server and ship it in the image"
```

---

### Task 11: End-to-end test — sign up to offline completion

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/app.spec.ts`
- Modify: `apps/web/package.json` (`e2e` script), `.github/workflows/ci.yml` (e2e job), `.gitignore` (`test-results/`, `playwright-report/`)

**Interfaces:**
- Consumes: the whole app, served by the real server with `WEB_DIR` pointing at `apps/web/dist`.
- Produces: `pnpm --filter @tagteam/web e2e` (builds, then runs Playwright against a fresh database).

- [ ] **Step 1: Config**

`apps/web/playwright.config.ts`:
```ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	use: { baseURL: BASE_URL, ...devices["Pixel 7"], serviceWorkers: "allow" },
	webServer: {
		command: "pnpm --filter @tagteam/server start",
		url: `${BASE_URL}/api/health`,
		reuseExistingServer: false,
		env: {
			AUTH_SECRET: "e2e-secret-that-is-at-least-32-characters",
			BASE_URL,
			PORT: String(PORT),
			DATABASE_PATH: join(tmpdir(), `tagteam-e2e-${Date.now()}.db`),
			WEB_DIR: join(import.meta.dirname, "dist"),
		},
	},
});
```
`apps/web/package.json`: `"e2e": "vite build && playwright test"`. Install the browser once: `pnpm --filter @tagteam/web exec playwright install chromium`.

- [ ] **Step 2: The scenario**

`apps/web/e2e/app.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("sign up, create a group, add and complete tasks, keep working offline", async ({ page, context }) => {
	const email = `e2e-${Date.now()}@example.com`;

	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Sign in to TagTeam" })).toBeVisible();
	await page.getByRole("link", { name: "Create an account" }).click();
	await page.getByLabel("Name").fill("Sam");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill("correct-horse-battery");
	await page.getByRole("button", { name: "Create account" }).click();

	await expect(page.getByRole("heading", { name: "Sign in faster next time" })).toBeVisible();
	await page.getByRole("button", { name: "Not now" }).click();

	await expect(page.getByRole("heading", { name: "Start a group or join one" })).toBeVisible();
	await page.getByLabel("Group name").fill("E2E family");
	await page.getByRole("button", { name: "Create group" }).click();

	await expect(page.getByRole("button", { name: /E2E family/ })).toBeVisible();
	await expect(page.getByText("Add your first task")).toBeVisible();

	await page.getByRole("button", { name: "Add task" }).first().click();
	await page.getByLabel("Task").fill("Brush teeth");
	await page.getByRole("radio", { name: "Daily" }).click();
	await page.getByRole("button", { name: "Add task" }).last().click();
	await expect(page.getByRole("button", { name: "Complete Brush teeth" })).toBeVisible();

	// Wait until the change reached the server, then prove the app works offline.
	await expect(page.getByText(/Syncing|Offline/)).toHaveCount(0);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole("button", { name: /E2E family/ })).toBeVisible();

	await page.getByRole("button", { name: "Complete Brush teeth" }).click();
	await expect(page.getByRole("button", { name: "Undo Brush teeth" })).toBeVisible();
	await expect(page.getByText("Offline · 1 queued")).toBeVisible();

	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect(page.getByText(/queued|Syncing/)).toHaveCount(0);

	// A fresh load from the server shows the offline completion was saved.
	await page.reload();
	await expect(page.getByText("1 of 1 done today")).toBeVisible();
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @tagteam/web e2e`
Expected: 1 passed. If a step fails because of a real app defect, fix the app (not the test) in this task and note it in the report; if the scenario itself is wrong about intended behaviour, report BLOCKED.

- [ ] **Step 4: CI job and ignores**

Append to `.gitignore`:
```
test-results/
playwright-report/
```

Add a job to `.github/workflows/ci.yml` (parallel to `image`, after `test`):
```yaml
  e2e:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @tagteam/web exec playwright install --with-deps chromium
      - run: pnpm --filter @tagteam/web e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/test-results
```
Run actionlint (`docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`) → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/package.json .github/workflows/ci.yml .gitignore
git commit -m "test(web): cover sign-up to offline completion end to end"
```
