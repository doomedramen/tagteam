import { atTime } from "@tagteam/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "../db/client";
import {
	groups,
	notificationDelivery,
	notificationLog,
	notificationSettings,
	profile,
	pushSubscription,
	suggestion,
	task,
	taskEvent,
	user,
} from "../db/schema";
import {
	runNotificationSweep,
	sendSuggestionNotification,
} from "./notifications";

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
	) =>
		sendSuggestionNotification(
			db,
			push,
			{ suggestionId: "suggestion", event },
			now,
		);
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
	] as const)(
		"tells the sender when it is $event",
		async ({ event, kind, title }) => {
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
		},
	);

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
