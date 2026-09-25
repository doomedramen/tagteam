import { describe, expect, it } from "vitest";
import {
	addDays,
	atTime,
	daysInMonth,
	firstOfMonth,
	isLocalDate,
	isoMonday,
	isTimeOfDay,
	isTimeZone,
	startOfDay,
	weekdayOf,
} from "./localDate";

describe("localDate", () => {
	it("adds days across month boundaries", () => {
		expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
		expect(addDays("2026-09-21", -1)).toBe("2026-09-20");
	});

	it("computes ISO weekdays and Mondays", () => {
		expect(weekdayOf("2026-09-21")).toBe(1);
		expect(weekdayOf("2026-09-27")).toBe(7);
		expect(isoMonday("2026-09-23")).toBe("2026-09-21");
		expect(isoMonday("2026-09-27")).toBe("2026-09-21");
	});

	it("handles months", () => {
		expect(daysInMonth("2026-02-10")).toBe(28);
		expect(firstOfMonth("2026-01-31")).toBe("2026-01-01");
		expect(firstOfMonth("2026-01-31", 1)).toBe("2026-02-01");
	});

	it("converts local dates to instants in a timezone", () => {
		// London is on BST (UTC+1) in September
		expect(startOfDay("2026-09-21", "Europe/London")).toBe(
			Date.UTC(2026, 8, 20, 23),
		);
		expect(atTime("2026-09-21", "08:00", "Europe/London")).toBe(
			Date.UTC(2026, 8, 21, 7),
		);
	});

	it("respects DST changes (New York falls back on 2026-11-01)", () => {
		expect(atTime("2026-10-31", "08:00", "America/New_York")).toBe(
			Date.UTC(2026, 9, 31, 12),
		);
		expect(atTime("2026-11-01", "08:00", "America/New_York")).toBe(
			Date.UTC(2026, 10, 1, 13),
		);
	});

	it("shifts a nonexistent wall-clock time forward across the DST spring-forward gap", () => {
		// UK clocks go 01:00 -> 02:00 on 2026-03-29; 01:30 doesn't exist, so Luxon
		// shifts it forward by the gap to 02:30 BST (same instant as 01:30 UTC).
		expect(atTime("2026-03-29", "01:30", "Europe/London")).toBe(
			Date.UTC(2026, 2, 29, 1, 30),
		);
	});

	it("validates inputs", () => {
		expect(isLocalDate("2026-02-28")).toBe(true);
		expect(isLocalDate("2026-02-30")).toBe(false);
		expect(isLocalDate("2026-2-3")).toBe(false);
		expect(isTimeOfDay("08:05")).toBe(true);
		expect(isTimeOfDay("24:00")).toBe(false);
		expect(isTimeOfDay("8:05")).toBe(false);
		expect(isTimeZone("Europe/London")).toBe(true);
		expect(isTimeZone("Mars/Base")).toBe(false);
	});
});
