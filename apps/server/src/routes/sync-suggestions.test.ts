import { randomUUID } from "node:crypto";
import { MAX_PENDING_SUGGESTIONS } from "@tagteam/core";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { membership, suggestion, task } from "../db/schema";
import { createLiveHub, type LiveHub } from "../live";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, pullAll, push, userIdOf } from "../test/sync-helpers";

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
	/** A second group owned by Sam, with Jo as a member. */
	const otherGroupWithJo = async () => {
		const other = (
			await readJson<{ group: { id: string } }>(
				await api(ctx.app, sam, "POST", "/api/groups", { name: "Work" }),
			)
		).group.id;
		const { code } = await readJson<{ code: string }>(
			await api(ctx.app, sam, "POST", `/api/groups/${other}/invites`),
		);
		await api(ctx.app, jo, "POST", "/api/invites/redeem", { code });
		return other;
	};

	const create = (id = suggestionId, to = joId, inGroup = groupId) =>
		mutation(
			"suggestion.create",
			{
				suggestionId: id,
				groupId: inGroup,
				toUserId: to,
				title: " Wash dishes ",
				notes: null,
				startDate: "2026-10-01",
				dueTime: "19:00",
				rule: { freq: "day", interval: 1 },
			},
			ctx.clock.now,
		);
	const accept = (
		id = suggestionId,
		newTaskId = taskId,
		startDate = "2026-10-01",
	) =>
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
		expect(await reason(sam, create(overId))).toBe(
			"too many pending suggestions",
		);
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

	it("counts only pending suggestions, per group, towards the cap", async () => {
		const other = await otherGroupWithJo();
		const filled = await push(
			ctx.app,
			sam,
			Array.from({ length: MAX_PENDING_SUGGESTIONS }, () =>
				create(randomUUID()),
			),
		);
		expect(filled.results.every((r) => r.status === "applied")).toBe(true);
		expect(await reason(sam, create(randomUUID()))).toBe(
			"too many pending suggestions",
		);

		// The same pair in another group has its own allowance.
		expect(
			(await push(ctx.app, sam, [create(randomUUID(), joId, other)])).results[0]
				?.status,
		).toBe("applied");

		// Declined and accepted rows no longer count: each frees a slot.
		const [first, second] = ctx.db
			.select()
			.from(suggestion)
			.where(eq(suggestion.groupId, groupId))
			.all();
		await push(ctx.app, jo, [decline(first?.id)]);
		await push(ctx.app, jo, [accept(second?.id, randomUUID())]);
		const results = (
			await push(ctx.app, sam, [create(randomUUID()), create(randomUUID())])
		).results;
		expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
		expect(await reason(sam, create(randomUUID()))).toBe(
			"too many pending suggestions",
		);
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
		expect(await reason(jo, accept(suggestionId, taskId, "2026-09-30"))).toBe(
			"startDate is before the suggested start",
		);
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

	it("pulls a suggestion to its sender and recipient only", async () => {
		await push(ctx.app, sam, [create()]);
		const expected = {
			id: suggestionId,
			groupId,
			fromUserId: samId,
			toUserId: joId,
			title: "Wash dishes",
			notes: null,
			emoji: null,
			color: null,
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
		expect(byId.get(taskId)).toMatchObject({
			ownerId: joId,
			suggestedBy: samId,
		});
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

	it("leaves suggestions in other groups alone when a member leaves one", async () => {
		const other = await otherGroupWithJo();
		const ids = {
			toJoHere: randomUUID(),
			toJoElsewhere: randomUUID(),
			fromJoElsewhere: randomUUID(),
			fromJoDeclinedElsewhere: randomUUID(),
		};
		await push(ctx.app, sam, [
			create(ids.toJoHere),
			create(ids.toJoElsewhere, joId, other),
		]);
		await push(ctx.app, jo, [
			create(ids.fromJoElsewhere, samId, other),
			create(ids.fromJoDeclinedElsewhere, samId, other),
		]);
		await push(ctx.app, sam, [decline(ids.fromJoDeclinedElsewhere)]);

		await api(ctx.app, jo, "POST", `/api/groups/${groupId}/leave`);

		expect(row(ids.toJoHere)?.status).toBe("withdrawn");
		expect(row(ids.toJoElsewhere)?.status).toBe("pending");
		expect(row(ids.fromJoElsewhere)?.status).toBe("pending");
		expect(row(ids.fromJoDeclinedElsewhere)?.status).toBe("declined");
		expect(
			ctx.db
				.select()
				.from(suggestion)
				.where(eq(suggestion.status, "withdrawn"))
				.all()
				.map((s) => s.id),
		).toEqual([ids.toJoHere]);
	});

	it("rejects an accept from a recipient who is no longer an active member", async () => {
		await push(ctx.app, sam, [create()]);
		// Direct DB change, not the leave route (which would withdraw the suggestion).
		ctx.db
			.update(membership)
			.set({ leftAt: ctx.clock.now })
			.where(and(eq(membership.groupId, groupId), eq(membership.userId, joId)))
			.run();
		expect(await reason(jo, accept())).toBe("not a member of this group");
		expect(taskRow(taskId)).toBeUndefined();
		expect(row()?.status).toBe("pending");
	});
});
