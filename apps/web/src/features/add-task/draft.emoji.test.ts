import { describe, expect, it } from "vitest";
import { fakeTask } from "../../test/fakes";
import {
	draftMutation,
	newDraft,
	suggestionMutation,
	taskDraft,
	taskUpdateMutation,
} from "./draft";

const PLANT = "\u{1FAB4}";
const base = { ...newDraft("2026-09-23"), title: "Water plants" };
const ctx = { groupId: "g1", timezone: "UTC", at: 5 };

describe("an emoji that fails validation", () => {
	it("is left out of a new task, which is still created", () => {
		for (const bad of ["abc", "\u{1FAB4}\u{1FAB4}", "", " "]) {
			const m = draftMutation({ ...base, emoji: bad }, ctx);
			expect(m, JSON.stringify(bad)).toMatchObject({
				type: "task.create",
				title: "Water plants",
			});
			expect(m).not.toHaveProperty("emoji");
		}
	});

	it("is left out of a suggestion", () => {
		const m = suggestionMutation(
			{ ...base, emoji: "abc", forUserId: "u2" },
			{ groupId: "g1", toUserId: "u2", at: 5 },
		);
		expect(m).toMatchObject({ type: "suggestion.create" });
		expect(m).not.toHaveProperty("emoji");
	});

	it("is not sent in an edit, and an otherwise unchanged edit sends nothing", () => {
		const task = fakeTask({ emoji: null, color: "teal" });
		const draft = { ...taskDraft(task, "2026-09-23"), emoji: "abc" };
		expect(taskUpdateMutation(draft, task, 9)).toBeNull();
		const retitled = { ...draft, title: "Water the plants" };
		expect(taskUpdateMutation(retitled, task, 9)).toMatchObject({
			title: "Water the plants",
		});
		expect(taskUpdateMutation(retitled, task, 9)).not.toHaveProperty("emoji");
	});

	it("is sent when it is valid, whether or not the person chose it", () => {
		expect(
			draftMutation({ ...base, emoji: PLANT, emojiChosen: false }, ctx),
		).toMatchObject({ emoji: PLANT });
	});
});
