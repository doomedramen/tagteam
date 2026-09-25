import { describe, expect, it } from "vitest";
import { type DerivedTask, deriveTask, type TaskEvent } from "./derive";
import { atTime, type LocalDate } from "./localDate";
import type { RuleVersion } from "./rule";
import type { TaskSchedule } from "./schedule";

const TZ = "Europe/London";
const at = (date: LocalDate, time: string) => atTime(date, time, TZ);
const HOUR = 3_600_000;

const daily08: TaskSchedule = {
	startDate: "2026-09-21", // Monday
	timezone: TZ,
	rules: [
		{
			effectiveFrom: "2026-09-21",
			rule: { freq: "day", interval: 1 },
			dueTime: "08:00",
		},
	],
};

const done = (
	id: string,
	key: LocalDate,
	date: LocalDate,
	time: string,
): TaskEvent => ({
	id,
	type: "completed",
	occurrenceKey: key,
	at: at(date, time),
});

const lines = (d: DerivedTask) =>
	d.entries.map(
		(e) => `${e.key} ${e.status}${e.blockedBy ? ` <${e.blockedBy}` : ""}`,
	);

describe("deriveTask", () => {
	it("keeps one overdue occurrence open and logs later ones as missed", () => {
		const d = deriveTask(daily08, [], at("2026-09-23", "09:00"));
		expect(lines(d)).toEqual([
			"2026-09-21 overdue",
			"2026-09-22 missed <2026-09-21",
			"2026-09-23 missed <2026-09-21",
		]);
		expect(d.current?.key).toBe("2026-09-21");
		expect(d.missedWhileOpen).toBe(2);
	});

	it("does not count an occurrence as missed before its due time", () => {
		const d = deriveTask(daily08, [], at("2026-09-23", "07:00"));
		expect(lines(d)).toEqual([
			"2026-09-21 overdue",
			"2026-09-22 missed <2026-09-21",
		]);
		expect(d.missedWhileOpen).toBe(1);
	});

	it("matches the spec example: late completion, gap missed, today overdue", () => {
		const d = deriveTask(
			daily08,
			[done("c1", "2026-09-21", "2026-09-23", "10:00")],
			at("2026-09-23", "10:05"),
		);
		expect(lines(d)).toEqual([
			"2026-09-21 late",
			"2026-09-22 missed <2026-09-21",
			"2026-09-23 overdue",
		]);
		expect(d.entries[0]?.lateByMs).toBe(50 * HOUR);
		expect(d.entries[0]?.completionId).toBe("c1");
		expect(d.current?.key).toBe("2026-09-23");
		expect(d.missedWhileOpen).toBe(0);
	});

	it("moves to the next occurrence after an on-time completion", () => {
		const d = deriveTask(
			daily08,
			[done("c1", "2026-09-21", "2026-09-21", "07:30")],
			at("2026-09-21", "09:00"),
		);
		expect(lines(d)).toEqual(["2026-09-21 on_time", "2026-09-22 upcoming"]);
		expect(d.entries[0]?.lateByMs).toBeUndefined();
	});

	it("reverts an undone completion", () => {
		const events: TaskEvent[] = [
			done("c1", "2026-09-21", "2026-09-23", "10:00"),
			{
				id: "u1",
				type: "uncompleted",
				refEventId: "c1",
				at: at("2026-09-23", "10:01"),
			},
		];
		const d = deriveTask(daily08, events, at("2026-09-23", "10:05"));
		expect(lines(d)).toEqual([
			"2026-09-21 overdue",
			"2026-09-22 missed <2026-09-21",
			"2026-09-23 missed <2026-09-21",
		]);
	});

	it("ignores a duplicate completion of the same occurrence from another device", () => {
		const events = [
			done("c2", "2026-09-21", "2026-09-21", "07:45"),
			done("c1", "2026-09-21", "2026-09-21", "07:30"),
		];
		const d = deriveTask(daily08, events, at("2026-09-21", "09:00"));
		expect(lines(d)).toEqual(["2026-09-21 on_time", "2026-09-22 upcoming"]);
		expect(d.entries[0]?.completionId).toBe("c1");
	});

	it("allows completing the upcoming occurrence early", () => {
		const events = [
			done("c1", "2026-09-21", "2026-09-21", "07:30"),
			done("c2", "2026-09-22", "2026-09-21", "20:00"),
		];
		const d = deriveTask(daily08, events, at("2026-09-21", "21:00"));
		expect(lines(d)).toEqual([
			"2026-09-21 on_time",
			"2026-09-22 on_time",
			"2026-09-23 upcoming",
		]);
	});

	it("treats an untimed occurrence as due by the end of its period", () => {
		const untimed = {
			...daily08,
			rules: [{ ...daily08.rules[0], dueTime: null } as RuleVersion],
		};
		const d = deriveTask(
			untimed,
			[done("c1", "2026-09-21", "2026-09-21", "23:00")],
			at("2026-09-21", "23:30"),
		);
		expect(lines(d)).toEqual(["2026-09-21 on_time", "2026-09-22 upcoming"]);
	});

	it("handles one-off tasks", () => {
		const once: TaskSchedule = {
			...daily08,
			rules: [{ effectiveFrom: "2026-09-21", rule: null, dueTime: null }],
		};
		expect(lines(deriveTask(once, [], at("2026-09-22", "09:00")))).toEqual([
			"2026-09-21 overdue",
		]);
		const d = deriveTask(
			once,
			[done("c1", "2026-09-21", "2026-09-22", "09:00")],
			at("2026-09-22", "10:00"),
		);
		expect(lines(d)).toEqual(["2026-09-21 late"]);
		expect(d.current).toBeNull();
	});

	it("applies a schedule change from its effective date only", () => {
		const changed: TaskSchedule = {
			...daily08,
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: "08:00",
				},
				{
					effectiveFrom: "2026-09-24",
					rule: { freq: "week", interval: 1, weekdays: [5] },
					dueTime: "08:00",
				},
			],
		};
		const onTime = [
			done("c1", "2026-09-21", "2026-09-21", "07:00"),
			done("c2", "2026-09-22", "2026-09-22", "07:00"),
			done("c3", "2026-09-23", "2026-09-23", "07:00"),
		];
		expect(
			lines(deriveTask(changed, onTime, at("2026-09-24", "12:00"))).at(-1),
		).toBe("2026-09-25 upcoming");

		// An occurrence still open from the old rule stays open under the new one.
		expect(lines(deriveTask(changed, [], at("2026-09-25", "09:00")))).toEqual([
			"2026-09-21 overdue",
			"2026-09-22 missed <2026-09-21",
			"2026-09-23 missed <2026-09-21",
			"2026-09-25 missed <2026-09-21",
		]);
	});

	it("stops entries at archivedAt even when now is later", () => {
		const archived = { ...daily08, archivedAt: at("2026-09-22", "12:00") };
		const d = deriveTask(archived, [], at("2026-09-25", "09:00"));
		expect(lines(d)).toEqual([
			"2026-09-21 overdue",
			"2026-09-22 missed <2026-09-21",
		]);
		expect(d.current?.key).toBe("2026-09-21");
		expect(d.missedWhileOpen).toBe(1);
	});

	it("ignores nudges", () => {
		const d = deriveTask(
			daily08,
			[{ id: "n1", type: "nudged", at: at("2026-09-21", "09:00") }],
			at("2026-09-21", "10:00"),
		);
		expect(lines(d)).toEqual(["2026-09-21 overdue"]);
	});
});
