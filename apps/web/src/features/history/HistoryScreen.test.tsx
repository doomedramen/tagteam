import type { MemberDto, TaskDto } from "@tagteam/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TagTeamDb } from "../../store/db";
import { renderWithSession } from "../../test/fakes";
import { HistoryScreen } from "./HistoryScreen";

const member = (userId: string, displayName: string): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
});
const startDate = new Date().toISOString().slice(0, 10);
const task = (
	id: string,
	title: string,
	patch: Partial<TaskDto> = {},
): TaskDto => ({
	id,
	groupId: "g1",
	ownerId: "u1",
	title,
	notes: null,
	timezone: "UTC",
	startDate,
	rules: [{ effectiveFrom: startDate, rule: null, dueTime: null }],
	archivedAt: null,
	createdAt: Date.now() - 60_000,
	suggestedBy: null,
	...patch,
});

let store: TagTeamDb;
beforeEach(async () => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut([member("u1", "Sam"), member("u2", "Jo")]);
});

describe("HistoryScreen created entries", () => {
	it("says took on and who suggested it for a suggested task", async () => {
		await store.tasks.bulkPut([
			task("t1", "Wash dishes", { suggestedBy: "u2" }),
			task("t2", "Brush teeth"),
		]);
		renderWithSession(<HistoryScreen />, { store });
		expect(
			await screen.findByText("You took on Wash dishes."),
		).toBeInTheDocument();
		expect(screen.getByText("Suggested by Jo")).toBeInTheDocument();
		expect(screen.getByText("You added Brush teeth.")).toBeInTheDocument();
		expect(screen.getAllByText(/Suggested by/)).toHaveLength(1);
	});

	it("says you when the viewer made the suggestion", async () => {
		await store.tasks.put(
			task("t1", "Wash dishes", { ownerId: "u2", suggestedBy: "u1" }),
		);
		renderWithSession(<HistoryScreen />, { store });
		expect(
			await screen.findByText("Jo took on Wash dishes."),
		).toBeInTheDocument();
		expect(screen.getByText("Suggested by you")).toBeInTheDocument();
	});

	it("names a member who has left generically", async () => {
		await store.tasks.put(task("t1", "Wash dishes", { suggestedBy: "u9" }));
		renderWithSession(<HistoryScreen />, { store });
		expect(
			await screen.findByText("Suggested by a former member"),
		).toBeInTheDocument();
	});
});
