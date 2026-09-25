import {
	addDays,
	atTime,
	daysInMonth,
	firstOfMonth,
	isLocalDate,
	isoMonday,
	isTimeOfDay,
	isTimeZone,
	type LocalDate,
	startOfDay,
} from "./localDate";
import { type Rule, type RuleVersion, ruleErrors } from "./rule";

export interface TaskSchedule {
	startDate: LocalDate;
	/** Owner's IANA timezone. */
	timezone: string;
	/** Ascending by `effectiveFrom`; `rules[0].effectiveFrom === startDate`. */
	rules: RuleVersion[];
	/** Epoch ms. No occurrence, including lookahead ones from `expandSlots`, starts after this. */
	archivedAt?: number | null;
}

export function scheduleErrors(s: TaskSchedule): string[] {
	const errors: string[] = [];
	if (!isLocalDate(s.startDate)) errors.push("startDate must be YYYY-MM-DD");
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
		if (version.dueTime !== null && !isTimeOfDay(version.dueTime)) {
			errors.push(`rules[${i}].dueTime must be HH:MM or null`);
		}
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
			// Loops forever (caller stops pulling); never reaches the next case.
			for (let n = 0; ; n++) yield addDays(anchor, n * rule.interval);
		case "week": {
			// Loops forever (caller stops pulling); never reaches the next case.
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
			// Loops forever (caller stops pulling); this is the last case.
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

interface Occurrence {
	key: LocalDate;
	dueTime: string | null;
}

function* occurrences(s: TaskSchedule): Generator<Occurrence> {
	for (const [i, version] of s.rules.entries()) {
		const anchor = i === 0 ? s.startDate : version.effectiveFrom;
		const end = s.rules[i + 1]?.effectiveFrom;
		for (const key of ruleKeys(version.rule, anchor)) {
			if (end !== undefined && key >= end) break;
			yield { key, dueTime: version.dueTime };
		}
	}
}

/** Every occurrence key of the schedule, ascending, across all rule versions. */
export function* occurrenceKeys(s: TaskSchedule): Generator<LocalDate> {
	for (const occurrence of occurrences(s)) yield occurrence.key;
}

export interface Slot {
	key: LocalDate;
	/** Epoch ms when this occurrence becomes current: start of `key` in the task timezone. */
	periodStart: number;
	/** Epoch ms deadline: `key` at its version's `dueTime`, or the start of the next occurrence's day. */
	dueAt: number;
}

/**
 * Slots whose period has started by `until` (capped at `archivedAt`), plus the next
 * `lookahead` slots that still start at or before `archivedAt` — unless the task was
 * archived by `until`, then none after.
 */
export function expandSlots(
	s: TaskSchedule,
	until: number,
	lookahead = 1,
): Slot[] {
	const limit = Math.min(until, s.archivedAt ?? Number.POSITIVE_INFINITY);
	const found: Occurrence[] = [];
	let beyond = 0;
	// One extra occurrence past the lookahead so the last returned slot knows its period end.
	for (const occurrence of occurrences(s)) {
		found.push(occurrence);
		if (
			startOfDay(occurrence.key, s.timezone) > limit &&
			++beyond === lookahead + 1
		)
			break;
	}
	const slots = found.map(({ key, dueTime }, i): Slot => {
		const periodEnd = found[i + 1]?.key ?? addDays(key, 1);
		return {
			key,
			periodStart: startOfDay(key, s.timezone),
			dueAt: dueTime
				? atTime(key, dueTime, s.timezone)
				: startOfDay(periodEnd, s.timezone),
		};
	});
	const started = slots.filter((slot) => slot.periodStart <= limit);
	if (s.archivedAt != null && s.archivedAt <= until) return started;
	const archiveLimit = s.archivedAt ?? Number.POSITIVE_INFINITY;
	return [
		...started,
		...slots
			.filter(
				(slot) => slot.periodStart > limit && slot.periodStart <= archiveLimit,
			)
			.slice(0, lookahead),
	];
}
