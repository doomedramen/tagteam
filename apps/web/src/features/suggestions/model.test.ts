import type { SuggestionDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import { pendingSuggestionCount } from "./model";

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
