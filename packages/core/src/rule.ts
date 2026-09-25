import type { Weekday } from "./localDate";

export type Rule =
	| { freq: "day"; interval: number }
	| { freq: "week"; interval: number; weekdays: Weekday[] }
	| { freq: "month"; interval: number; monthDay: number | "last" };

/** Schedule in force from `effectiveFrom`. `rule: null` means a one-off occurrence on that date. */
export interface RuleVersion {
	effectiveFrom: string;
	rule: Rule | null;
}

export const MAX_INTERVAL = 366;

/** Human-readable problems with `rule`; empty array means valid. */
export function ruleErrors(rule: unknown): string[] {
	if (rule === null) return [];
	if (typeof rule !== "object") return ["rule must be an object or null"];
	const r = rule as Record<string, unknown>;
	const errors: string[] = [];
	const interval = r.interval;
	if (
		!Number.isInteger(interval) ||
		(interval as number) < 1 ||
		(interval as number) > MAX_INTERVAL
	) {
		errors.push(`interval must be an integer 1-${MAX_INTERVAL}`);
	}
	switch (r.freq) {
		case "day":
			break;
		case "week": {
			const w = r.weekdays;
			const valid =
				Array.isArray(w) &&
				w.length > 0 &&
				w.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) &&
				new Set(w).size === w.length;
			if (!valid)
				errors.push("weekdays must be distinct integers 1-7, at least one");
			break;
		}
		case "month": {
			const d = r.monthDay;
			if (
				d !== "last" &&
				!(Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 31)
			) {
				errors.push("monthDay must be 1-31 or 'last'");
			}
			break;
		}
		default:
			errors.push("freq must be 'day', 'week' or 'month'");
	}
	return errors;
}
