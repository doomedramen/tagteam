import { randomUUID } from "node:crypto";
import type { TaskColor } from "@tagteam/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestion, task } from "../db/schema";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, pullAll, push, userIdOf } from "../test/sync-helpers";

const PLANT = "\u{1FAB4}"; // potted plant
const BASKET = "\u{1F9FA}"; // basket
const BROOM = "\u{1F9F9}"; // broom

describe("task emoji and color", () => {
	let ctx: TestContext;
	let sam: string;
	let jo: string;
	let samId: string;
	let joId: string;
	let groupId: string;
	let taskId: string;

	const look = (emoji?: string | null, color?: TaskColor | null) => ({
		...(emoji !== undefined ? { emoji } : {}),
		...(color !== undefined ? { color } : {}),
	});
	const create = (
		extra: { emoji?: string | null; color?: TaskColor | null } = {},
		id = taskId,
		at = ctx.clock.now,
	) =>
		mutation(
			"task.create",
			{
				taskId: id,
				groupId,
				title: "Water plants",
				notes: null,
				timezone: "Europe/London",
				startDate: "2026-09-21",
				dueTime: null,
				rule: null,
				...extra,
			},
			at,
		);
	const update = (
		fields: { emoji?: string | null; color?: TaskColor | null },
		at: number,
	) => mutation("task.update", { taskId, ...fields }, at);
	const row = (id = taskId) =>
		ctx.db.select().from(task).where(eq(task.id, id)).get();

	beforeEach(async () => {
		ctx = createTestContext();
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
		jo = await signUp(ctx.app, "jo@example.com", "Jo");
		samId = userIdOf(ctx.db, "sam@example.com");
		joId = userIdOf(ctx.db, "jo@example.com");
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

	it("stores the emoji and color from a create and returns them in pull", async () => {
		const { results } = await push(ctx.app, sam, [create(look(PLANT, "teal"))]);
		expect(results[0]?.status).toBe("applied");
		expect(row()).toMatchObject({ emoji: PLANT, color: "teal" });
		const pulled = await pullAll(ctx.app, jo);
		expect(pulled.tasks).toMatchObject([
			{ id: taskId, emoji: PLANT, color: "teal" },
		]);
	});

	it("stores null for both when a create leaves them out, and starts all six clocks", async () => {
		await push(ctx.app, sam, [create()]);
		expect(row()).toMatchObject({ emoji: null, color: null });
		const at = ctx.clock.now;
		expect(row()?.clocks).toEqual({
			title: at,
			notes: at,
			schedule: at,
			archive: at,
			emoji: at,
			color: at,
		});
		const pulled = await pullAll(ctx.app, sam);
		expect(pulled.tasks[0]).toMatchObject({ emoji: null, color: null });
	});

	it("applies an update's emoji and color, and an explicit null clears them", async () => {
		await push(ctx.app, sam, [create(look(PLANT, "teal"))]);
		const t0 = ctx.clock.now;
		await push(ctx.app, sam, [update(look(BASKET, "pink"), t0 + 1)]);
		expect(row()).toMatchObject({ emoji: BASKET, color: "pink" });
		await push(ctx.app, sam, [update(look(null, null), t0 + 2)]);
		expect(row()).toMatchObject({ emoji: null, color: null });
	});

	it("keeps the latest write per field, each on its own clock", async () => {
		await push(ctx.app, sam, [create(look(PLANT, "teal"))]);
		const t0 = ctx.clock.now;
		await push(ctx.app, sam, [update({ emoji: BASKET }, t0 + 2000)]);
		// Older than the emoji write but newer than the color's creation clock.
		const stale = await push(ctx.app, sam, [
			update(look(BROOM, "pink"), t0 + 1000),
		]);
		expect(stale.results[0]?.status).toBe("applied");
		expect(row()).toMatchObject({ emoji: BASKET, color: "pink" });
		expect(row()?.clocks).toMatchObject({ emoji: t0 + 2000, color: t0 + 1000 });
	});

	it("reads a stored clock object without emoji and color as zero", async () => {
		await push(ctx.app, sam, [create()]);
		const t0 = ctx.clock.now;
		// What rows written before migration 0005 hold.
		ctx.db
			.update(task)
			.set({ clocks: { title: t0, notes: t0, schedule: t0, archive: t0 } })
			.where(eq(task.id, taskId))
			.run();
		const { results } = await push(ctx.app, sam, [
			update(look(PLANT, "teal"), t0 + 1),
		]);
		expect(results[0]?.status).toBe("applied");
		expect(row()).toMatchObject({
			emoji: PLANT,
			color: "teal",
			clocks: { title: t0, emoji: t0 + 1, color: t0 + 1 },
		});
	});

	it("only lets the owner change the look", async () => {
		await push(ctx.app, sam, [create(look(PLANT, "teal"))]);
		const { results } = await push(ctx.app, jo, [
			update(look(BROOM, "pink"), ctx.clock.now + 1),
		]);
		expect(results[0]?.reason).toBe("not your task");
		expect(row()).toMatchObject({ emoji: PLANT, color: "teal" });
	});

	it("rejects values that are not one emoji or one of the seven hues", async () => {
		const bad = await push(ctx.app, sam, [
			create({ emoji: "water" }),
			create({ color: "red" as TaskColor }),
		]);
		expect(bad.results[0]?.reason).toBe(
			"invalid: emoji must be null or a single emoji",
		);
		expect(bad.results[1]?.reason).toMatch(
			/^invalid: color must be null or one of /,
		);
		expect(row()).toBeUndefined();

		await push(ctx.app, sam, [create()]);
		const empty = await push(ctx.app, sam, [update({}, ctx.clock.now + 1)]);
		expect(empty.results[0]?.reason).toBe(
			"invalid: update must change title, notes, emoji or color",
		);
	});

	it("carries emoji and color on a suggestion and copies them to the accepted task", async () => {
		const suggestionId = randomUUID();
		const newTaskId = randomUUID();
		const made = await push(ctx.app, sam, [
			mutation(
				"suggestion.create",
				{
					suggestionId,
					groupId,
					toUserId: joId,
					title: "Water plants",
					notes: null,
					startDate: "2026-10-01",
					dueTime: null,
					rule: null,
					...look(PLANT, "green"),
				},
				ctx.clock.now,
			),
		]);
		expect(made.results[0]?.status).toBe("applied");
		expect(
			ctx.db
				.select()
				.from(suggestion)
				.where(eq(suggestion.id, suggestionId))
				.get(),
		).toMatchObject({ emoji: PLANT, color: "green" });
		const joView = await pullAll(ctx.app, jo);
		expect(joView.suggestions).toMatchObject([
			{ id: suggestionId, emoji: PLANT, color: "green" },
		]);

		const accepted = await push(ctx.app, jo, [
			mutation(
				"suggestion.accept",
				{
					suggestionId,
					taskId: newTaskId,
					timezone: "Europe/London",
					startDate: "2026-10-01",
				},
				ctx.clock.now,
			),
		]);
		expect(accepted.results[0]?.status).toBe("applied");
		expect(row(newTaskId)).toMatchObject({
			emoji: PLANT,
			color: "green",
			ownerId: joId,
			suggestedBy: samId,
		});
		expect(row(newTaskId)?.clocks).toMatchObject({
			emoji: ctx.clock.now,
			color: ctx.clock.now,
		});
	});

	it("leaves a suggestion's emoji and color null when the sender chose none", async () => {
		const suggestionId = randomUUID();
		await push(ctx.app, sam, [
			mutation(
				"suggestion.create",
				{
					suggestionId,
					groupId,
					toUserId: joId,
					title: "Water plants",
					notes: null,
					startDate: "2026-10-01",
					dueTime: null,
					rule: null,
				},
				ctx.clock.now,
			),
		]);
		expect(
			ctx.db
				.select()
				.from(suggestion)
				.where(eq(suggestion.id, suggestionId))
				.get(),
		).toMatchObject({ emoji: null, color: null });
	});
});
