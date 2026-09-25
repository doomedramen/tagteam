import { describe, expect, it } from "vitest";
import type { LocalDate } from "./localDate";
import type { Rule } from "./rule";
import { occurrenceKeys, scheduleErrors, type TaskSchedule } from "./schedule";

const schedule = (
	startDate: LocalDate,
	rule: Rule | null,
	extra: Partial<TaskSchedule> = {},
): TaskSchedule => ({
	startDate,
	dueTime: null,
	timezone: "Europe/London",
	rules: [{ effectiveFrom: startDate, rule }],
	...extra,
});

const take = (s: TaskSchedule, n: number): LocalDate[] => {
	const out: LocalDate[] = [];
	for (const key of occurrenceKeys(s)) {
		out.push(key);
		if (out.length === n) break;
	}
	return out;
};

describe("occurrenceKeys", () => {
	it("yields a single key for one-off tasks", () => {
		expect(take(schedule("2026-09-21", null), 5)).toEqual(["2026-09-21"]);
	});

	it("yields every N days", () => {
		expect(
			take(schedule("2026-09-21", { freq: "day", interval: 2 }), 3),
		).toEqual(["2026-09-21", "2026-09-23", "2026-09-25"]);
	});

	it("yields chosen weekdays every N weeks, never before the start date", () => {
		// Starts Wednesday; Monday of the first week is before start so it is skipped.
		expect(
			take(
				schedule("2026-09-23", { freq: "week", interval: 2, weekdays: [3, 1] }),
				4,
			),
		).toEqual(["2026-09-23", "2026-10-05", "2026-10-07", "2026-10-19"]);
	});

	it("clamps month days to the month length", () => {
		expect(
			take(
				schedule("2026-01-31", { freq: "month", interval: 1, monthDay: 31 }),
				4,
			),
		).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
		expect(
			take(
				schedule("2026-01-31", {
					freq: "month",
					interval: 1,
					monthDay: "last",
				}),
				2,
			),
		).toEqual(["2026-01-31", "2026-02-28"]);
	});

	it("skips a month day that falls before the start date", () => {
		expect(
			take(
				schedule("2026-01-20", { freq: "month", interval: 1, monthDay: 15 }),
				2,
			),
		).toEqual(["2026-02-15", "2026-03-15"]);
	});

	it("switches rule at each version effectiveFrom", () => {
		const s: TaskSchedule = {
			...schedule("2026-09-21", { freq: "day", interval: 1 }),
			rules: [
				{ effectiveFrom: "2026-09-21", rule: { freq: "day", interval: 1 } },
				{
					effectiveFrom: "2026-09-24",
					rule: { freq: "week", interval: 1, weekdays: [5] },
				},
			],
		};
		expect(take(s, 5)).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-25",
			"2026-10-02",
		]);
	});
});

describe("scheduleErrors", () => {
	it("accepts a valid schedule", () => {
		expect(
			scheduleErrors(
				schedule(
					"2026-09-21",
					{ freq: "day", interval: 1 },
					{ dueTime: "08:00" },
				),
			),
		).toEqual([]);
	});

	it("reports each problem", () => {
		const bad: TaskSchedule = {
			startDate: "2026-09-21",
			dueTime: "8am",
			timezone: "Mars/Base",
			rules: [
				{ effectiveFrom: "2026-09-22", rule: { freq: "day", interval: 0 } },
				{ effectiveFrom: "2026-09-22", rule: null },
			],
		};
		const errors = scheduleErrors(bad);
		expect(errors).toContain("dueTime must be HH:MM or null");
		expect(errors).toContain("timezone must be an IANA zone");
		expect(errors).toContain("rules[0].effectiveFrom must equal startDate");
		expect(errors).toContain(
			"rules must be strictly ascending by effectiveFrom",
		);
		expect(errors.some((e) => e.startsWith("rules[0]: interval"))).toBe(true);
	});

	it("requires at least one rule version", () => {
		expect(
			scheduleErrors({ ...schedule("2026-09-21", null), rules: [] }),
		).toContain("rules must not be empty");
	});
});
