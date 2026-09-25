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
	rules: [
		{
			effectiveFrom: "2026-09-21",
			rule: { freq: "day", interval: 1 },
			dueTime: "08:00",
		},
	],
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
