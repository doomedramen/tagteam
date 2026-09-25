import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./derive";
import { summarize } from "./stats";

const entry = (
	dueAt: number,
	status: HistoryEntry["status"],
): HistoryEntry => ({ key: "x", dueAt, status });

describe("summarize", () => {
	it("counts closed and missed occurrences inside the window", () => {
		const entries = [
			entry(5, "on_time"),
			entry(10, "on_time"),
			entry(20, "late"),
			entry(30, "missed"),
			entry(40, "overdue"),
			entry(100, "on_time"),
		];
		expect(summarize(entries, 10, 100)).toEqual({
			onTime: 1,
			late: 1,
			missed: 1,
			onTimeRate: 1 / 3,
		});
	});

	it("returns a null rate when nothing is in range", () => {
		expect(summarize([], 0, 100)).toEqual({
			onTime: 0,
			late: 0,
			missed: 0,
			onTimeRate: null,
		});
	});
});
