import { describe, expect, it } from "vitest";
import { type Mutation, mutationErrors } from "./mutations";

const id = "0b7a3a57-8d4e-4f6b-9a39-3c0b8d1f2e10";
const taskId = "5e0c1c5e-4f7a-4a8c-8f7e-1d2c3b4a5f60";
const groupId = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const at = Date.UTC(2026, 8, 25, 12);

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
			"update must change title or notes",
		]);
	});
});
