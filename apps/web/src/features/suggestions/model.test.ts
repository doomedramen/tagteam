import type { SuggestionDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import {
	acceptStartDate,
	incomingSuggestions,
	outgoingSuggestions,
	pendingSuggestionCount,
	suggestionSummary,
} from "./model";

const suggestion = (patch: Partial<SuggestionDto> = {}): SuggestionDto => ({
	id: crypto.randomUUID(),
	groupId: "g1",
	fromUserId: "u1",
	toUserId: "u2",
	title: "Wash dishes",
	notes: null,
	startDate: "2026-10-01",
	dueTime: null,
	rule: null,
	status: "pending",
	taskId: null,
	createdAt: 0,
	resolvedAt: null,
	...patch,
});

describe("pendingSuggestionCount", () => {
	it("counts only pending suggestions from one sender to one recipient in one group", () => {
		const all = [
			suggestion(),
			suggestion(),
			suggestion({ status: "declined" }),
			suggestion({ status: "accepted" }),
			suggestion({ status: "withdrawn" }),
			suggestion({ toUserId: "u3" }),
			suggestion({ fromUserId: "u2", toUserId: "u1" }),
			suggestion({ groupId: "g2" }),
		];
		expect(pendingSuggestionCount(all, "g1", "u1", "u2")).toBe(2);
		expect(pendingSuggestionCount([], "g1", "u1", "u2")).toBe(0);
	});
});

describe("incomingSuggestions and outgoingSuggestions", () => {
	const all = [
		suggestion({
			id: "newer",
			toUserId: "u1",
			fromUserId: "u2",
			createdAt: 20,
		}),
		suggestion({
			id: "older",
			toUserId: "u1",
			fromUserId: "u2",
			createdAt: 10,
		}),
		suggestion({
			id: "answered",
			toUserId: "u1",
			fromUserId: "u2",
			status: "declined",
		}),
		suggestion({
			id: "other-group",
			toUserId: "u1",
			fromUserId: "u2",
			groupId: "g2",
		}),
		suggestion({ id: "not-mine", toUserId: "u3", fromUserId: "u2" }),
		suggestion({
			id: "waiting",
			fromUserId: "u1",
			toUserId: "u2",
			createdAt: 5,
		}),
		suggestion({
			id: "declined",
			fromUserId: "u1",
			toUserId: "u2",
			status: "declined",
			createdAt: 6,
		}),
		suggestion({
			id: "accepted",
			fromUserId: "u1",
			toUserId: "u2",
			status: "accepted",
		}),
		suggestion({
			id: "withdrawn",
			fromUserId: "u1",
			toUserId: "u2",
			status: "withdrawn",
		}),
	];

	it("lists pending suggestions addressed to me, oldest first", () => {
		expect(incomingSuggestions(all, "g1", "u1").map((s) => s.id)).toEqual([
			"older",
			"newer",
		]);
	});

	it("lists my suggestions that are waiting or declined, oldest first", () => {
		expect(outgoingSuggestions(all, "g1", "u1").map((s) => s.id)).toEqual([
			"waiting",
			"declined",
		]);
	});
});

describe("acceptStartDate", () => {
	it("is the later of the suggested start and today", () => {
		expect(acceptStartDate("2026-09-30", "2026-10-02")).toBe("2026-10-02");
		expect(acceptStartDate("2026-10-02", "2026-10-02")).toBe("2026-10-02");
		expect(acceptStartDate("2026-10-05", "2026-10-02")).toBe("2026-10-05");
	});
});

describe("suggestionSummary", () => {
	const today = "2026-10-01";
	const summary = (patch: Partial<SuggestionDto>) =>
		suggestionSummary(
			{ rule: null, dueTime: null, startDate: today, ...patch },
			today,
			"en-GB",
		);

	it("describes one-off tasks", () => {
		expect(summary({})).toBe("Once · today");
		expect(summary({ startDate: "2026-10-03" })).toBe("Once · on 3 Oct");
		expect(summary({ dueTime: "19:00" })).toBe("Once · by 19:00 · today");
	});

	it("describes repeating tasks and only mentions a future start", () => {
		expect(
			summary({ rule: { freq: "day", interval: 1 }, dueTime: "19:00" }),
		).toBe("Daily · by 19:00");
		expect(summary({ rule: { freq: "day", interval: 3 } })).toBe(
			"Every 3 days",
		);
		expect(
			summary({
				rule: { freq: "week", interval: 1, weekdays: [3, 1] },
				startDate: "2026-10-05",
			}),
		).toBe("Weekly · Mon, Wed · starts 5 Oct");
		expect(
			summary({ rule: { freq: "week", interval: 2, weekdays: [5] } }),
		).toBe("Every 2 weeks · Fri");
		expect(
			summary({ rule: { freq: "month", interval: 1, monthDay: "last" } }),
		).toBe("Monthly · last day");
		expect(
			summary({ rule: { freq: "month", interval: 2, monthDay: 15 } }),
		).toBe("Every 2 months · day 15");
	});

	it("ignores a start date in the past", () => {
		expect(
			summary({ rule: { freq: "day", interval: 1 }, startDate: "2026-09-01" }),
		).toBe("Daily");
	});
});
