import { atTime } from "@tagteam/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "../db/client";
import {
	groups,
	notificationDelivery,
	notificationLog,
	notificationSettings,
	pushSubscription,
	task,
	taskEvent,
	user,
} from "../db/schema";
import { runNotificationSweep } from "./notifications";

const timezone = "Europe/London";
const day = "2026-09-27";
const time = (value: string) => atTime(day, value, timezone);

describe("reminders for newly created tasks", () => {
	let db: Db;
	let close: () => void;
	const push = { publicKey: "test", send: vi.fn(async () => {}) };

	beforeEach(() => {
		({ db, close } = openDb(":memory:"));
		push.send.mockClear();
		db.insert(user)
			.values({ id: "owner", name: "Sam", email: "sam@example.com" })
			.run();
		db.insert(groups)
			.values({ id: "group", name: "Home", createdBy: "owner", createdAt: 0 })
			.run();
		db.insert(notificationSettings)
			.values({ userId: "owner", updatedAt: 0 })
			.run();
		db.insert(pushSubscription)
			.values({
				id: "device",
				userId: "owner",
				endpoint: "https://fcm.googleapis.com/test",
				p256dh: "key",
				auth: "auth",
				deviceLabel: "Phone",
				createdAt: 0,
			})
			.run();
	});

	afterEach(() => close());

	function createTask(createdAt: number, dueTime: string | null = null) {
		db.insert(task)
			.values({
				id: "task",
				groupId: "group",
				ownerId: "owner",
				title: "Wash dishes",
				timezone,
				startDate: day,
				rules: [
					{ effectiveFrom: day, dueTime, rule: { freq: "day", interval: 1 } },
				],
				createdAt,
				clocks: {
					title: createdAt,
					notes: createdAt,
					schedule: createdAt,
					archive: createdAt,
				},
				seq: 1,
			})
			.run();
	}

	it.each([
		{ label: "untimed due", createdAt: "12:00", dueTime: null },
		{ label: "timed due", createdAt: "12:00", dueTime: "11:30" },
		{ label: "timed overdue", createdAt: "12:00", dueTime: "10:00" },
	])(
		"skips a $label trigger before creation",
		async ({ createdAt, dueTime }) => {
			createTask(time(createdAt), dueTime);
			await runNotificationSweep(db, push, time(createdAt) + 60_000);
			await runNotificationSweep(db, push, time(createdAt) + 120_000);
			expect(push.send).not.toHaveBeenCalled();
			expect(db.select().from(notificationLog).all()).toEqual([]);
			expect(db.select().from(notificationDelivery).all()).toEqual([]);
		},
	);

	it.each([
		{ label: "untimed", createdAt: "08:30", dueTime: null, trigger: "09:00" },
		{ label: "timed", createdAt: "12:00", dueTime: "13:00", trigger: "13:00" },
		{
			label: "at creation",
			createdAt: "09:00",
			dueTime: null,
			trigger: "09:00",
		},
	])(
		"sends a $label due reminder once",
		async ({ createdAt, dueTime, trigger }) => {
			createTask(time(createdAt), dueTime);
			await runNotificationSweep(db, push, time(trigger) - 1);
			expect(push.send).not.toHaveBeenCalled();
			await runNotificationSweep(db, push, time(trigger));
			await runNotificationSweep(db, push, time(trigger) + 60_000);
			expect(push.send).toHaveBeenCalledTimes(1);
			expect(db.select().from(notificationLog).all()).toMatchObject([
				{ kind: "due", createdAt: time(trigger) },
			]);
		},
	);

	it("still sends a future overdue reminder after skipping the due reminder", async () => {
		createTask(time("12:00"));
		await runNotificationSweep(db, push, time("12:01"));
		expect(push.send).not.toHaveBeenCalled();
		await runNotificationSweep(
			db,
			push,
			atTime("2026-09-28", "09:00", timezone),
		);
		expect(push.send).toHaveBeenCalledTimes(1);
		expect(db.select().from(notificationLog).all()).toMatchObject([
			{ kind: "overdue", occurrenceKey: day },
		]);
	});

	it("still reminds for the next occurrence after completing the first", async () => {
		createTask(time("12:00"));
		await runNotificationSweep(db, push, time("12:01"));
		db.insert(taskEvent)
			.values({
				id: "completion",
				taskId: "task",
				groupId: "group",
				userId: "owner",
				type: "completed",
				occurrenceKey: day,
				at: time("13:00"),
				receivedAt: time("13:00"),
				seq: 2,
			})
			.run();
		await runNotificationSweep(
			db,
			push,
			atTime("2026-09-28", "09:00", timezone),
		);
		expect(push.send).toHaveBeenCalledTimes(1);
		expect(db.select().from(notificationLog).all()).toMatchObject([
			{ kind: "due", occurrenceKey: "2026-09-28" },
		]);
	});
});
