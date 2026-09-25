import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, pullAll, push } from "../test/sync-helpers";

describe("GET /api/sync/pull", () => {
	let ctx: TestContext;
	let sam: string;
	let jo: string;
	let groupId: string;
	const taskId = randomUUID();

	const createTask = (id = taskId, group = groupId) =>
		mutation(
			"task.create",
			{
				taskId: id,
				groupId: group,
				title: "Brush teeth",
				notes: null,
				timezone: "Europe/London",
				startDate: "2026-09-21",
				dueTime: "08:00",
				rule: { freq: "day", interval: 1 },
			},
			ctx.clock.now,
		);
	const complete = (key: string) =>
		mutation("task.complete", { taskId, occurrenceKey: key }, ctx.clock.now);
	const invite = async () =>
		(
			await readJson<{ code: string }>(
				await api(ctx.app, sam, "POST", `/api/groups/${groupId}/invites`),
			)
		).code;

	beforeEach(async () => {
		ctx = createTestContext();
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
		jo = await signUp(ctx.app, "jo@example.com", "Jo");
		groupId = (
			await readJson<{ group: { id: string } }>(
				await api(ctx.app, sam, "POST", "/api/groups", { name: "Smiths" }),
			)
		).group.id;
		await push(ctx.app, sam, [createTask(), complete("2026-09-21")]);
	});
	afterEach(() => ctx.close());

	it("returns everything in the caller's groups from cursor 0", async () => {
		const first = await pullAll(ctx.app, sam);
		expect(first.groups).toEqual([{ id: groupId, name: "Smiths" }]);
		expect(first.members.map((m) => [m.displayName, m.role, m.leftAt])).toEqual(
			[["Sam", "admin", null]],
		);
		expect(first.tasks).toMatchObject([
			{ id: taskId, title: "Brush teeth", rules: [{ dueTime: "08:00" }] },
		]);
		expect(first.tasks[0]).not.toHaveProperty("clocks");
		expect(first.events).toMatchObject([
			{ taskId, type: "completed", occurrenceKey: "2026-09-21" },
		]);
		expect(first.removedGroupIds).toEqual([]);
		expect(first.cursor).toBeGreaterThan(0);
	});

	it("returns only changes after the cursor", async () => {
		const { cursor } = await pullAll(ctx.app, sam);
		const nothing = await pullAll(ctx.app, sam, cursor);
		expect([
			nothing.groups,
			nothing.members,
			nothing.tasks,
			nothing.events,
		]).toEqual([[], [], [], []]);
		expect(nothing.cursor).toBe(cursor);

		await push(ctx.app, sam, [complete("2026-09-22")]);
		const next = await pullAll(ctx.app, sam, cursor);
		expect(next.events.map((e) => e.occurrenceKey)).toEqual(["2026-09-22"]);
		expect(next.tasks).toEqual([]);
	});

	it("sends a full snapshot of a group the caller just joined", async () => {
		const before = await pullAll(ctx.app, jo);
		expect(before.tasks).toEqual([]);
		await api(ctx.app, jo, "POST", "/api/invites/redeem", {
			code: await invite(),
		});

		const after = await pullAll(ctx.app, jo, before.cursor);
		expect(after.groups).toEqual([{ id: groupId, name: "Smiths" }]);
		expect(after.tasks.map((t) => t.id)).toEqual([taskId]);
		expect(after.events).toHaveLength(1);
		expect(after.members.map((m) => m.displayName).sort()).toEqual([
			"Jo",
			"Sam",
		]);

		const samSees = await pullAll(
			ctx.app,
			sam,
			(await pullAll(ctx.app, sam)).cursor - 1,
		);
		expect(samSees.members.some((m) => m.displayName === "Jo")).toBe(true);
	});

	it("tells a leaver to drop the group and others that the member left", async () => {
		await api(ctx.app, jo, "POST", "/api/invites/redeem", {
			code: await invite(),
		});
		const joCursor = (await pullAll(ctx.app, jo)).cursor;
		const samCursor = (await pullAll(ctx.app, sam)).cursor;

		await api(ctx.app, jo, "POST", `/api/groups/${groupId}/leave`);
		const joAfter = await pullAll(ctx.app, jo, joCursor);
		expect(joAfter.removedGroupIds).toEqual([groupId]);
		expect([joAfter.groups, joAfter.tasks, joAfter.events]).toEqual([
			[],
			[],
			[],
		]);

		const samAfter = await pullAll(ctx.app, sam, samCursor);
		expect(samAfter.members).toMatchObject([
			{ displayName: "Jo", leftAt: ctx.clock.now },
		]);
	});

	it("never returns other groups' data", async () => {
		const kim = await signUp(ctx.app, "kim@example.com", "Kim");
		await api(ctx.app, kim, "POST", "/api/groups", { name: "Other" });
		const kimSees = await pullAll(ctx.app, kim);
		expect(kimSees.groups.map((g) => g.name)).toEqual(["Other"]);
		expect([kimSees.tasks, kimSees.events]).toEqual([[], []]);
		expect(kimSees.members.map((m) => m.displayName)).toEqual(["Kim"]);
	});

	it("validates the cursor", async () => {
		for (const bad of ["-1", "1.5", "abc", "1234567890123456"]) {
			expect(
				(await api(ctx.app, sam, "GET", `/api/sync/pull?cursor=${bad}`)).status,
			).toBe(400);
		}
	});
});
