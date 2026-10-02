import { type Mutation, mutationErrors, type TaskDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import {
	draftErrors,
	draftMutation,
	draftRule,
	newDraft,
	suggestionMutation,
	type TaskDraft,
	taskDraft,
	taskUpdateMutation,
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

	it("starts every draft for me", () => {
		expect(newDraft("2026-09-23").forUserId).toBeNull();
	});

	it("builds a suggestion.create that core accepts", () => {
		const m = suggestionMutation(
			{
				...base,
				title: " Wash dishes ",
				repeat: "weekly",
				dueTime: "19:00",
				forUserId: "u2",
			},
			{
				groupId: "11111111-1111-4111-8111-111111111111",
				toUserId: "u2",
				at: 7,
			},
		);
		expect(mutationErrors(m)).toEqual([]);
		expect(m).toMatchObject({
			type: "suggestion.create",
			toUserId: "u2",
			title: "Wash dishes",
			notes: null,
			startDate: "2026-09-23",
			dueTime: "19:00",
			rule: { freq: "week", interval: 1, weekdays: [3] },
			at: 7,
		});
		expect(m.id).not.toBe((m as { suggestionId: string }).suggestionId);
	});

	it("starts a new draft blue with no emoji chosen", () => {
		const d = newDraft("2026-09-23");
		expect(d.color).toBe("blue");
		expect(d.emoji).toBeNull();
		expect(d.emojiChosen).toBe(false);
	});

	it("sends the color of a new task and leaves out an emoji nobody picked", () => {
		const ctx = { groupId: "g1", timezone: "Europe/London", at: 5 };
		const plain = draftMutation({ ...base, title: "Bins" }, ctx);
		expect(plain).toMatchObject({ type: "task.create", color: "blue" });
		expect(plain).not.toHaveProperty("emoji");
		const picked = draftMutation(
			{
				...base,
				title: "Water plants",
				emoji: "\u{1FAB4}",
				emojiChosen: true,
				color: "teal",
			},
			ctx,
		);
		expect(picked).toMatchObject({ emoji: "\u{1FAB4}", color: "teal" });
		const uncolored = draftMutation(
			{ ...base, title: "Bins", color: null },
			ctx,
		);
		expect(uncolored).not.toHaveProperty("color");
	});

	it("carries emoji and color on a suggestion, and core accepts it", () => {
		const m = suggestionMutation(
			{
				...base,
				title: "Water plants",
				emoji: "\u{1FAB4}",
				emojiChosen: true,
				color: "green",
				forUserId: "u2",
			},
			{
				groupId: "11111111-1111-4111-8111-111111111111",
				toUserId: "u2",
				at: 7,
			},
		);
		expect(mutationErrors(m)).toEqual([]);
		expect(m).toMatchObject({ emoji: "\u{1FAB4}", color: "green" });
	});

	describe("editing a task", () => {
		const task: TaskDto = {
			id: "22222222-2222-4222-8222-222222222222",
			groupId: "g1",
			ownerId: "u1",
			title: "Water plants",
			notes: null,
			emoji: null,
			color: null,
			timezone: "UTC",
			startDate: "2026-09-21",
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
			],
			archivedAt: null,
			createdAt: 0,
			suggestedBy: null,
		};

		it("starts from the task's own emoji and color, which may be none", () => {
			const plain = taskDraft(task, "2026-09-23");
			expect(plain).toMatchObject({
				emoji: null,
				emojiChosen: false,
				color: null,
			});
			const styled = taskDraft(
				{ ...task, emoji: "\u{1FAB4}", color: "teal" },
				"2026-09-23",
			);
			expect(styled).toMatchObject({
				emoji: "\u{1FAB4}",
				emojiChosen: true,
				color: "teal",
			});
		});

		it("sends nothing when nothing changed, even though the sheet shows a default", () => {
			expect(
				taskUpdateMutation(taskDraft(task, "2026-09-23"), task, 9),
			).toBeNull();
		});

		it("sends only the changed fields in one update", () => {
			const draft = taskDraft(task, "2026-09-23");
			expect(
				taskUpdateMutation({ ...draft, title: " Water the plants " }, task, 9),
			).toMatchObject({
				type: "task.update",
				taskId: task.id,
				title: "Water the plants",
				at: 9,
			});
			const emojiOnly = taskUpdateMutation(
				{ ...draft, emoji: "\u{1FAB4}", emojiChosen: true },
				task,
				9,
			);
			expect(emojiOnly).toMatchObject({ emoji: "\u{1FAB4}" });
			expect(emojiOnly).not.toHaveProperty("title");
			expect(emojiOnly).not.toHaveProperty("color");
			const all = taskUpdateMutation(
				{
					...draft,
					title: "Plants",
					emoji: "\u{1F9FA}",
					emojiChosen: true,
					color: "pink",
				},
				task,
				9,
			);
			expect(all).toMatchObject({
				title: "Plants",
				emoji: "\u{1F9FA}",
				color: "pink",
			});
			expect(mutationErrors(all as Mutation)).toEqual([]);
		});

		it("does not resend an unchanged emoji or color, and never clears a stored color", () => {
			const styled = { ...task, emoji: "\u{1FAB4}", color: "teal" as const };
			const draft = taskDraft(styled, "2026-09-23");
			expect(taskUpdateMutation(draft, styled, 9)).toBeNull();
			expect(
				taskUpdateMutation({ ...draft, color: null }, styled, 9),
			).toBeNull();
			expect(
				taskUpdateMutation({ ...draft, color: "blue" }, styled, 9),
			).toMatchObject({ color: "blue" });
		});
	});
});
