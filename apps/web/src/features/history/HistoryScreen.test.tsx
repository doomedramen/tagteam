import type { MemberDto, TaskDto } from "@tagteam/core";
import { screen, within } from "@testing-library/react";
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
	emoji: null,
	color: null,
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

describe("HistoryScreen full-width rows", () => {
	it("keeps the horizontal padding on each row, not on the card content", async () => {
		await store.tasks.put(task("t1", "Brush teeth"));
		renderWithSession(<HistoryScreen />, { store });
		const row = (await screen.findByText("You added Brush teeth.")).closest(
			"li",
		);
		const content = row?.closest('[data-slot="card-content"]');
		expect(content).toHaveClass("px-0");
		expect(content).not.toHaveClass("px-4");
		expect(row).toHaveClass("px-4");
	});
});

describe("HistoryScreen member filter", () => {
	it("keeps the selected text clear of the arrow", async () => {
		renderWithSession(<HistoryScreen />, { store });
		const select = await screen.findByLabelText("Member");
		expect(select).toHaveClass("pr-7");
		expect(select).not.toHaveClass("px-0");
	});

	it("labels the default option Everyone so it fits the field", async () => {
		renderWithSession(<HistoryScreen />, { store });
		const select = await screen.findByLabelText("Member");
		expect(
			within(select).getByRole("option", { name: "Everyone" }),
		).toHaveValue("all");
		expect(
			within(select).queryByRole("option", { name: "All members" }),
		).toBeNull();
	});
});

describe("HistoryScreen page header", () => {
	it("paints the title block and member filter in the app-colour band", async () => {
		renderWithSession(<HistoryScreen />, { store });
		const heading = await screen.findByRole("heading", { name: "History" });
		const header = heading.closest('[data-slot="page-header"]');
		expect(header).toHaveClass("bg-header", "rounded-none");
		expect(
			screen.getByLabelText("Member").closest('[data-slot="page-header"]'),
		).toBe(header);
	});
});
