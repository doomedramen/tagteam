import { describe, expect, it } from "vitest";
import {
	isSuggestionMutation,
	MAX_PENDING_SUGGESTIONS,
	type Mutation,
	mutationErrors,
} from "./mutations";

const id = "0b7a3a57-8d4e-4f6b-9a39-3c0b8d1f2e10";
const taskId = "5e0c1c5e-4f7a-4a8c-8f7e-1d2c3b4a5f60";
const groupId = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const suggestionId = "7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
// Better Auth user ids are random strings, not UUIDs.
const toUserId = "k3Jx9mQ2pL7vN1sT5yB8wZ4aC6dE0fGh";
const at = Date.UTC(2026, 8, 25, 12);

const PLANT = "\u{1FAB4}"; // potted plant

const valid: Mutation[] = [
	{
		id,
		at,
		type: "task.create",
		taskId,
		groupId,
		title: "Brush teeth",
		notes: null,
		timezone: "Europe/London",
		startDate: "2026-09-21",
		dueTime: "08:00",
		rule: { freq: "day", interval: 1 },
	},
	{ id, at, type: "task.update", taskId, title: "Floss" },
	{ id, at, type: "task.update", taskId, notes: null },
	{
		id,
		at,
		type: "task.schedule",
		taskId,
		effectiveFrom: "2026-10-01",
		dueTime: null,
		rule: null,
	},
	{ id, at, type: "task.archive", taskId, archived: true },
	{ id, at, type: "task.complete", taskId, occurrenceKey: "2026-09-21" },
	{ id, at, type: "task.uncomplete", taskId, refEventId: id },
	{ id, at, type: "task.nudge", taskId },
	{
		id,
		at,
		type: "suggestion.create",
		suggestionId,
		groupId,
		toUserId,
		title: "Wash dishes",
		notes: null,
		startDate: "2026-10-01",
		dueTime: "19:00",
		rule: { freq: "day", interval: 1 },
	},
	{
		id,
		at,
		type: "suggestion.accept",
		suggestionId,
		taskId,
		timezone: "Europe/London",
		startDate: "2026-10-02",
	},
	{ id, at, type: "suggestion.decline", suggestionId },
	{ id, at, type: "suggestion.withdraw", suggestionId },
	{
		id,
		at,
		type: "task.create",
		taskId,
		groupId,
		title: "Water plants",
		notes: null,
		timezone: "Europe/London",
		startDate: "2026-09-21",
		dueTime: null,
		rule: null,
		emoji: PLANT,
		color: "teal",
	},
	{
		id,
		at,
		type: "task.create",
		taskId,
		groupId,
		title: "Water plants",
		notes: null,
		timezone: "Europe/London",
		startDate: "2026-09-21",
		dueTime: null,
		rule: null,
		emoji: null,
		color: null,
	},
	{ id, at, type: "task.update", taskId, emoji: PLANT },
	{ id, at, type: "task.update", taskId, color: "blue" },
	{ id, at, type: "task.update", taskId, emoji: null, color: null },
	{
		id,
		at,
		type: "suggestion.create",
		suggestionId,
		groupId,
		toUserId,
		title: "Water plants",
		notes: null,
		startDate: "2026-10-01",
		dueTime: null,
		rule: null,
		emoji: PLANT,
		color: "pink",
	},
];

describe("mutationErrors", () => {
	it.each(valid)("accepts a valid $type", (m) => {
		expect(mutationErrors(m)).toEqual([]);
	});

	it("rejects non-objects and unknown types", () => {
		expect(mutationErrors(null)).toEqual(["mutation must be an object"]);
		expect(mutationErrors([])).toEqual(["mutation must be an object"]);
		expect(mutationErrors({ id, at, type: "task.delete", taskId })).toEqual([
			"type is not a known mutation",
		]);
	});

	it("reports every problem in a create", () => {
		expect(
			mutationErrors({
				id: "nope",
				at: -1,
				type: "task.create",
				taskId: "x",
				groupId,
				title: "   ",
				notes: "n".repeat(1001),
				timezone: "Mars/Base",
				startDate: "2026-02-30",
				dueTime: "8am",
				rule: { freq: "day", interval: 0 },
				colour: "red",
			}),
		).toEqual([
			"id must be a UUID",
			"at must be epoch milliseconds",
			"unknown field: colour",
			"taskId must be a UUID",
			"title must be 1-100 characters",
			"notes must be null or at most 1000 characters",
			"timezone must be an IANA zone",
			"startDate must be YYYY-MM-DD",
			"dueTime must be HH:MM or null",
			"rule: interval must be an integer 1-366",
		]);
	});

	it("requires the fields of each type", () => {
		expect(mutationErrors({ id, at, type: "task.complete", taskId })).toEqual([
			"occurrenceKey is required",
		]);
		expect(mutationErrors({ id, at, type: "task.update", taskId })).toEqual([
			"update must change title, notes, emoji or color",
		]);
	});

	it("reports every problem in a suggestion.create", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.create",
				suggestionId: "x",
				groupId,
				toUserId: "",
				title: "   ",
				notes: "n".repeat(1001),
				startDate: "2026-02-30",
				dueTime: "8am",
				rule: { freq: "day", interval: 0 },
			}),
		).toEqual([
			"suggestionId must be a UUID",
			"toUserId must be a user id",
			"title must be 1-100 characters",
			"notes must be null or at most 1000 characters",
			"startDate must be YYYY-MM-DD",
			"dueTime must be HH:MM or null",
			"rule: interval must be an integer 1-366",
		]);
	});

	it("reports every problem in a suggestion.accept", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.accept",
				suggestionId,
				taskId: "x",
				timezone: "Mars/Base",
				startDate: "soon",
				extra: true,
			}),
		).toEqual([
			"unknown field: extra",
			"taskId must be a UUID",
			"timezone must be an IANA zone",
			"startDate must be YYYY-MM-DD",
		]);
	});

	it("requires the fields of each suggestion mutation", () => {
		expect(mutationErrors({ id, at, type: "suggestion.decline" })).toEqual([
			"suggestionId is required",
		]);
		expect(
			mutationErrors({ id, at, type: "suggestion.accept", suggestionId }),
		).toEqual([
			"taskId is required",
			"timezone is required",
			"startDate is required",
		]);
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.withdraw",
				suggestionId,
				toUserId,
			}),
		).toEqual(["unknown field: toUserId"]);
	});

	it("caps pending suggestions per sender and recipient at 10", () => {
		expect(MAX_PENDING_SUGGESTIONS).toBe(10);
	});

	it("rejects an emoji that is not exactly one emoji", () => {
		for (const bad of ["a", "\u{1F600}\u{1F600}", "", 5, "x".repeat(40)]) {
			expect(
				mutationErrors({ id, at, type: "task.update", taskId, emoji: bad }),
			).toEqual(["emoji must be null or a single emoji"]);
		}
	});

	it("rejects a color that is not one of the seven hues", () => {
		for (const bad of ["red", "Blue", "", 3]) {
			expect(
				mutationErrors({ id, at, type: "task.update", taskId, color: bad }),
			).toEqual([
				"color must be null or one of pink, coral, amber, green, teal, blue, purple",
			]);
		}
	});

	it("reports emoji and color problems on create and suggestion.create", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "task.create",
				taskId,
				groupId,
				title: "Water plants",
				notes: null,
				timezone: "Europe/London",
				startDate: "2026-09-21",
				dueTime: null,
				rule: null,
				emoji: "water",
				color: "green-ish",
			}),
		).toEqual([
			"emoji must be null or a single emoji",
			"color must be null or one of pink, coral, amber, green, teal, blue, purple",
		]);
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.create",
				suggestionId,
				groupId,
				toUserId,
				title: "Water plants",
				notes: null,
				startDate: "2026-10-01",
				dueTime: null,
				rule: null,
				color: "nope",
			}),
		).toEqual([
			"color must be null or one of pink, coral, amber, green, teal, blue, purple",
		]);
	});

	it("treats absent emoji and color as optional on every type that has them", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "task.create",
				taskId,
				groupId,
				title: "Water plants",
				notes: null,
				timezone: "Europe/London",
				startDate: "2026-09-21",
				dueTime: null,
				rule: null,
			}),
		).toEqual([]);
		expect(
			mutationErrors({ id, at, type: "task.update", taskId, title: "Floss" }),
		).toEqual([]);
	});

	it("lets an update change only the emoji or only the color, but never nothing", () => {
		expect(
			mutationErrors({ id, at, type: "task.update", taskId, emoji: PLANT }),
		).toEqual([]);
		expect(
			mutationErrors({ id, at, type: "task.update", taskId, color: "pink" }),
		).toEqual([]);
		expect(mutationErrors({ id, at, type: "task.update", taskId })).toEqual([
			"update must change title, notes, emoji or color",
		]);
	});

	it("does not accept emoji or color on mutations that do not carry them", () => {
		expect(
			mutationErrors({
				id,
				at,
				type: "task.archive",
				taskId,
				archived: true,
				emoji: PLANT,
			}),
		).toEqual(["unknown field: emoji"]);
		expect(
			mutationErrors({
				id,
				at,
				type: "suggestion.accept",
				suggestionId,
				taskId,
				timezone: "Europe/London",
				startDate: "2026-10-02",
				color: "teal",
			}),
		).toEqual(["unknown field: color"]);
	});

	it("tells suggestion mutations apart from task mutations", () => {
		expect(valid.filter(isSuggestionMutation).map((m) => m.type)).toEqual([
			"suggestion.create",
			"suggestion.accept",
			"suggestion.decline",
			"suggestion.withdraw",
			"suggestion.create",
		]);
	});
});
