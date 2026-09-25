import { describe, expect, it } from "vitest";
import { draftErrors, draftMutation, draftRule, newDraft } from "./draft";

const base = newDraft("2026-09-23"); // Wednesday

describe("task drafts", () => {
	it("maps repeat choices to rules", () => {
		expect(draftRule({ ...base, repeat: "once" })).toBeNull();
		expect(draftRule({ ...base, repeat: "daily" })).toEqual({
			freq: "day",
			interval: 1,
		});
		expect(draftRule({ ...base, repeat: "weekly" })).toEqual({
			freq: "week",
			interval: 1,
			weekdays: [3],
		});
		expect(draftRule({ ...base, repeat: "monthly" })).toEqual({
			freq: "month",
			interval: 1,
			monthDay: 23,
		});
		expect(
			draftRule({ ...base, repeat: "custom", every: 3, unit: "day" }),
		).toEqual({ freq: "day", interval: 3 });
		expect(
			draftRule({
				...base,
				repeat: "custom",
				every: 2,
				unit: "week",
				weekdays: [1, 3],
			}),
		).toEqual({ freq: "week", interval: 2, weekdays: [1, 3] });
		expect(
			draftRule({
				...base,
				repeat: "custom",
				every: 2,
				unit: "week",
				weekdays: [],
			}),
		).toEqual({ freq: "week", interval: 2, weekdays: [3] });
		expect(
			draftRule({
				...base,
				repeat: "custom",
				every: 1,
				unit: "month",
				monthDay: "last",
			}),
		).toEqual({ freq: "month", interval: 1, monthDay: "last" });
	});

	it("validates the title and interval", () => {
		expect(draftErrors({ ...base, title: "   " })).toEqual({
			title: "Give it a name",
		});
		expect(
			draftErrors({ ...base, title: "Bins", repeat: "custom", every: 0 }),
		).toEqual({ every: "Enter a number from 1 to 366" });
		expect(draftErrors({ ...base, title: "Bins" })).toEqual({});
	});

	it("builds a create mutation", () => {
		const m = draftMutation(
			{ ...base, title: " Brush teeth ", repeat: "daily", dueTime: "08:00" },
			{ groupId: "g1", timezone: "Europe/London", at: 5 },
		);
		expect(m).toMatchObject({
			type: "task.create",
			groupId: "g1",
			title: "Brush teeth",
			notes: null,
			timezone: "Europe/London",
			startDate: "2026-09-23",
			dueTime: "08:00",
			rule: { freq: "day", interval: 1 },
			at: 5,
		});
		expect(m.id).not.toBe((m as { taskId: string }).taskId);
	});
});
