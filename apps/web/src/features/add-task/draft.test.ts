import { mutationErrors } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import {
	draftErrors,
	draftMutation,
	draftRule,
	newDraft,
	type TaskDraft,
} from "./draft";

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

	it("validates the due time", () => {
		expect(draftErrors({ ...base, title: "Bins", dueTime: "" })).toEqual({
			dueTime: "Enter a time like 08:00",
		});
		expect(draftErrors({ ...base, title: "Bins", dueTime: "8:" })).toEqual({
			dueTime: "Enter a time like 08:00",
		});
		expect(draftErrors({ ...base, title: "Bins", dueTime: "25:00" })).toEqual({
			dueTime: "Enter a time like 08:00",
		});
		expect(draftErrors({ ...base, title: "Bins", dueTime: "08:00" })).toEqual(
			{},
		);
		expect(draftErrors({ ...base, title: "Bins", dueTime: null })).toEqual({});
	});

	it("produces a mutation core accepts for every draft that passes validation", () => {
		const drafts: TaskDraft[] = [
			{ ...base, title: "Once", dueTime: null },
			{ ...base, title: "Daily", repeat: "daily", dueTime: "08:00" },
			{ ...base, title: "Weekly", repeat: "weekly", dueTime: null },
			{ ...base, title: "Monthly", repeat: "monthly", dueTime: "18:30" },
			{
				...base,
				title: "Custom week",
				repeat: "custom",
				unit: "week",
				every: 2,
				weekdays: [1, 3],
				dueTime: "07:15",
			},
			{
				...base,
				title: "Custom month",
				repeat: "custom",
				unit: "month",
				every: 1,
				monthDay: "last",
				dueTime: null,
			},
		];
		const groupId = "11111111-1111-4111-8111-111111111111";
		for (const d of drafts) {
			expect(draftErrors(d)).toEqual({});
			const m = draftMutation(d, {
				groupId,
				timezone: "Europe/London",
				at: 1,
			});
			expect(mutationErrors(m)).toEqual([]);
		}
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
