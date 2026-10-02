import type { MemberDto, TaskDto } from "@tagteam/core";
import { describe, expect, it } from "vitest";
import { buildActivityFeed } from "./model";

const now = Date.UTC(2026, 9, 1, 12);
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
	id: "t1",
	groupId: "g1",
	ownerId: "u1",
	title: "Wash dishes",
	notes: null,
	timezone: "UTC",
	startDate: "2026-10-01",
	rules: [{ effectiveFrom: "2026-10-01", rule: null, dueTime: null }],
	archivedAt: null,
	createdAt: now - 1000,
	suggestedBy: null,
	emoji: null,
	color: null,
	...patch,
});
const member = (userId: string, displayName: string): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
});
const members = [member("u1", "Sam"), member("u2", "Jo")];

describe("buildActivityFeed created entries", () => {
	it("records who suggested a task that began as a suggestion", () => {
		const feed = buildActivityFeed({
			tasks: [task({ suggestedBy: "u2" })],
			events: [],
			members,
			groupId: "g1",
			now,
		});
		expect(feed).toHaveLength(1);
		expect(feed[0]).toMatchObject({
			kind: "created",
			actorId: "u1",
			actorName: "Sam",
			suggestedById: "u2",
		});
	});

	it("keeps the suggester even if they have left the group", () => {
		const feed = buildActivityFeed({
			tasks: [task({ suggestedBy: "u9" })],
			events: [],
			members,
			groupId: "g1",
			now,
		});
		expect(feed[0]?.suggestedById).toBe("u9");
	});

	it("leaves ordinary tasks without a suggester", () => {
		const feed = buildActivityFeed({
			tasks: [task()],
			events: [],
			members,
			groupId: "g1",
			now,
		});
		expect(feed[0]).not.toHaveProperty("suggestedById");
	});
});
