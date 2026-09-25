import { randomUUID } from "node:crypto";
import { MAX_CLOCK_SKEW_MS, NUDGE_INTERVAL_MS } from "@tagteam/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { task, taskEvent } from "../db/schema";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, push } from "../test/sync-helpers";

describe("POST /api/sync/push", () => {
	let ctx: TestContext;
	let sam: string;
	let jo: string;
	let groupId: string;
	let taskId: string;

	const create = (id = taskId, at = ctx.clock.now) =>
		mutation(
			"task.create",
			{
				taskId: id,
				groupId,
				title: " Brush teeth ",
				notes: null,
				timezone: "Europe/London",
				startDate: "2026-09-21",
				dueTime: "08:00",
				rule: { freq: "day", interval: 1 },
			},
			at,
		);
	const row = () => ctx.db.select().from(task).where(eq(task.id, taskId)).get();
	const events = () =>
		ctx.db.select().from(taskEvent).where(eq(taskEvent.taskId, taskId)).all();

	beforeEach(async () => {
		ctx = createTestContext();
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
		taskId = randomUUID();
	});
	afterEach(() => ctx.close());

	it("applies a create and a completion, and treats retries as duplicates", async () => {
		const batch = [
			create(),
			mutation(
				"task.complete",
				{ taskId, occurrenceKey: "2026-09-21" },
				ctx.clock.now,
			),
		];
		const first = await push(ctx.app, sam, batch);
		expect(first.status).toBe(200);
		expect(first.results.map((r) => r.status)).toEqual(["applied", "applied"]);
		expect(row()).toMatchObject({
			title: "Brush teeth",
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: "08:00",
				},
			],
			archivedAt: null,
		});
		expect(events()).toMatchObject([
			{
				id: batch[1]?.id,
				type: "completed",
				occurrenceKey: "2026-09-21",
				groupId,
			},
		]);

		const again = await push(ctx.app, sam, batch);
		expect(again.results.map((r) => r.status)).toEqual([
			"duplicate",
			"duplicate",
		]);
		expect(events()).toHaveLength(1);
	});

	it("rejects invalid mutations without blocking the rest of the batch", async () => {
		const { results } = await push(ctx.app, sam, [
			{ id: "x", type: "task.nudge" },
			create(),
		]);
		expect(results[0]).toMatchObject({ id: "x", status: "rejected" });
		expect(results[0]?.reason).toMatch(/^invalid: /);
		expect(results[1]?.status).toBe("applied");
	});

	it("rejects batches that are not an array of at most 100", async () => {
		expect(
			(
				await push(
					ctx.app,
					sam,
					Array.from({ length: 101 }, () => create(randomUUID())),
				)
			).status,
		).toBe(400);
		const res = await api(ctx.app, sam, "POST", "/api/sync/push", {
			mutations: "nope",
		});
		expect(res.status).toBe(400);
	});

	it("only lets owners change or complete their tasks, in groups they belong to", async () => {
		await push(ctx.app, sam, [create()]);
		const { results } = await push(ctx.app, jo, [
			mutation("task.update", { taskId, title: "Hacked" }, ctx.clock.now),
			mutation(
				"task.complete",
				{ taskId, occurrenceKey: "2026-09-21" },
				ctx.clock.now,
			),
			mutation(
				"task.create",
				{
					taskId: randomUUID(),
					groupId: randomUUID(),
					title: "X",
					notes: null,
					timezone: "UTC",
					startDate: "2026-09-21",
					dueTime: null,
					rule: null,
				},
				ctx.clock.now,
			),
		]);
		expect(results.map((r) => r.reason)).toEqual([
			"not your task",
			"not your task",
			"not a member of this group",
		]);
		expect(row()?.title).toBe("Brush teeth");
	});

	it("lets members nudge others' tasks once per 30 minutes, never their own", async () => {
		await push(ctx.app, sam, [create()]);
		const nudge = () => mutation("task.nudge", { taskId }, ctx.clock.now);
		expect((await push(ctx.app, sam, [nudge()])).results[0]?.reason).toBe(
			"you can't nudge your own task",
		);
		expect((await push(ctx.app, jo, [nudge()])).results[0]?.status).toBe(
			"applied",
		);
		expect((await push(ctx.app, jo, [nudge()])).results[0]?.reason).toBe(
			"rate_limited",
		);
		ctx.clock.now += NUDGE_INTERVAL_MS + 1;
		expect((await push(ctx.app, jo, [nudge()])).results[0]?.status).toBe(
			"applied",
		);
	});

	it("keeps the latest edit per field when edits arrive out of order", async () => {
		await push(ctx.app, sam, [create()]);
		const t0 = ctx.clock.now;
		await push(ctx.app, sam, [
			mutation(
				"task.update",
				{ taskId, title: "Newer", notes: "n2" },
				t0 + 2000,
			),
		]);
		const stale = await push(ctx.app, sam, [
			mutation("task.update", { taskId, title: "Older" }, t0 + 1000),
		]);
		expect(stale.results[0]?.status).toBe("applied");
		expect(row()).toMatchObject({ title: "Newer", notes: "n2" });
	});

	it("appends or replaces schedule versions from their effective date", async () => {
		await push(ctx.app, sam, [create()]);
		const t = ctx.clock.now;
		await push(ctx.app, sam, [
			mutation(
				"task.schedule",
				{
					taskId,
					effectiveFrom: "2026-10-01",
					dueTime: "20:00",
					rule: { freq: "week", interval: 1, weekdays: [1] },
				},
				t + 1,
			),
		]);
		expect(row()?.rules.map((v) => [v.effectiveFrom, v.dueTime])).toEqual([
			["2026-09-21", "08:00"],
			["2026-10-01", "20:00"],
		]);
		await push(ctx.app, sam, [
			mutation(
				"task.schedule",
				{ taskId, effectiveFrom: "2026-09-21", dueTime: null, rule: null },
				t + 2,
			),
		]);
		expect(row()?.rules).toEqual([
			{ effectiveFrom: "2026-09-21", rule: null, dueTime: null },
		]);

		const early = await push(ctx.app, sam, [
			mutation(
				"task.schedule",
				{ taskId, effectiveFrom: "2026-09-20", dueTime: null, rule: null },
				t + 3,
			),
		]);
		expect(early.results[0]?.reason).toBe(
			"effectiveFrom is before the task starts",
		);
	});

	it("archives and unarchives by last writer", async () => {
		await push(ctx.app, sam, [create()]);
		const t = ctx.clock.now;
		await push(ctx.app, sam, [
			mutation("task.archive", { taskId, archived: true }, t + 10),
		]);
		expect(row()?.archivedAt).toBe(t + 10);
		await push(ctx.app, sam, [
			mutation("task.archive", { taskId, archived: false }, t + 5),
		]);
		expect(row()?.archivedAt).toBe(t + 10);
		await push(ctx.app, sam, [
			mutation("task.archive", { taskId, archived: false }, t + 20),
		]);
		expect(row()?.archivedAt).toBeNull();
	});

	it("clamps timestamps from clocks running ahead", async () => {
		await push(ctx.app, sam, [create()]);
		await push(ctx.app, sam, [
			mutation(
				"task.complete",
				{ taskId, occurrenceKey: "2026-09-21" },
				ctx.clock.now + 86_400_000,
			),
		]);
		expect(events()[0]?.at).toBe(ctx.clock.now + MAX_CLOCK_SKEW_MS);
	});

	it("only uncompletes an existing completion of the same task", async () => {
		await push(ctx.app, sam, [create()]);
		const done = mutation(
			"task.complete",
			{ taskId, occurrenceKey: "2026-09-21" },
			ctx.clock.now,
		);
		await push(ctx.app, sam, [done]);
		const bad = await push(ctx.app, sam, [
			mutation(
				"task.uncomplete",
				{ taskId, refEventId: randomUUID() },
				ctx.clock.now,
			),
		]);
		expect(bad.results[0]?.reason).toBe(
			"refEventId is not a completion of this task",
		);
		const ok = await push(ctx.app, sam, [
			mutation(
				"task.uncomplete",
				{ taskId, refEventId: done.id },
				ctx.clock.now,
			),
		]);
		expect(ok.results[0]?.status).toBe("applied");
		expect(events().map((e) => e.type)).toEqual(["completed", "uncompleted"]);
	});

	it("rejects changes to unknown tasks and after leaving the group", async () => {
		expect(
			(
				await push(ctx.app, sam, [
					mutation("task.nudge", { taskId }, ctx.clock.now),
				])
			).results[0]?.reason,
		).toBe("task not found");
		await push(ctx.app, sam, [create()]);
		await api(ctx.app, sam, "POST", `/api/groups/${groupId}/leave`);
		const after = await push(ctx.app, sam, [
			mutation(
				"task.complete",
				{ taskId, occurrenceKey: "2026-09-21" },
				ctx.clock.now,
			),
		]);
		expect(after.results[0]?.reason).toBe("not a member of this group");
	});

	it("requires a session", async () => {
		expect(
			(await api(ctx.app, null, "POST", "/api/sync/push", { mutations: [] }))
				.status,
		).toBe(401);
	});
});
