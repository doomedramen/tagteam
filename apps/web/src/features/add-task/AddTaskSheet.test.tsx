import {
	DEFAULT_EMOJI,
	type MemberDto,
	type SuggestionDto,
} from "@tagteam/core";
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
import {
	fakeEngine,
	fakeSuggestion,
	fakeTask,
	renderWithSession,
} from "../../test/fakes";
import { AddTaskSheet } from "./AddTaskSheet";

const PLANT = "\u{1FAB4}"; // potted plant

const row = (name: RegExp | string) => screen.getByRole("button", { name });
const create = () => screen.getByRole("button", { name: "Create" });
const dialog = () => screen.getByRole("dialog", { name: /New task|Edit task/ });

/** Picks an emoji the way a person with the system emoji keyboard would. */
async function typeEmoji(emoji: string) {
	await userEvent.click(screen.getByRole("button", { name: /^Emoji:/ }));
	await userEvent.type(
		await screen.findByLabelText("Type or paste an emoji"),
		emoji,
	);
}

/** Renders the sheet with an "Open" button so a test can dismiss and reopen it. */
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

describe("AddTaskSheet", () => {
	it("creates a one-off task on Enter, blue and with no stored emoji", async () => {
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
				color: "blue",
			}),
		);
		expect(engine.enqueue.mock.calls[0]?.[0]).not.toHaveProperty("emoji");
		expect(onClose).toHaveBeenCalled();
	});

	it("builds a custom weekly schedule with a due time", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Clean room");
		await userEvent.click(row(/^Repeat/));
		await userEvent.click(screen.getByRole("button", { name: "Custom" }));
		const every = screen.getByLabelText("Every");
		await userEvent.clear(every);
		await userEvent.type(every, "2");
		await userEvent.selectOptions(screen.getByLabelText("Unit"), "week");
		await userEvent.click(screen.getByRole("button", { name: "Monday" }));
		await userEvent.click(row(/^Due by/));
		await userEvent.click(screen.getByRole("button", { name: "Add time" }));
		const time = screen.getByLabelText("Due by");
		await userEvent.clear(time);
		await userEvent.type(time, "18:30");
		await userEvent.click(create());
		const m = engine.enqueue.mock.calls[0]?.[0];
		expect(m).toMatchObject({
			rule: { freq: "week", interval: 2 },
			dueTime: "18:30",
		});
		expect(m.rule.weekdays).toContain(1);
	});

	it("explains a missing name instead of creating", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.click(create());
		expect(screen.getByText("Give it a name")).toBeInTheDocument();
		expect(engine.enqueue).not.toHaveBeenCalled();
	});

	it("explains a cleared due time instead of creating", async () => {
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Clean room");
		await userEvent.click(row(/^Due by/));
		await userEvent.click(screen.getByRole("button", { name: "Add time" }));
		await userEvent.clear(screen.getByLabelText("Due by"));
		await userEvent.click(create());
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

	it("keeps the title focused when the header action is pressed", async () => {
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />);
		const title = screen.getByLabelText("Task");
		expect(title).toHaveFocus();
		await userEvent.pointer({ keys: "[MouseLeft>]", target: create() });
		expect(title).toHaveFocus();
	});

	it("keeps an unfinished draft after dismissal and keeps the action outside the scrolling body", async () => {
		renderWithSession(<Harness />);
		await userEvent.type(screen.getByLabelText("Task"), "Water plants");
		expect(
			screen.queryByRole("button", { name: "Daily" }),
		).not.toBeInTheDocument();
		const action = create();
		expect(action.closest('[data-slot="sheet-body"]')).toBeNull();
		expect(dialog().querySelector('[data-slot="sheet-footer"]')).toBeNull();
		expect(action).toHaveAttribute(
			"form",
			screen.getByLabelText("Task").closest("form")?.id,
		);
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(screen.getByLabelText("Task")).toHaveValue("Water plants");
	});

	it("keeps the draft when saving fails, says so under the header, and allows retry", async () => {
		const engine = fakeEngine();
		engine.enqueue.mockRejectedValueOnce(new Error("disk full"));
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, { engine });
		await userEvent.type(screen.getByLabelText("Task"), "Water plants{Enter}");
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Could not add task. Try again.");
		expect(alert.closest('[data-slot="sheet-notice"]')).not.toBeNull();
		expect(screen.getByLabelText("Task")).toHaveValue("Water plants");
		expect(onClose).not.toHaveBeenCalled();
		await userEvent.click(create());
		expect(onClose).toHaveBeenCalledOnce();
	});

	describe("rows", () => {
		it("shows each setting's value and opens one row at a time", async () => {
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />);
			expect(row(/^Repeat/)).toHaveTextContent("Once");
			expect(row(/^Starts/)).toHaveTextContent("Today");
			expect(row(/^Due by/)).toHaveTextContent("No time");
			expect(row(/^Repeat/)).toHaveAttribute("aria-expanded", "false");

			await userEvent.click(row(/^Repeat/));
			expect(row(/^Repeat/)).toHaveAttribute("aria-expanded", "true");
			expect(screen.getByRole("button", { name: "Daily" })).toBeInTheDocument();

			await userEvent.click(row(/^Starts/));
			expect(row(/^Repeat/)).toHaveAttribute("aria-expanded", "false");
			expect(
				screen.queryByRole("button", { name: "Daily" }),
			).not.toBeInTheDocument();
			expect(screen.getByLabelText("Start date")).toBeInTheDocument();

			await userEvent.click(row(/^Starts/));
			expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
		});

		it("reflects the chosen repeat and due time in the row values", async () => {
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />);
			await userEvent.click(row(/^Repeat/));
			await userEvent.click(screen.getByRole("button", { name: "Daily" }));
			expect(row(/^Repeat/)).toHaveTextContent("Daily");
			await userEvent.click(row(/^Due by/));
			await userEvent.click(screen.getByRole("button", { name: "Add time" }));
			expect(row(/^Due by/)).toHaveTextContent("08:00");
		});
	});

	describe("look", () => {
		it("starts blue with the default emoji, named as the default", () => {
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />);
			expect(dialog()).toHaveAttribute("data-task-color", "blue");
			expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
			expect(
				screen.getByRole("button", {
					name: "Emoji: clipboard, default, change",
				}),
			).toHaveTextContent(DEFAULT_EMOJI);
		});

		it("re-tints the sheet when a color is tapped, and creates the task in that color", async () => {
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
			await userEvent.type(screen.getByLabelText("Task"), "Water plants");
			await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
			expect(dialog()).toHaveAttribute("data-task-color", "teal");
			await userEvent.click(create());
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({ type: "task.create", color: "teal" }),
			);
		});

		it("opens the picker from the emoji circle and keeps a hand-picked emoji", async () => {
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
			await userEvent.type(screen.getByLabelText("Task"), "Water plants");
			await typeEmoji(PLANT);
			await waitFor(() =>
				expect(
					screen.queryByRole("dialog", { name: "Choose emoji" }),
				).not.toBeInTheDocument(),
			);
			expect(
				await screen.findByRole("button", {
					name: "Emoji: potted plant, change",
				}),
			).toHaveTextContent(PLANT);
			await userEvent.click(create());
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "task.create",
					emoji: PLANT,
					color: "blue",
				}),
			);
		});

		it("Use default stores the clipboard as a deliberate choice", async () => {
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { engine });
			await userEvent.type(screen.getByLabelText("Task"), "Bins");
			await userEvent.click(screen.getByRole("button", { name: /^Emoji:/ }));
			await userEvent.click(
				await screen.findByRole("button", { name: "Use default" }),
			);
			await userEvent.click(create());
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({ type: "task.create", emoji: DEFAULT_EMOJI }),
			);
		});

		it("keeps the emoji and color when the sheet is dismissed and reopened", async () => {
			renderWithSession(<Harness />);
			await userEvent.click(screen.getByRole("radio", { name: "Pink" }));
			await typeEmoji(PLANT);
			await userEvent.click(screen.getByRole("button", { name: "Close" }));
			await userEvent.click(screen.getByRole("button", { name: "Open" }));
			expect(dialog()).toHaveAttribute("data-task-color", "pink");
			expect(
				await screen.findByRole("button", {
					name: "Emoji: potted plant, change",
				}),
			).toBeInTheDocument();
		});

		it("resets to blue and the default emoji after a task is created", async () => {
			renderWithSession(<Harness />);
			await userEvent.type(screen.getByLabelText("Task"), "Water plants");
			await userEvent.click(screen.getByRole("radio", { name: "Pink" }));
			await userEvent.click(create());
			await userEvent.click(screen.getByRole("button", { name: "Open" }));
			expect(dialog()).toHaveAttribute("data-task-color", "blue");
			expect(
				screen.getByRole("button", {
					name: "Emoji: clipboard, default, change",
				}),
			).toBeInTheDocument();
		});
	});

	describe("editing", () => {
		const task = fakeTask({ title: "Water plants" });

		it("opens with Repeat expanded and no color selected when the task has none", async () => {
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} task={task} />);
			expect(
				await screen.findByRole("button", { name: "Daily" }),
			).toBeInTheDocument();
			expect(row(/^Repeat/)).toHaveAttribute("aria-expanded", "true");
			expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
			expect(dialog()).not.toHaveAttribute("data-task-color");
			expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: /^For/ }),
			).not.toBeInTheDocument();
			expect(screen.getByLabelText("Task")).toHaveValue("Water plants");
			expect(row(/^Changes from/)).toBeInTheDocument();
		});

		it("saves one update with only the title when only the title changed", async () => {
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} task={task} />, {
				engine,
			});
			const title = await screen.findByLabelText("Task");
			await userEvent.clear(title);
			await userEvent.type(title, "Water the plants");
			await userEvent.click(screen.getByRole("button", { name: "Save" }));
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
			const m = engine.enqueue.mock.calls[0]?.[0];
			expect(m).toMatchObject({
				type: "task.update",
				taskId: "t1",
				title: "Water the plants",
			});
			expect(m).not.toHaveProperty("emoji");
			expect(m).not.toHaveProperty("color");
		});

		it("sends the color and emoji only once the person picks them", async () => {
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} task={task} />, {
				engine,
			});
			await screen.findByRole("button", { name: "Daily" });
			await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
			await typeEmoji(PLANT);
			await userEvent.click(screen.getByRole("button", { name: "Save" }));
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
			const m = engine.enqueue.mock.calls[0]?.[0];
			expect(m).toMatchObject({
				type: "task.update",
				emoji: PLANT,
				color: "teal",
			});
			expect(m).not.toHaveProperty("title");
		});

		it("says nothing changed instead of sending an empty update", async () => {
			const engine = fakeEngine();
			renderWithSession(<AddTaskSheet open onClose={vi.fn()} task={task} />, {
				engine,
			});
			await screen.findByRole("button", { name: "Daily" });
			await userEvent.click(screen.getByRole("button", { name: "Save" }));
			expect(await screen.findByText("No changes to save")).toBeInTheDocument();
			expect(engine.enqueue).not.toHaveBeenCalled();
		});

		it("starts from the task's own emoji and color", async () => {
			renderWithSession(
				<AddTaskSheet
					open
					onClose={vi.fn()}
					task={{ ...task, emoji: PLANT, color: "green" }}
				/>,
			);
			await screen.findByRole("button", { name: "Daily" });
			expect(dialog()).toHaveAttribute("data-task-color", "green");
			expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();
			expect(
				await screen.findByRole("button", {
					name: "Emoji: potted plant, change",
				}),
			).toBeInTheDocument();
		});
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
	Array.from({ length: count }, (_, i) =>
		fakeSuggestion({
			id: `s${i}`,
			fromUserId: "u1",
			toUserId: "u2",
			title: `Task ${i}`,
		}),
	);
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
/** Opens the "For" row and chooses a recipient in its select. */
async function chooseFor(name: string) {
	await userEvent.click(await screen.findByRole("button", { name: /^For/ }));
	await userEvent.selectOptions(screen.getByLabelText("For"), name);
}

describe("AddTaskSheet suggestions", () => {
	it("offers Me first and then the other active members, by name", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u3", "Kim"),
			member("u2", "Jo"),
			member("u4", "Lee", { leftAt: 9 }),
		]);
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { store });
		expect(
			await screen.findByRole("button", { name: /^For/ }),
		).toHaveTextContent("Me");
		await userEvent.click(row(/^For/));
		const select = screen.getByRole("combobox", { name: "For" });
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Me", "Jo", "Kim"]);
		expect(select).toHaveDisplayValue("Me");
	});

	it("hides the row when nobody else is in the group", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u2", "Jo", { leftAt: 5 }),
		]);
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, { store });
		await settle();
		expect(
			screen.queryByRole("button", { name: /^For/ }),
		).not.toBeInTheDocument();
		expect(create()).toBeInTheDocument();
	});

	it("suggests to the chosen member instead of creating a task, carrying the look", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const engine = fakeEngine();
		const onClose = vi.fn();
		renderWithSession(<AddTaskSheet open onClose={onClose} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Wash dishes");
		await userEvent.click(screen.getByRole("radio", { name: "Coral" }));
		await chooseFor("Jo");
		expect(row(/^For/)).toHaveTextContent("Jo");
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
				color: "coral",
			}),
		);
		expect(onClose).toHaveBeenCalled();
	});

	it("goes back to creating a task for me when Me is chosen again", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Call grandma");
		await chooseFor("Jo");
		const select = screen.getByLabelText("For");
		expect(select).toHaveDisplayValue("Jo");
		await userEvent.selectOptions(select, "Me");
		expect(select).toHaveDisplayValue("Me");
		await userEvent.click(create());
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.create", title: "Call grandma" }),
		);
	});

	it("keeps the chosen member when the sheet is dismissed and reopened", async () => {
		const store = await storeWith([member("u1", "Sam"), member("u2", "Jo")]);
		renderWithSession(<Harness />, { store });
		await chooseFor("Jo");
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		await userEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("For")).toHaveDisplayValue("Jo");
	});

	it("treats a chosen member who has since left as Me", async () => {
		const store = await storeWith([
			member("u1", "Sam"),
			member("u2", "Jo"),
			member("u3", "Kim"),
		]);
		const engine = fakeEngine();
		renderWithSession(<AddTaskSheet open onClose={vi.fn()} />, {
			store,
			engine,
		});
		await userEvent.type(screen.getByLabelText("Task"), "Wash dishes");
		await chooseFor("Jo");
		expect(
			screen.getByRole("button", { name: "Suggest to Jo" }),
		).toBeInTheDocument();
		await act(async () => {
			await store.members.update(["g1", "u2"], { leftAt: 9 });
		});
		await waitFor(() =>
			expect(screen.getByLabelText("For")).toHaveDisplayValue("Me"),
		);
		expect(
			screen.queryByRole("option", { name: "Jo" }),
		).not.toBeInTheDocument();
		await userEvent.click(create());
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.create", title: "Wash dishes" }),
		);
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
			await chooseFor("Jo");
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
