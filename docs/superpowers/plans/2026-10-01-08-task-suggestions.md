# Plan 8 — Task Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can suggest a task to another member of the same group from the New task sheet; the recipient accepts or declines on Today, and accepting creates an ordinary task owned by the recipient.

**Architecture:** Four new sync mutations (`suggestion.create|accept|decline|withdraw`) flow through the existing outbox → `POST /api/sync/push` path. A new `suggestion` table (global `seq`, rows never deleted, status changes instead) is returned by pull only to its sender and recipient. Accepting inserts a `task` row (with `suggestedBy`) and updates the suggestion in the single existing push transaction. Pokes and web-push notifications target only the two people involved (accept also pokes the group). The web app mirrors suggestions in a new Dexie table and renders them on Today, New task, History, and task detail.

**Tech Stack:** existing stack — TypeScript strict, `@tagteam/core`, Hono 4 + Drizzle 0.45 + better-sqlite3 + Vitest (server), Vite + React 19 + Tailwind 4 + Dexie + Vitest/Testing Library + Playwright (web), Biome.

**Spec:** `docs/superpowers/specs/2026-10-01-task-suggestions-design.md` (binding; §1 summary, §2 behaviour table, §3 data model, §4 mutations, §5 sync, §6 web, §7 push, §8 testing). Executors read it together with their task.

## Global Constraints

- **Prerequisite:** run `pnpm install` at the repo root before Task 1. Dependencies were not installed when this plan was written, so none of its code or tests has been run; where the real code disagrees with a plan snippet, the real code and the spec win, and the difference is reported.
- Work on `main` directly. No feature branches or worktrees. **Never push.**
- Conventional Commits, exactly the message given in the task. **Never** add `Co-authored-by` or any attribution trailer. **Never** use `--no-verify`.
- Sub-agents: Haiku or Sonnet only. Keep `docs/STATUS.md` current (Task 10 finalises it).
- Commands: `pnpm test`, `pnpm typecheck`, `rtk proxy pnpm lint`, `rtk proxy pnpm format` (Biome: tabs, double quotes; plain `pnpm lint` is mangled by a local RTK hook). Before each commit run once: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`. Reformatting plan code with Biome is expected.
- Instants are epoch ms numbers; calendar dates are `YYYY-MM-DD` strings; times are `HH:MM`.
- History is derived, never stored. Every client write is a `Mutation` → local outbox → `POST /api/sync/push` (idempotent by id) → `GET /api/sync/pull?cursor=`. Server validates with `mutationErrors`; **web must only enqueue mutations that pass it**.
- Server errors are always `{ error: { code, message, details? } }`; **inaccessible resources look absent** (a suggestion the caller is not party to is "suggestion not found").
- **Rule kept:** users create and complete their own tasks only. A suggestion is not a task; the task it becomes is created by, and belongs to, the person who accepted it. Nothing about a pending suggestion counts toward history, stats, or reminders.
- **Cap:** at most `MAX_PENDING_SUGGESTIONS = 10` pending suggestions from one sender to one recipient in a group.
- **Privacy:** only the sender and the recipient ever receive a suggestion row (the single per-user filter lives in pull). Declines and withdrawals never appear in group History. Withdraw and Clear send no push.
- **Start date on accept:** client sends the later of the suggestion's `startDate` and today in the browser timezone; the server only enforces `startDate >= suggestion.startDate`. Timezone on accept is the recipient's (browser) timezone. `createdAt` of the new task is the mutation's clamped `at`.
- **Push copy (url always `/`):** "{sender} suggests a task" / task title; "{recipient} accepted your suggestion" / task title; "{recipient} declined your suggestion" / task title. Gated by the receiving user's nudge toggle and its enabled-at cutoff; held during the receiving user's quiet hours (profile timezone) and delivered after; a held "suggested" push is dropped if the suggestion is no longer pending; at most once per suggestion per kind.
- **UI:** mobile first, tap targets ≥ 44 px, safe-area insets, light/dark via `prefers-color-scheme`, status never colour-only, sentence-case copy without "please" or exclamation marks. The "For" control is a labelled single-select group usable by keyboard and assistive technology.
- Runtime-visible changes get a visual check in the browser at 375 × 812 (light and dark), not only tests.
- Better Auth user ids are random 32-character strings, **not UUIDs**: validate `toUserId` as a non-empty string (≤ 128 chars), never with `isId`.

---

## Decisions made while planning (differences from the decomposition in the brief)

- **`TaskDto.suggestedBy` and `PullResponse.suggestions` land in Task 4, not Task 1.** Adding them in core first would break `typecheck` of `apps/server` (the pull select has no `suggestedBy` column until Task 2) and of the web fixtures. Task 1 therefore ships only the mutation vocabulary, `MAX_PENDING_SUGGESTIONS`, `SuggestionDto` and an `isSuggestionMutation` guard, plus two tiny compile-compatibility edits (a server guard and a web helper refactor). Every task ends with the whole repo green.
- **`notification_log` migration is hand-written, not as generated.** Making `task_id` nullable makes drizzle-kit emit a drop-and-recreate of `notification_log`. The drizzle migrator runs in a transaction, where `PRAGMA foreign_keys = OFF` is a no-op, so `DROP TABLE notification_log` would cascade-delete every queued row in `notification_delivery`. (Reproduced with the real migrations 0000–0003 in a scratch SQLite database.) Task 2 generates the migration to get the snapshot and journal, then replaces the SQL file with a version that rebuilds both tables safely, and adds a test that proves queued deliveries survive.
- **`notification_log` shape (minimal change):** `task_id` becomes nullable; new nullable `suggestion_id` (FK to `suggestion`, cascade); unique index on `(suggestion_id, kind)`; three new `kind` values `suggested`, `suggestion_accepted`, `suggestion_declined`. `occurrence_key` stays `NOT NULL` and holds the suggestion id for these kinds. SQLite treats NULLs as distinct in unique indexes, so the existing `(task_id, occurrence_key, kind)` index and the new one never collide with each other's rows.
- **After a successful suggestion the sheet resets to "Me"** (like every other draft field); the selection persists only across dismiss/reopen without submitting.
- **History/task-detail wording uses "Suggested by you" when the viewer is the suggester** (existing convention: "You added …"); otherwise the member's display name, or "a former member".

## File Structure

```
packages/core/src/
  mutations.ts               + MAX_PENDING_SUGGESTIONS, 4 suggestion mutations, FIELDS, toUserId/suggestionId validation,
                               SuggestionMutation, isSuggestionMutation
  mutations.test.ts          + suggestion cases
  index.test.ts              + isSuggestionMutation in the API list
  wire.ts                    + SuggestionStatus, SuggestionDto (Task 1); TaskDto.suggestedBy, PullResponse.suggestions (Task 4)
apps/server/
  drizzle/0004_task_suggestions.sql (+ meta)   generated, then SQL replaced with the safe rebuild
  src/db/app-schema.ts       + suggestion table, task.suggestedBy, notificationLog task_id nullable + suggestion_id + kinds + index
  src/db/client.test.ts      + "suggestion" in the table list
  src/db/migrations.test.ts  (new) queued notification deliveries survive migration 0004
  src/services/sync-suggestions.ts  (new) applySuggestionMutation()
  src/services/sync-push.ts  Outcome carries pokeUserIds; applyMutations returns userIds; exports Tx, Outcome
  src/services/sync-pull.ts  suggestions (sender/recipient only), suggestedBy
  src/services/groups.ts     leaveGroup withdraws suggestions
  src/services/notifications.ts  three suggestion push kinds, nudge-toggle gating, quiet hours, dropped held push
  src/routes/sync.ts         onChange(groupIds, userIds); onSuggestion hook
  src/app.ts                 wire both hooks
  src/test/harness.ts        createTestContext accepts { live, push }
  src/test/sync-helpers.ts   + userIdOf()
  src/routes/sync-suggestions.test.ts  (new) push, pokes, pull, leave-group
  src/services/notifications.test.ts   + suggestion push describe
apps/web/
  src/store/db.ts            version(2) suggestions table
  src/store/apply.ts         applyLocal for 4 mutations, applyPull/removeGroup/reset
  src/sync/engine.ts         enqueue transaction includes suggestions
  src/features/suggestions/model.ts   (new) pure helpers (cap count, incoming/outgoing, accept start date, summary, suggester label)
  src/features/add-task/draft.ts      forUserId, suggestionMutation
  src/features/add-task/AddTaskSheet.tsx   "For" control, "Suggest to {name}", cap error
  src/features/today/Suggestions.tsx  (new) IncomingSuggestions, OutgoingSuggestions
  src/features/today/TodayScreen.tsx, TodayList.tsx   wire cards and the "Suggested by you" section
  src/features/history/model.ts, HistoryScreen.tsx    "took on" wording
  src/features/task-detail/TaskDetailScreen.tsx       "Suggested by" line
  src/features/me/NotificationSettings.tsx            "Nudges and suggestions"
  e2e/suggestions.spec.ts    (new) two-user flow
docs/STATUS.md, docs/superpowers/specs/2026-09-25-tagteam-design.md (§3.6 mutation list)
```

Task order: 1 core → 2 schema → 3 push → 4 pull + leave → 5 notifications → 6 web store → 7 New task sheet → 8 Today → 9 History/detail/Me → 10 e2e + visual + wrap-up.

---

### Task 1: Core — suggestion mutations and validation

**Files:**
- Modify: `packages/core/src/mutations.ts`, `packages/core/src/wire.ts`, `packages/core/src/index.test.ts`
- Modify (compile compatibility only): `apps/server/src/services/sync-push.ts`, `apps/web/src/store/apply.ts`
- Test: `packages/core/src/mutations.test.ts`

**Interfaces:**
- Consumes: `isLocalDate`, `isTimeOfDay`, `isTimeZone`, `LocalDate` (localDate.ts); `Rule`, `ruleErrors` (rule.ts); existing `fieldError`/`FIELDS`/`mutationErrors` in `mutations.ts`.
- Produces (all exported from `@tagteam/core`):
  - `MAX_PENDING_SUGGESTIONS = 10`
  - `Mutation` gains, each `Base & {...}` (`Base` = `{ id: string; at: number }`):
    - `{ type: "suggestion.create"; suggestionId: string; groupId: string; toUserId: string; title: string; notes: string | null; startDate: LocalDate; dueTime: string | null; rule: Rule | null }`
    - `{ type: "suggestion.accept"; suggestionId: string; taskId: string; timezone: string; startDate: LocalDate }`
    - `{ type: "suggestion.decline"; suggestionId: string }`
    - `{ type: "suggestion.withdraw"; suggestionId: string }`
  - ``type SuggestionMutation = Extract<Mutation, { type: `suggestion.${string}` }>``
  - `isSuggestionMutation(m: Mutation): m is SuggestionMutation`
  - `type SuggestionStatus = "pending" | "accepted" | "declined" | "withdrawn"`
  - `interface SuggestionDto` (spec §3, uses `SuggestionStatus` for `status`)
  - `mutationErrors` messages: `"suggestionId must be a UUID"`, `"toUserId must be a user id"`; the other fields reuse the existing messages.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/mutations.test.ts` change the import and constants at the top:

```ts
import { describe, expect, it } from "vitest";
import {
	isSuggestionMutation,
	MAX_PENDING_SUGGESTIONS,
	type Mutation,
	mutationErrors,
} from "./mutations";

const id = "0b7a3a57-8d4e-4f6b-9a39-3c0b8d1f2e10";
const taskId = "5e0c1c5e-4f7a-4a8c-8f7e-1d2c3b4a5f60";
const groupId = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const suggestionId = "7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
// Better Auth user ids are random strings, not UUIDs.
const toUserId = "k3Jx9mQ2pL7vN1sT5yB8wZ4aC6dE0fGh";
const at = Date.UTC(2026, 8, 25, 12);
```

Append these four entries to the end of the `valid` array (after the `task.nudge` entry):

```ts
	{
		id,
		at,
		type: "suggestion.create",
		suggestionId,
		groupId,
		toUserId,
		title: "Wash dishes",
		notes: null,
		startDate: "2026-10-01",
		dueTime: "19:00",
		rule: { freq: "day", interval: 1 },
	},
	{
		id,
		at,
		type: "suggestion.accept",
		suggestionId,
		taskId,
		timezone: "Europe/London",
		startDate: "2026-10-02",
	},
	{ id, at, type: "suggestion.decline", suggestionId },
	{ id, at, type: "suggestion.withdraw", suggestionId },
```

Append these tests inside the `describe("mutationErrors", ...)` block, after the `requires the fields of each type` test:

```ts
	it("reports every problem in a suggestion.create", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.create",
				suggestionId: "x",
				groupId,
				toUserId: "",
				title: "   ",
				notes: "n".repeat(1001),
				startDate: "2026-02-30",
				dueTime: "8am",
				rule: { freq: "day", interval: 0 },
			}),
		).toEqual([
			"suggestionId must be a UUID",
			"toUserId must be a user id",
			"title must be 1-100 characters",
			"notes must be null or at most 1000 characters",
			"startDate must be YYYY-MM-DD",
			"dueTime must be HH:MM or null",
			"rule: interval must be an integer 1-366",
		]);
	});

	it("reports every problem in a suggestion.accept", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.accept",
				suggestionId,
				taskId: "x",
				timezone: "Mars/Base",
				startDate: "soon",
				extra: true,
			}),
		).toEqual([
			"unknown field: extra",
			"taskId must be a UUID",
			"timezone must be an IANA zone",
			"startDate must be YYYY-MM-DD",
		]);
	});

	it("requires the fields of each suggestion mutation", () => {
		expect(mutationErrors({ id, at, type: "suggestion.decline" })).toEqual([
			"suggestionId is required",
		]);
		expect(
			mutationErrors({ id, at, type: "suggestion.accept", suggestionId }),
		).toEqual([
			"taskId is required",
			"timezone is required",
			"startDate is required",
		]);
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.withdraw",
				suggestionId,
				toUserId,
			}),
		).toEqual(["unknown field: toUserId"]);
	});

	it("caps pending suggestions per sender and recipient at 10", () => {
		expect(MAX_PENDING_SUGGESTIONS).toBe(10);
	});

	it("tells suggestion mutations apart from task mutations", () => {
		expect(valid.filter(isSuggestionMutation).map((m) => m.type)).toEqual([
			"suggestion.create",
			"suggestion.accept",
			"suggestion.decline",
			"suggestion.withdraw",
		]);
	});
```

In `packages/core/src/index.test.ts` add `"isSuggestionMutation",` to the list of names, directly after `"mutationErrors",`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/core test -- src/mutations.test.ts src/index.test.ts`
Expected: FAIL — the new `valid` entries report `type is not a known mutation`, `isSuggestionMutation` is not a function, and `MAX_PENDING_SUGGESTIONS` is undefined.

- [ ] **Step 3: Implement the core changes**

In `packages/core/src/mutations.ts`:

1. After `export const NUDGE_INTERVAL_MS = 30 * 60 * 1000;` add:

```ts
/** A sender may have at most this many pending suggestions to one recipient in one group. */
export const MAX_PENDING_SUGGESTIONS = 10;
/** Better Auth ids are opaque strings; this only bounds what `suggestion.create` accepts. */
const MAX_USER_ID_LENGTH = 128;
```

2. Replace the `Mutation` union's last member and close the union with the four new members. The end of the union currently reads `| (Base & { type: "task.nudge"; taskId: string });`. Replace that line with:

```ts
	| (Base & { type: "task.nudge"; taskId: string })
	| (Base & {
			type: "suggestion.create";
			suggestionId: string;
			groupId: string;
			toUserId: string;
			title: string;
			notes: string | null;
			startDate: LocalDate;
			dueTime: string | null;
			rule: Rule | null;
	  })
	| (Base & {
			type: "suggestion.accept";
			suggestionId: string;
			taskId: string;
			timezone: string;
			startDate: LocalDate;
	  })
	| (Base & { type: "suggestion.decline"; suggestionId: string })
	| (Base & { type: "suggestion.withdraw"; suggestionId: string });
```

3. Directly after `export type MutationType = Mutation["type"];` add:

```ts
export type SuggestionMutation = Extract<
	Mutation,
	{ type: `suggestion.${string}` }
>;

export const isSuggestionMutation = (m: Mutation): m is SuggestionMutation =>
	m.type.startsWith("suggestion.");
```

4. In `FIELDS`, after the `"task.nudge": ["taskId"],` entry add:

```ts
	"suggestion.create": [
		"suggestionId",
		"groupId",
		"toUserId",
		"title",
		"notes",
		"startDate",
		"dueTime",
		"rule",
	],
	"suggestion.accept": ["suggestionId", "taskId", "timezone", "startDate"],
	"suggestion.decline": ["suggestionId"],
	"suggestion.withdraw": ["suggestionId"],
```

5. In `fieldError`, replace the first case group

```ts
		case "taskId":
		case "groupId":
		case "refEventId":
			return isId(v) ? null : `${key} must be a UUID`;
```

with

```ts
		case "taskId":
		case "groupId":
		case "refEventId":
		case "suggestionId":
			return isId(v) ? null : `${key} must be a UUID`;
		case "toUserId":
			return typeof v === "string" &&
				v.length >= 1 &&
				v.length <= MAX_USER_ID_LENGTH
				? null
				: "toUserId must be a user id";
```

In `packages/core/src/wire.ts` change the first import to `import type { Rule, RuleVersion } from "./rule";` and add, directly after the `EventDto` interface:

```ts
export type SuggestionStatus = "pending" | "accepted" | "declined" | "withdrawn";

export interface SuggestionDto {
	id: string;
	groupId: string;
	fromUserId: string;
	toUserId: string;
	title: string;
	notes: string | null;
	startDate: string;
	dueTime: string | null;
	rule: Rule | null;
	status: SuggestionStatus;
	taskId: string | null;
	createdAt: number;
	resolvedAt: number | null;
}
```

- [ ] **Step 4: Keep the dependants compiling**

The wider union makes `m.taskId` ill-typed in two places. Make these two minimal edits (Task 3 and Task 6 replace the stand-ins with the real behaviour).

`apps/server/src/services/sync-push.ts` — add `isSuggestionMutation` to the `@tagteam/core` import list (keep it alphabetical: after `type MutationResult,`... Biome will reorder), and at the very top of `applyOne`, before `if (m.type === "task.create") {`, insert:

```ts
	if (isSuggestionMutation(m))
		return { reason: "suggestions are not supported yet" };
```

`apps/web/src/store/apply.ts` — the `event` helper reads `m.taskId`, which only exists on task mutations. Replace

```ts
	const event = (
		fields: Pick<EventDto, "type" | "occurrenceKey" | "refEventId">,
	) =>
		store.events.put({
			id: m.id,
			taskId: m.taskId,
			userId: me.userId,
			at: m.at,
			...fields,
		});
```

with

```ts
	const event = (
		taskId: string,
		fields: Pick<EventDto, "type" | "occurrenceKey" | "refEventId">,
	) =>
		store.events.put({
			id: m.id,
			taskId,
			userId: me.userId,
			at: m.at,
			...fields,
		});
```

and change the three call sites (inside `case "task.complete"`, `case "task.uncomplete"`, `case "task.nudge"`):

```ts
await event({
	type: "completed",
```
becomes
```ts
await event(m.taskId, {
	type: "completed",
```
(and likewise `await event(m.taskId, {` for the `"uncompleted"` and `"nudged"` calls; the `"nudged"` call is the one-liner `await event({ type: "nudged", occurrenceKey: null, refEventId: null });` which becomes `await event(m.taskId, {\n type: "nudged",\n occurrenceKey: null,\n refEventId: null,\n });`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/core test`
Expected: PASS (all core tests).

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/server/src/services/sync-push.ts apps/web/src/store/apply.ts
git commit -m "feat(core): add suggestion mutations and validation"
```

### Task 2: Server — `suggestion` table, `task.suggestedBy`, notification log shape

**Files:**
- Modify: `apps/server/src/db/app-schema.ts` (task :97, notificationLog :194)
- Create (generated, then SQL replaced): `apps/server/drizzle/0004_task_suggestions.sql`, `apps/server/drizzle/meta/0004_snapshot.json`; Modify (generated): `apps/server/drizzle/meta/_journal.json`
- Modify test: `apps/server/src/db/client.test.ts`
- Create test: `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Consumes: `Rule` from `@tagteam/core`; existing `user`, `groups`, `task` tables.
- Produces (exported from `apps/server/src/db/schema`):
  - `suggestion` table: `id, groupId, fromUserId, toUserId, title, notes, startDate, dueTime, rule (Rule | null), status ("pending" | "accepted" | "declined" | "withdrawn"), taskId (string | null), createdAt, resolvedAt (number | null), seq`; indexes `suggestion_group_seq_idx (group_id, seq)` and `suggestion_pair_idx (group_id, from_user_id, to_user_id, status)`.
  - `task.suggestedBy: string | null`.
  - `notificationLog.taskId: string | null`, `notificationLog.suggestionId: string | null`, `notificationLog.kind` enum `"due" | "overdue" | "nudge" | "suggested" | "suggestion_accepted" | "suggestion_declined"`, unique index `notification_log_suggestion_unique (suggestion_id, kind)`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/db/client.test.ts` add `"suggestion",` to the expected table list between `"session",` and `"sync_state",`.

Create `apps/server/src/db/migrations.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const files = readdirSync(folder)
	.filter((name) => name.endsWith(".sql"))
	.sort();
const statements = (name: string) =>
	readFileSync(join(folder, name), "utf8")
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter(Boolean);

it("keeps queued notification deliveries when the log is rebuilt for suggestions", () => {
	const migration = files.find((name) => name.startsWith("0004_"));
	expect(migration).toBeDefined();

	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	for (const name of files.filter((name) => name < "0004_"))
		for (const statement of statements(name)) sqlite.exec(statement);
	sqlite.exec(`
		insert into user (id, name, email) values ('u1', 'Sam', 'sam@example.com');
		insert into groups (id, name, created_by, created_at) values ('g1', 'Home', 'u1', 0);
		insert into task (id, group_id, owner_id, title, timezone, start_date, rules, created_at, clocks, seq)
			values ('t1', 'g1', 'u1', 'Wash dishes', 'UTC', '2026-09-27', '[]', 0, '{}', 1);
		insert into notification_log (id, task_id, user_id, occurrence_key, kind, title, body, url, created_at)
			values ('n1', 't1', 'u1', '2026-09-27', 'due', 'Task due', 'Wash dishes is due.', '/', 5);
		insert into notification_delivery (id, notification_id, endpoint, next_attempt_at)
			values ('d1', 'n1', 'https://fcm.googleapis.com/test', 9);
	`);

	// The app's migrator runs each migration inside one transaction, where
	// `PRAGMA foreign_keys = OFF` has no effect; mirror that here.
	sqlite.transaction(() => {
		for (const statement of statements(migration as string))
			sqlite.exec(statement);
	})();

	expect(
		sqlite
			.prepare("select id, task_id, suggestion_id, kind from notification_log")
			.all(),
	).toEqual([{ id: "n1", task_id: "t1", suggestion_id: null, kind: "due" }]);
	expect(
		sqlite
			.prepare(
				"select id, notification_id, status, next_attempt_at from notification_delivery",
			)
			.all(),
	).toEqual([
		{ id: "d1", notification_id: "n1", status: "pending", next_attempt_at: 9 },
	]);
	expect(sqlite.pragma("foreign_key_check")).toEqual([]);

	// Suggestion notifications have no task and dedupe by (suggestion, kind).
	sqlite.exec(`
		insert into suggestion (id, group_id, from_user_id, to_user_id, title, start_date, status, created_at, seq)
			values ('sg1', 'g1', 'u1', 'u1', 'Wash dishes', '2026-09-27', 'pending', 0, 2);
	`);
	const insertLog = sqlite.prepare(
		"insert or ignore into notification_log (id, task_id, suggestion_id, user_id, occurrence_key, kind, title, body, url, created_at) values (?, null, 'sg1', 'u1', 'sg1', 'suggested', 'T', 'B', '/', 5)",
	);
	expect(insertLog.run("n2").changes).toBe(1);
	expect(insertLog.run("n3").changes).toBe(0);
	sqlite.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/server test -- src/db`
Expected: FAIL — `client.test.ts` is missing the `suggestion` table and `migrations.test.ts` fails on `expect(migration).toBeDefined()`.

- [ ] **Step 3: Change the schema**

In `apps/server/src/db/app-schema.ts`:

1. Change the first import to `import type { Rule, RuleVersion } from "@tagteam/core";`.

2. In the `task` table, add this column directly after `clocks: ...` and before `seq`:

```ts
			/** Set only when the task was created by accepting a suggestion: the suggester's user id. */
			suggestedBy: text("suggested_by").references(() => user.id, {
				onDelete: "set null",
			}),
```

3. Directly after the `taskEvent` table (and before `appliedMutation`) add:

```ts
/** A task one member proposes to another. Rows are never deleted; `status` changes instead, so sync needs no tombstones. */
export const suggestion = sqliteTable(
	"suggestion",
	{
		id: text("id").primaryKey(),
		groupId: text("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		fromUserId: text("from_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		toUserId: text("to_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		notes: text("notes"),
		startDate: text("start_date").notNull(),
		dueTime: text("due_time"),
		rule: text("rule", { mode: "json" }).$type<Rule>(),
		status: text("status", {
			enum: ["pending", "accepted", "declined", "withdrawn"],
		}).notNull(),
		taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
		createdAt: epochMs("created_at").notNull(),
		/** Set on the latest status change. */
		resolvedAt: epochMs("resolved_at"),
		seq: integer("seq").notNull(),
	},
	(t) => [
		index("suggestion_group_seq_idx").on(t.groupId, t.seq),
		index("suggestion_pair_idx").on(
			t.groupId,
			t.fromUserId,
			t.toUserId,
			t.status,
		),
	],
);
```

4. In `notificationLog` replace the `taskId` column

```ts
		taskId: text("task_id")
			.notNull()
			.references(() => task.id, { onDelete: "cascade" }),
```

with

```ts
		/** Null for suggestion notifications, which have no task yet. */
		taskId: text("task_id").references(() => task.id, { onDelete: "cascade" }),
		suggestionId: text("suggestion_id").references(() => suggestion.id, {
			onDelete: "cascade",
		}),
```

then update the comment and `kind` column below it:

```ts
		/** Occurrence date for reminders; source event id for nudges; suggestion id for suggestion kinds. */
		occurrenceKey: text("occurrence_key").notNull(),
		kind: text("kind", {
			enum: [
				"due",
				"overdue",
				"nudge",
				"suggested",
				"suggestion_accepted",
				"suggestion_declined",
			],
		}).notNull(),
```

and add a second unique index to the table's index array (after `notification_log_dedupe_unique`):

```ts
		uniqueIndex("notification_log_suggestion_unique").on(
			t.suggestionId,
			t.kind,
		),
```

- [ ] **Step 4: Generate the migration, then replace its SQL**

Run: `pnpm --filter @tagteam/server exec drizzle-kit generate --name task_suggestions`
Expected: creates `apps/server/drizzle/0004_task_suggestions.sql`, `apps/server/drizzle/meta/0004_snapshot.json`, and a fifth entry in `meta/_journal.json`. If drizzle-kit asks whether a column was created or renamed, choose "create" (nothing is renamed).

The generated SQL drops and recreates `notification_log`, which would cascade-delete queued `notification_delivery` rows inside the migrator's transaction. **Overwrite the whole file** `apps/server/drizzle/0004_task_suggestions.sql` with this version (keep the snapshot and journal exactly as generated; they describe the same final schema):

```sql
CREATE TABLE `suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`start_date` text NOT NULL,
	`due_time` text,
	`rule` text,
	`status` text NOT NULL,
	`task_id` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`seq` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `suggestion_group_seq_idx` ON `suggestion` (`group_id`,`seq`);--> statement-breakpoint
CREATE INDEX `suggestion_pair_idx` ON `suggestion` (`group_id`,`from_user_id`,`to_user_id`,`status`);--> statement-breakpoint
ALTER TABLE `task` ADD `suggested_by` text REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE TABLE `__new_notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`suggestion_id` text,
	`user_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestion`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notification_log`(`id`, `task_id`, `user_id`, `occurrence_key`, `kind`, `title`, `body`, `url`, `created_at`, `sent_at`) SELECT `id`, `task_id`, `user_id`, `occurrence_key`, `kind`, `title`, `body`, `url`, `created_at`, `sent_at` FROM `notification_log`;--> statement-breakpoint
CREATE TABLE `__notification_delivery_backup` AS SELECT * FROM `notification_delivery`;--> statement-breakpoint
DROP TABLE `notification_delivery`;--> statement-breakpoint
DROP TABLE `notification_log`;--> statement-breakpoint
ALTER TABLE `__new_notification_log` RENAME TO `notification_log`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_dedupe_unique` ON `notification_log` (`task_id`,`occurrence_key`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_suggestion_unique` ON `notification_log` (`suggestion_id`,`kind`);--> statement-breakpoint
CREATE INDEX `notification_log_pending_idx` ON `notification_log` (`sent_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	FOREIGN KEY (`notification_id`) REFERENCES `notification_log`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `notification_delivery` SELECT * FROM `__notification_delivery_backup`;--> statement-breakpoint
DROP TABLE `__notification_delivery_backup`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_notification_endpoint_unique` ON `notification_delivery` (`notification_id`,`endpoint`);
```

Why this order: the delivery rows are parked in a plain backup table first, so dropping the old log has no child rows to cascade into; the new log is renamed into place, then deliveries are restored against it.

Sanity check that the snapshot matches the schema: run `pnpm --filter @tagteam/server exec drizzle-kit generate --name should_be_empty` again. Expected: "No schema changes, nothing to migrate" and no new files (`git status` shows only the Task 2 files).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/server test`
Expected: PASS (all server tests, including `src/db/client.test.ts` and `src/db/migrations.test.ts`).

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (Biome does not format `.sql`/`.json` under `drizzle/`; if it flags them, leave them as generated/pasted).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db apps/server/drizzle
git commit -m "feat(server): add suggestion table and notification log support"
```

### Task 3: Server — apply the four suggestion mutations in push

**Files:**
- Create: `apps/server/src/services/sync-suggestions.ts`
- Modify: `apps/server/src/services/sync-push.ts` (`Tx`/`Outcome` :18-19, `applyMutations` :30-76, `applyOne` :78), `apps/server/src/routes/sync.ts` (`SyncDeps.onChange` :13, push route :37 and :65), `apps/server/src/app.ts` (:73)
- Modify test helpers: `apps/server/src/test/harness.ts`, `apps/server/src/test/sync-helpers.ts`
- Test: `apps/server/src/routes/sync-suggestions.test.ts` (new)

**Interfaces:**
- Consumes: `suggestion`, `task` tables (Task 2); `SuggestionMutation`, `isSuggestionMutation`, `MAX_PENDING_SUGGESTIONS` (Task 1); `isActiveMember(db, groupId, userId)` (`services/groups.ts`); `nextSeq(tx)`; `pokeGroups(db, hub, groupIds, alsoUserIds)` and `LiveHub` (`live.ts`).
- Produces:
  - `export type Tx` and `export type Outcome = { reason: string } | { groupId: string | null; pokeUserIds?: string[] }` from `services/sync-push.ts`.
  - `applyMutations(db, userId, inputs, now): { results: MutationResult[]; groupIds: Set<string>; userIds: Set<string> }` — `userIds` are users to poke individually.
  - `applySuggestionMutation(tx: Tx, userId: string, m: SuggestionMutation, at: number): Outcome` from `services/sync-suggestions.ts`.
  - `SyncDeps.onChange?: (groupIds: Set<string>, userIds: Set<string>) => void`.
  - Rejection reasons (exact strings, relied on by tests and by Task 4): `"not a member of this group"`, `"recipient is not a member of this group"`, `"you can't suggest a task to yourself"`, `"suggestion already exists"`, `"too many pending suggestions"`, `"suggestion not found"`, `"suggestion is not addressed to you"`, `"suggestion is no longer pending"`, `"startDate is before the suggested start"`, `"task already exists"`, `"not your suggestion"`, `"suggestion can no longer be withdrawn"`.
  - Test helpers: `createTestContext({ webDir?, live? })`; `userIdOf(db: Db, email: string): string`.

- [ ] **Step 1: Write the failing tests**

Extend the test helpers first (they are used by the new test file).

`apps/server/src/test/harness.ts` — add imports `import type { LiveHub } from "../live";` and change `createTestContext`:

```ts
export function createTestContext(
	options: { webDir?: string; live?: LiveHub } = {},
): TestContext {
	const clock = { now: Date.UTC(2026, 8, 25, 12) };
	const { db, close } = openDb(":memory:");
	const auth = createAuth(db, TEST_CONFIG);
	const app = createApp({
		db,
		auth,
		trustedOrigin: TEST_CONFIG.baseUrl,
		now: () => clock.now,
		webDir: options.webDir,
		live: options.live,
	});
	return { db, app, clock, close };
}
```

`apps/server/src/test/sync-helpers.ts` — add imports `import { eq } from "drizzle-orm";`, `import type { Db } from "../db/client";`, `import { user } from "../db/schema";` and append:

```ts
/** The id Better Auth assigned to the user who signed up with `email`. */
export function userIdOf(db: Db, email: string): string {
	const row = db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.get();
	if (!row) throw new Error(`no user with email ${email}`);
	return row.id;
}
```

Create `apps/server/src/routes/sync-suggestions.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { MAX_PENDING_SUGGESTIONS } from "@tagteam/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestion, task } from "../db/schema";
import { createLiveHub, type LiveHub } from "../live";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, push, userIdOf } from "../test/sync-helpers";

describe("suggestion mutations", () => {
	let ctx: TestContext;
	let hub: LiveHub;
	let sam: string;
	let jo: string;
	let kim: string;
	let lee: string;
	let samId: string;
	let joId: string;
	let kimId: string;
	let leeId: string;
	let groupId: string;
	let suggestionId: string;
	let taskId: string;

	const invite = async () =>
		(
			await readJson<{ code: string }>(
				await api(ctx.app, sam, "POST", `/api/groups/${groupId}/invites`),
			)
		).code;
	const join = async (cookie: string) =>
		api(ctx.app, cookie, "POST", "/api/invites/redeem", {
			code: await invite(),
		});

	const create = (id = suggestionId, to = joId) =>
		mutation(
			"suggestion.create",
			{
				suggestionId: id,
				groupId,
				toUserId: to,
				title: " Wash dishes ",
				notes: null,
				startDate: "2026-10-01",
				dueTime: "19:00",
				rule: { freq: "day", interval: 1 },
			},
			ctx.clock.now,
		);
	const accept = (id = suggestionId, newTaskId = taskId, startDate = "2026-10-01") =>
		mutation(
			"suggestion.accept",
			{
				suggestionId: id,
				taskId: newTaskId,
				timezone: "Europe/London",
				startDate,
			},
			ctx.clock.now,
		);
	const decline = (id = suggestionId) =>
		mutation("suggestion.decline", { suggestionId: id }, ctx.clock.now);
	const withdraw = (id = suggestionId) =>
		mutation("suggestion.withdraw", { suggestionId: id }, ctx.clock.now);
	const row = (id = suggestionId) =>
		ctx.db.select().from(suggestion).where(eq(suggestion.id, id)).get();
	const taskRow = (id: string) =>
		ctx.db.select().from(task).where(eq(task.id, id)).get();
	const reason = async (cookie: string, m: ReturnType<typeof create>) =>
		(await push(ctx.app, cookie, [m])).results[0]?.reason;

	beforeEach(async () => {
		hub = createLiveHub();
		ctx = createTestContext({ live: hub });
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
		jo = await signUp(ctx.app, "jo@example.com", "Jo");
		kim = await signUp(ctx.app, "kim@example.com", "Kim");
		lee = await signUp(ctx.app, "lee@example.com", "Lee");
		samId = userIdOf(ctx.db, "sam@example.com");
		joId = userIdOf(ctx.db, "jo@example.com");
		kimId = userIdOf(ctx.db, "kim@example.com");
		leeId = userIdOf(ctx.db, "lee@example.com");
		groupId = (
			await readJson<{ group: { id: string } }>(
				await api(ctx.app, sam, "POST", "/api/groups", { name: "Smiths" }),
			)
		).group.id;
		await join(jo);
		await join(lee);
		suggestionId = randomUUID();
		taskId = randomUUID();
	});
	afterEach(() => ctx.close());

	it("stores a pending suggestion from one member to another, once per mutation id", async () => {
		const m = create();
		const first = await push(ctx.app, sam, [m]);
		expect(first.results[0]?.status).toBe("applied");
		expect(row()).toMatchObject({
			groupId,
			fromUserId: samId,
			toUserId: joId,
			title: "Wash dishes",
			notes: null,
			startDate: "2026-10-01",
			dueTime: "19:00",
			rule: { freq: "day", interval: 1 },
			status: "pending",
			taskId: null,
			createdAt: ctx.clock.now,
			resolvedAt: null,
		});
		expect(row()?.seq).toBeGreaterThan(0);
		expect((await push(ctx.app, sam, [m])).results[0]?.status).toBe(
			"duplicate",
		);
	});

	it("rejects creates from outsiders, to outsiders, to yourself, or with a used id", async () => {
		expect(await reason(kim, create(randomUUID(), joId))).toBe(
			"not a member of this group",
		);
		expect(await reason(sam, create(randomUUID(), kimId))).toBe(
			"recipient is not a member of this group",
		);
		expect(await reason(sam, create(randomUUID(), samId))).toBe(
			"you can't suggest a task to yourself",
		);
		expect((await push(ctx.app, sam, [create()])).results[0]?.status).toBe(
			"applied",
		);
		expect(await reason(sam, create())).toBe("suggestion already exists");
		expect(ctx.db.select().from(suggestion).all()).toHaveLength(1);
	});

	it("caps pending suggestions per sender and recipient", async () => {
		const filled = await push(
			ctx.app,
			sam,
			Array.from({ length: MAX_PENDING_SUGGESTIONS }, () =>
				create(randomUUID()),
			),
		);
		expect(filled.results.every((r) => r.status === "applied")).toBe(true);
		const overId = randomUUID();
		expect(await reason(sam, create(overId))).toBe("too many pending suggestions");
		expect(row(overId)).toBeUndefined();

		// Other direction and other recipients have their own allowance.
		expect(
			(await push(ctx.app, jo, [create(randomUUID(), samId)])).results[0]
				?.status,
		).toBe("applied");
		expect(
			(await push(ctx.app, sam, [create(randomUUID(), leeId)])).results[0]
				?.status,
		).toBe("applied");

		// Answering or withdrawing one frees a slot.
		const [first] = ctx.db.select().from(suggestion).all();
		await push(ctx.app, sam, [withdraw(first?.id)]);
		expect(
			(await push(ctx.app, sam, [create(overId)])).results[0]?.status,
		).toBe("applied");
	});

	it("accepting creates the recipient's task and resolves the suggestion together", async () => {
		await push(ctx.app, sam, [create()]);
		ctx.clock.now += 60_000;
		const { results } = await push(ctx.app, jo, [
			accept(suggestionId, taskId, "2026-10-03"),
		]);
		expect(results[0]?.status).toBe("applied");
		expect(taskRow(taskId)).toMatchObject({
			groupId,
			ownerId: joId,
			title: "Wash dishes",
			notes: null,
			timezone: "Europe/London",
			startDate: "2026-10-03",
			rules: [
				{
					effectiveFrom: "2026-10-03",
					rule: { freq: "day", interval: 1 },
					dueTime: "19:00",
				},
			],
			archivedAt: null,
			createdAt: ctx.clock.now,
			suggestedBy: samId,
		});
		expect(row()).toMatchObject({
			status: "accepted",
			taskId,
			resolvedAt: ctx.clock.now,
		});
	});

	it("leaves the suggestion pending and writes no task when an accept is rejected", async () => {
		await push(ctx.app, sam, [create()]);
		const usedTaskId = randomUUID();
		await push(ctx.app, jo, [
			mutation(
				"task.create",
				{
					taskId: usedTaskId,
					groupId,
					title: "Other",
					notes: null,
					timezone: "UTC",
					startDate: "2026-10-01",
					dueTime: null,
					rule: null,
				},
				ctx.clock.now,
			),
		]);
		expect(await reason(jo, accept(suggestionId, usedTaskId))).toBe(
			"task already exists",
		);
		expect(
			await reason(jo, accept(suggestionId, taskId, "2026-09-30")),
		).toBe("startDate is before the suggested start");
		expect(row()).toMatchObject({ status: "pending", taskId: null });
		expect(ctx.db.select().from(task).all()).toHaveLength(1);
	});

	it("only the recipient answers, and people outside the pair see nothing", async () => {
		await push(ctx.app, sam, [create()]);
		expect(await reason(sam, accept())).toBe(
			"suggestion is not addressed to you",
		);
		expect(await reason(sam, decline())).toBe(
			"suggestion is not addressed to you",
		);
		for (const stranger of [kim, lee]) {
			expect(await reason(stranger, accept())).toBe("suggestion not found");
			expect(await reason(stranger, decline())).toBe("suggestion not found");
			expect(await reason(stranger, withdraw())).toBe("suggestion not found");
		}
		expect(row()).toMatchObject({ status: "pending" });
	});

	it("declines only while pending", async () => {
		await push(ctx.app, sam, [create()]);
		ctx.clock.now += 1000;
		expect((await push(ctx.app, jo, [decline()])).results[0]?.status).toBe(
			"applied",
		);
		expect(row()).toMatchObject({
			status: "declined",
			resolvedAt: ctx.clock.now,
		});
		expect(await reason(jo, decline())).toBe("suggestion is no longer pending");
		expect(await reason(jo, accept())).toBe("suggestion is no longer pending");
	});

	it("lets only the sender withdraw, while pending or declined", async () => {
		await push(ctx.app, sam, [create()]);
		expect(await reason(jo, withdraw())).toBe("not your suggestion");
		expect((await push(ctx.app, sam, [withdraw()])).results[0]?.status).toBe(
			"applied",
		);
		expect(row()?.status).toBe("withdrawn");
		expect(await reason(sam, withdraw())).toBe(
			"suggestion can no longer be withdrawn",
		);

		const declinedId = randomUUID();
		await push(ctx.app, sam, [create(declinedId)]);
		await push(ctx.app, jo, [decline(declinedId)]);
		expect(
			(await push(ctx.app, sam, [withdraw(declinedId)])).results[0]?.status,
		).toBe("applied");
		expect(row(declinedId)?.status).toBe("withdrawn");

		const acceptedId = randomUUID();
		await push(ctx.app, sam, [create(acceptedId)]);
		await push(ctx.app, jo, [accept(acceptedId, randomUUID())]);
		expect(await reason(sam, withdraw(acceptedId))).toBe(
			"suggestion can no longer be withdrawn",
		);
	});

	it("lets whichever of a withdraw and an accept arrives first win", async () => {
		await push(ctx.app, sam, [create()]);
		await push(ctx.app, sam, [withdraw()]);
		const late = await push(ctx.app, jo, [accept()]);
		expect(late.results[0]).toMatchObject({
			status: "rejected",
			reason: "suggestion is no longer pending",
		});
		expect(taskRow(taskId)).toBeUndefined();
	});

	it("pokes only the sender and recipient, and the whole group on accept", async () => {
		const poked: string[] = [];
		for (const [name, id] of [
			["sam", samId],
			["jo", joId],
			["lee", leeId],
			["kim", kimId],
		] as const)
			hub.subscribe(id, () => poked.push(name));

		await push(ctx.app, sam, [create()]);
		expect(poked.sort()).toEqual(["jo", "sam"]);

		poked.length = 0;
		await push(ctx.app, jo, [decline()]);
		expect(poked.sort()).toEqual(["jo", "sam"]);

		poked.length = 0;
		const second = randomUUID();
		await push(ctx.app, sam, [create(second)]);
		poked.length = 0;
		await push(ctx.app, jo, [accept(second, randomUUID())]);
		expect(poked.sort()).toEqual(["jo", "lee", "sam"]);

		poked.length = 0;
		const third = randomUUID();
		await push(ctx.app, sam, [create(third)]);
		poked.length = 0;
		await push(ctx.app, sam, [withdraw(third)]);
		expect(poked.sort()).toEqual(["jo", "sam"]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/server test -- src/routes/sync-suggestions.test.ts`
Expected: FAIL — every push is rejected with `suggestions are not supported yet` (the stand-in from Task 1).

- [ ] **Step 3: Implement**

Create `apps/server/src/services/sync-suggestions.ts`:

```ts
import { MAX_PENDING_SUGGESTIONS, type SuggestionMutation } from "@tagteam/core";
import { and, count, eq } from "drizzle-orm";
import { suggestion, task } from "../db/schema";
import { nextSeq } from "../db/seq";
import { isActiveMember } from "./groups";
import type { Outcome, Tx } from "./sync-push";

/** The suggestion, but only to its sender or recipient: for anyone else it does not exist. */
function visibleSuggestion(tx: Tx, suggestionId: string, userId: string) {
	const row = tx
		.select()
		.from(suggestion)
		.where(eq(suggestion.id, suggestionId))
		.get();
	return row && (row.fromUserId === userId || row.toUserId === userId)
		? row
		: undefined;
}

/** Applies one suggestion mutation inside the caller's push transaction. */
export function applySuggestionMutation(
	tx: Tx,
	userId: string,
	m: SuggestionMutation,
	at: number,
): Outcome {
	if (m.type === "suggestion.create") {
		if (!isActiveMember(tx, m.groupId, userId))
			return { reason: "not a member of this group" };
		if (m.toUserId === userId)
			return { reason: "you can't suggest a task to yourself" };
		if (!isActiveMember(tx, m.groupId, m.toUserId))
			return { reason: "recipient is not a member of this group" };
		if (
			tx
				.select({ id: suggestion.id })
				.from(suggestion)
				.where(eq(suggestion.id, m.suggestionId))
				.get()
		)
			return { reason: "suggestion already exists" };
		const pending =
			tx
				.select({ value: count() })
				.from(suggestion)
				.where(
					and(
						eq(suggestion.groupId, m.groupId),
						eq(suggestion.fromUserId, userId),
						eq(suggestion.toUserId, m.toUserId),
						eq(suggestion.status, "pending"),
					),
				)
				.get()?.value ?? 0;
		if (pending >= MAX_PENDING_SUGGESTIONS)
			return { reason: "too many pending suggestions" };
		tx.insert(suggestion)
			.values({
				id: m.suggestionId,
				groupId: m.groupId,
				fromUserId: userId,
				toUserId: m.toUserId,
				title: m.title.trim(),
				notes: m.notes,
				startDate: m.startDate,
				dueTime: m.dueTime,
				rule: m.rule,
				status: "pending",
				taskId: null,
				createdAt: at,
				resolvedAt: null,
				seq: nextSeq(tx),
			})
			.run();
		return { groupId: null, pokeUserIds: [userId, m.toUserId] };
	}

	const current = visibleSuggestion(tx, m.suggestionId, userId);
	if (!current) return { reason: "suggestion not found" };
	const pair = [current.fromUserId, current.toUserId];
	const resolve = (changes: Partial<typeof suggestion.$inferInsert>) =>
		tx
			.update(suggestion)
			.set({ ...changes, resolvedAt: at, seq: nextSeq(tx) })
			.where(eq(suggestion.id, current.id))
			.run();

	switch (m.type) {
		case "suggestion.accept": {
			if (current.toUserId !== userId)
				return { reason: "suggestion is not addressed to you" };
			if (current.status !== "pending")
				return { reason: "suggestion is no longer pending" };
			if (!isActiveMember(tx, current.groupId, userId))
				return { reason: "not a member of this group" };
			if (m.startDate < current.startDate)
				return { reason: "startDate is before the suggested start" };
			if (
				tx
					.select({ id: task.id })
					.from(task)
					.where(eq(task.id, m.taskId))
					.get()
			)
				return { reason: "task already exists" };
			tx.insert(task)
				.values({
					id: m.taskId,
					groupId: current.groupId,
					ownerId: userId,
					title: current.title,
					notes: current.notes,
					timezone: m.timezone,
					startDate: m.startDate,
					rules: [
						{
							effectiveFrom: m.startDate,
							rule: current.rule,
							dueTime: current.dueTime,
						},
					],
					archivedAt: null,
					createdAt: at,
					clocks: { title: at, notes: at, schedule: at, archive: at },
					suggestedBy: current.fromUserId,
					seq: nextSeq(tx),
				})
				.run();
			resolve({ status: "accepted", taskId: m.taskId });
			return { groupId: current.groupId, pokeUserIds: pair };
		}
		case "suggestion.decline": {
			if (current.toUserId !== userId)
				return { reason: "suggestion is not addressed to you" };
			if (current.status !== "pending")
				return { reason: "suggestion is no longer pending" };
			resolve({ status: "declined" });
			return { groupId: null, pokeUserIds: pair };
		}
		case "suggestion.withdraw": {
			if (current.fromUserId !== userId) return { reason: "not your suggestion" };
			if (current.status !== "pending" && current.status !== "declined")
				return { reason: "suggestion can no longer be withdrawn" };
			resolve({ status: "withdrawn" });
			return { groupId: null, pokeUserIds: pair };
		}
	}
}
```

Edit `apps/server/src/services/sync-push.ts`:

1. Add `import { applySuggestionMutation } from "./sync-suggestions";` after the `./groups` import.

2. Replace

```ts
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Outcome = { groupId: string } | { reason: string } | { groupId: null };
```

with

```ts
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a mutation did: rejected, or applied with the group to poke and any extra users to poke. */
export type Outcome =
	| { reason: string }
	| { groupId: string | null; pokeUserIds?: string[] };
```

3. Replace the head of `applyMutations`

```ts
/** Applies client mutations in order, each atomically. Returns per-mutation results and the groups that changed. */
export function applyMutations(
	db: Db,
	userId: string,
	inputs: unknown[],
	now: number,
): { results: MutationResult[]; groupIds: Set<string> } {
	const results: MutationResult[] = [];
	const groupIds = new Set<string>();
```

with

```ts
/** Applies client mutations in order, each atomically. Returns per-mutation results, the groups that changed, and users to poke individually. */
export function applyMutations(
	db: Db,
	userId: string,
	inputs: unknown[],
	now: number,
): {
	results: MutationResult[];
	groupIds: Set<string>;
	userIds: Set<string>;
} {
	const results: MutationResult[] = [];
	const groupIds = new Set<string>();
	const userIds = new Set<string>();
```

4. Replace `if (outcome.groupId) groupIds.add(outcome.groupId);` with

```ts
				if (outcome.groupId) groupIds.add(outcome.groupId);
				for (const id of outcome.pokeUserIds ?? []) userIds.add(id);
```

5. Replace `return { results, groupIds };` with `return { results, groupIds, userIds };`.

6. Replace the Task 1 stand-in at the top of `applyOne`

```ts
	if (isSuggestionMutation(m))
		return { reason: "suggestions are not supported yet" };
```

with

```ts
	if (isSuggestionMutation(m))
		return applySuggestionMutation(tx, userId, m, at);
```

Edit `apps/server/src/routes/sync.ts`:

```ts
export interface SyncDeps {
	db: Db;
	now: () => number;
	/** Called after a push that changed data: groups whose members to poke, plus individual users to poke. */
	onChange?: (groupIds: Set<string>, userIds: Set<string>) => void;
	onNudge?: (input: {
		taskId: string;
		eventId: string;
		senderId: string;
	}) => void | Promise<void>;
}
```

In the push handler replace `const { results, groupIds } = applyMutations(` with `const { results, groupIds, userIds } = applyMutations(` and replace `if (groupIds.size > 0) deps.onChange?.(groupIds);` with

```ts
		if (groupIds.size > 0 || userIds.size > 0)
			deps.onChange?.(groupIds, userIds);
```

Edit `apps/server/src/app.ts`: replace `onChange: (groupIds) => pokeGroups(db, live, groupIds),` with

```ts
			onChange: (groupIds, userIds) =>
				pokeGroups(db, live, groupIds, userIds),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/server test -- src/routes/sync-suggestions.test.ts`
Expected: PASS (10 tests).

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (existing push tests still pass: task pokes are unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): apply suggestion mutations in sync push"
```

### Task 4: Server — pull suggestions, `suggestedBy`, and leave-group cleanup

**Files:**
- Modify: `packages/core/src/wire.ts` (TaskDto :56, PullResponse :79), `apps/server/src/services/sync-pull.ts` (:1-14, :36-43, :83-99), `apps/server/src/services/groups.ts` (imports :3,5; `leaveGroup` :96)
- Modify (keep the web compiling): `apps/web/src/store/apply.ts`, `apps/web/src/store/apply.test.ts`, `apps/web/src/sync/engine.test.ts`, `apps/web/src/features/today/model.test.ts`, `apps/web/src/features/today/TodayScreen.test.tsx`
- Test: `apps/server/src/routes/sync-suggestions.test.ts` (append inside the existing `describe("suggestion mutations", ...)`)

**Interfaces:**
- Consumes: `suggestion` table and `task.suggestedBy` (Task 2); `SuggestionDto` (Task 1); rejection reasons and push behaviour of Task 3. Test-file locals from Task 3: `ctx`, `sam/jo/kim/lee` (cookies), `samId/joId/kimId/leeId`, `groupId`, `suggestionId`, `taskId`, `join(cookie)`, `create(id?, to?)`, `accept(id?, taskId?, startDate?)`, `decline(id?)`, `withdraw(id?)`, `row(id?)`, `taskRow(id)`; helper `pullAll` from `../test/sync-helpers`.
- Produces:
  - `TaskDto.suggestedBy: string | null`; `PullResponse.suggestions: SuggestionDto[]` (core `wire.ts`).
  - `pull(db, userId, cursor)` returns `suggestions` only for rows whose sender or recipient is `userId`, in groups visible under the existing cursor/fresh rules, ordered by `seq`. `SuggestionDto` carries no `seq`.
  - `leaveGroup(db, groupId, userId, now)` additionally sets `status = "withdrawn"`, `resolvedAt = now`, `seq` (the same `seq` as the membership change) on: pending suggestions in that group sent to or by the leaver, and declined suggestions in that group sent by the leaver. Declined suggestions sent *to* the leaver stay declined.

- [ ] **Step 1: Write the failing tests**

Add `pullAll` to the existing import `import { mutation, push, userIdOf } from "../test/sync-helpers";` so it reads `import { mutation, pullAll, push, userIdOf } from "../test/sync-helpers";`.

Insert these tests inside `describe("suggestion mutations", ...)` in `apps/server/src/routes/sync-suggestions.test.ts`, after the last existing `it(...)` and before the closing `});`:

```ts
	it("pulls a suggestion to its sender and recipient only", async () => {
		await push(ctx.app, sam, [create()]);
		const expected = {
			id: suggestionId,
			groupId,
			fromUserId: samId,
			toUserId: joId,
			title: "Wash dishes",
			notes: null,
			startDate: "2026-10-01",
			dueTime: "19:00",
			rule: { freq: "day", interval: 1 },
			status: "pending",
			taskId: null,
			createdAt: ctx.clock.now,
			resolvedAt: null,
		};
		expect((await pullAll(ctx.app, sam)).suggestions).toEqual([expected]);
		expect((await pullAll(ctx.app, jo)).suggestions).toEqual([expected]);
		// Lee is in the group but is not a party; Kim is not in the group.
		expect((await pullAll(ctx.app, lee)).suggestions).toEqual([]);
		expect((await pullAll(ctx.app, kim)).suggestions).toEqual([]);
	});

	it("returns a changed suggestion after the cursor and nothing when nothing changed", async () => {
		await push(ctx.app, sam, [create()]);
		const { cursor } = await pullAll(ctx.app, jo);
		expect((await pullAll(ctx.app, jo, cursor)).suggestions).toEqual([]);

		ctx.clock.now += 1000;
		await push(ctx.app, jo, [decline()]);
		const after = await pullAll(ctx.app, sam, cursor);
		expect(after.suggestions).toMatchObject([
			{ id: suggestionId, status: "declined", resolvedAt: ctx.clock.now },
		]);
		expect(after.tasks).toEqual([]);
	});

	it("shows an accepted task to the whole group with who suggested it, but not the suggestion", async () => {
		await push(ctx.app, sam, [create()]);
		await push(ctx.app, jo, [accept()]);
		const ordinaryId = randomUUID();
		await push(ctx.app, jo, [
			mutation(
				"task.create",
				{
					taskId: ordinaryId,
					groupId,
					title: "Bins",
					notes: null,
					timezone: "UTC",
					startDate: "2026-10-01",
					dueTime: null,
					rule: null,
				},
				ctx.clock.now,
			),
		]);
		await join(kim);
		const view = await pullAll(ctx.app, kim);
		const byId = new Map(view.tasks.map((t) => [t.id, t]));
		expect(byId.get(taskId)).toMatchObject({ ownerId: joId, suggestedBy: samId });
		expect(byId.get(ordinaryId)?.suggestedBy).toBeNull();
		expect(view.suggestions).toEqual([]);
	});

	it("withdraws suggestions that can no longer be answered when a member leaves", async () => {
		const ids = {
			toJoPending: randomUUID(),
			toJoDeclined: randomUUID(),
			fromJoPending: randomUUID(),
			fromJoDeclined: randomUUID(),
			toLeePending: randomUUID(),
			toLeeAccepted: randomUUID(),
		};
		await push(ctx.app, sam, [
			create(ids.toJoPending),
			create(ids.toJoDeclined),
			create(ids.toLeePending, leeId),
			create(ids.toLeeAccepted, leeId),
		]);
		await push(ctx.app, jo, [
			decline(ids.toJoDeclined),
			create(ids.fromJoPending, samId),
			create(ids.fromJoDeclined, samId),
		]);
		await push(ctx.app, sam, [decline(ids.fromJoDeclined)]);
		await push(ctx.app, lee, [accept(ids.toLeeAccepted, randomUUID())]);
		const samCursor = (await pullAll(ctx.app, sam)).cursor;
		const joCursor = (await pullAll(ctx.app, jo)).cursor;

		await api(ctx.app, jo, "POST", `/api/groups/${groupId}/leave`);

		const status = (id: string) => row(id)?.status;
		expect(status(ids.toJoPending)).toBe("withdrawn");
		expect(status(ids.fromJoPending)).toBe("withdrawn");
		expect(status(ids.fromJoDeclined)).toBe("withdrawn");
		expect(row(ids.toJoPending)?.resolvedAt).toBe(ctx.clock.now);
		// Declined suggestions sent to the leaver, and unrelated ones, are untouched.
		expect(status(ids.toJoDeclined)).toBe("declined");
		expect(status(ids.toLeePending)).toBe("pending");
		expect(status(ids.toLeeAccepted)).toBe("accepted");

		const samAfter = await pullAll(ctx.app, sam, samCursor);
		expect(samAfter.suggestions.map((s) => [s.id, s.status]).sort()).toEqual(
			[
				[ids.fromJoDeclined, "withdrawn"],
				[ids.fromJoPending, "withdrawn"],
				[ids.toJoPending, "withdrawn"],
			].sort(),
		);
		const joAfter = await pullAll(ctx.app, jo, joCursor);
		expect(joAfter.suggestions).toEqual([]);
		expect(joAfter.removedGroupIds).toEqual([groupId]);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/server test -- src/routes/sync-suggestions.test.ts`
Expected: FAIL — `suggestions` is `undefined` in pull responses (and `suggestedBy` is missing, and the leave test finds statuses unchanged). The test file may also fail typecheck until the wire types exist; that is expected at this point.

- [ ] **Step 3: Implement — core wire types**

In `packages/core/src/wire.ts`, add to `TaskDto` after `createdAt: number;`:

```ts
	/** User id of whoever suggested this task, when it began as an accepted suggestion. */
	suggestedBy: string | null;
```

and to `PullResponse` after `events: EventDto[];`:

```ts
	/** Suggestions the caller sent or received; never anyone else's. */
	suggestions: SuggestionDto[];
```

- [ ] **Step 4: Implement — server pull**

In `apps/server/src/services/sync-pull.ts`:

1. Add `SuggestionDto` to the `@tagteam/core` type import and to the `export type { ... }` line.
2. Add `suggestion` to the schema import: `import { groups, membership, profile, suggestion, task, taskEvent } from "../db/schema";`.
3. In the `empty` object add `suggestions: [],` after `events: [],`.
4. In the `tasks` select add `suggestedBy: task.suggestedBy,` after `createdAt: task.createdAt,`.
5. After the `events: tx.select(...)...all(),` entry (the last property of the returned object) add:

```ts
			// The only per-user filter in pull, and the only place the privacy rule lives:
			// a suggestion belongs to its sender and recipient, not to the group.
			suggestions: tx
				.select({
					id: suggestion.id,
					groupId: suggestion.groupId,
					fromUserId: suggestion.fromUserId,
					toUserId: suggestion.toUserId,
					title: suggestion.title,
					notes: suggestion.notes,
					startDate: suggestion.startDate,
					dueTime: suggestion.dueTime,
					rule: suggestion.rule,
					status: suggestion.status,
					taskId: suggestion.taskId,
					createdAt: suggestion.createdAt,
					resolvedAt: suggestion.resolvedAt,
				})
				.from(suggestion)
				.where(
					and(
						visible(suggestion.groupId, suggestion.seq),
						or(
							eq(suggestion.fromUserId, userId),
							eq(suggestion.toUserId, userId),
						),
					),
				)
				.orderBy(suggestion.seq)
				.all(),
```

- [ ] **Step 5: Implement — leave group**

In `apps/server/src/services/groups.ts` change the imports to

```ts
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { groups, membership, profile, suggestion } from "../db/schema";
```

and in `leaveGroup`, directly after the `tx.update(membership)...run();` statement and before `const current = tx`, insert:

```ts
		// Nobody is left to answer these or to read their answers: withdraw what is
		// still pending to or from the leaver, and declined suggestions they sent.
		tx.update(suggestion)
			.set({ status: "withdrawn", resolvedAt: now, seq })
			.where(
				and(
					eq(suggestion.groupId, groupId),
					or(
						and(
							eq(suggestion.status, "pending"),
							or(
								eq(suggestion.fromUserId, userId),
								eq(suggestion.toUserId, userId),
							),
						),
						and(
							eq(suggestion.status, "declined"),
							eq(suggestion.fromUserId, userId),
						),
					),
				),
			)
			.run();
```

- [ ] **Step 6: Implement — keep the web compiling**

The new required fields break web fixtures and one object literal. Make these mechanical edits (Task 6 does the real web work):

- `apps/web/src/store/apply.ts`: in `case "task.create"`, add `suggestedBy: null,` after `createdAt: m.at,`.
- `apps/web/src/store/apply.test.ts`: in `serverTask` add `suggestedBy: null,` after `createdAt: at,`; in the `pull` helper add `suggestions: [],` after `events: [],`.
- `apps/web/src/sync/engine.test.ts`: in `emptyPull` add `suggestions: [],` after `events: [],`.
- `apps/web/src/features/today/model.test.ts`: in the `task` helper add `suggestedBy: null,` after `createdAt: 0,`.
- `apps/web/src/features/today/TodayScreen.test.tsx`: in `brushTeeth` add `suggestedBy: null,` after `createdAt: 0,`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/server test -- src/routes/sync-suggestions.test.ts`
Expected: PASS (14 tests).

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (existing pull tests are unaffected: ordinary tasks now carry `suggestedBy: null`).

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/server/src apps/web/src
git commit -m "feat(server): pull suggestions to sender and recipient and clean up on leave"
```

### Task 5: Server — push notifications for suggestions

**Files:**
- Modify: `apps/server/src/services/notifications.ts` (kinds :25, `notificationEnabled` :98, `deliverPending` :110-161, `enqueueNotification` :257, new `sendSuggestionNotification` after `sendNudgeNotification` :305), `apps/server/src/routes/sync.ts` (deps and push handler), `apps/server/src/app.ts` (:18, :70)
- Modify test helper: `apps/server/src/test/harness.ts`
- Test: `apps/server/src/services/notifications.test.ts` (append a describe), `apps/server/src/routes/suggestion-push.test.ts` (new)

**Interfaces:**
- Consumes: `suggestion` table and `notificationLog.suggestionId`/new kinds (Task 2); `applyMutations` outcome pokes and `SyncDeps` (Task 3); existing `getNotificationSettings`, `deliverPending`, `enqueueNotification`, `inQuietHours`.
- Produces:
  - `export type SuggestionPushEvent = "suggested" | "accepted" | "declined"` and `sendSuggestionNotification(db: Db, push: PushTransport, input: { suggestionId: string; event: SuggestionPushEvent }, now: number): Promise<void>` from `services/notifications.ts`. "suggested" goes to the suggestion's `toUserId`, "accepted" and "declined" to its `fromUserId`. Titles: `"{sender} suggests a task"`, `"{recipient} accepted your suggestion"`, `"{recipient} declined your suggestion"`; body is the suggestion title; url `/`. Log rows use `taskId: null`, `suggestionId`, `occurrenceKey = suggestionId`, kinds `suggested | suggestion_accepted | suggestion_declined`.
  - `SyncDeps.onSuggestion?: (input: { suggestionId: string; event: SuggestionPushEvent }) => void | Promise<void>`, called after an applied `suggestion.create` ("suggested"), `suggestion.accept` ("accepted") or `suggestion.decline` ("declined"); never for `suggestion.withdraw`.
  - `createTestContext({ webDir?, live?, push? })`.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/test/harness.ts` — add `import type { PushTransport } from "../services/push";` and extend the options and the `createApp` call:

```ts
export function createTestContext(
	options: { webDir?: string; live?: LiveHub; push?: PushTransport } = {},
): TestContext {
	const clock = { now: Date.UTC(2026, 8, 25, 12) };
	const { db, close } = openDb(":memory:");
	const auth = createAuth(db, TEST_CONFIG);
	const app = createApp({
		db,
		auth,
		trustedOrigin: TEST_CONFIG.baseUrl,
		now: () => clock.now,
		webDir: options.webDir,
		live: options.live,
		push: options.push,
	});
	return { db, app, clock, close };
}
```

In `apps/server/src/services/notifications.test.ts`: add `import { eq } from "drizzle-orm";` at the top; add `profile` and `suggestion` to the `../db/schema` import list; change `import { runNotificationSweep } from "./notifications";` to `import { runNotificationSweep, sendSuggestionNotification } from "./notifications";`. Append this describe at the end of the file:

```ts
describe("suggestion notifications", () => {
	let db: Db;
	let close: () => void;
	const push = {
		publicKey: "test",
		send: vi.fn(async (_subscription: unknown, _payload: string) => {}),
	};
	const sent = () =>
		push.send.mock.calls.map(([subscription, payload]) => ({
			endpoint: (subscription as { endpoint: string }).endpoint,
			...(JSON.parse(payload) as Record<string, string>),
		}));
	const tell = (
		event: "suggested" | "accepted" | "declined",
		now = time("12:00"),
	) => sendSuggestionNotification(db, push, { suggestionId: "suggestion", event }, now);
	const nextMorning = atTime("2026-09-28", "08:00", timezone);

	beforeEach(() => {
		({ db, close } = openDb(":memory:"));
		push.send.mockClear();
		db.insert(user)
			.values([
				{ id: "sender", name: "Sam", email: "sam@example.com" },
				{ id: "recipient", name: "Jo", email: "jo@example.com" },
			])
			.run();
		db.insert(profile)
			.values([
				{
					userId: "sender",
					displayName: "Sam",
					avatarColor: "blue",
					timezone,
					createdAt: 0,
					updatedAt: 0,
				},
				{
					userId: "recipient",
					displayName: "Jo",
					avatarColor: "green",
					timezone,
					createdAt: 0,
					updatedAt: 0,
				},
			])
			.run();
		db.insert(groups)
			.values({ id: "group", name: "Home", createdBy: "sender", createdAt: 0 })
			.run();
		db.insert(suggestion)
			.values({
				id: "suggestion",
				groupId: "group",
				fromUserId: "sender",
				toUserId: "recipient",
				title: "Wash dishes",
				startDate: day,
				status: "pending",
				createdAt: 0,
				seq: 1,
			})
			.run();
		db.insert(notificationSettings)
			.values([
				{ userId: "sender", updatedAt: 0 },
				{ userId: "recipient", updatedAt: 0 },
			])
			.run();
		db.insert(pushSubscription)
			.values(
				(["sender", "recipient"] as const).map((userId) => ({
					id: `${userId}-device`,
					userId,
					endpoint: `https://fcm.googleapis.com/${userId}`,
					p256dh: "key",
					auth: "auth",
					deviceLabel: "Phone",
					createdAt: 0,
				})),
			)
			.run();
	});
	afterEach(() => close());

	it("tells the recipient about a new suggestion", async () => {
		await tell("suggested");
		expect(sent()).toEqual([
			{
				endpoint: "https://fcm.googleapis.com/recipient",
				title: "Sam suggests a task",
				body: "Wash dishes",
				url: "/",
			},
		]);
		expect(db.select().from(notificationLog).all()).toMatchObject([
			{
				kind: "suggested",
				userId: "recipient",
				taskId: null,
				suggestionId: "suggestion",
				occurrenceKey: "suggestion",
				sentAt: time("12:00"),
			},
		]);
	});

	it.each([
		{
			event: "accepted",
			kind: "suggestion_accepted",
			title: "Jo accepted your suggestion",
		},
		{
			event: "declined",
			kind: "suggestion_declined",
			title: "Jo declined your suggestion",
		},
	] as const)("tells the sender when it is $event", async ({ event, kind, title }) => {
		await tell(event);
		expect(sent()).toEqual([
			{
				endpoint: "https://fcm.googleapis.com/sender",
				title,
				body: "Wash dishes",
				url: "/",
			},
		]);
		expect(db.select().from(notificationLog).all()).toMatchObject([
			{ kind, userId: "sender" },
		]);
	});

	it("sends each kind at most once per suggestion", async () => {
		await tell("suggested");
		await tell("suggested", time("12:05"));
		await tell("accepted", time("12:10"));
		await tell("accepted", time("12:15"));
		expect(push.send).toHaveBeenCalledTimes(2);
		expect(db.select().from(notificationLog).all()).toHaveLength(2);
	});

	it("follows the receiving user's nudge toggle and its cutoff, not the reminders toggle", async () => {
		const recipient = eq(notificationSettings.userId, "recipient");
		db.update(notificationSettings)
			.set({ nudgesEnabled: false })
			.where(recipient)
			.run();
		await tell("suggested");
		expect(push.send).not.toHaveBeenCalled();
		expect(db.select().from(notificationLog).all()).toEqual([]);

		db.update(notificationSettings)
			.set({ nudgesEnabled: true, nudgesEnabledAt: time("12:00") + 1 })
			.where(recipient)
			.run();
		await tell("suggested");
		expect(push.send).not.toHaveBeenCalled();

		db.update(notificationSettings)
			.set({ nudgesEnabledAt: 0, remindersEnabled: false })
			.where(recipient)
			.run();
		await tell("suggested");
		expect(push.send).toHaveBeenCalledTimes(1);
	});

	it("holds a suggestion push during the recipient's quiet hours and delivers it after", async () => {
		await tell("suggested", time("23:00"));
		expect(push.send).not.toHaveBeenCalled();
		expect(db.select().from(notificationLog).all()).toMatchObject([
			{ sentAt: null },
		]);
		await runNotificationSweep(db, push, time("23:30"));
		expect(push.send).not.toHaveBeenCalled();
		await runNotificationSweep(db, push, nextMorning);
		expect(push.send).toHaveBeenCalledTimes(1);
		await runNotificationSweep(db, push, nextMorning + 60_000);
		expect(push.send).toHaveBeenCalledTimes(1);
	});

	it("drops a held suggested push if the suggestion is no longer pending", async () => {
		await tell("suggested", time("23:00"));
		db.update(suggestion).set({ status: "withdrawn" }).run();
		await runNotificationSweep(db, push, nextMorning);
		expect(push.send).not.toHaveBeenCalled();
		expect(db.select().from(notificationLog).all()).toMatchObject([
			{ sentAt: nextMorning },
		]);
		expect(db.select().from(notificationDelivery).all()).toMatchObject([
			{ status: "gone" },
		]);
	});

	it("still delivers a held accepted notice after the suggestion has resolved", async () => {
		await tell("accepted", time("23:00"));
		db.update(suggestion).set({ status: "accepted" }).run();
		await runNotificationSweep(db, push, nextMorning);
		expect(sent()).toMatchObject([
			{ endpoint: "https://fcm.googleapis.com/sender" },
		]);
	});
});
```

Create `apps/server/src/routes/suggestion-push.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationLog, notificationSettings, pushSubscription } from "../db/schema";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, push, userIdOf } from "../test/sync-helpers";

describe("suggestion push notifications over sync", () => {
	const send = vi.fn(async (_subscription: unknown, _payload: string) => {});
	let ctx: TestContext;
	let sam: string;
	let jo: string;
	let groupId: string;

	const create = (suggestionId: string, toUserId: string) =>
		mutation(
			"suggestion.create",
			{
				suggestionId,
				groupId,
				toUserId,
				title: "Wash dishes",
				notes: null,
				startDate: "2026-10-01",
				dueTime: null,
				rule: null,
			},
			ctx.clock.now,
		);
	const payload = (call: number) =>
		JSON.parse(send.mock.calls[call]?.[1] ?? "{}") as Record<string, string>;
	const endpoint = (call: number) =>
		(send.mock.calls[call]?.[0] as { endpoint: string }).endpoint;

	beforeEach(async () => {
		send.mockClear();
		ctx = createTestContext({ push: { publicKey: "test", send } });
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
		jo = await signUp(ctx.app, "jo@example.com", "Jo");
		groupId = (
			await readJson<{ group: { id: string } }>(
				await api(ctx.app, sam, "POST", "/api/groups", { name: "Smiths" }),
			)
		).group.id;
		const { code } = await readJson<{ code: string }>(
			await api(ctx.app, sam, "POST", `/api/groups/${groupId}/invites`),
		);
		await api(ctx.app, jo, "POST", "/api/invites/redeem", { code });
		// Explicit settings and devices that predate the test clock, so opt-in cutoffs never apply.
		for (const email of ["sam@example.com", "jo@example.com"]) {
			const userId = userIdOf(ctx.db, email);
			ctx.db.insert(notificationSettings).values({ userId, updatedAt: 0 }).run();
			ctx.db
				.insert(pushSubscription)
				.values({
					id: `${userId}-device`,
					userId,
					endpoint: `https://fcm.googleapis.com/${email.split("@")[0]}`,
					p256dh: "key",
					auth: "auth",
					deviceLabel: "Phone",
					createdAt: 0,
				})
				.run();
		}
	});
	afterEach(() => ctx.close());

	it("notifies the recipient of a suggestion and the sender of an answer, but never of a withdrawal", async () => {
		const joId = userIdOf(ctx.db, "jo@example.com");
		const first = randomUUID();
		const second = randomUUID();
		const third = randomUUID();

		await push(ctx.app, sam, [create(first, joId)]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(endpoint(0)).toBe("https://fcm.googleapis.com/jo");
		expect(payload(0)).toEqual({
			title: "Sam suggests a task",
			body: "Wash dishes",
			url: "/",
		});

		await push(ctx.app, jo, [
			mutation(
				"suggestion.accept",
				{
					suggestionId: first,
					taskId: randomUUID(),
					timezone: "UTC",
					startDate: "2026-10-01",
				},
				ctx.clock.now,
			),
		]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		expect(endpoint(1)).toBe("https://fcm.googleapis.com/sam");
		expect(payload(1).title).toBe("Jo accepted your suggestion");

		await push(ctx.app, sam, [create(second, joId)]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
		await push(ctx.app, jo, [
			mutation("suggestion.decline", { suggestionId: second }, ctx.clock.now),
		]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
		expect(endpoint(3)).toBe("https://fcm.googleapis.com/sam");
		expect(payload(3).title).toBe("Jo declined your suggestion");

		await push(ctx.app, sam, [create(third, joId)]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5));
		await push(ctx.app, sam, [
			mutation("suggestion.withdraw", { suggestionId: third }, ctx.clock.now),
		]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(send).toHaveBeenCalledTimes(5);
		expect(ctx.db.select().from(notificationLog).all()).toHaveLength(5);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/server test -- src/services/notifications.test.ts src/routes/suggestion-push.test.ts`
Expected: FAIL — `sendSuggestionNotification` is not exported, and the route test never sees a push.

- [ ] **Step 3: Implement — notifications service**

In `apps/server/src/services/notifications.ts`:

1. Add `suggestion` to the `../db/schema` import (alphabetical: after `pushSubscription`).

2. Replace `type NotificationKind = "due" | "overdue" | "nudge";` with:

```ts
type NotificationKind =
	| "due"
	| "overdue"
	| "nudge"
	| "suggested"
	| "suggestion_accepted"
	| "suggestion_declined";

/** Kinds that follow the user's nudge toggle; reminders follow the reminders toggle. */
const NUDGE_TOGGLE_KINDS: ReadonlySet<NotificationKind> = new Set([
	"nudge",
	"suggested",
	"suggestion_accepted",
	"suggestion_declined",
]);
const usesNudgeToggle = (kind: NotificationKind) =>
	NUDGE_TOGGLE_KINDS.has(kind);

export type SuggestionPushEvent = "suggested" | "accepted" | "declined";
```

3. In `notificationEnabled` replace `return kind === "nudge"` with `return usesNudgeToggle(kind)`.

4. Directly above `async function deliverPending(`, add:

```ts
function dropNotification(
	db: Db,
	notificationId: string,
	reason: string,
	now: number,
) {
	db.update(notificationDelivery)
		.set({ status: "gone", lastError: reason })
		.where(
			and(
				eq(notificationDelivery.notificationId, notificationId),
				eq(notificationDelivery.status, "pending"),
			),
		)
		.run();
	db.update(notificationLog)
		.set({ sentAt: now })
		.where(eq(notificationLog.id, notificationId))
		.run();
}

function suggestionIsPending(db: Db, suggestionId: string | null): boolean {
	if (!suggestionId) return false;
	return (
		db
			.select({ status: suggestion.status })
			.from(suggestion)
			.where(eq(suggestion.id, suggestionId))
			.get()?.status === "pending"
	);
}
```

5. In `deliverPending`, replace this block (from `const settings = getNotificationSettings(db, log.userId);` through the closing brace of the `if (log.createdAt < enabledAt) { ... }`):

```ts
		const settings = getNotificationSettings(db, log.userId);
		const enabled =
			log.kind === "nudge" ? settings.nudgesEnabled : settings.remindersEnabled;
		if (!enabled) continue;
		const enabledAt =
			log.kind === "nudge"
				? settings.nudgesEnabledAt
				: settings.remindersEnabledAt;
		if (log.createdAt < enabledAt) {
			db.update(notificationDelivery)
				.set({ status: "gone", lastError: "Notification predates opt-in" })
				.where(
					and(
						eq(notificationDelivery.notificationId, log.id),
						eq(notificationDelivery.status, "pending"),
					),
				)
				.run();
			db.update(notificationLog)
				.set({ sentAt: now })
				.where(eq(notificationLog.id, log.id))
				.run();
			continue;
		}
```

with:

```ts
		const settings = getNotificationSettings(db, log.userId);
		const nudgeToggle = usesNudgeToggle(log.kind);
		const enabled = nudgeToggle
			? settings.nudgesEnabled
			: settings.remindersEnabled;
		if (!enabled) continue;
		const enabledAt = nudgeToggle
			? settings.nudgesEnabledAt
			: settings.remindersEnabledAt;
		if (log.createdAt < enabledAt) {
			dropNotification(db, log.id, "Notification predates opt-in", now);
			continue;
		}
		// A held "suggested" push is pointless once the suggestion has been answered or withdrawn.
		if (log.kind === "suggested" && !suggestionIsPending(db, log.suggestionId)) {
			dropNotification(db, log.id, "Suggestion is no longer pending", now);
			continue;
		}
```

Leave the next block (`if (log.kind !== "nudge") { ... inQuietHours ... continue; }`) unchanged: every kind except nudges, including the three suggestion kinds, waits out the recipient's quiet hours.

6. In `enqueueNotification`'s `input` type change `taskId: string;` to:

```ts
			taskId: string | null;
			suggestionId?: string | null;
```

7. After `sendNudgeNotification`, add:

```ts
export async function sendSuggestionNotification(
	db: Db,
	push: PushTransport,
	input: { suggestionId: string; event: SuggestionPushEvent },
	now: number,
) {
	const target = db
		.select({
			id: suggestion.id,
			fromUserId: suggestion.fromUserId,
			toUserId: suggestion.toUserId,
			title: suggestion.title,
		})
		.from(suggestion)
		.where(eq(suggestion.id, input.suggestionId))
		.get();
	if (!target) return;
	// "suggested" goes to the recipient about the sender; answers go to the sender about the recipient.
	const actorId =
		input.event === "suggested" ? target.fromUserId : target.toUserId;
	const receiverId =
		input.event === "suggested" ? target.toUserId : target.fromUserId;
	const actor =
		db
			.select({ displayName: profile.displayName })
			.from(profile)
			.where(eq(profile.userId, actorId))
			.get()?.displayName ?? "A teammate";
	const copy = {
		suggested: {
			kind: "suggested",
			title: `${actor} suggests a task`,
		},
		accepted: {
			kind: "suggestion_accepted",
			title: `${actor} accepted your suggestion`,
		},
		declined: {
			kind: "suggestion_declined",
			title: `${actor} declined your suggestion`,
		},
	} as const;
	const { kind, title } = copy[input.event];
	enqueueNotification(
		db,
		{
			taskId: null,
			suggestionId: target.id,
			userId: receiverId,
			occurrenceKey: target.id,
			kind,
			scheduledAt: now,
			title,
			body: target.title,
			url: "/",
		},
		now,
	);
	await deliverPending(db, push, now);
}
```

- [ ] **Step 4: Implement — route hook and app wiring**

In `apps/server/src/routes/sync.ts`:

1. Add `import type { SuggestionPushEvent } from "../services/notifications";` and, below the imports:

```ts
const SUGGESTION_EVENTS = new Map<string, SuggestionPushEvent>([
	["suggestion.create", "suggested"],
	["suggestion.accept", "accepted"],
	["suggestion.decline", "declined"],
]);
```

2. In `SyncDeps` add after `onNudge`:

```ts
	/** Called for each applied suggestion.create/accept/decline; never for withdraw. */
	onSuggestion?: (input: {
		suggestionId: string;
		event: SuggestionPushEvent;
	}) => void | Promise<void>;
```

3. In the push handler loop, extend the local `mutation` type to include `suggestionId?: unknown;` and add, after the `if (...task.nudge...) { ... }` block and still inside the `for` loop:

```ts
				const event =
					typeof mutation?.type === "string"
						? SUGGESTION_EVENTS.get(mutation.type)
						: undefined;
				if (
					results[index]?.status === "applied" &&
					event &&
					typeof mutation?.suggestionId === "string"
				) {
					const suggestion = { suggestionId: mutation.suggestionId, event };
					void Promise.resolve()
						.then(() => deps.onSuggestion?.(suggestion))
						.catch((error: unknown) =>
							console.error("Suggestion push failed", error),
						);
				}
```

In `apps/server/src/app.ts` change the notifications import to `import { sendNudgeNotification, sendSuggestionNotification } from "./services/notifications";` and add, after the `onNudge` entry in the `syncRoutes({...})` call:

```ts
				onSuggestion: push
					? (input) => sendSuggestionNotification(db, push, input, now())
					: undefined,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/server test -- src/services/notifications.test.ts src/routes/suggestion-push.test.ts`
Expected: PASS.

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (existing reminder and nudge tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): send push notifications for suggestions"
```

### Task 6: Web — local store for suggestions

**Files:**
- Modify: `apps/web/src/store/db.ts` (:1-7, :28-45), `apps/web/src/store/apply.ts` (whole file), `apps/web/src/sync/engine.ts` (:93-96)
- Test: `apps/web/src/store/apply.test.ts` (append), `apps/web/src/sync/engine.test.ts` (append one test)

**Interfaces:**
- Consumes: `SuggestionDto`, the four suggestion `Mutation`s, `TaskDto.suggestedBy`, `PullResponse.suggestions` (Tasks 1 and 4); existing `applyLocal`, `applyPull`, `removeGroup`.
- Produces:
  - `TagTeamDb.suggestions: EntityTable<SuggestionDto, "id">`, a Dexie `version(2)` table `"id, groupId"`.
  - `applyLocal(store, m, me)` handles, for the local user `me`:
    - `suggestion.create` → puts a `pending` row (`fromUserId = me.userId`, `title` trimmed, `taskId: null`, `createdAt = m.at`, `resolvedAt: null`).
    - `suggestion.accept` → if the row exists and is `pending`: puts a task (`ownerId = me.userId`, `title`/`notes` from the suggestion, `timezone`/`startDate` from the mutation, `rules: [{ effectiveFrom: m.startDate, rule: s.rule, dueTime: s.dueTime }]`, `archivedAt: null`, `createdAt = m.at`, `suggestedBy = s.fromUserId`) and sets the row to `accepted` with `taskId` and `resolvedAt = m.at`; otherwise does nothing.
    - `suggestion.decline` → `pending` → `declined`, `resolvedAt = m.at`.
    - `suggestion.withdraw` → `pending` or `declined` → `withdrawn`, `resolvedAt = m.at`.
  - `applyPull` upserts `pull.suggestions`, deletes a removed group's suggestions, clears suggestions on `reset`, and re-applies pending outbox mutations on top as before.
  - The sync engine's `enqueue` transaction includes `store.suggestions`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/store/apply.test.ts` change the first import to `import type { Mutation, PullResponse, SuggestionDto, TaskDto } from "@tagteam/core";`, then add these declarations after the `serverTask` helper:

```ts
const suggestionId = "44444444-4444-4444-8444-444444444444";
const newTaskId = "55555555-5555-4555-8555-555555555555";
const serverSuggestion = (patch: Partial<SuggestionDto> = {}): SuggestionDto => ({
	id: suggestionId,
	groupId,
	fromUserId: "u2",
	toUserId: "u1",
	title: "Wash dishes",
	notes: null,
	startDate: "2026-09-21",
	dueTime: "19:00",
	rule: { freq: "day", interval: 1 },
	status: "pending",
	taskId: null,
	createdAt: at,
	resolvedAt: null,
	...patch,
});
const accept = (): Mutation => ({
	id: id(),
	at: at + 5,
	type: "suggestion.accept",
	suggestionId,
	taskId: newTaskId,
	timezone: "Europe/London",
	startDate: "2026-09-23",
});
```

Append these `describe` blocks at the end of the file:

```ts
describe("applyLocal suggestions", () => {
	it("records a pending suggestion from me", async () => {
		await applyLocal(
			db,
			{
				id: id(),
				at,
				type: "suggestion.create",
				suggestionId,
				groupId,
				toUserId: "u2",
				title: " Wash dishes ",
				notes: null,
				startDate: "2026-09-21",
				dueTime: "19:00",
				rule: { freq: "day", interval: 1 },
			},
			me,
		);
		expect(await db.suggestions.get(suggestionId)).toEqual({
			id: suggestionId,
			groupId,
			fromUserId: "u1",
			toUserId: "u2",
			title: "Wash dishes",
			notes: null,
			startDate: "2026-09-21",
			dueTime: "19:00",
			rule: { freq: "day", interval: 1 },
			status: "pending",
			taskId: null,
			createdAt: at,
			resolvedAt: null,
		});
	});

	it("accepting writes my own task with the suggester recorded and resolves the suggestion", async () => {
		await db.suggestions.put(serverSuggestion());
		await applyLocal(db, accept(), me);
		expect(await db.tasks.get(newTaskId)).toEqual({
			id: newTaskId,
			groupId,
			ownerId: "u1",
			title: "Wash dishes",
			notes: null,
			timezone: "Europe/London",
			startDate: "2026-09-23",
			rules: [
				{
					effectiveFrom: "2026-09-23",
					rule: { freq: "day", interval: 1 },
					dueTime: "19:00",
				},
			],
			archivedAt: null,
			createdAt: at + 5,
			suggestedBy: "u2",
		});
		expect(await db.suggestions.get(suggestionId)).toMatchObject({
			status: "accepted",
			taskId: newTaskId,
			resolvedAt: at + 5,
		});
	});

	it("declines a pending suggestion and withdraws a pending or declined one", async () => {
		await db.suggestions.put(serverSuggestion());
		await applyLocal(
			db,
			{ id: id(), at: at + 1, type: "suggestion.decline", suggestionId },
			me,
		);
		expect(await db.suggestions.get(suggestionId)).toMatchObject({
			status: "declined",
			resolvedAt: at + 1,
		});
		await applyLocal(
			db,
			{ id: id(), at: at + 2, type: "suggestion.withdraw", suggestionId },
			me,
		);
		expect(await db.suggestions.get(suggestionId)).toMatchObject({
			status: "withdrawn",
			resolvedAt: at + 2,
		});
	});

	it("ignores answers to suggestions that are unknown or no longer pending", async () => {
		await applyLocal(db, accept(), me);
		expect(await db.tasks.count()).toBe(0);

		await db.suggestions.put(serverSuggestion({ status: "withdrawn" }));
		await applyLocal(db, accept(), me);
		await applyLocal(
			db,
			{ id: id(), at, type: "suggestion.decline", suggestionId },
			me,
		);
		expect(await db.tasks.count()).toBe(0);
		expect((await db.suggestions.get(suggestionId))?.status).toBe("withdrawn");

		await db.suggestions.put(serverSuggestion({ status: "accepted" }));
		await applyLocal(
			db,
			{ id: id(), at, type: "suggestion.withdraw", suggestionId },
			me,
		);
		expect((await db.suggestions.get(suggestionId))?.status).toBe("accepted");
	});
});

describe("applyPull suggestions", () => {
	it("mirrors suggestions the server returned", async () => {
		await applyPull(db, pull({ suggestions: [serverSuggestion()] }), me);
		expect(await db.suggestions.toArray()).toEqual([serverSuggestion()]);
		await applyPull(
			db,
			pull({ suggestions: [serverSuggestion({ status: "declined" })] }),
			me,
		);
		expect((await db.suggestions.get(suggestionId))?.status).toBe("declined");
	});

	it("keeps a queued accept on top of an older pull", async () => {
		await db.outbox.add({ mutation: accept() });
		await applyPull(db, pull({ suggestions: [serverSuggestion()] }), me);
		expect((await db.suggestions.get(suggestionId))?.status).toBe("accepted");
		expect((await db.tasks.get(newTaskId))?.suggestedBy).toBe("u2");
	});

	it("drops the suggestions of groups the user left", async () => {
		await applyPull(
			db,
			pull({
				groups: [{ id: groupId, name: "Smiths" }],
				suggestions: [serverSuggestion()],
			}),
			me,
		);
		await applyPull(db, pull({ removedGroupIds: [groupId] }), me);
		expect(await db.suggestions.count()).toBe(0);
	});

	it("rebuilds suggestions from scratch on reset", async () => {
		await db.suggestions.put(serverSuggestion({ id: "local-only" }));
		await applyPull(db, pull({ suggestions: [serverSuggestion()] }), me, {
			reset: true,
		});
		expect((await db.suggestions.toArray()).map((s) => s.id)).toEqual([
			suggestionId,
		]);
	});
});
```

In `apps/web/src/sync/engine.test.ts` add this test inside `describe("sync engine", ...)`, after `rebuilds from scratch after a rejection`:

```ts
	it("applies a suggestion locally at once and clears it when the server rejects it", async () => {
		const api = fakeApi((ms) =>
			ms.map((m) => ({
				id: m.id,
				status: "rejected",
				reason: "recipient is not a member of this group",
			})),
		);
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await engine.enqueue({
			id: crypto.randomUUID(),
			at: Date.now(),
			type: "suggestion.create",
			suggestionId: crypto.randomUUID(),
			groupId,
			toUserId: "u2",
			title: "Wash dishes",
			notes: null,
			startDate: "2026-09-21",
			dueTime: null,
			rule: null,
		});
		expect(await store.suggestions.count()).toBe(1);
		expect(engine.getStatus().pending).toBe(1);

		await engine.sync();
		expect(api.pull).toHaveBeenCalledWith(0);
		expect(await store.suggestions.count()).toBe(0);
		engine.dispose();
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/web test -- src/store/apply.test.ts src/sync/engine.test.ts`
Expected: FAIL — `db.suggestions` is undefined (`Cannot read properties of undefined`).

- [ ] **Step 3: Implement the Dexie table**

In `apps/web/src/store/db.ts` add `SuggestionDto` to the type import (alphabetical, after `Mutation,`), add the field `suggestions!: EntityTable<SuggestionDto, "id">;` after `events!`, and add a second schema version right after the existing `this.version(1).stores({ ... });`:

```ts
		this.version(2).stores({
			suggestions: "id, groupId",
		});
```

(Dexie keeps the version 1 tables for tables not named in a later version.)

- [ ] **Step 4: Implement the store logic**

Replace the whole of `apps/web/src/store/apply.ts` with:

```ts
import {
	type EventDto,
	type Mutation,
	type PullResponse,
	withScheduleVersion,
} from "@tagteam/core";
import { setMeta, type TagTeamDb } from "./db";

export interface LocalUser {
	userId: string;
}

/** Applies one of the user's own mutations to the local mirror (optimistic update). */
export async function applyLocal(
	store: TagTeamDb,
	m: Mutation,
	me: LocalUser,
): Promise<void> {
	const event = (
		taskId: string,
		fields: Pick<EventDto, "type" | "occurrenceKey" | "refEventId">,
	) =>
		store.events.put({
			id: m.id,
			taskId,
			userId: me.userId,
			at: m.at,
			...fields,
		});

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
				rules: [
					{ effectiveFrom: m.startDate, rule: m.rule, dueTime: m.dueTime },
				],
				archivedAt: null,
				createdAt: m.at,
				suggestedBy: null,
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
			await store.tasks.update(m.taskId, {
				archivedAt: m.archived ? m.at : null,
			});
			return;
		case "task.complete":
			if (await store.tasks.get(m.taskId))
				await event(m.taskId, {
					type: "completed",
					occurrenceKey: m.occurrenceKey,
					refEventId: null,
				});
			return;
		case "task.uncomplete":
			if (await store.tasks.get(m.taskId))
				await event(m.taskId, {
					type: "uncompleted",
					occurrenceKey: null,
					refEventId: m.refEventId,
				});
			return;
		case "task.nudge":
			if (await store.tasks.get(m.taskId))
				await event(m.taskId, {
					type: "nudged",
					occurrenceKey: null,
					refEventId: null,
				});
			return;
		case "suggestion.create":
			await store.suggestions.put({
				id: m.suggestionId,
				groupId: m.groupId,
				fromUserId: me.userId,
				toUserId: m.toUserId,
				title: m.title.trim(),
				notes: m.notes,
				startDate: m.startDate,
				dueTime: m.dueTime,
				rule: m.rule,
				status: "pending",
				taskId: null,
				createdAt: m.at,
				resolvedAt: null,
			});
			return;
		case "suggestion.accept": {
			const suggestion = await store.suggestions.get(m.suggestionId);
			if (!suggestion || suggestion.status !== "pending") return;
			await store.tasks.put({
				id: m.taskId,
				groupId: suggestion.groupId,
				ownerId: me.userId,
				title: suggestion.title,
				notes: suggestion.notes,
				timezone: m.timezone,
				startDate: m.startDate,
				rules: [
					{
						effectiveFrom: m.startDate,
						rule: suggestion.rule,
						dueTime: suggestion.dueTime,
					},
				],
				archivedAt: null,
				createdAt: m.at,
				suggestedBy: suggestion.fromUserId,
			});
			await store.suggestions.update(suggestion.id, {
				status: "accepted",
				taskId: m.taskId,
				resolvedAt: m.at,
			});
			return;
		}
		case "suggestion.decline": {
			const suggestion = await store.suggestions.get(m.suggestionId);
			if (suggestion?.status === "pending")
				await store.suggestions.update(suggestion.id, {
					status: "declined",
					resolvedAt: m.at,
				});
			return;
		}
		case "suggestion.withdraw": {
			const suggestion = await store.suggestions.get(m.suggestionId);
			if (suggestion?.status === "pending" || suggestion?.status === "declined")
				await store.suggestions.update(suggestion.id, {
					status: "withdrawn",
					resolvedAt: m.at,
				});
			return;
		}
	}
}

async function removeGroup(store: TagTeamDb, groupId: string): Promise<void> {
	const taskIds = await store.tasks
		.where("groupId")
		.equals(groupId)
		.primaryKeys();
	await store.events.where("taskId").anyOf(taskIds).delete();
	await store.tasks.bulkDelete(taskIds);
	await store.suggestions.where("groupId").equals(groupId).delete();
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
	await store.transaction(
		"rw",
		[
			store.groups,
			store.members,
			store.tasks,
			store.events,
			store.suggestions,
			store.outbox,
			store.meta,
		],
		async () => {
			if (options.reset) {
				await Promise.all([
					store.groups.clear(),
					store.members.clear(),
					store.tasks.clear(),
					store.events.clear(),
					store.suggestions.clear(),
				]);
			}
			for (const groupId of pull.removedGroupIds)
				await removeGroup(store, groupId);
			await store.groups.bulkPut(pull.groups);
			await store.members.bulkPut(pull.members);
			await store.tasks.bulkPut(pull.tasks);
			await store.events.bulkPut(pull.events);
			await store.suggestions.bulkPut(pull.suggestions);
			const pending = await store.outbox.orderBy("seq").toArray();
			for (const row of pending) await applyLocal(store, row.mutation, me);
			await setMeta(store, "cursor", pull.cursor);
		},
	);
}
```

In `apps/web/src/sync/engine.ts` replace

```ts
				[store.outbox, store.tasks, store.events],
```

with

```ts
				[store.outbox, store.tasks, store.events, store.suggestions],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/web test -- src/store/apply.test.ts src/sync/engine.test.ts`
Expected: PASS.

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store apps/web/src/sync
git commit -m "feat(web): mirror suggestions in the local store"
```

### Task 7: Web — "For" control in the New task sheet

**Files:**
- Create: `apps/web/src/features/suggestions/model.ts`, `apps/web/src/features/suggestions/model.test.ts`
- Modify: `apps/web/src/features/add-task/draft.ts` (:17-37, :132), `apps/web/src/features/add-task/AddTaskSheet.tsx` (imports :1-33, :63, :73, :108-109, :134-141, :150-153, :183-197, :231-232)
- Test: `apps/web/src/features/add-task/draft.test.ts` (append), `apps/web/src/features/add-task/AddTaskSheet.test.tsx` (append)

**Interfaces:**
- Consumes: `store.members` (`MemberDto`: `groupId, userId, displayName, avatarColor, role, joinedAt, leftAt`), `store.suggestions` (Task 6); `MAX_PENDING_SUGGESTIONS`, `Mutation`, `SuggestionDto` (core); `useSession()` → `{ store, engine, activeGroupId, me }`; existing `ToggleGroup`/`ToggleGroupItem`, `FieldSet`, `FieldLegend`, `toggleClass` in the sheet.
- Produces:
  - `pendingSuggestionCount(suggestions: SuggestionDto[], groupId: string, fromUserId: string, toUserId: string): number` (`features/suggestions/model.ts`) — counts `status === "pending"` rows only.
  - `TaskDraft.forUserId: string | null` (`null` = for me; `newDraft` sets `null`).
  - `suggestionMutation(d: TaskDraft, ctx: { groupId: string; toUserId: string; at: number }): Mutation` — a `suggestion.create` with fresh `id` and `suggestionId`, `notes: null`, `title` trimmed, `startDate`/`dueTime`/`rule` from the draft.
  - UI contract used by Task 10's e2e: a `ToggleGroup` labelled "For" containing buttons "Me" (first, pressed by default) and one per other active member by display name; footer button text `Suggest to {name}` (otherwise `Add task`); inline `role="alert"` error when the cap is reached.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/suggestions/model.test.ts`:

```ts
import type { SuggestionDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import { pendingSuggestionCount } from "./model";

const suggestion = (patch: Partial<SuggestionDto> = {}): SuggestionDto => ({
	id: crypto.randomUUID(),
	groupId: "g1",
	fromUserId: "u1",
	toUserId: "u2",
	title: "Wash dishes",
	notes: null,
	startDate: "2026-10-01",
	dueTime: null,
	rule: null,
	status: "pending",
	taskId: null,
	createdAt: 0,
	resolvedAt: null,
	...patch,
});

describe("pendingSuggestionCount", () => {
	it("counts only pending suggestions from one sender to one recipient in one group", () => {
		const all = [
			suggestion(),
			suggestion(),
			suggestion({ status: "declined" }),
			suggestion({ status: "accepted" }),
			suggestion({ status: "withdrawn" }),
			suggestion({ toUserId: "u3" }),
			suggestion({ fromUserId: "u2", toUserId: "u1" }),
			suggestion({ groupId: "g2" }),
		];
		expect(pendingSuggestionCount(all, "g1", "u1", "u2")).toBe(2);
		expect(pendingSuggestionCount([], "g1", "u1", "u2")).toBe(0);
	});
});
```

Append to `apps/web/src/features/add-task/draft.test.ts` inside `describe("task drafts", ...)` (and add `suggestionMutation` to the import from `./draft`):

```ts
	it("starts every draft for me", () => {
		expect(newDraft("2026-09-23").forUserId).toBeNull();
	});

	it("builds a suggestion.create that core accepts", () => {
		const m = suggestionMutation(
			{
				...base,
				title: " Wash dishes ",
				repeat: "weekly",
				dueTime: "19:00",
				forUserId: "u2",
			},
			{ groupId: "11111111-1111-4111-8111-111111111111", toUserId: "u2", at: 7 },
		);
		expect(mutationErrors(m)).toEqual([]);
		expect(m).toMatchObject({
			type: "suggestion.create",
			toUserId: "u2",
			title: "Wash dishes",
			notes: null,
			startDate: "2026-09-23",
			dueTime: "19:00",
			rule: { freq: "week", interval: 1, weekdays: [3] },
			at: 7,
		});
		expect(m.id).not.toBe((m as { suggestionId: string }).suggestionId);
	});
```

Append to `apps/web/src/features/add-task/AddTaskSheet.test.tsx` — first extend the imports at the top:

```tsx
import type { MemberDto, SuggestionDto, TaskDto } from "@tagteam/core";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEngine, renderWithSession } from "../../test/fakes";
import { AddTaskSheet } from "./AddTaskSheet";
```

and add at the end of the file:

```tsx
const member = (
	userId: string,
	displayName: string,
	patch: Partial<MemberDto> = {},
): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
	...patch,
});
const pendingToJo = (count: number): SuggestionDto[] =>
	Array.from({ length: count }, (_, i) => ({
		id: `s${i}`,
		groupId: "g1",
		fromUserId: "u1",
		toUserId: "u2",
		title: `Task ${i}`,
		notes: null,
		startDate: "2026-10-01",
		dueTime: null,
		rule: null,
		status: "pending",
		taskId: null,
		createdAt: 0,
		resolvedAt: null,
	}));
async function storeWith(
	members: MemberDto[],
	suggestions: SuggestionDto[] = [],
) {
	const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut(members);
	await store.suggestions.bulkPut(suggestions);
	return store;
}
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

describe("AddTaskSheet suggestions", () => {
	it("offers Me first and then the other active members, by name", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u3", "Kim"),
			member("u2", "Jo"),
			member("u4", "Lee", { leftAt: 9 }),
		]);
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { store });
		const group = await screen.findByLabelText("For");
		const chips = within(group)
			.getAllByRole("button")
			.map((button) => [button.textContent, button.getAttribute("aria-pressed")]);
		expect(chips).toEqual([
			["Me", "true"],
			["Jo", "false"],
			["Kim", "false"],
		]);
	});

	it("hides the control when nobody else is in the group", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u2", "Jo", { leftAt: 5 }),
		]);
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { store });
		await settle();
		expect(screen.queryByLabelText("For")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Add task" })).toBeInTheDocument();
	});

	it("hides the control when editing an existing task", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const task: TaskDto = {
			id: "t1",
			groupId: "g1",
			ownerId: "u1",
			title: "Brush teeth",
			notes: null,
			timezone: "UTC",
			startDate: "2026-09-21",
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
			],
			archivedAt: null,
			createdAt: 0,
			suggestedBy: null,
		};
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} task={task} />, {
			store,
		});
		await settle();
		expect(screen.queryByLabelText("For")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Save changes" }),
		).toBeInTheDocument();
	});

	it("suggests to the chosen member instead of adding a task", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const engine = fakeEngine();
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Wash dishes");
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		);
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "suggestion.create",
				groupId: "g1",
				toUserId: "u2",
				title: "Wash dishes",
				notes: null,
				rule: null,
			}),
		);
		expect(onClose).toHaveBeenCalled();
	});

	it("goes back to adding a task for me when Me is chosen again", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Call grandma");
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await userEvent.click(screen.getByRole("button", { name: "Me" }));
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.create", title: "Call grandma" }),
		);
	});

	it("keeps the chosen member when the sheet is dismissed and reopened", async () => {
		function Harness() {
			const [open, setOpen] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Open
					</button>
					<AddTaskSheet open={open} onClose={() => setOpen(false)} />
				</>
			);
		}
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		renderWithSession(<Harness />, { store });
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		).toBeInTheDocument();
	});

	it.each([
		{ pending: 9, allowed: true },
		{ pending: 10, allowed: false },
	])("with $pending pending suggestions to the member, allowed: $allowed", async ({
		pending,
		allowed,
	}) => {
		const store = await storeWith(
			[member("u1", "Sam"), member("u2", "Jo")],
			pendingToJo(pending),
		);
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Wash dishes");
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await settle();
		await userEvent.click(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		);
		if (allowed) {
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
		} else {
			expect(await screen.findByRole("alert")).toHaveTextContent(
				"You already have 10 suggestions waiting for Jo. Wait for an answer or withdraw one.",
			);
			expect(engine.enqueue).not.toHaveBeenCalled();
		}
	});
});
```

(The existing top-of-file imports `fireEvent, screen, waitFor` and `useState` are replaced by the block above; keep the existing tests untouched.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/web test -- src/features/suggestions src/features/add-task`
Expected: FAIL — `./model` does not exist, `suggestionMutation` is not exported, and the sheet has no "For" group.

- [ ] **Step 3: Implement — model and draft**

Create `apps/web/src/features/suggestions/model.ts`:

```ts
import type { SuggestionDto } from "@tagteam/core";

/** Suggestions from `fromUserId` to `toUserId` in `groupId` that are still waiting for an answer. */
export function pendingSuggestionCount(
	suggestions: SuggestionDto[],
	groupId: string,
	fromUserId: string,
	toUserId: string,
): number {
	return suggestions.filter(
		(s) =>
			s.status === "pending" &&
			s.groupId === groupId &&
			s.fromUserId === fromUserId &&
			s.toUserId === toUserId,
	).length;
}
```

In `apps/web/src/features/add-task/draft.ts` add to `TaskDraft` (after `dueTime: string | null;`):

```ts
	/** Another member to suggest this task to; `null` means the task is for me. */
	forUserId: string | null;
```

add `forUserId: null,` after `dueTime: null,` in `newDraft`, and add after `draftMutation`:

```ts
export function suggestionMutation(
	d: TaskDraft,
	ctx: { groupId: string; toUserId: string; at: number },
): Mutation {
	return {
		id: crypto.randomUUID(),
		at: ctx.at,
		type: "suggestion.create",
		suggestionId: crypto.randomUUID(),
		groupId: ctx.groupId,
		toUserId: ctx.toUserId,
		title: d.title.trim(),
		notes: null,
		startDate: d.startDate,
		dueTime: d.dueTime,
		rule: draftRule(d),
	};
}
```

- [ ] **Step 4: Implement — the sheet**

Edit `apps/web/src/features/add-task/AddTaskSheet.tsx` (Biome will re-sort imports on format):

1. Replace `import type { TaskDto, Weekday } from "@tagteam/core";` with

```tsx
import {
	MAX_PENDING_SUGGESTIONS,
	type TaskDto,
	type Weekday,
} from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
```

2. Replace `import { CalendarDays, ChevronDown, Clock, Plus } from "lucide-react";` with `import { CalendarDays, ChevronDown, Clock, Plus, Send } from "lucide-react";`.

3. In the `./draft` import add `suggestionMutation,` (after `newDraft,`), and below that import add `import { pendingSuggestionCount } from "../suggestions/model";`.

4. Replace `const { engine, activeGroupId, me } = useSession();` with `const { store, engine, activeGroupId, me } = useSession();`.

5. Directly after `const [saveError, setSaveError] = useState<string | null>(null);` add:

```tsx
	const members = useLiveQuery(
		() =>
			store.members
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	const suggestions = useLiveQuery(
		() =>
			store.suggestions
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	// Other active members I could suggest this task to. Editing never offers it.
	const recipients = task
		? []
		: (members ?? [])
				.filter((m) => m.leftAt === null && m.userId !== me.user.id)
				.sort((a, b) => a.displayName.localeCompare(b.displayName));
	const recipient =
		recipients.find((m) => m.userId === draft.forUserId) ?? null;
```

6. In `submit`, replace

```tsx
			if (!task && !activeGroupId) return;
			setSaveError(null);
```

with

```tsx
			if (!task && !activeGroupId) return;
			if (
				recipient &&
				pendingSuggestionCount(
					suggestions ?? [],
					activeGroupId as string,
					me.user.id,
					recipient.userId,
				) >= MAX_PENDING_SUGGESTIONS
			) {
				setSaveError(
					`You already have ${MAX_PENDING_SUGGESTIONS} suggestions waiting for ${recipient.displayName}. Wait for an answer or withdraw one.`,
				);
				return;
			}
			setSaveError(null);
```

7. Replace the non-edit branch

```tsx
			} else {
				await engine.enqueue(
					draftMutation(draft, {
						groupId: activeGroupId as string,
						timezone: browserTimeZone(),
						at: Date.now(),
					}),
				);
				toast.show({ message: `Added · ${draft.title.trim()}` });
			}
```

with

```tsx
			} else if (recipient) {
				await engine.enqueue(
					suggestionMutation(draft, {
						groupId: activeGroupId as string,
						toUserId: recipient.userId,
						at: Date.now(),
					}),
				);
				toast.show({
					message: `Suggested to ${recipient.displayName} · ${draft.title.trim()}`,
				});
			} else {
				await engine.enqueue(
					draftMutation(draft, {
						groupId: activeGroupId as string,
						timezone: browserTimeZone(),
						at: Date.now(),
					}),
				);
				toast.show({ message: `Added · ${draft.title.trim()}` });
			}
```

(After a successful submit the existing `setDraft(newDraft(today))` runs, so the sheet goes back to "Me".)

8. Replace the failure message

```tsx
				setSaveError(
					task
						? "Could not update task. Try again."
						: "Could not add task. Try again.",
				);
```

with

```tsx
				setSaveError(
					task
						? "Could not update task. Try again."
						: recipient
							? "Could not send suggestion. Try again."
							: "Could not add task. Try again.",
				);
```

9. Replace the footer button content

```tsx
							{!task && !submitting ? (
								<Plus aria-hidden className="size-5" />
							) : null}
							{task ? "Save changes" : "Add task"}
```

with

```tsx
							{!task && !submitting ? (
								recipient ? (
									<Send aria-hidden className="size-5" />
								) : (
									<Plus aria-hidden className="size-5" />
								)
							) : null}
							{task
								? "Save changes"
								: recipient
									? `Suggest to ${recipient.displayName}`
									: "Add task"}
```

10. Insert this block immediately before the `<button type="button" aria-expanded={showSchedule} ...>` element (the "Schedule" row), i.e. directly after the title `</Field>`:

```tsx
						{recipients.length > 0 ? (
							<FieldSet className="gap-2">
								<FieldLegend
									variant="label"
									className="mb-2 text-[13px] font-medium text-text-2"
								>
									For
								</FieldLegend>
								<ToggleGroup
									value={[recipient?.userId ?? me.user.id]}
									aria-label="For"
									onValueChange={([value]) => {
										if (!value) return;
										update({ forUserId: value === me.user.id ? null : value });
										setSaveError(null);
									}}
									className="w-full flex-wrap justify-start gap-2 rounded-none"
								>
									<ToggleGroupItem value={me.user.id} className={toggleClass}>
										Me
									</ToggleGroupItem>
									{recipients.map((member) => (
										<ToggleGroupItem
											key={member.userId}
											value={member.userId}
											className={toggleClass}
										>
											{member.displayName}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</FieldSet>
						) : null}

```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/web test -- src/features/suggestions src/features/add-task`
Expected: PASS (existing sheet tests included: with no other members the control is absent and the footer still says "Add task").

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features
git commit -m "feat(web): suggest a task to another member from the New task sheet"
```

### Task 8: Web — incoming suggestion cards and "Suggested by you" on Today

**Files:**
- Modify: `apps/web/src/features/suggestions/model.ts` (append), `apps/web/src/features/suggestions/model.test.ts` (append)
- Create: `apps/web/src/features/today/Suggestions.tsx`
- Modify: `apps/web/src/features/today/TodayList.tsx` (imports :3-8, props :278-294, empty branch :304-326, populated branch :354-399), `apps/web/src/features/today/TodayScreen.tsx` (whole file)
- Test: `apps/web/src/features/today/TodayScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `store.members`, `store.suggestions` (Task 6); `pendingSuggestionCount` (Task 7, same `model.ts`); `engine.enqueue(Mutation)`; `Avatar`, `Button` (`ui/`), `Card`/`CardContent`; `browserTimeZone`, `localDate` (`lib/time`); `MemberDto`, `SuggestionDto`, `Rule`, `LocalDate` (core).
- Produces (all in `features/suggestions/model.ts` unless noted):
  - `incomingSuggestions(suggestions: SuggestionDto[], groupId: string, userId: string): SuggestionDto[]` — `status === "pending"`, `toUserId === userId`, oldest first (`createdAt`).
  - `outgoingSuggestions(suggestions: SuggestionDto[], groupId: string, userId: string): SuggestionDto[]` — `fromUserId === userId`, status `pending` or `declined`, oldest first.
  - `acceptStartDate(suggestedStart: string, today: LocalDate): LocalDate` — the later of the two.
  - `suggestionSummary(s: Pick<SuggestionDto, "rule" | "dueTime" | "startDate">, today: LocalDate, locale?: string): string` — e.g. `"Daily · by 19:00"`, `"Weekly · Mon, Wed · starts 5 Oct"`, `"Once · today"`, `"Once · on 3 Oct"`.
  - `IncomingSuggestions({ suggestions, members, today, onAccept, onDecline })` and `OutgoingSuggestions({ suggestions, members, onWithdraw })` (`features/today/Suggestions.tsx`). Incoming card buttons: visible text `Decline` / `Accept` with `aria-label` `Decline {title}` / `Accept {title}`; copy line `{name} suggests`. Outgoing rows: `Waiting for {name}` + button `Withdraw` (aria-label `Withdraw {title}`), or `{name} declined` + button `Clear` (aria-label `Clear {title}`); both send `suggestion.withdraw`. Section headings: `Suggested for you` (incoming) and `Suggested by you` (outgoing, rendered only when non-empty).
  - `TodayList` props `incoming?: ReactNode` and `outgoing?: ReactNode`.
  - Accept sends `{ type: "suggestion.accept", suggestionId, taskId: crypto.randomUUID(), timezone: browserTimeZone(), startDate: acceptStartDate(s.startDate, localDate(Date.now())) }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/suggestions/model.test.ts` (add the new names to the import from `./model`):

```ts
import {
	acceptStartDate,
	incomingSuggestions,
	outgoingSuggestions,
	pendingSuggestionCount,
	suggestionSummary,
} from "./model";
```

```ts
describe("incomingSuggestions and outgoingSuggestions", () => {
	const all = [
		suggestion({ id: "newer", toUserId: "u1", fromUserId: "u2", createdAt: 20 }),
		suggestion({ id: "older", toUserId: "u1", fromUserId: "u2", createdAt: 10 }),
		suggestion({ id: "answered", toUserId: "u1", fromUserId: "u2", status: "declined" }),
		suggestion({ id: "other-group", toUserId: "u1", fromUserId: "u2", groupId: "g2" }),
		suggestion({ id: "not-mine", toUserId: "u3", fromUserId: "u2" }),
		suggestion({ id: "waiting", fromUserId: "u1", toUserId: "u2", createdAt: 5 }),
		suggestion({
			id: "declined",
			fromUserId: "u1",
			toUserId: "u2",
			status: "declined",
			createdAt: 6,
		}),
		suggestion({ id: "accepted", fromUserId: "u1", toUserId: "u2", status: "accepted" }),
		suggestion({ id: "withdrawn", fromUserId: "u1", toUserId: "u2", status: "withdrawn" }),
	];

	it("lists pending suggestions addressed to me, oldest first", () => {
		expect(incomingSuggestions(all, "g1", "u1").map((s) => s.id)).toEqual([
			"older",
			"newer",
		]);
	});

	it("lists my suggestions that are waiting or declined, oldest first", () => {
		expect(outgoingSuggestions(all, "g1", "u1").map((s) => s.id)).toEqual([
			"waiting",
			"declined",
		]);
	});
});

describe("acceptStartDate", () => {
	it("is the later of the suggested start and today", () => {
		expect(acceptStartDate("2026-09-30", "2026-10-02")).toBe("2026-10-02");
		expect(acceptStartDate("2026-10-02", "2026-10-02")).toBe("2026-10-02");
		expect(acceptStartDate("2026-10-05", "2026-10-02")).toBe("2026-10-05");
	});
});

describe("suggestionSummary", () => {
	const today = "2026-10-01";
	const summary = (patch: Partial<SuggestionDto>) =>
		suggestionSummary(
			{ rule: null, dueTime: null, startDate: today, ...patch },
			today,
			"en-GB",
		);

	it("describes one-off tasks", () => {
		expect(summary({})).toBe("Once · today");
		expect(summary({ startDate: "2026-10-03" })).toBe("Once · on 3 Oct");
		expect(summary({ dueTime: "19:00" })).toBe("Once · by 19:00 · today");
	});

	it("describes repeating tasks and only mentions a future start", () => {
		expect(summary({ rule: { freq: "day", interval: 1 }, dueTime: "19:00" })).toBe(
			"Daily · by 19:00",
		);
		expect(summary({ rule: { freq: "day", interval: 3 } })).toBe("Every 3 days");
		expect(
			summary({
				rule: { freq: "week", interval: 1, weekdays: [3, 1] },
				startDate: "2026-10-05",
			}),
		).toBe("Weekly · Mon, Wed · starts 5 Oct");
		expect(
			summary({ rule: { freq: "week", interval: 2, weekdays: [5] } }),
		).toBe("Every 2 weeks · Fri");
		expect(
			summary({ rule: { freq: "month", interval: 1, monthDay: "last" } }),
		).toBe("Monthly · last day");
		expect(
			summary({ rule: { freq: "month", interval: 2, monthDay: 15 } }),
		).toBe("Every 2 months · day 15");
	});

	it("ignores a start date in the past", () => {
		expect(
			summary({ rule: { freq: "day", interval: 1 }, startDate: "2026-09-01" }),
		).toBe("Daily");
	});
});
```

Append to `apps/web/src/features/today/TodayScreen.test.tsx` — change the first import to `import type { MemberDto, SuggestionDto, TaskDto } from "@tagteam/core";` and add at the end of the file:

```tsx
const jo: MemberDto = {
	groupId: "g1",
	userId: "u2",
	displayName: "Jo",
	avatarColor: "green",
	role: "member",
	joinedAt: 0,
	leftAt: null,
};
const suggestion = (patch: Partial<SuggestionDto> = {}): SuggestionDto => ({
	id: "s1",
	groupId: "g1",
	fromUserId: "u2",
	toUserId: "u1",
	title: "Wash dishes",
	notes: null,
	startDate: iso(today),
	dueTime: null,
	rule: { freq: "day", interval: 1 },
	status: "pending",
	taskId: null,
	createdAt: 0,
	resolvedAt: null,
	...patch,
});
const daysFromNow = (days: number) => iso(new Date(Date.now() + days * 86_400_000));

describe("TodayScreen suggestions", () => {
	it("shows a suggestion for me above the task sections, even in an empty group", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		expect(await screen.findByText("Jo suggests")).toBeInTheDocument();
		expect(screen.getByText("Wash dishes")).toBeInTheDocument();
		expect(screen.getByText("Daily")).toBeInTheDocument();
		expect(screen.getByText("Add your first task")).toBeInTheDocument();
	});

	it("puts the cards before the task list", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		const card = await screen.findByText("Jo suggests");
		const row = await screen.findByText("Brush teeth");
		expect(
			card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("does not show other people's suggestions or answered ones as cards", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.bulkPut([
			suggestion({ id: "a", toUserId: "u3", title: "For Kim" }),
			suggestion({ id: "b", status: "declined", title: "Old one" }),
		]);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		expect(screen.queryByText("For Kim")).not.toBeInTheDocument();
		expect(screen.queryByText("Old one")).not.toBeInTheDocument();
		expect(screen.queryByText(/suggests/)).not.toBeInTheDocument();
	});

	it.each([
		{ name: "a past start moves to today", start: daysFromNow(-2), expected: iso(today) },
		{ name: "today stays today", start: iso(today), expected: iso(today) },
		{ name: "a future start is kept", start: daysFromNow(3), expected: daysFromNow(3) },
	])("accepts with the recipient's timezone and start date: $name", async ({
		start,
		expected,
	}) => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion({ startDate: start }));
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		await userEvent.click(
			await screen.findByRole("button", { name: "Accept Wash dishes" }),
		);
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "suggestion.accept",
				suggestionId: "s1",
				taskId: expect.any(String),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				startDate: expected,
			}),
		);
	});

	it("declines a suggestion", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		await userEvent.click(
			await screen.findByRole("button", { name: "Decline Wash dishes" }),
		);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "suggestion.decline", suggestionId: "s1" }),
		);
	});

	it("reports a failed answer and allows another try", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		engine.enqueue.mockRejectedValueOnce(new Error("disk full"));
		renderWithSession(<TodayScreen />, { store, engine });
		const accept = await screen.findByRole("button", { name: "Accept Wash dishes" });
		await userEvent.click(accept);
		expect(
			await screen.findByText("Could not update suggestion. Try again."),
		).toBeInTheDocument();
		await userEvent.click(accept);
		expect(engine.enqueue).toHaveBeenCalledTimes(2);
	});

	it("lists what I suggested: Withdraw while waiting, Clear once declined", async () => {
		await store.members.put(jo);
		const mine = { fromUserId: "u1", toUserId: "u2" };
		await store.suggestions.bulkPut([
			suggestion({ id: "s1", title: "Bins", status: "pending", ...mine }),
			suggestion({ id: "s2", title: "Plants", status: "declined", ...mine }),
			suggestion({ id: "s3", title: "Took it", status: "accepted", ...mine }),
			suggestion({ id: "s4", title: "Gone", status: "withdrawn", ...mine }),
		]);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		expect(await screen.findByText("Suggested by you")).toBeInTheDocument();
		expect(screen.getByText("Waiting for Jo")).toBeInTheDocument();
		expect(screen.getByText("Jo declined")).toBeInTheDocument();
		expect(screen.queryByText("Took it")).not.toBeInTheDocument();
		expect(screen.queryByText("Gone")).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Withdraw Bins" }));
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "suggestion.withdraw", suggestionId: "s1" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Clear Plants" }));
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "suggestion.withdraw", suggestionId: "s2" }),
		);
	});

	it("shows no 'Suggested by you' section when there is nothing to show", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.put(
			suggestion({ fromUserId: "u1", toUserId: "u2", status: "accepted" }),
		);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		expect(screen.queryByText("Suggested by you")).not.toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/web test -- src/features/suggestions src/features/today`
Expected: FAIL — the new model functions do not exist and Today renders no suggestion UI.

- [ ] **Step 3: Implement — model helpers**

Replace the imports at the top of `apps/web/src/features/suggestions/model.ts` with `import type { LocalDate, Rule, SuggestionDto } from "@tagteam/core";` and append:

```ts
/** Pending suggestions addressed to `userId` in `groupId`, oldest first. */
export function incomingSuggestions(
	suggestions: SuggestionDto[],
	groupId: string,
	userId: string,
): SuggestionDto[] {
	return suggestions
		.filter(
			(s) =>
				s.groupId === groupId && s.toUserId === userId && s.status === "pending",
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** Suggestions `userId` sent that still need attention: waiting for an answer, or declined and not yet cleared. */
export function outgoingSuggestions(
	suggestions: SuggestionDto[],
	groupId: string,
	userId: string,
): SuggestionDto[] {
	return suggestions
		.filter(
			(s) =>
				s.groupId === groupId &&
				s.fromUserId === userId &&
				(s.status === "pending" || s.status === "declined"),
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** The later of the suggested start and today, so an accepted task never begins with missed occurrences. */
export function acceptStartDate(
	suggestedStart: string,
	today: LocalDate,
): LocalDate {
	return suggestedStart > today ? suggestedStart : today;
}

function shortDate(date: string, locale?: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

function repeatLabel(rule: Rule | null, locale?: string): string {
	if (rule === null) return "Once";
	switch (rule.freq) {
		case "day":
			return rule.interval === 1 ? "Daily" : `Every ${rule.interval} days`;
		case "week": {
			// 1 January 2024 was a Monday, so weekday 1 = Monday.
			const days = [...rule.weekdays]
				.sort((a, b) => a - b)
				.map((day) =>
					new Intl.DateTimeFormat(locale, {
						weekday: "short",
						timeZone: "UTC",
					}).format(Date.UTC(2024, 0, day)),
				)
				.join(", ");
			return `${rule.interval === 1 ? "Weekly" : `Every ${rule.interval} weeks`} · ${days}`;
		}
		case "month": {
			const day = rule.monthDay === "last" ? "last day" : `day ${rule.monthDay}`;
			return `${rule.interval === 1 ? "Monthly" : `Every ${rule.interval} months`} · ${day}`;
		}
	}
}

/** One line describing the suggested schedule, as the recipient would see it if they accepted today. */
export function suggestionSummary(
	s: Pick<SuggestionDto, "rule" | "dueTime" | "startDate">,
	today: LocalDate,
	locale?: string,
): string {
	const future = s.startDate > today;
	const when =
		s.rule === null
			? future
				? `on ${shortDate(s.startDate, locale)}`
				: "today"
			: future
				? `starts ${shortDate(s.startDate, locale)}`
				: null;
	return [
		repeatLabel(s.rule, locale),
		s.dueTime ? `by ${s.dueTime}` : null,
		when,
	]
		.filter(Boolean)
		.join(" · ");
}
```

- [ ] **Step 4: Implement — the cards**

Create `apps/web/src/features/today/Suggestions.tsx`:

```tsx
import type { LocalDate, MemberDto, SuggestionDto } from "@tagteam/core";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { suggestionSummary } from "../suggestions/model";

const nameOf = (members: MemberDto[], userId: string) =>
	members.find((member) => member.userId === userId)?.displayName ?? "Someone";

export function IncomingSuggestions({
	suggestions,
	members,
	today,
	onAccept,
	onDecline,
}: {
	suggestions: SuggestionDto[];
	members: MemberDto[];
	today: LocalDate;
	onAccept: (suggestion: SuggestionDto) => void;
	onDecline: (suggestion: SuggestionDto) => void;
}) {
	if (suggestions.length === 0) return null;
	return (
		<section aria-label="Suggested for you" className="mt-5">
			<h2 className="mb-1 text-[13px] font-medium text-text-2">
				Suggested for you
			</h2>
			<ul className="flex flex-col gap-2">
				{suggestions.map((suggestion) => {
					const sender = members.find(
						(member) => member.userId === suggestion.fromUserId,
					);
					const name = sender?.displayName ?? "Someone";
					return (
						<li key={suggestion.id}>
							<Card className="gap-3 rounded-2xl p-4 ring-line">
								<CardContent className="flex flex-col gap-3 p-0">
									<div className="flex items-start gap-3">
										<Avatar name={name} color={sender?.avatarColor ?? "gray"} />
										<div className="min-w-0 flex-1">
											<p className="text-[13px] text-text-2">{name} suggests</p>
											<p className="break-words text-[15px] font-medium">
												{suggestion.title}
											</p>
											<p className="text-[13px] text-text-2">
												{suggestionSummary(suggestion, today)}
											</p>
										</div>
									</div>
									<div className="flex gap-2">
										<Button
											aria-label={`Decline ${suggestion.title}`}
											className="flex-1"
											onClick={() => onDecline(suggestion)}
										>
											Decline
										</Button>
										<Button
											variant="primary"
											aria-label={`Accept ${suggestion.title}`}
											className="flex-1"
											onClick={() => onAccept(suggestion)}
										>
											Accept
										</Button>
									</div>
								</CardContent>
							</Card>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

export function OutgoingSuggestions({
	suggestions,
	members,
	onWithdraw,
}: {
	suggestions: SuggestionDto[];
	members: MemberDto[];
	onWithdraw: (suggestion: SuggestionDto) => void;
}) {
	if (suggestions.length === 0) return null;
	return (
		<section aria-label="Suggested by you" className="mt-6">
			<h2 className="mb-1 text-[13px] font-medium text-text-2">
				Suggested by you
			</h2>
			<Card className="gap-0 overflow-hidden rounded-2xl p-0 ring-line">
				<CardContent className="px-4 py-0">
					<ul>
						{suggestions.map((suggestion) => {
							const name = nameOf(members, suggestion.toUserId);
							const declined = suggestion.status === "declined";
							const action = declined ? "Clear" : "Withdraw";
							return (
								<li
									key={suggestion.id}
									className="flex items-center gap-3 border-b border-line py-3 last:border-0"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[15px]">{suggestion.title}</p>
										<p className="text-[13px] text-text-2">
											{declined ? `${name} declined` : `Waiting for ${name}`}
										</p>
									</div>
									<Button
										variant="ghost"
										aria-label={`${action} ${suggestion.title}`}
										className="shrink-0"
										onClick={() => onWithdraw(suggestion)}
									>
										{action}
									</Button>
								</li>
							);
						})}
					</ul>
				</CardContent>
			</Card>
		</section>
	);
}
```

- [ ] **Step 5: Implement — wire into Today**

In `apps/web/src/features/today/TodayList.tsx`:

1. Change the react import block to also import the `ReactNode` type: add `type ReactNode,` to the list (`type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState`).

2. Replace the `TodayList` signature and prop types

```tsx
export function TodayList({
	view,
	now,
	showUpcoming,
	onToggleUpcoming,
	onToggle,
	celebratingKey,
	onAdd,
}: {
	view: TodayView;
	now: number;
	showUpcoming: boolean;
	onToggleUpcoming: () => void;
	onToggle: (row: TodayRow) => void;
	celebratingKey: string | null;
	onAdd: () => void;
}) {
```

with

```tsx
export function TodayList({
	view,
	now,
	showUpcoming,
	onToggleUpcoming,
	onToggle,
	celebratingKey,
	onAdd,
	incoming,
	outgoing,
}: {
	view: TodayView;
	now: number;
	showUpcoming: boolean;
	onToggleUpcoming: () => void;
	onToggle: (row: TodayRow) => void;
	celebratingKey: string | null;
	onAdd: () => void;
	/** Suggestion cards addressed to me, shown above the task sections. */
	incoming?: ReactNode;
	/** The "Suggested by you" section, shown at the bottom. */
	outgoing?: ReactNode;
}) {
```

3. In the empty branch (`key="empty"`), add `{incoming}` as the first child of the `motion.div` (before `<Empty ...>`) and `{outgoing}` as its last child (after `</Empty>`).

4. In the populated branch (`key="populated"`), insert `{incoming}` directly after the helper paragraph

```tsx
						<p className="mt-3 text-[13px] text-text-2">
							Tap a circle to complete or reopen. Swipe right works too.
						</p>
```

and `{outgoing}` directly after the closing `</AnimatePresence>` of the upcoming block (the last child of the `populated` `motion.div`).

Replace `apps/web/src/features/today/TodayScreen.tsx` with:

```tsx
import type { Mutation, SuggestionDto } from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { readFlag, writeFlag } from "../../lib/storage";
import {
	browserTimeZone,
	dayBounds,
	localDate,
	useNow,
} from "../../lib/time";
import { useSession } from "../../session/session";
import { fireScreenConfettiCannon } from "../../ui/confetti";
import { useToast } from "../../ui/Toast";
import {
	acceptStartDate,
	incomingSuggestions,
	outgoingSuggestions,
} from "../suggestions/model";
import { buildToday, type TodayRow } from "./model";
import { IncomingSuggestions, OutgoingSuggestions } from "./Suggestions";
import { TodayList } from "./TodayList";

const UPCOMING_KEY = "tagteam.showUpcoming";

export function TodayScreen() {
	const { store, engine, me, activeGroupId } = useSession();
	const outlet = useOutletContext<{ openAdd?: () => void } | undefined>();
	const toast = useToast();
	const now = useNow();
	const [showUpcoming, setShowUpcoming] = useState(() =>
		readFlag(UPCOMING_KEY, false),
	);
	const [celebratingKey, setCelebratingKey] = useState<string | null>(null);
	const inFlight = useRef(new Set<string>());
	const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
		},
		[],
	);
	const tasks = useLiveQuery(
		() =>
			store.tasks
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	const events = useLiveQuery(async () => {
		const ids = (tasks ?? []).map((t) => t.id);
		return ids.length === 0
			? []
			: store.events.where("taskId").anyOf(ids).toArray();
	}, [store, tasks]);
	const members = useLiveQuery(
		() =>
			store.members
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	const suggestions = useLiveQuery(
		() =>
			store.suggestions
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	if (!tasks || !events || !members || !suggestions || !activeGroupId)
		return null;

	const view = buildToday({
		tasks,
		events,
		userId: me.user.id,
		groupId: activeGroupId,
		now,
		day: dayBounds(now),
	});

	const uncomplete = (taskId: string, refEventId: string) =>
		engine.enqueue({
			id: crypto.randomUUID(),
			at: Date.now(),
			type: "task.uncomplete",
			taskId,
			refEventId,
		});

	const onToggle = async (row: TodayRow) => {
		const key = `${row.task.id}:${row.key}:${row.kind}`;
		if (inFlight.current.has(key)) return;
		inFlight.current.add(key);
		try {
			if (row.kind === "done") {
				if (row.completionId) {
					await uncomplete(row.task.id, row.completionId);
					toast.show({ message: `Reopened · ${row.task.title}` });
				}
				return;
			}
			const id = crypto.randomUUID();
			await engine.enqueue({
				id,
				at: Date.now(),
				type: "task.complete",
				taskId: row.task.id,
				occurrenceKey: row.key,
			});
			fireScreenConfettiCannon();
			const nextCelebrationKey = `${row.task.id}:${row.key}`;
			setCelebratingKey(nextCelebrationKey);
			if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
			celebrationTimer.current = setTimeout(() => {
				setCelebratingKey((current) =>
					current === nextCelebrationKey ? null : current,
				);
			}, 750);
			toast.show({
				message: `Done · ${row.task.title}`,
				action: {
					label: "Undo",
					onClick: () => {
						void uncomplete(row.task.id, id).catch(() => {
							toast.show({ message: "Could not undo completion. Try again." });
						});
					},
				},
				durationMs: 5000,
			});
		} catch {
			toast.show({ message: "Could not change task. Try again." });
		} finally {
			inFlight.current.delete(key);
		}
	};

	const answer = async (
		suggestion: SuggestionDto,
		mutation: Mutation,
		message: string,
	) => {
		const key = `suggestion:${suggestion.id}`;
		if (inFlight.current.has(key)) return;
		inFlight.current.add(key);
		try {
			await engine.enqueue(mutation);
			toast.show({ message });
		} catch {
			toast.show({ message: "Could not update suggestion. Try again." });
		} finally {
			inFlight.current.delete(key);
		}
	};
	const accept = (suggestion: SuggestionDto) =>
		answer(
			suggestion,
			{
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "suggestion.accept",
				suggestionId: suggestion.id,
				taskId: crypto.randomUUID(),
				timezone: browserTimeZone(),
				startDate: acceptStartDate(suggestion.startDate, localDate(Date.now())),
			},
			`Added · ${suggestion.title}`,
		);
	const decline = (suggestion: SuggestionDto) =>
		answer(
			suggestion,
			{
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "suggestion.decline",
				suggestionId: suggestion.id,
			},
			`Declined · ${suggestion.title}`,
		);
	const withdraw = (suggestion: SuggestionDto) =>
		answer(
			suggestion,
			{
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "suggestion.withdraw",
				suggestionId: suggestion.id,
			},
			suggestion.status === "declined"
				? `Cleared · ${suggestion.title}`
				: `Withdrawn · ${suggestion.title}`,
		);

	return (
		<TodayList
			view={view}
			now={now}
			celebratingKey={celebratingKey}
			showUpcoming={showUpcoming}
			onToggleUpcoming={() => {
				setShowUpcoming((value) => {
					writeFlag(UPCOMING_KEY, !value);
					return !value;
				});
			}}
			onToggle={(row) => void onToggle(row)}
			onAdd={() => outlet?.openAdd?.()}
			incoming={
				<IncomingSuggestions
					suggestions={incomingSuggestions(
						suggestions,
						activeGroupId,
						me.user.id,
					)}
					members={members}
					today={localDate(now)}
					onAccept={(suggestion) => void accept(suggestion)}
					onDecline={(suggestion) => void decline(suggestion)}
				/>
			}
			outgoing={
				<OutgoingSuggestions
					suggestions={outgoingSuggestions(
						suggestions,
						activeGroupId,
						me.user.id,
					)}
					members={members}
					onWithdraw={(suggestion) => void withdraw(suggestion)}
				/>
			}
		/>
	);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/web test -- src/features/suggestions src/features/today`
Expected: PASS (existing Today tests too: with no suggestions both slots render nothing).

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features
git commit -m "feat(web): answer and track suggestions on Today"
```

### Task 9: Web — History, task detail and Me wording

**Files:**
- Modify: `apps/web/src/features/suggestions/model.ts` (append `suggesterLabel`), `apps/web/src/features/history/model.ts` (:10-23, :77-85), `apps/web/src/features/history/HistoryScreen.tsx` (:21-25, :56-58, :193-205), `apps/web/src/features/task-detail/TaskDetailScreen.tsx` (:41-45, :465), `apps/web/src/features/me/NotificationSettings.tsx` (:302-310, :342-345)
- Test: `apps/web/src/features/suggestions/model.test.ts` (append), `apps/web/src/features/history/model.test.ts` (new), `apps/web/src/features/history/HistoryScreen.test.tsx` (new), `apps/web/src/features/task-detail/TaskDetailScreen.test.tsx` (new), `apps/web/src/features/me/NotificationSettings.test.tsx` (new)

**Interfaces:**
- Consumes: `TaskDto.suggestedBy` (Task 4); `store.members`; existing `buildActivityFeed`, `ActivityItem`, `activityText`.
- Produces:
  - `suggesterLabel(userId: string, meId: string, members: MemberDto[]): string` (`features/suggestions/model.ts`) — `"you"` when `userId === meId`, else the member's `displayName`, else `"a former member"`.
  - `ActivityItem.suggestedById?: string`, set only on the `kind: "created"` item of a task whose `suggestedBy` is set.
  - History text for such items: `"{actor} took on {title}."` (actor is `"You"` for the viewer) with a second line `"Suggested by {suggesterLabel}"`; other created items keep `"{actor} added {title}."`.
  - Task detail shows `"Suggested by {suggesterLabel}"` under the schedule summary when `task.suggestedBy` is set.
  - Me: the nudge toggle is labelled `Nudges and suggestions` (description `A teammate nudges you or suggests a task`); the quiet-hours note reads `Reminders and suggestions wait until quiet hours end. Nudges arrive right away.`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/suggestions/model.test.ts` (add `suggesterLabel` to the import from `./model` and `MemberDto` to the type import from `@tagteam/core`):

```ts
describe("suggesterLabel", () => {
	const members: MemberDto[] = [
		{
			groupId: "g1",
			userId: "u2",
			displayName: "Jo",
			avatarColor: "green",
			role: "member",
			joinedAt: 0,
			leftAt: null,
		},
	];
	it("says you for me, the display name for a member, and a generic name otherwise", () => {
		expect(suggesterLabel("u1", "u1", members)).toBe("you");
		expect(suggesterLabel("u2", "u1", members)).toBe("Jo");
		expect(suggesterLabel("u9", "u1", members)).toBe("a former member");
	});
});
```

Create `apps/web/src/features/history/model.test.ts`:

```ts
import type { MemberDto, TaskDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import { buildActivityFeed } from "./model";

const now = Date.UTC(2026, 9, 1, 12);
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
	id: "t1",
	groupId: "g1",
	ownerId: "u1",
	title: "Wash dishes",
	notes: null,
	timezone: "UTC",
	startDate: "2026-10-01",
	rules: [{ effectiveFrom: "2026-10-01", rule: null, dueTime: null }],
	archivedAt: null,
	createdAt: now - 1000,
	suggestedBy: null,
	...patch,
});
const member = (userId: string, displayName: string): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
});
const members = [member("u1", "Sam"), member("u2", "Jo")];

describe("buildActivityFeed created entries", () => {
	it("records who suggested a task that began as a suggestion", () => {
		const feed = buildActivityFeed({
			tasks: [task({ suggestedBy: "u2" })],
			events: [],
			members,
			groupId: "g1",
			now,
		});
		expect(feed).toHaveLength(1);
		expect(feed[0]).toMatchObject({
			kind: "created",
			actorId: "u1",
			actorName: "Sam",
			suggestedById: "u2",
		});
	});

	it("keeps the suggester even if they have left the group", () => {
		const feed = buildActivityFeed({
			tasks: [task({ suggestedBy: "u9" })],
			events: [],
			members,
			groupId: "g1",
			now,
		});
		expect(feed[0]?.suggestedById).toBe("u9");
	});

	it("leaves ordinary tasks without a suggester", () => {
		const feed = buildActivityFeed({
			tasks: [task()],
			events: [],
			members,
			groupId: "g1",
			now,
		});
		expect(feed[0]).not.toHaveProperty("suggestedById");
	});
});
```

Create `apps/web/src/features/history/HistoryScreen.test.tsx`:

```tsx
import type { MemberDto, TaskDto } from "@tagteam/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TagTeamDb } from "../../store/db";
import { renderWithSession } from "../../test/fakes";
import { HistoryScreen } from "./HistoryScreen";

const member = (userId: string, displayName: string): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
});
const startDate = new Date().toISOString().slice(0, 10);
const task = (
	id: string,
	title: string,
	patch: Partial<TaskDto> = {},
): TaskDto => ({
	id,
	groupId: "g1",
	ownerId: "u1",
	title,
	notes: null,
	timezone: "UTC",
	startDate,
	rules: [{ effectiveFrom: startDate, rule: null, dueTime: null }],
	archivedAt: null,
	createdAt: Date.now() - 60_000,
	suggestedBy: null,
	...patch,
});

let store: TagTeamDb;
beforeEach(async () => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut([member("u1", "Sam"), member("u2", "Jo")]);
});

describe("HistoryScreen created entries", () => {
	it("says took on and who suggested it for a suggested task", async () => {
		await store.tasks.bulkPut([
			task("t1", "Wash dishes", { suggestedBy: "u2" }),
			task("t2", "Brush teeth"),
		]);
		renderWithSession(<HistoryScreen />, { store });
		expect(await screen.findByText("You took on Wash dishes.")).toBeInTheDocument();
		expect(screen.getByText("Suggested by Jo")).toBeInTheDocument();
		expect(screen.getByText("You added Brush teeth.")).toBeInTheDocument();
		expect(screen.getAllByText(/Suggested by/)).toHaveLength(1);
	});

	it("says you when the viewer made the suggestion", async () => {
		await store.tasks.put(
			task("t1", "Wash dishes", { ownerId: "u2", suggestedBy: "u1" }),
		);
		renderWithSession(<HistoryScreen />, { store });
		expect(await screen.findByText("Jo took on Wash dishes.")).toBeInTheDocument();
		expect(screen.getByText("Suggested by you")).toBeInTheDocument();
	});

	it("names a member who has left generically", async () => {
		await store.tasks.put(task("t1", "Wash dishes", { suggestedBy: "u9" }));
		renderWithSession(<HistoryScreen />, { store });
		expect(
			await screen.findByText("Suggested by a former member"),
		).toBeInTheDocument();
	});
});
```

Create `apps/web/src/features/task-detail/TaskDetailScreen.test.tsx`:

```tsx
import type { MemberDto, TaskDto } from "@tagteam/core";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { TagTeamDb } from "../../store/db";
import { renderWithSession } from "../../test/fakes";
import { TaskDetailScreen } from "./TaskDetailScreen";

const member = (userId: string, displayName: string): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
});
const startDate = new Date().toISOString().slice(0, 10);
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
	id: "t1",
	groupId: "g1",
	ownerId: "u1",
	title: "Wash dishes",
	notes: null,
	timezone: "UTC",
	startDate,
	rules: [
		{ effectiveFrom: startDate, rule: { freq: "day", interval: 1 }, dueTime: null },
	],
	archivedAt: null,
	createdAt: Date.now() - 60_000,
	suggestedBy: null,
	...patch,
});

let store: TagTeamDb;
beforeEach(async () => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut([member("u1", "Sam"), member("u2", "Jo")]);
});

const renderDetail = () =>
	renderWithSession(
		<Routes>
			<Route path="/tasks/:taskId" element={<TaskDetailScreen />} />
		</Routes>,
		{ store },
		"/tasks/t1",
	);

describe("TaskDetailScreen suggested by", () => {
	it("shows who suggested the task", async () => {
		await store.tasks.put(task({ suggestedBy: "u2" }));
		renderDetail();
		expect(await screen.findByText("Suggested by Jo")).toBeInTheDocument();
	});

	it("says you when the viewer suggested it", async () => {
		await store.tasks.put(task({ ownerId: "u2", suggestedBy: "u1" }));
		renderDetail();
		expect(await screen.findByText("Suggested by you")).toBeInTheDocument();
	});

	it("shows nothing for an ordinary task", async () => {
		await store.tasks.put(task());
		renderDetail();
		await screen.findByRole("heading", { name: "Wash dishes" });
		expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument();
	});
});
```

Create `apps/web/src/features/me/NotificationSettings.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithSession } from "../../test/fakes";
import { NotificationSettings } from "./NotificationSettings";

vi.mock("../../lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/api")>()),
	apiFetch: vi.fn(async () => ({
		configured: true,
		publicKey: "key",
		settings: {
			remindersEnabled: true,
			nudgesEnabled: true,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
		},
		subscriptionCount: 0,
	})),
}));

describe("NotificationSettings", () => {
	it("labels the nudge toggle so it also covers suggestions", async () => {
		renderWithSession(<NotificationSettings />);
		expect(
			await screen.findByRole("switch", { name: "Nudges and suggestions" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("A teammate nudges you or suggests a task"),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Reminders and suggestions wait until quiet hours end. Nudges arrive right away.",
			),
		).toBeInTheDocument();
		expect(screen.queryByText("Nudges from your team")).not.toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tagteam/web test -- src/features/suggestions src/features/history src/features/task-detail src/features/me`
Expected: FAIL — `suggesterLabel` is missing, created items carry no `suggestedById`, the screens show the old wording, and the Me toggle still says "Nudges from your team".

- [ ] **Step 3: Implement — label helper and History model**

In `apps/web/src/features/suggestions/model.ts` change the type import to `import type { LocalDate, MemberDto, Rule, SuggestionDto } from "@tagteam/core";` and append:

```ts
/** Who to name as the suggester: "you" for the viewer, else their display name. */
export function suggesterLabel(
	userId: string,
	meId: string,
	members: MemberDto[],
): string {
	if (userId === meId) return "you";
	return (
		members.find((member) => member.userId === userId)?.displayName ??
		"a former member"
	);
}
```

In `apps/web/src/features/history/model.ts` add to `ActivityItem` (after `completionStatus?: "on_time" | "late";`):

```ts
	/** On a "created" item: the member who suggested the task, when it began as a suggestion. */
	suggestedById?: string;
```

and in the `items.push({ ... })` call that creates the `kind: "created"` item (the one with `at: task.createdAt`), add as the last property, after `at: task.createdAt,`:

```ts
				...(task.suggestedBy ? { suggestedById: task.suggestedBy } : {}),
```

- [ ] **Step 4: Implement — History screen**

In `apps/web/src/features/history/HistoryScreen.tsx`:

1. Add `import { suggesterLabel } from "../suggestions/model";` (after the `../../session/session` import).

2. Replace

```tsx
		case "created":
			return `${actor} added ${item.taskTitle}.`;
```

with

```tsx
		case "created":
			return item.suggestedById
				? `${actor} took on ${item.taskTitle}.`
				: `${actor} added ${item.taskTitle}.`;
```

3. Directly after the `</p>` that closes the `<p className="text-[14px] font-medium leading-5">` containing the `<Link>` (and before the `<p className="mt-1 text-[12px] text-text-2">{formatTime(item.at)}</p>` line), insert:

```tsx
														{item.suggestedById ? (
															<p className="mt-0.5 text-[13px] text-text-2">
																Suggested by{" "}
																{suggesterLabel(
																	item.suggestedById,
																	me.user.id,
																	members,
																)}
															</p>
														) : null}
```

- [ ] **Step 5: Implement — task detail and Me**

In `apps/web/src/features/task-detail/TaskDetailScreen.tsx` add `import { suggesterLabel } from "../suggestions/model";` after the `../add-task/AddTaskSheet` import, and insert directly after `<p className="text-[14px] text-text-2">{ruleSummary(task, now)}</p>`:

```tsx
						{task.suggestedBy ? (
							<p className="mt-1 text-[13px] text-text-2">
								Suggested by {suggesterLabel(task.suggestedBy, me.user.id, members)}
							</p>
						) : null}
```

In `apps/web/src/features/me/NotificationSettings.tsx` replace

```tsx
								label="Nudges from your team"
								description="A teammate nudges you about a task"
```

with

```tsx
								label="Nudges and suggestions"
								description="A teammate nudges you or suggests a task"
```

and replace

```tsx
										Reminders wait until quiet hours end. Nudges arrive right
										away.
```

with

```tsx
										Reminders and suggestions wait until quiet hours end. Nudges
										arrive right away.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @tagteam/web test -- src/features/suggestions src/features/history src/features/task-detail src/features/me`
Expected: PASS.

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features
git commit -m "feat(web): show who suggested a task in History and task detail"
```

### Task 10: End-to-end test, visual check, and wrap-up

**Files:**
- Create: `apps/web/e2e/suggestions.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-25-tagteam-design.md` (§3.6, :100-107), `docs/STATUS.md`
- Create (git-ignored, only if missing): `apps/server/.env`

**Interfaces:**
- Consumes: the whole feature; UI contract from Tasks 7–9 (buttons `Add task`, `Jo`/`Me` in the "For" group, `Suggest to {name}`, text `Waiting for {name}`, `{name} suggests`, buttons `Accept {title}`, `Complete {title}`, History text `{owner} took on {title}.` and `Suggested by {name|you}`); server endpoints `POST /api/auth/sign-up/email`, `POST /api/groups`, `POST /api/groups/:id/invites`, `POST /api/invites/redeem`.
- Produces: a Playwright spec that runs in both configured projects (`iphone` WebKit, `chromium`), and an up-to-date `docs/STATUS.md`.

- [ ] **Step 1: Write the end-to-end test**

Create `apps/web/e2e/suggestions.spec.ts`. Accounts and the group are set up through the API (the browser context's cookie jar is shared with `page.request`), so the test spends its time on the feature:

```ts
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

async function signUp(page: Page, origin: string, name: string) {
	const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
	const response = await page.request.post("/api/auth/sign-up/email", {
		headers: { origin },
		data: { name, email, password: PASSWORD },
	});
	expect(response.ok()).toBe(true);
}

test("one member suggests a task, the other accepts it, and both see it", async ({
	page: sam,
	browser,
}, testInfo) => {
	test.setTimeout(60_000);
	const origin = testInfo.project.use.baseURL as string;
	const joContext = await browser.newContext({
		baseURL: origin,
		viewport: { width: 375, height: 812 },
		serviceWorkers: "block",
	});
	const jo = await joContext.newPage();
	try {
		await sam.setViewportSize({ width: 375, height: 812 });
		await signUp(sam, origin, "Sam");
		await signUp(jo, origin, "Jo");
		const created = await sam.request.post("/api/groups", {
			data: { name: "E2E suggestions" },
		});
		const { group } = (await created.json()) as { group: { id: string } };
		const invite = await sam.request.post(`/api/groups/${group.id}/invites`);
		const { code } = (await invite.json()) as { code: string };
		const redeemed = await jo.request.post("/api/invites/redeem", {
			data: { code },
		});
		expect(redeemed.ok()).toBe(true);

		// Sam suggests a task to Jo from the New task sheet.
		await sam.goto("/");
		await expect(
			sam.getByRole("button", { name: /E2E suggestions/ }),
		).toBeVisible();
		await sam.getByRole("button", { name: "Add task" }).first().click();
		const sheet = sam.getByRole("dialog", { name: "New task", exact: true });
		await sheet.getByRole("textbox", { name: "Task" }).fill("Wash dishes");
		await sheet.getByRole("button", { name: "Jo", exact: true }).click();
		await expect(
			sheet.getByRole("button", { name: "Me", exact: true }),
		).toHaveAttribute("aria-pressed", "false");
		await sam.screenshot({ path: testInfo.outputPath("sam-suggest.png") });
		await sheet.getByRole("button", { name: "Suggest to Jo" }).click();
		await expect(sam.getByText("Waiting for Jo")).toBeVisible();
		await expect(sam.getByText(/queued|Syncing/)).toHaveCount(0);

		// Jo sees the card, accepts, and the task lands on Jo's Today.
		await jo.goto("/");
		await expect(jo.getByText("Sam suggests")).toBeVisible({ timeout: 15_000 });
		await expect(jo.getByText("Wash dishes")).toBeVisible();
		await jo.screenshot({ path: testInfo.outputPath("jo-card.png") });
		await jo.getByRole("button", { name: "Accept Wash dishes" }).click();
		await expect(
			jo.getByRole("button", { name: "Complete Wash dishes" }),
		).toBeVisible();
		await expect(jo.getByText("Sam suggests")).toHaveCount(0);
		await expect(jo.getByText(/queued|Syncing/)).toHaveCount(0);

		// Sam's waiting row disappears; both histories say who took it on and who suggested it.
		await expect(sam.getByText("Waiting for Jo")).toHaveCount(0, {
			timeout: 15_000,
		});
		await sam.getByRole("link", { name: "History" }).click();
		await expect(sam.getByText("Jo took on Wash dishes.")).toBeVisible();
		await expect(sam.getByText("Suggested by you")).toBeVisible();

		await jo.getByRole("link", { name: "History" }).click();
		await expect(jo.getByText("You took on Wash dishes.")).toBeVisible();
		await expect(jo.getByText("Suggested by Sam")).toBeVisible();
	} finally {
		await joContext.close();
	}
});
```

- [ ] **Step 2: Run the end-to-end tests**

Run: `pnpm --filter @tagteam/web exec vite build`
Then: `pnpm --filter @tagteam/web exec playwright test`
Expected: PASS in both projects (the existing `app.spec.ts` flow and the new spec, 4 tests in total). This task adds no production code, so a failure here is a real defect in Tasks 1–9: report it with the failing assertion and the Playwright trace rather than weakening the test.

- [ ] **Step 3: Visual check at 375 × 812, light and dark**

Needs the project's `.claude/launch.json` configs `server` (port 3000) and `web` (port 5173). If `apps/server/.env` is missing, create it (it is git-ignored) with test values for local development only:

```bash
printf 'AUTH_SECRET=%s\nBASE_URL=http://localhost:5173\n' "$(openssl rand -base64 32)" > apps/server/.env
```

1. Start both servers with `preview_start` (`server`, then `web`).
2. Seed two local test accounts and four suggestions through the Vite proxy (all of this is local development data):

```bash
cd "$(mktemp -d)"
BASE=http://localhost:5173
JSON='content-type: application/json'
PW=correct-horse-battery
signup() { curl -s -c "$1.jar" -H "$JSON" -H "origin: $BASE" -d "{\"name\":\"$2\",\"email\":\"$1-visual@example.com\",\"password\":\"$PW\"}" "$BASE/api/auth/sign-up/email" > /dev/null; }
signup sam Sam; signup jo Jo
GROUP=$(curl -s -b sam.jar -H "$JSON" -d '{"name":"Visual check"}' "$BASE/api/groups" | jq -r .group.id)
CODE=$(curl -s -b sam.jar -X POST "$BASE/api/groups/$GROUP/invites" | jq -r .code)
curl -s -b jo.jar -H "$JSON" -d "{\"code\":\"$CODE\"}" "$BASE/api/invites/redeem" > /dev/null
SAM=$(curl -s -b sam.jar "$BASE/api/me" | jq -r .user.id)
JO=$(curl -s -b jo.jar "$BASE/api/me" | jq -r .user.id)
NOW=$(($(date +%s) * 1000)); TODAY=$(date +%F)
mutate() { curl -s -b "$1.jar" -H "$JSON" -d "{\"mutations\":[$2]}" "$BASE/api/sync/push"; echo; }
create() { mutate "$1" "{\"id\":\"$(uuidgen)\",\"at\":$NOW,\"type\":\"suggestion.create\",\"suggestionId\":\"$2\",\"groupId\":\"$GROUP\",\"toUserId\":\"$3\",\"title\":\"$4\",\"notes\":null,\"startDate\":\"$TODAY\",\"dueTime\":null,\"rule\":$5}"; }
S1=$(uuidgen); S2=$(uuidgen); S3=$(uuidgen); S4=$(uuidgen)
create sam "$S1" "$JO" "Wash dishes" '{"freq":"day","interval":1}'
create sam "$S2" "$JO" "Water the plants" '{"freq":"week","interval":1,"weekdays":[1,3]}'
create jo "$S3" "$SAM" "Take out the bins" null
create jo "$S4" "$SAM" "Call grandma" null
mutate sam "{\"id\":\"$(uuidgen)\",\"at\":$NOW,\"type\":\"suggestion.decline\",\"suggestionId\":\"$S4\"}"
```

Expected: every printed response contains `"status":"applied"`.

3. Open `http://localhost:5173/sign-in` in the Browser pane, `resize_window` to 375 × 812 (reload afterwards), and sign in as `jo-visual@example.com` with the password above (local development account created in step 2).
4. On Today, confirm and screenshot (light, then `resize_window` with `colorScheme: "dark"`):
   - Two cards under "Suggested for you" above the task area: avatar, "Sam suggests", title, schedule summary (`Daily`, `Weekly · Mon, Wed`), Decline and Accept side by side.
   - At the bottom "Suggested by you" with "Take out the bins" / "Waiting for Sam" / Withdraw and "Call grandma" / "Sam declined" / Clear. Status is readable as text, not colour only.
   - Nothing overflows horizontally; the bottom row clears the tab bar and the safe area.
5. Measure tap targets with `javascript_tool` (expect every height ≥ 44):

```js
[...document.querySelectorAll("button")]
	.filter((b) => /^(Accept|Decline|Withdraw|Clear) /.test(b.getAttribute("aria-label") ?? ""))
	.map((b) => [b.getAttribute("aria-label"), Math.round(b.getBoundingClientRect().height)]);
```

6. Tap the Add button: the sheet shows the "For" chips `Me` (selected) and `Sam`; select `Sam` and confirm the footer reads "Suggest to Sam" (light and dark screenshots); select `Me` and confirm it reads "Add task". Close the sheet and reopen it to confirm a chosen member is kept.
7. Accept "Wash dishes": the toast reads "Added · Wash dishes", the card disappears, the task is in Today. Decline "Water the plants": the card disappears. Withdraw "Take out the bins" and Clear "Call grandma": both rows disappear and the section vanishes when empty.
8. History shows "You took on Wash dishes." with "Suggested by Sam"; open the task: "Suggested by Sam" sits under the schedule line. On Me, the toggle reads "Nudges and suggestions".
9. Fix anything that looks wrong, re-run the affected tests, and stop both servers (`preview_stop`). Delete the temporary cookie-jar directory.

- [ ] **Step 4: Update the main design spec**

In `docs/superpowers/specs/2026-09-25-tagteam-design.md` §3.6 replace

```markdown
- Mutations (`@tagteam/core` `Mutation`): `task.create`, `task.update`, `task.schedule`, `task.archive`,
  `task.complete`, `task.uncomplete`, `task.nudge`. Each has a client UUID `id` and client `at`.
```

with

```markdown
- Mutations (`@tagteam/core` `Mutation`): `task.create`, `task.update`, `task.schedule`, `task.archive`,
  `task.complete`, `task.uncomplete`, `task.nudge`, and the suggestion mutations `suggestion.create`,
  `suggestion.accept`, `suggestion.decline`, `suggestion.withdraw` (see
  `2026-10-01-task-suggestions-design.md`). Each has a client UUID `id` and client `at`.
```

and replace

```markdown
- `GET /api/sync/pull?cursor=N` → `{ cursor, groups, members, tasks, events, removedGroupIds }`.
```

with

```markdown
- `GET /api/sync/pull?cursor=N` → `{ cursor, groups, members, tasks, events, suggestions, removedGroupIds }`.
  `suggestions` holds only the suggestions the caller sent or received.
```

- [ ] **Step 5: Update `docs/STATUS.md`**

Make these edits (write the date of the day you finish, from `date +%F`; state only what actually passed in Steps 2, 3 and 6):

1. Replace the `_Last updated: ..._` line with `_Last updated: <today> (Plan 8 task suggestions complete)._`.
2. Change the heading ``## Done (on `main`; CI green through Plan 7)`` to ``## Done (on `main`; CI green through Plan 7, Plan 8 not yet run in CI)`` and add this row after the Plan 7 row of that table:

```markdown
| 08 task suggestions | suggest a task to another member from New task; accept or decline on Today; History and task detail say who suggested it; push for suggested, accepted and declined | Spec: `2026-10-01-task-suggestions-design.md` |
```

3. Insert this section directly before `## Next plans`:

```markdown
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
- Checks: unit tests, typecheck, lint, the two-user Playwright flow (WebKit and Chromium) and a
  375 × 812 light/dark visual check passed.
```

4. In `## Next plans` delete the bullet that starts `- **Plan 8: task suggestions.**` (the three-line bullet); keep the "Team up" bullet.
5. In `## Decisions to know` append:

```markdown
- Suggestions: the recipient's browser computes the accepted task's `startDate` (later of the
  suggestion's start and today) and sends its own timezone; the server only enforces
  `startDate >= suggestion.startDate`. A withdraw racing an accept resolves by arrival order and the
  loser's client re-pulls. After sending a suggestion the New task sheet resets to "Me". History and
  task detail say "Suggested by you" when the viewer is the suggester. Better Auth user ids are not
  UUIDs, so `toUserId` is validated as a bounded non-empty string.
```

- [ ] **Step 6: Full verification**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/e2e/suggestions.spec.ts docs/STATUS.md docs/superpowers/specs/2026-09-25-tagteam-design.md
git commit -m "test(web): cover task suggestions end to end; update status and sync spec"
```

---

## Carry-over notes

- **Execution order matters for a green repo.** Task 1 leaves two compile-compatibility stand-ins (the server's `suggestions are not supported yet` rejection, replaced in Task 3; the web `event(taskId, …)` helper, kept and extended in Task 6). Task 4 changes `TaskDto`/`PullResponse` in core and edits six web files mechanically for the same reason.
- **Migration 0004 is hand-edited.** Never regenerate it with drizzle-kit after the edit; a future `db:generate` should report no changes. If the migrator is ever changed to run outside a transaction, the backup-table dance becomes unnecessary but stays correct.
- **`notification_log.occurrence_key` is overloaded** (date for reminders, event id for nudges, suggestion id for suggestion kinds). Dedupe for suggestion kinds actually relies on the `(suggestion_id, kind)` unique index.
- **Rows are never deleted.** `suggestion` grows with every suggestion; at the app's group sizes this is fine. If it ever matters, prune rows that are `accepted`/`declined`/`withdrawn` for longer than some window, after both parties have synced; pull has no tombstones to protect.
- **Pull has no pagination.** The new `suggestions` array follows the same rule as tasks and events.
- **Held pushes are delivered by the minute sweep** (`runNotificationSweep` → `deliverPending`), not at the exact end of quiet hours.
- **A suggestion to someone with no push subscription or with the toggle off creates no log row**, so enabling the toggle later does not replay old suggestions (same opt-in cutoff rule as nudges).
- **Out of scope (spec §9):** teaming up, dependencies, grouped tasks, suggesting to several members, suggesting changes to an existing task, a reason with a decline, expiry, nudging tasks that are not overdue.
- **Not covered by tests:** native iOS push delivery of the new kinds (needs a device and VAPID keys) and the installed-PWA behaviour of the new Today cards; verify on a device when convenient.
