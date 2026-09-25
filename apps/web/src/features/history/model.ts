import {
	deriveTask,
	type EventDto,
	type MemberDto,
	type TaskDto,
	type TaskEvent,
} from "@tagteam/core";
import { localDate } from "../../lib/time";

export type ActivityKind = "completed" | "missed" | "nudged" | "created";

export interface ActivityItem {
	id: string;
	taskId: string;
	taskTitle: string;
	actorId: string;
	actorName: string;
	targetId?: string;
	targetName?: string;
	kind: ActivityKind;
	at: number;
	completionStatus?: "on_time" | "late";
}

export interface ActivityDay {
	date: string;
	items: ActivityItem[];
}

const displayName = (member: MemberDto | undefined) =>
	member?.displayName ?? "Former member";

export function buildActivityFeed(input: {
	tasks: TaskDto[];
	events: EventDto[];
	members: MemberDto[];
	groupId: string;
	now: number;
}): ActivityItem[] {
	const members = new Map(
		input.members.map((member) => [member.userId, member]),
	);
	const tasks = input.tasks.filter((task) => task.groupId === input.groupId);
	const eventsByTask = new Map<string, EventDto[]>();
	for (const event of input.events) {
		const list = eventsByTask.get(event.taskId) ?? [];
		list.push(event);
		eventsByTask.set(event.taskId, list);
	}

	const items: ActivityItem[] = [];
	for (const task of tasks) {
		const events = eventsByTask.get(task.id) ?? [];
		const undone = new Set(
			events.flatMap((event) =>
				event.type === "uncompleted" ? [event.refEventId] : [],
			),
		);
		const derived = deriveTask(
			{
				startDate: task.startDate,
				timezone: task.timezone,
				rules: task.rules,
				archivedAt: task.archivedAt,
			},
			events as unknown as TaskEvent[],
			input.now,
		);
		const completionStatus = new Map(
			derived.entries.flatMap((entry) =>
				entry.completionId && entry.status !== "missed"
					? [[entry.completionId, entry.status] as const]
					: [],
			),
		);

		items.push({
			id: `created:${task.id}`,
			taskId: task.id,
			taskTitle: task.title,
			actorId: task.ownerId,
			actorName: displayName(members.get(task.ownerId)),
			kind: "created",
			at: task.createdAt,
		});

		for (const event of events) {
			if (event.type === "nudged") {
				items.push({
					id: event.id,
					taskId: task.id,
					taskTitle: task.title,
					actorId: event.userId,
					actorName: displayName(members.get(event.userId)),
					targetId: task.ownerId,
					targetName: displayName(members.get(task.ownerId)),
					kind: "nudged",
					at: event.at,
				});
			}
			if (event.type === "completed" && !undone.has(event.id)) {
				const status = completionStatus.get(event.id);
				items.push({
					id: event.id,
					taskId: task.id,
					taskTitle: task.title,
					actorId: event.userId,
					actorName: displayName(members.get(event.userId)),
					kind: "completed",
					at: event.at,
					completionStatus: status === "late" ? "late" : "on_time",
				});
			}
		}

		for (const entry of derived.entries) {
			if (entry.status !== "missed") continue;
			items.push({
				id: `missed:${task.id}:${entry.key}`,
				taskId: task.id,
				taskTitle: task.title,
				actorId: task.ownerId,
				actorName: displayName(members.get(task.ownerId)),
				kind: "missed",
				at: entry.dueAt,
			});
		}
	}

	const tieOrder: Record<ActivityKind, number> = {
		created: 0,
		completed: 1,
		missed: 2,
		nudged: 3,
	};
	return items.sort(
		(a, b) =>
			b.at - a.at ||
			tieOrder[a.kind] - tieOrder[b.kind] ||
			a.id.localeCompare(b.id),
	);
}

export function groupActivityByDay(
	items: ActivityItem[],
	timezone?: string,
): ActivityDay[] {
	const days = new Map<string, ActivityItem[]>();
	for (const item of items) {
		const date = localDate(item.at, timezone);
		const list = days.get(date) ?? [];
		list.push(item);
		days.set(date, list);
	}
	return [...days]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, entries]) => ({ date, items: entries }));
}
