import { randomUUID } from "node:crypto";
import {
	atTime,
	deriveTask,
	type LocalDate,
	type TaskEvent,
} from "@tagteam/core";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import {
	notificationDelivery,
	notificationLog,
	profile,
	pushSubscription,
	task,
	taskEvent,
} from "../db/schema";
import { getNotificationSettings } from "./notification-settings";
import type { PushTransport } from "./push";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RETRY_MAX = HOUR;

type NotificationKind = "due" | "overdue" | "nudge";

function localDateAt(ms: number, timezone: string): LocalDate {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(ms);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

function localTimeAt(ms: number, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(ms);
	const hour = parts.find((item) => item.type === "hour")?.value ?? "00";
	const minute = parts.find((item) => item.type === "minute")?.value ?? "00";
	return `${hour}:${minute}`;
}

function inQuietHours(
	now: number,
	timezone: string,
	start: string,
	end: string,
): boolean {
	if (start === end) return false;
	const current = localTimeAt(now, timezone);
	return start < end
		? current >= start && current < end
		: current >= start || current < end;
}

function asTaskEvents(events: (typeof taskEvent.$inferSelect)[]): TaskEvent[] {
	const result: TaskEvent[] = [];
	for (const event of events) {
		if (event.type === "completed" && event.occurrenceKey) {
			result.push({
				id: event.id,
				type: "completed",
				at: event.at,
				occurrenceKey: event.occurrenceKey as LocalDate,
			});
		} else if (event.type === "uncompleted" && event.refEventId) {
			result.push({
				id: event.id,
				type: "uncompleted",
				at: event.at,
				refEventId: event.refEventId,
			});
		} else {
			result.push({ id: event.id, type: "nudged", at: event.at });
		}
	}
	return result;
}

function statusCode(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const value = (error as { statusCode?: unknown }).statusCode;
	return typeof value === "number" ? value : undefined;
}

function retryDelay(attempts: number): number {
	return Math.min(RETRY_MAX, 30_000 * 2 ** Math.min(attempts, 7));
}

function notificationEnabled(
	db: Db,
	userId: string,
	kind: NotificationKind,
): boolean {
	const settings = getNotificationSettings(db, userId);
	return kind === "nudge" ? settings.nudgesEnabled : settings.remindersEnabled;
}

async function deliverPending(db: Db, push: PushTransport, now: number) {
	const pendingLogs = db
		.select()
		.from(notificationLog)
		.where(isNull(notificationLog.sentAt))
		.orderBy(notificationLog.createdAt)
		.limit(250)
		.all();

	for (const log of pendingLogs) {
		if (!notificationEnabled(db, log.userId, log.kind)) continue;
		if (log.kind !== "nudge") {
			const timezone =
				db
					.select({ timezone: profile.timezone })
					.from(profile)
					.where(eq(profile.userId, log.userId))
					.get()?.timezone ?? "UTC";
			const settings = getNotificationSettings(db, log.userId);
			if (
				inQuietHours(
					now,
					timezone,
					settings.quietHoursStart,
					settings.quietHoursEnd,
				)
			)
				continue;
		}

		const subscriptions = db
			.select({ endpoint: pushSubscription.endpoint })
			.from(pushSubscription)
			.where(eq(pushSubscription.userId, log.userId))
			.all();
		for (const subscription of subscriptions) {
			db.insert(notificationDelivery)
				.values({
					id: randomUUID(),
					notificationId: log.id,
					endpoint: subscription.endpoint,
					nextAttemptAt: now,
				})
				.onConflictDoNothing()
				.run();
		}

		const deliveries = db
			.select()
			.from(notificationDelivery)
			.where(
				and(
					eq(notificationDelivery.notificationId, log.id),
					eq(notificationDelivery.status, "pending"),
					lte(notificationDelivery.nextAttemptAt, now),
				),
			)
			.all();
		for (const delivery of deliveries) {
			const subscription = db
				.select()
				.from(pushSubscription)
				.where(
					and(
						eq(pushSubscription.endpoint, delivery.endpoint),
						eq(pushSubscription.userId, log.userId),
					),
				)
				.get();
			if (!subscription) {
				db.update(notificationDelivery)
					.set({ status: "gone" })
					.where(eq(notificationDelivery.id, delivery.id))
					.run();
				continue;
			}
			try {
				await push.send(
					{
						endpoint: subscription.endpoint,
						keys: { p256dh: subscription.p256dh, auth: subscription.auth },
					},
					JSON.stringify({ title: log.title, body: log.body, url: log.url }),
				);
				db.update(notificationDelivery)
					.set({ status: "sent", sentAt: now, lastError: null })
					.where(eq(notificationDelivery.id, delivery.id))
					.run();
			} catch (error) {
				const code = statusCode(error);
				if (code === 404 || code === 410) {
					db.delete(pushSubscription)
						.where(eq(pushSubscription.id, subscription.id))
						.run();
					db.update(notificationDelivery)
						.set({
							status: "gone",
							lastError: `Push endpoint returned ${code}`,
						})
						.where(eq(notificationDelivery.id, delivery.id))
						.run();
				} else {
					const attempts = delivery.attempts + 1;
					db.update(notificationDelivery)
						.set({
							attempts,
							nextAttemptAt: now + retryDelay(attempts),
							lastError: code
								? `Push service returned ${code}`
								: "Push service request failed",
						})
						.where(eq(notificationDelivery.id, delivery.id))
						.run();
					console.error("Push delivery failed", code ?? "network error");
				}
			}
		}
		const unfinished = db
			.select({ status: notificationDelivery.status })
			.from(notificationDelivery)
			.where(eq(notificationDelivery.notificationId, log.id))
			.all();
		if (
			unfinished.length > 0 &&
			unfinished.every((delivery) => delivery.status !== "pending")
		) {
			db.update(notificationLog)
				.set({ sentAt: now })
				.where(eq(notificationLog.id, log.id))
				.run();
		}
	}
}

function enqueueNotification(
	db: Db,
	input: {
		taskId: string;
		userId: string;
		occurrenceKey: string;
		kind: NotificationKind;
		title: string;
		body: string;
		url: string;
	},
	now: number,
) {
	if (!notificationEnabled(db, input.userId, input.kind)) return;
	const subscriptions = db
		.select({ endpoint: pushSubscription.endpoint })
		.from(pushSubscription)
		.where(eq(pushSubscription.userId, input.userId))
		.all();
	if (subscriptions.length === 0) return;
	db.insert(notificationLog)
		.values({ id: randomUUID(), ...input, createdAt: now })
		.onConflictDoNothing()
		.run();
}

export async function sendNudgeNotification(
	db: Db,
	push: PushTransport,
	input: { taskId: string; eventId: string; senderId: string },
	now: number,
) {
	const target = db
		.select({ id: task.id, ownerId: task.ownerId, title: task.title })
		.from(task)
		.where(eq(task.id, input.taskId))
		.get();
	if (!target) return;
	const sender = db
		.select({ displayName: profile.displayName })
		.from(profile)
		.where(eq(profile.userId, input.senderId))
		.get();
	enqueueNotification(
		db,
		{
			taskId: target.id,
			userId: target.ownerId,
			occurrenceKey: input.eventId,
			kind: "nudge",
			title: `${sender?.displayName ?? "A teammate"} nudged you`,
			body: `${target.title} is still open.`,
			url: "/team",
		},
		now,
	);
	await deliverPending(db, push, now);
}

export async function runNotificationSweep(
	db: Db,
	push: PushTransport,
	now: number,
) {
	const tasks = db.select().from(task).where(isNull(task.archivedAt)).all();
	if (tasks.length === 0) {
		await deliverPending(db, push, now);
		return;
	}
	const events = db
		.select()
		.from(taskEvent)
		.where(
			inArray(
				taskEvent.taskId,
				tasks.map((item) => item.id),
			),
		)
		.all();
	const eventsByTask = new Map<string, typeof events>();
	for (const event of events) {
		const list = eventsByTask.get(event.taskId) ?? [];
		list.push(event);
		eventsByTask.set(event.taskId, list);
	}

	for (const item of tasks) {
		const derived = deriveTask(
			{
				startDate: item.startDate as LocalDate,
				timezone: item.timezone,
				rules: item.rules,
				archivedAt: item.archivedAt,
			},
			asTaskEvents(eventsByTask.get(item.id) ?? []),
			now,
		);
		const current = derived.current;
		if (!current || current.status === "upcoming") continue;
		const ownerTimezone =
			db
				.select({ timezone: profile.timezone })
				.from(profile)
				.where(eq(profile.userId, item.ownerId))
				.get()?.timezone ?? "UTC";
		const ownerSettings = getNotificationSettings(db, item.ownerId);
		if (
			inQuietHours(
				now,
				ownerTimezone,
				ownerSettings.quietHoursStart,
				ownerSettings.quietHoursEnd,
			)
		)
			continue;
		const version = [...item.rules]
			.reverse()
			.find((entry) => entry.effectiveFrom <= current.key);
		if (!version) continue;
		const remindAt = version.dueTime
			? current.dueAt
			: Math.min(atTime(current.key, "09:00", item.timezone), current.dueAt);
		const overdueAt = version.dueTime
			? current.dueAt + HOUR
			: atTime(
					localDateAt(current.dueAt, item.timezone),
					"09:00",
					item.timezone,
				);
		const kind: NotificationKind = now >= overdueAt ? "overdue" : "due";
		if (now < (kind === "overdue" ? overdueAt : remindAt)) continue;
		enqueueNotification(
			db,
			{
				taskId: item.id,
				userId: item.ownerId,
				occurrenceKey: current.key,
				kind,
				title: kind === "overdue" ? "Task still open" : "Task due",
				body:
					kind === "overdue"
						? `${item.title} is still open.`
						: `${item.title} is due.`,
				url: "/",
			},
			now,
		);
	}
	await deliverPending(db, push, now);
}

export function startNotificationScheduler(db: Db, push: PushTransport) {
	let activeRun: Promise<void> | null = null;
	const run = () => {
		if (activeRun) return activeRun;
		activeRun = (async () => {
			try {
				await runNotificationSweep(db, push, Date.now());
			} catch (error) {
				console.error("Notification sweep failed", error);
			} finally {
				activeRun = null;
			}
		})();
		return activeRun;
	};
	void run();
	const timer = setInterval(() => void run(), MINUTE);
	return async () => {
		clearInterval(timer);
		await activeRun;
	};
}

export function validatePushEndpoint(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 4096) return false;
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();
		const allowed =
			host === "fcm.googleapis.com" ||
			host === "android.googleapis.com" ||
			host === "web.push.apple.com" ||
			host.endsWith(".push.apple.com") ||
			host === "push.services.mozilla.com" ||
			host.endsWith(".push.services.mozilla.com") ||
			host.endsWith(".notify.windows.com");
		return (
			url.protocol === "https:" &&
			url.port === "" &&
			url.username === "" &&
			url.password === "" &&
			allowed
		);
	} catch {
		return false;
	}
}
