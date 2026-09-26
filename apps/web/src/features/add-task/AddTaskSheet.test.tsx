import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
		await userEvent.click(screen.getByRole("button", { name: "Custom" }));
		const every = screen.getByLabelText("Every");
		await userEvent.clear(every);
		await userEvent.type(every, "2");
		await userEvent.selectOptions(screen.getByLabelText("Unit"), "week");
		await userEvent.click(screen.getByRole("button", { name: "Monday" }));
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
		const form = screen
			.getByRole("button", { name: "Add task" })
			.closest("form");
		if (!form) throw new Error("form not found");
		fireEvent.submit(form);
		fireEvent.submit(form);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
	});
});
