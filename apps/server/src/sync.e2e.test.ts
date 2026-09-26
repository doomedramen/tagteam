import { randomUUID } from "node:crypto";
import { atTime, deriveTask, type TaskEvent } from "@tagteam/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EventDto, TaskDto } from "./services/sync-pull";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "./test/harness";
import { mutation, pullAll, push } from "./test/sync-helpers";

const TZ = "Europe/London";
const at = (date: string, time: string) => atTime(date, time, TZ);

let ctx: TestContext;
beforeEach(() => {
	ctx = createTestContext();
});
afterEach(() => ctx.close());

async function signIn(email: string) {
	const res = await ctx.app.request("/api/auth/sign-in/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: "correct-horse-battery" }),
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0] ?? "")
		.find((c) => c.startsWith("better-auth.session_token="));
	if (!cookie) throw new Error("sign-in failed");
	return cookie;
}

const history = (t: TaskDto, events: EventDto[], now: number) =>
	deriveTask(
		{
			startDate: t.startDate,
			timezone: t.timezone,
			rules: t.rules,
			archivedAt: t.archivedAt,
		},
		// EventDto rows are the wire form of TaskEvent (nullable columns for the unused variant fields).
		events.filter((e) => e.taskId === t.id) as unknown as TaskEvent[],
		now,
	).entries.map((e) => `${e.key} ${e.status}`);

it("converges two offline devices and reproduces the spec's history example", async () => {
	const phone = await signUp(ctx.app, "sam@example.com", "Sam");
	const laptop = await signIn("sam@example.com");
	const groupId = (
		await readJson<{ group: { id: string } }>(
			await api(ctx.app, phone, "POST", "/api/groups", { name: "Smiths" }),
		)
	).group.id;
	const taskId = randomUUID();

	// Phone creates the task online on Monday morning.
	ctx.clock.now = at("2026-09-21", "07:00");
	await push(ctx.app, phone, [
		mutation(
			"task.create",
			{
				taskId,
				groupId,
				title: "Brush teeth",
				notes: null,
				timezone: TZ,
				startDate: "2026-09-21",
				dueTime: "08:00",
				rule: { freq: "day", interval: 1 },
			},
			ctx.clock.now,
		),
	]);
	const laptopStart = await pullAll(ctx.app, laptop);

	// Laptop renames it on Tuesday while online.
	ctx.clock.now = at("2026-09-22", "12:00");
	await push(ctx.app, laptop, [
		mutation(
			"task.update",
			{ taskId, title: "Brush teeth (2 min)" },
			ctx.clock.now,
		),
	]);

	// Phone was offline: it completed on Wednesday 10:00 and renamed on Monday evening; both sync Wednesday 10:05.
	const phoneQueue = [
		mutation(
			"task.update",
			{ taskId, title: "Brush teeth!" },
			at("2026-09-21", "19:00"),
		),
		mutation(
			"task.complete",
			{ taskId, occurrenceKey: "2026-09-21" },
			at("2026-09-23", "10:00"),
		),
	];
	ctx.clock.now = at("2026-09-23", "10:05");
	expect(
		(await push(ctx.app, phone, phoneQueue)).results.map((r) => r.status),
	).toEqual(["applied", "applied"]);
	// A flaky network retries the same batch.
	expect(
		(await push(ctx.app, phone, phoneQueue)).results.map((r) => r.status),
	).toEqual(["duplicate", "duplicate"]);

	const phoneView = await pullAll(ctx.app, phone);
	const laptopDelta = await pullAll(ctx.app, laptop, laptopStart.cursor);

	// Latest edit wins on both devices despite arriving last.
	expect(phoneView.tasks[0]?.title).toBe("Brush teeth (2 min)");
	expect(laptopDelta.tasks[0]?.title).toBe("Brush teeth (2 min)");

	// Same history on both, matching the spec: Mon late; Tue and Wed missed; Thu upcoming.
	const expected = [
		"2026-09-21 late",
		"2026-09-22 missed",
		"2026-09-23 missed",
		"2026-09-24 upcoming",
	];
	expect(
		history(phoneView.tasks[0] as TaskDto, phoneView.events, ctx.clock.now),
	).toEqual(expected);
	expect(
		history(laptopDelta.tasks[0] as TaskDto, laptopDelta.events, ctx.clock.now),
	).toEqual(expected);
});
