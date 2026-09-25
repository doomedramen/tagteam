import { expect, it } from "vitest";
import * as core from "./index";

it("exposes the public API", () => {
	for (const name of [
		"addDays",
		"atTime",
		"startOfDay",
		"isLocalDate",
		"isTimeOfDay",
		"isTimeZone",
		"isId",
		"mutationErrors",
		"ruleErrors",
		"scheduleErrors",
		"occurrenceKeys",
		"expandSlots",
		"withScheduleVersion",
		"deriveTask",
		"summarize",
	]) {
		expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
	}
});
