import {
	addDays,
	daysInMonth,
	firstOfMonth,
	isLocalDate,
	isoMonday,
	isTimeOfDay,
	isTimeZone,
	type LocalDate,
} from "./localDate";
import { type Rule, type RuleVersion, ruleErrors } from "./rule";

export interface TaskSchedule {
	startDate: LocalDate;
	/** `HH:MM` in `timezone`, or null = due by the end of each period. */
	dueTime: string | null;
	/** Owner's IANA timezone. */
	timezone: string;
	/** Ascending by `effectiveFrom`; `rules[0].effectiveFrom === startDate`. */
	rules: RuleVersion[];
	/** Epoch ms. No occurrence starts after this. */
	archivedAt?: number | null;
}

export function scheduleErrors(s: TaskSchedule): string[] {
	const errors: string[] = [];
	if (!isLocalDate(s.startDate)) errors.push("startDate must be YYYY-MM-DD");
	if (s.dueTime !== null && !isTimeOfDay(s.dueTime))
		errors.push("dueTime must be HH:MM or null");
	if (!isTimeZone(s.timezone)) errors.push("timezone must be an IANA zone");
	if (s.rules.length === 0) errors.push("rules must not be empty");
	s.rules.forEach((version, i) => {
		if (!isLocalDate(version.effectiveFrom))
			errors.push(`rules[${i}].effectiveFrom must be YYYY-MM-DD`);
		if (i === 0 && version.effectiveFrom !== s.startDate) {
			errors.push("rules[0].effectiveFrom must equal startDate");
		}
		const previous = s.rules[i - 1];
		if (previous && version.effectiveFrom <= previous.effectiveFrom) {
			errors.push("rules must be strictly ascending by effectiveFrom");
		}
		for (const e of ruleErrors(version.rule)) errors.push(`rules[${i}]: ${e}`);
	});
	return errors;
}

/** Keys produced by one rule from `anchor` onwards, ascending. Infinite unless one-off. */
function* ruleKeys(rule: Rule | null, anchor: LocalDate): Generator<LocalDate> {
	if (rule === null) {
		yield anchor;
		return;
	}
	switch (rule.freq) {
		case "day":
			for (let n = 0; ; n++) yield addDays(anchor, n * rule.interval);
		case "week": {
			const weekdays = [...rule.weekdays].sort((a, b) => a - b);
			const firstMonday = isoMonday(anchor);
			for (let n = 0; ; n++) {
				const monday = addDays(firstMonday, n * 7 * rule.interval);
				for (const weekday of weekdays) {
					const key = addDays(monday, weekday - 1);
					if (key >= anchor) yield key;
				}
			}
		}
		case "month": {
			for (let n = 0; ; n++) {
				const first = firstOfMonth(anchor, n * rule.interval);
				const length = daysInMonth(first);
				const day =
					rule.monthDay === "last" ? length : Math.min(rule.monthDay, length);
				const key = addDays(first, day - 1);
				if (key >= anchor) yield key;
			}
		}
	}
}

/** Every occurrence key of the schedule, ascending, across all rule versions. */
export function* occurrenceKeys(s: TaskSchedule): Generator<LocalDate> {
	for (const [i, version] of s.rules.entries()) {
		const anchor = i === 0 ? s.startDate : version.effectiveFrom;
		const end = s.rules[i + 1]?.effectiveFrom;
		for (const key of ruleKeys(version.rule, anchor)) {
			if (end !== undefined && key >= end) break;
			yield key;
		}
	}
}
