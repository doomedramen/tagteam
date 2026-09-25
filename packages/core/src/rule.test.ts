import { describe, expect, it } from "vitest";
import { ruleErrors } from "./rule";

describe("ruleErrors", () => {
	it("accepts valid rules and null (one-off)", () => {
		expect(ruleErrors(null)).toEqual([]);
		expect(ruleErrors({ freq: "day", interval: 1 })).toEqual([]);
		expect(ruleErrors({ freq: "week", interval: 2, weekdays: [1, 3] })).toEqual(
			[],
		);
		expect(ruleErrors({ freq: "month", interval: 1, monthDay: 31 })).toEqual(
			[],
		);
		expect(
			ruleErrors({ freq: "month", interval: 3, monthDay: "last" }),
		).toEqual([]);
	});

	it("rejects bad intervals", () => {
		expect(ruleErrors({ freq: "day", interval: 0 })).toHaveLength(1);
		expect(ruleErrors({ freq: "day", interval: 1.5 })).toHaveLength(1);
		expect(ruleErrors({ freq: "day", interval: 367 })).toHaveLength(1);
	});

	it("rejects bad weekdays and month days", () => {
		expect(
			ruleErrors({ freq: "week", interval: 1, weekdays: [] }),
		).toHaveLength(1);
		expect(
			ruleErrors({ freq: "week", interval: 1, weekdays: [0] }),
		).toHaveLength(1);
		expect(
			ruleErrors({ freq: "week", interval: 1, weekdays: [2, 2] }),
		).toHaveLength(1);
		expect(
			ruleErrors({ freq: "month", interval: 1, monthDay: 32 }),
		).toHaveLength(1);
		expect(
			ruleErrors({ freq: "month", interval: 1, monthDay: "first" }),
		).toHaveLength(1);
	});

	it("rejects unknown shapes", () => {
		expect(ruleErrors({ freq: "year", interval: 1 })).toHaveLength(1);
		expect(ruleErrors("daily")).toHaveLength(1);
	});
});
