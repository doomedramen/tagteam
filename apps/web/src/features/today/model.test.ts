import { atTime, type EventDto, type TaskDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import { rowLabel } from "./labels";
import { buildToday } from "./model";

const TZ = "Europe/London";
const at = (date: string, time: string) => atTime(date, time, TZ);
const opts = { tz: TZ, locale: "en-GB" };
const day = (date: string) => ({
	start: at(date, "00:00"),
	end: at(date, "00:00") + 86_400_000,
});

const task = (id: string, patch: Partial<TaskDto> = {}): TaskDto => ({
	id,
	groupId: "g1",
	ownerId: "u1",
	title: id,
	notes: null,
	timezone: TZ,
	startDate: "2026-09-21",
	rules: [
		{
			effectiveFrom: "2026-09-21",
			rule: { freq: "day", interval: 1 },
			dueTime: "08:00",
		},
	],
	archivedAt: null,
	createdAt: 0,
	...patch,
});
const done = (
	taskId: string,
	key: string,
	when: number,
	id = `${taskId}-${key}`,
): EventDto => ({
	id,
	taskId,
	userId: "u1",
	type: "completed",
	occurrenceKey: key,
	refEventId: null,
	at: when,
});

describe("buildToday", () => {
	it("puts an old open occurrence under overdue with its missed count", () => {
		const now = at("2026-09-23", "09:00");
		const view = buildToday({
			tasks: [task("teeth")],
			events: [],
			userId: "u1",
			groupId: "g1",
			now,
			day: day("2026-09-23"),
		});
		expect(view.overdue.map((r) => [r.task.id, r.key, r.missed])).toEqual([
			["teeth", "2026-09-21", 2],
		]);
		expect(rowLabel(view.overdue[0]!, now, opts)).toBe(
			"Since Mon 08:00 · 2 missed",
		);
		expect(view.total).toBe(1);
	});

	it("shows today's completions as done and the next one as upcoming", () => {
		const now = at("2026-09-21", "09:00");
		const view = buildToday({
			tasks: [task("teeth")],
			events: [done("teeth", "2026-09-21", at("2026-09-21", "07:42"))],
			userId: "u1",
			groupId: "g1",
			now,
			day: day("2026-09-21"),
		});
		expect(view.today.map((r) => [r.kind, r.key, r.completionId])).toEqual([
			["done", "2026-09-21", "teeth-2026-09-21"],
		]);
		expect(rowLabel(view.today[0]!, now, opts)).toBe("Done 07:42");
		expect(view.upcoming.map((r) => r.key)).toEqual(["2026-09-22"]);
		expect(rowLabel(view.upcoming[0]!, now, opts)).toBe("Tomorrow 08:00");
		expect([view.done, view.total]).toEqual([1, 1]);
	});

	it("labels open occurrences by due time or day", () => {
		const now = at("2026-09-21", "07:00");
		const untimed = task("read", {
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
			],
		});
		const weekly = task("bins", {
			startDate: "2026-09-19",
			rules: [
				{
					effectiveFrom: "2026-09-19",
					rule: { freq: "week", interval: 1, weekdays: [6] },
					dueTime: null,
				},
			],
		});
		const view = buildToday({
			tasks: [task("teeth"), untimed, weekly],
			events: [],
			userId: "u1",
			groupId: "g1",
			now,
			day: day("2026-09-21"),
		});
		expect(view.today.map((r) => [r.task.id, rowLabel(r, now, opts)])).toEqual([
			["teeth", "By 08:00"],
			["read", "Today"],
			["bins", "Due Fri"],
		]);
	});

	it("ignores other people's, other groups' and archived tasks", () => {
		const now = at("2026-09-21", "07:00");
		const view = buildToday({
			tasks: [
				task("theirs", { ownerId: "u2" }),
				task("other", { groupId: "g2" }),
				task("old", { archivedAt: 1 }),
			],
			events: [],
			userId: "u1",
			groupId: "g1",
			now,
			day: day("2026-09-21"),
		});
		expect([view.overdue, view.today, view.upcoming, view.hasTasks]).toEqual([
			[],
			[],
			[],
			false,
		]);
	});
});
