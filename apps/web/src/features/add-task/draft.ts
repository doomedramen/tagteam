import {
	isTimeOfDay,
	type LocalDate,
	MAX_INTERVAL,
	MAX_TITLE,
	type Mutation,
	type Rule,
	type TaskDto,
	type Weekday,
	weekdayOf,
	withScheduleVersion,
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

export function taskDraft(task: TaskDto, effectiveFrom: LocalDate): TaskDraft {
	const activeVersion =
		[...task.rules]
			.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
			.filter((version) => version.effectiveFrom <= effectiveFrom)
			.at(-1) ?? task.rules[0];
	const draft = newDraft(effectiveFrom);
	draft.title = task.title;
	if (!activeVersion) return draft;
	draft.dueTime = activeVersion.dueTime;
	const rule = activeVersion.rule;
	if (rule === null) {
		draft.repeat = "once";
	} else if (rule.freq === "day" && rule.interval === 1) {
		draft.repeat = "daily";
	} else {
		draft.repeat = "custom";
		draft.every = rule.interval;
		if (rule.freq === "day") {
			draft.unit = "day";
		} else if (rule.freq === "week") {
			draft.unit = "week";
			draft.weekdays = [...rule.weekdays];
		} else {
			draft.unit = "month";
			draft.monthDay = rule.monthDay;
		}
	}
	return draft;
}

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

function sameRule(a: Rule | null, b: Rule | null): boolean {
	if (a === null || b === null) return a === b;
	if (a.freq !== b.freq || a.interval !== b.interval) return false;
	if (a.freq === "day" || b.freq === "day") return a.freq === b.freq;
	if (a.freq === "week" && b.freq === "week")
		return (
			[...a.weekdays].sort((x, y) => x - y).join(",") ===
			[...b.weekdays].sort((x, y) => x - y).join(",")
		);
	if (a.freq === "month" && b.freq === "month")
		return a.monthDay === b.monthDay;
	return false;
}

export function draftErrors(d: TaskDraft): {
	title?: string;
	every?: string;
	dueTime?: string;
} {
	const errors: { title?: string; every?: string; dueTime?: string } = {};
	const length = d.title.trim().length;
	if (length < 1 || length > MAX_TITLE) errors.title = "Give it a name";
	if (
		d.repeat === "custom" &&
		(!Number.isInteger(d.every) || d.every < 1 || d.every > MAX_INTERVAL)
	) {
		errors.every = `Enter a number from 1 to ${MAX_INTERVAL}`;
	}
	if (d.dueTime !== null && !isTimeOfDay(d.dueTime)) {
		errors.dueTime = "Enter a time like 08:00";
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

export function draftScheduleMutation(
	d: TaskDraft,
	task: TaskDto,
	at: number,
): Mutation | null {
	const version = {
		effectiveFrom: d.startDate,
		rule: draftRule(d),
		dueTime: d.dueTime,
	};
	const activeVersion = [...task.rules]
		.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
		.filter((item) => item.effectiveFrom <= version.effectiveFrom)
		.at(-1);
	if (
		activeVersion &&
		sameRule(activeVersion.rule, version.rule) &&
		activeVersion.dueTime === version.dueTime
	)
		return null;
	const nextRules = withScheduleVersion(
		task.startDate as LocalDate,
		task.rules,
		version,
	);
	if (JSON.stringify(nextRules) === JSON.stringify(task.rules)) return null;
	return {
		id: crypto.randomUUID(),
		at,
		type: "task.schedule",
		taskId: task.id,
		effectiveFrom: version.effectiveFrom,
		rule: version.rule,
		dueTime: version.dueTime,
	};
}
