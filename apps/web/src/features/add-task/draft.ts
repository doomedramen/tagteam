import {
	type LocalDate,
	MAX_INTERVAL,
	MAX_TITLE,
	type Mutation,
	type Rule,
	type Weekday,
	weekdayOf,
} from "@tagteam/core";

export type Repeat = "once" | "daily" | "weekly" | "monthly" | "custom";
export type Unit = "day" | "week" | "month";

export interface TaskDraft {
	title: string;
	repeat: Repeat;
	every: number;
	unit: Unit;
	weekdays: Weekday[];
	monthDay: number | "last";
	startDate: LocalDate;
	dueTime: string | null;
}

export const newDraft = (today: LocalDate): TaskDraft => ({
	title: "",
	repeat: "once",
	every: 1,
	unit: "day",
	weekdays: [],
	monthDay: Number(today.slice(8)),
	startDate: today,
	dueTime: null,
});

export function draftRule(d: TaskDraft): Rule | null {
	const startWeekday = weekdayOf(d.startDate);
	switch (d.repeat) {
		case "once":
			return null;
		case "daily":
			return { freq: "day", interval: 1 };
		case "weekly":
			return { freq: "week", interval: 1, weekdays: [startWeekday] };
		case "monthly":
			return {
				freq: "month",
				interval: 1,
				monthDay: Number(d.startDate.slice(8)),
			};
		case "custom":
			if (d.unit === "day") return { freq: "day", interval: d.every };
			if (d.unit === "week") {
				const weekdays =
					d.weekdays.length > 0
						? [...d.weekdays].sort((a, b) => a - b)
						: [startWeekday];
				return { freq: "week", interval: d.every, weekdays };
			}
			return { freq: "month", interval: d.every, monthDay: d.monthDay };
	}
}

export function draftErrors(d: TaskDraft): { title?: string; every?: string } {
	const errors: { title?: string; every?: string } = {};
	const length = d.title.trim().length;
	if (length < 1 || length > MAX_TITLE) errors.title = "Give it a name";
	if (
		d.repeat === "custom" &&
		(!Number.isInteger(d.every) || d.every < 1 || d.every > MAX_INTERVAL)
	) {
		errors.every = `Enter a number from 1 to ${MAX_INTERVAL}`;
	}
	return errors;
}

export function draftMutation(
	d: TaskDraft,
	ctx: { groupId: string; timezone: string; at: number },
): Mutation {
	return {
		id: crypto.randomUUID(),
		at: ctx.at,
		type: "task.create",
		taskId: crypto.randomUUID(),
		groupId: ctx.groupId,
		title: d.title.trim(),
		notes: null,
		timezone: ctx.timezone,
		startDate: d.startDate,
		dueTime: d.dueTime,
		rule: draftRule(d),
	};
}
