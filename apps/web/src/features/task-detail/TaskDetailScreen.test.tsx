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

describe("TaskDetailScreen look", () => {
	it("wears the task's color and shows its emoji above the title", async () => {
		await store.tasks.put(task({ emoji: "\u{1FAB4}", color: "teal" }));
		renderDetail();
		await screen.findByRole("heading", { name: "Wash dishes" });
		const root = document.querySelector('[data-slot="task-detail"]');
		expect(root).toHaveAttribute("data-task-color", "teal");
		expect(root).toHaveClass("bg-task-sheet");
		const circle = root?.querySelector('[data-slot="task-emoji"]');
		expect(circle).toHaveTextContent("\u{1FAB4}");
		expect(circle).toHaveAttribute("aria-hidden", "true");
		expect(
			circle?.compareDocumentPosition(
				screen.getByRole("heading", { name: "Wash dishes" }),
			),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("shows the default emoji on neutral surfaces for a task with no emoji or color", async () => {
		await store.tasks.put(task());
		renderDetail();
		await screen.findByRole("heading", { name: "Wash dishes" });
		const root = document.querySelector('[data-slot="task-detail"]');
		expect(root).not.toHaveAttribute("data-task-color");
		expect(root?.querySelector('[data-slot="task-emoji"]')).toHaveTextContent(
			"\u{1F4CB}",
		);
	});

	it("keeps the history icon circles readable by remapping surface-2 to the sheet, only for a colored task", async () => {
		await store.tasks.put(task({ color: "teal" }));
		renderDetail();
		await screen.findByRole("heading", { name: "Wash dishes" });
		const root = document.querySelector('[data-slot="task-detail"]');
		expect(root).toHaveClass(
			"data-[task-color]:[--surface-2:var(--task-sheet)]",
		);
		expect(root).not.toHaveClass("[--surface-2:var(--task-swatch)]");
	});
});
