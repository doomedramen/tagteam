import { describe, expect, it } from "vitest";
import type { LocalDate } from "./localDate";
import { atTime, startOfDay } from "./localDate";
import type { Rule } from "./rule";
import {
	expandSlots,
	occurrenceKeys,
	scheduleErrors,
	type TaskSchedule,
} from "./schedule";

const schedule = (
	startDate: LocalDate,
	rule: Rule | null,
	{
		dueTime = null,
		...extra
	}: Partial<TaskSchedule> & { dueTime?: string | null } = {},
): TaskSchedule => ({
	startDate,
	timezone: "Europe/London",
	rules: [{ effectiveFrom: startDate, rule, dueTime }],
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
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
				{
					effectiveFrom: "2026-09-24",
					rule: { freq: "week", interval: 1, weekdays: [5] },
					dueTime: null,
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

	it("returns to a recurring rule after a one-off version in between", () => {
		const s: TaskSchedule = {
			...schedule("2026-09-21", { freq: "day", interval: 1 }),
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
				{ effectiveFrom: "2026-09-24", rule: null, dueTime: null },
				{
					effectiveFrom: "2026-09-26",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
			],
		};
		expect(take(s, 7)).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
			"2026-09-26",
			"2026-09-27",
			"2026-09-28",
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
			timezone: "Mars/Base",
			rules: [
				{
					effectiveFrom: "2026-09-22",
					rule: { freq: "day", interval: 0 },
					dueTime: "8am",
				},
				{ effectiveFrom: "2026-09-22", rule: null, dueTime: null },
			],
		};
		const errors = scheduleErrors(bad);
		expect(errors).toContain("rules[0].dueTime must be HH:MM or null");
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

describe("expandSlots", () => {
	const london = (date: LocalDate, time: string) =>
		atTime(date, time, "Europe/London");
	const daily08 = schedule(
		"2026-09-21",
		{ freq: "day", interval: 1 },
		{ dueTime: "08:00" },
	);

	it("returns started slots plus one upcoming", () => {
		const slots = expandSlots(daily08, london("2026-09-23", "09:00"));
		expect(slots.map((s) => s.key)).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
		]);
		expect(slots[0]).toEqual({
			key: "2026-09-21",
			periodStart: Date.UTC(2026, 8, 20, 23),
			dueAt: london("2026-09-21", "08:00"),
		});
	});

	it("returns more upcoming slots on request", () => {
		const slots = expandSlots(daily08, london("2026-09-21", "09:00"), 3);
		expect(slots.map((s) => s.key)).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
		]);
	});

	it("makes untimed occurrences due at the start of the next occurrence day", () => {
		const weekly = schedule("2026-09-26", {
			freq: "week",
			interval: 1,
			weekdays: [6],
		});
		const slots = expandSlots(weekly, london("2026-09-26", "12:00"));
		expect(slots.map((s) => s.key)).toEqual(["2026-09-26", "2026-10-03"]);
		expect(slots[0]?.dueAt).toBe(startOfDay("2026-10-03", "Europe/London"));
		expect(slots[1]?.dueAt).toBe(startOfDay("2026-10-10", "Europe/London"));
	});

	it("makes an untimed one-off due at the end of its day", () => {
		const slots = expandSlots(
			schedule("2026-09-21", null),
			london("2026-09-25", "12:00"),
		);
		expect(slots).toEqual([
			{
				key: "2026-09-21",
				periodStart: startOfDay("2026-09-21", "Europe/London"),
				dueAt: startOfDay("2026-09-22", "Europe/London"),
			},
		]);
	});

	it("keeps wall-clock due times across DST", () => {
		const ny = schedule(
			"2026-10-31",
			{ freq: "day", interval: 1 },
			{ dueTime: "08:00", timezone: "America/New_York" },
		);
		const slots = expandSlots(ny, Date.UTC(2026, 10, 1, 14));
		expect(slots.slice(0, 2).map((s) => s.dueAt)).toEqual([
			Date.UTC(2026, 9, 31, 12),
			Date.UTC(2026, 10, 1, 13),
		]);
	});

	it("stops at archivedAt with no upcoming slot", () => {
		const archived = { ...daily08, archivedAt: london("2026-09-22", "12:00") };
		const slots = expandSlots(archived, london("2026-09-25", "12:00"));
		expect(slots.map((s) => s.key)).toEqual(["2026-09-21", "2026-09-22"]);
	});

	it("never returns a lookahead slot starting after archivedAt", () => {
		// until is before archivedAt, but archivedAt is still before the next
		// occurrence's periodStart, so the lookahead slot must be withheld.
		const weekly = schedule("2026-09-26", {
			freq: "week",
			interval: 1,
			weekdays: [6],
		});
		const archived = {
			...weekly,
			archivedAt: london("2026-09-30", "12:00"),
		};
		const slots = expandSlots(archived, london("2026-09-27", "12:00"));
		expect(slots.map((s) => s.key)).toEqual(["2026-09-26"]);
	});

	it("applies a due-time change only from its effective date", () => {
		const changed: TaskSchedule = {
			startDate: "2026-09-21",
			timezone: "Europe/London",
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: "08:00",
				},
				{
					effectiveFrom: "2026-09-23",
					rule: { freq: "day", interval: 1 },
					dueTime: "20:00",
				},
			],
		};
		const slots = expandSlots(changed, london("2026-09-23", "21:00"));
		expect(slots.map((s) => [s.key, s.dueAt])).toEqual([
			["2026-09-21", london("2026-09-21", "08:00")],
			["2026-09-22", london("2026-09-22", "08:00")],
			["2026-09-23", london("2026-09-23", "20:00")],
			["2026-09-24", london("2026-09-24", "20:00")],
		]);
	});
});
