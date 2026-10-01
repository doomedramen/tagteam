import type {
	Mutation,
	PullResponse,
	SuggestionDto,
	TaskDto,
} from "@tagteam/core";
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
	rules: [
		{
			effectiveFrom: "2026-09-21",
			rule: { freq: "day", interval: 1 },
			dueTime: "08:00",
		},
	],
	archivedAt: null,
	createdAt: at,
	suggestedBy: null,
});
const suggestionId = "44444444-4444-4444-8444-444444444444";
const newTaskId = "55555555-5555-4555-8555-555555555555";
const serverSuggestion = (
	patch: Partial<SuggestionDto> = {},
): SuggestionDto => ({
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
const pull = (patch: Partial<PullResponse>): PullResponse => ({
	cursor: 1,
	groups: [],
	members: [],
	tasks: [],
	events: [],
	suggestions: [],
	removedGroupIds: [],
	...patch,
});

let db: TagTeamDb;
beforeEach(() => {
	db = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

describe("applyLocal", () => {
	it("creates, edits, reschedules and archives a task", async () => {
		await applyLocal(
			db,
			{
				id: id(),
				at,
				type: "task.create",
				taskId,
				groupId,
				title: " Floss ",
				notes: null,
				timezone: "Europe/London",
				startDate: "2026-09-21",
				dueTime: null,
				rule: null,
			},
			me,
		);
		await applyLocal(
			db,
			{ id: id(), at, type: "task.update", taskId, notes: "gently" },
			me,
		);
		await applyLocal(
			db,
			{
				id: id(),
				at,
				type: "task.schedule",
				taskId,
				effectiveFrom: "2026-09-21",
				dueTime: "21:00",
				rule: { freq: "day", interval: 1 },
			},
			me,
		);
		await applyLocal(
			db,
			{ id: id(), at: at + 5, type: "task.archive", taskId, archived: true },
			me,
		);
		expect(await db.tasks.get(taskId)).toMatchObject({
			title: "Floss",
			notes: "gently",
			ownerId: "u1",
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: "21:00",
				},
			],
			archivedAt: at + 5,
		});
	});

	it("records completions, undos and nudges as events", async () => {
		await db.tasks.put(serverTask("Brush teeth"));
		const done = id();
		await applyLocal(
			db,
			{
				id: done,
				at,
				type: "task.complete",
				taskId,
				occurrenceKey: "2026-09-21",
			},
			me,
		);
		await applyLocal(
			db,
			{ id: id(), at, type: "task.uncomplete", taskId, refEventId: done },
			me,
		);
		const events = await db.events.where("taskId").equals(taskId).toArray();
		expect(
			events.map((e) => [e.type, e.occurrenceKey, e.refEventId, e.userId]),
		).toEqual([
			["completed", "2026-09-21", null, "u1"],
			["uncompleted", null, done, "u1"],
		]);
	});

	it("ignores changes to tasks it does not have", async () => {
		await applyLocal(
			db,
			{ id: id(), at, type: "task.update", taskId, title: "x" },
			me,
		);
		expect(await db.tasks.count()).toBe(0);
	});
});

describe("applyPull", () => {
	it("mirrors server rows and stores the cursor", async () => {
		await applyPull(
			db,
			pull({
				cursor: 7,
				groups: [{ id: groupId, name: "Smiths" }],
				tasks: [serverTask("Brush teeth")],
			}),
			me,
		);
		expect(await db.groups.toArray()).toEqual([
			{ id: groupId, name: "Smiths" },
		]);
		expect((await db.tasks.get(taskId))?.title).toBe("Brush teeth");
		expect(await getMeta<number>(db, "cursor")).toBe(7);
	});

	it("re-applies pending local changes on top of older server data", async () => {
		await db.tasks.put(serverTask("Brush teeth"));
		const rename: Mutation = {
			id: id(),
			at,
			type: "task.update",
			taskId,
			title: "Brush teeth (2 min)",
		};
		await db.outbox.add({ mutation: rename });
		await applyPull(db, pull({ tasks: [serverTask("Brush teeth")] }), me);
		expect((await db.tasks.get(taskId))?.title).toBe("Brush teeth (2 min)");
	});

	it("drops everything of groups the user left", async () => {
		await applyPull(
			db,
			pull({
				groups: [{ id: groupId, name: "Smiths" }],
				tasks: [serverTask("Brush teeth")],
				events: [
					{
						id: id(),
						taskId,
						userId: "u1",
						type: "completed",
						occurrenceKey: "2026-09-21",
						refEventId: null,
						at,
					},
				],
			}),
			me,
		);
		await applyPull(db, pull({ removedGroupIds: [groupId] }), me);
		expect([
			await db.groups.count(),
			await db.tasks.count(),
			await db.events.count(),
		]).toEqual([0, 0, 0]);
	});

	it("rebuilds from scratch on reset", async () => {
		await db.tasks.put({
			...serverTask("Local only"),
			id: "33333333-3333-4333-8333-333333333333",
		});
		await applyPull(db, pull({ tasks: [serverTask("Brush teeth")] }), me, {
			reset: true,
		});
		expect((await db.tasks.toArray()).map((t) => t.title)).toEqual([
			"Brush teeth",
		]);
	});
});

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
