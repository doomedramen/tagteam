import type { MemberDto, SuggestionDto, TaskDto } from "@tagteam/core";
import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEngine, renderWithSession } from "../../test/fakes";
import { AddTaskSheet } from "./AddTaskSheet";

describe("AddTaskSheet", () => {
	it("adds a one-off task on Enter", async () => {
		const engine = fakeEngine();
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, { engine });
		const title = screen.getByLabelText("Task");
		expect(title).toHaveFocus();
		await userEvent.type(title, "Call grandma{Enter}");
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "task.create",
				title: "Call grandma",
				rule: null,
				groupId: "g1",
			}),
		);
		expect(onClose).toHaveBeenCalled();
	});

	it("builds a custom weekly schedule with a due time", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Clean room");
		await userEvent.click(screen.getByRole("button", { name: /Schedule/ }));
		await userEvent.click(screen.getByRole("button", { name: "Custom" }));
		const every = screen.getByLabelText("Every");
		await userEvent.clear(every);
		await userEvent.type(every, "2");
		await userEvent.selectOptions(screen.getByLabelText("Unit"), "week");
		await userEvent.click(screen.getByRole("button", { name: "Monday" }));
		if (!screen.queryByRole("button", { name: "Add time" })) {
			await userEvent.click(screen.getByRole("button", { name: /Schedule/ }));
		}
		await userEvent.click(screen.getByRole("button", { name: "Add time" }));
		const time = screen.getByLabelText("Due by");
		await userEvent.clear(time);
		await userEvent.type(time, "18:30");
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		const m = engine.enqueue.mock.calls[0]?.[0];
		expect(m).toMatchObject({
			rule: { freq: "week", interval: 2 },
			dueTime: "18:30",
		});
		expect(m.rule.weekdays).toContain(1);
	});

	it("explains a missing name instead of adding", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		expect(screen.getByText("Give it a name")).toBeInTheDocument();
		expect(engine.enqueue).not.toHaveBeenCalled();
	});

	it("explains a cleared due time instead of adding", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Clean room");
		if (!screen.queryByRole("button", { name: "Add time" })) {
			await userEvent.click(screen.getByRole("button", { name: /Schedule/ }));
		}
		await userEvent.click(screen.getByRole("button", { name: "Add time" }));
		const time = screen.getByLabelText("Due by");
		await userEvent.clear(time);
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		expect(screen.getByText("Enter a time like 08:00")).toBeInTheDocument();
		expect(engine.enqueue).not.toHaveBeenCalled();
	});

	it("guards against a double submit", async () => {
		const engine = fakeEngine();
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Clean room");
		const form = screen.getByLabelText("Task").closest("form");
		if (!form) throw new Error("form not found");
		fireEvent.submit(form);
		fireEvent.submit(form);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
	});
	it("keeps an unfinished draft after dismissal and puts Add outside the scrolling body", async () => {
		function Harness() {
			const [open, setOpen] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Open
					</button>
					<AddTaskSheet open={open} onClose={() => setOpen(false)} />
				</>
			);
		}
		renderWithSession(<Harness />);
		await userEvent.type(screen.getByLabelText("Task"), "Water plants");
		expect(
			screen.queryByRole("button", { name: "Daily" }),
		).not.toBeInTheDocument();
		const add = screen.getByRole("button", { name: "Add task" });
		expect(add.closest('[data-slot="sheet-body"]')).toBeNull();
		expect(add).toHaveAttribute(
			"form",
			screen.getByLabelText("Task").closest("form")?.id,
		);
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(screen.getByLabelText("Task")).toHaveValue("Water plants");
	});

	it("keeps the draft when saving fails and allows retry", async () => {
		const engine = fakeEngine();
		engine.enqueue.mockRejectedValueOnce(new Error("disk full"));
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Water plants{Enter}");
		expect(
			await screen.findByText("Could not add task. Try again."),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Task")).toHaveValue("Water plants");
		expect(onClose).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		expect(onClose).toHaveBeenCalledOnce();
	});
});

const member = (
	userId: string,
	displayName: string,
	patch: Partial<MemberDto> = {},
): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
	...patch,
});
const pendingToJo = (count: number): SuggestionDto[] =>
	Array.from({ length: count }, (_, i) => ({
		id: `s${i}`,
		groupId: "g1",
		fromUserId: "u1",
		toUserId: "u2",
		title: `Task ${i}`,
		notes: null,
		startDate: "2026-10-01",
		dueTime: null,
		rule: null,
		status: "pending",
		taskId: null,
		createdAt: 0,
		resolvedAt: null,
	}));
async function storeWith(
	members: MemberDto[],
	suggestions: SuggestionDto[] = [],
) {
	const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut(members);
	await store.suggestions.bulkPut(suggestions);
	return store;
}
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

describe("AddTaskSheet suggestions", () => {
	it("offers Me first and then the other active members, by name", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u3", "Kim"),
			member("u2", "Jo"),
			member("u4", "Lee", { leftAt: 9 }),
		]);
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { store });
		const group = await screen.findByLabelText("For");
		const chips = within(group)
			.getAllByRole("button")
			.map((button) => [
				button.textContent,
				button.getAttribute("aria-pressed"),
			]);
		expect(chips).toEqual([
			["Me", "true"],
			["Jo", "false"],
			["Kim", "false"],
		]);
	});

	it("hides the control when nobody else is in the group", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u2", "Jo", { leftAt: 5 }),
		]);
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { store });
		await settle();
		expect(screen.queryByLabelText("For")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Add task" }),
		).toBeInTheDocument();
	});

	it("hides the control when editing an existing task", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const task: TaskDto = {
			id: "t1",
			groupId: "g1",
			ownerId: "u1",
			title: "Brush teeth",
			notes: null,
			timezone: "UTC",
			startDate: "2026-09-21",
			rules: [
				{
					effectiveFrom: "2026-09-21",
					rule: { freq: "day", interval: 1 },
					dueTime: null,
				},
			],
			archivedAt: null,
			createdAt: 0,
			suggestedBy: null,
		};
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} task={task} />, {
			store,
		});
		await settle();
		expect(screen.queryByLabelText("For")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Save changes" }),
		).toBeInTheDocument();
	});

	it("suggests to the chosen member instead of adding a task", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const engine = fakeEngine();
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Wash dishes");
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		);
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "suggestion.create",
				groupId: "g1",
				toUserId: "u2",
				title: "Wash dishes",
				notes: null,
				rule: null,
			}),
		);
		expect(onClose).toHaveBeenCalled();
	});

	it("goes back to adding a task for me when Me is chosen again", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Call grandma");
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await userEvent.click(screen.getByRole("button", { name: "Me" }));
		await userEvent.click(screen.getByRole("button", { name: "Add task" }));
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.create", title: "Call grandma" }),
		);
	});

	it("keeps the chosen member when the sheet is dismissed and reopened", async () => {
		function Harness() {
			const [open, setOpen] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Open
					</button>
					<AddTaskSheet open={open} onClose={() => setOpen(false)} />
				</>
			);
		}
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		renderWithSession(<Harness />, { store });
		await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		).toBeInTheDocument();
	});

	it.each([
		{ pending: 9, allowed: true },
		{ pending: 10, allowed: false },
	])(
		"with $pending pending suggestions to the member, allowed: $allowed",
		async ({ pending, allowed }) => {
			const store = await storeWith(
				[member("u1", "Sam"), member("u2", "Jo")],
				pendingToJo(pending),
			);
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, {
				store,
				engine,
			});
			await userEvent.type(screen.getByLabelText("Task"), "Wash dishes");
			await userEvent.click(await screen.findByRole("button", { name: "Jo" }));
			await settle();
			await userEvent.click(
				screen.getByRole("button", { name: "Suggest to Jo" }),
			);
			if (allowed) {
				expect(engine.enqueue).toHaveBeenCalledTimes(1);
			} else {
				expect(await screen.findByRole("alert")).toHaveTextContent(
					"You already have 10 suggestions waiting for Jo. Wait for an answer or withdraw one.",
				);
				expect(engine.enqueue).not.toHaveBeenCalled();
			}
		},
	);
});
