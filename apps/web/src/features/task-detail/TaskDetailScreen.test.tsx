import type { MemberDto, TaskDto } from "@tagteam/core";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { TagTeamDb } from "../../store/db";
import { renderWithSession } from "../../test/fakes";
import { TaskDetailScreen } from "./TaskDetailScreen";

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
const task = (patch: Partial<TaskDto> = {}): TaskDto => ({
	id: "t1",
	groupId: "g1",
	ownerId: "u1",
	title: "Wash dishes",
	notes: null,
	timezone: "UTC",
	startDate,
	rules: [
		{
			effectiveFrom: startDate,
			rule: { freq: "day", interval: 1 },
			dueTime: null,
		},
	],
	archivedAt: null,
	createdAt: Date.now() - 60_000,
	suggestedBy: null,
	emoji: null,
	color: null,
	...patch,
});

let store: TagTeamDb;
beforeEach(async () => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut([member("u1", "Sam"), member("u2", "Jo")]);
});

const renderDetail = () =>
	renderWithSession(
		<Routes>
			<Route path="/tasks/:taskId" element={<TaskDetailScreen />} />
		</Routes>,
		{ store },
		"/tasks/t1",
	);

describe("TaskDetailScreen suggested by", () => {
	it("shows who suggested the task", async () => {
		await store.tasks.put(task({ suggestedBy: "u2" }));
		renderDetail();
		expect(await screen.findByText("Suggested by Jo")).toBeInTheDocument();
	});

	it("says you when the viewer suggested it", async () => {
		await store.tasks.put(task({ ownerId: "u2", suggestedBy: "u1" }));
		renderDetail();
		expect(await screen.findByText("Suggested by you")).toBeInTheDocument();
	});

	it("shows nothing for an ordinary task", async () => {
		await store.tasks.put(task());
		renderDetail();
		await screen.findByRole("heading", { name: "Wash dishes" });
		expect(screen.queryByText(/Suggested by/)).not.toBeInTheDocument();
	});
});
