import {
	deriveTask,
	type EventDto,
	startOfDay,
	type TaskDto,
	type TaskEvent,
} from "@tagteam/core";

export type RowKind = "overdue" | "open" | "done" | "upcoming";

export interface TodayRow {
	task: TaskDto;
	kind: RowKind;
	key: string;
	/** Start of the occurrence day in the task's timezone (epoch ms). */
	periodStart: number;
	dueAt: number;
	timed: boolean;
	recurring: boolean;
	missed: number;
	completedAt?: number;
	completionId?: string;
}

export interface TodayView {
	overdue: TodayRow[];
	today: TodayRow[];
	upcoming: TodayRow[];
	done: number;
	total: number;
	hasTasks: boolean;
}

/** Due time of the rule version in force on `key`. */
const dueTimeFor = (task: TaskDto, key: string): string | null => {
	let dueTime: string | null = null;
	for (const version of task.rules)
		if (version.effectiveFrom <= key) dueTime = version.dueTime;
	return dueTime;
};

export function buildToday(input: {
	tasks: TaskDto[];
	events: EventDto[];
	userId: string;
	groupId: string;
	now: number;
	day: { start: number; end: number };
}): TodayView {
	const { tasks, events, userId, groupId, now, day } = input;
	const eventsByTask = new Map<string, EventDto[]>();
	for (const event of events)
		eventsByTask.set(event.taskId, [
			...(eventsByTask.get(event.taskId) ?? []),
			event,
		]);

	const view: TodayView = {
		overdue: [],
		today: [],
		upcoming: [],
		done: 0,
		total: 0,
		hasTasks: false,
	};
	const doneRows: TodayRow[] = [];
	for (const task of tasks) {
		if (
			task.groupId !== groupId ||
			task.ownerId !== userId ||
			task.archivedAt !== null
		)
			continue;
		view.hasTasks = true;
		const schedule = {
			startDate: task.startDate,
			timezone: task.timezone,
			rules: task.rules,
			archivedAt: task.archivedAt,
		};
		// EventDto rows are the wire form of TaskEvent (nullable columns for unused variant fields).
		const derived = deriveTask(
			schedule,
			(eventsByTask.get(task.id) ?? []) as unknown as TaskEvent[],
			now,
		);
		const recurring = task.rules.some((v) => v.rule !== null);
		const row = (kind: RowKind, key: string, dueAt: number): TodayRow => ({
			task,
			kind,
			key,
			periodStart: startOfDay(key, task.timezone),
			dueAt,
			timed: dueTimeFor(task, key) !== null,
			recurring,
			missed: 0,
		});

		for (const entry of derived.entries) {
			const { completedAt } = entry;
			const closed = entry.status === "on_time" || entry.status === "late";
			if (
				closed &&
				completedAt !== undefined &&
				completedAt >= day.start &&
				completedAt < day.end
			) {
				doneRows.push({
					...row("done", entry.key, entry.dueAt),
					completedAt,
					completionId: entry.completionId,
				});
			}
		}
		const current = derived.current;
		if (!current) continue;
		if (current.status === "overdue")
			view.overdue.push({
				...row("overdue", current.key, current.dueAt),
				missed: derived.missedWhileOpen,
			});
		else if (current.status === "open")
			view.today.push(row("open", current.key, current.dueAt));
		else view.upcoming.push(row("upcoming", current.key, current.dueAt));
	}

	const byDue = (a: TodayRow, b: TodayRow) => a.dueAt - b.dueAt;
	view.overdue.sort(byDue);
	view.today.sort(byDue);
	view.upcoming.sort(byDue);
	doneRows.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
	view.today.push(...doneRows);
	view.done = doneRows.length;
	view.total = view.today.length + view.overdue.length;
	return view;
}
