import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { Sheet } from "./Sheet";
import { TextField } from "./TextField";
import { ToastProvider, useToast } from "./Toast";

describe("UI kit", () => {
	it("buttons default to type=button and report busy", () => {
		render(<Button busy>Save</Button>);
		const button = screen.getByRole("button", { name: "Save" });
		expect(button).toHaveAttribute("type", "button");
		expect(button).toHaveAttribute("aria-busy", "true");
	});

	it("text fields link labels and errors", () => {
		render(<TextField label="Email" error="Enter an email" />);
		const input = screen.getByLabelText("Email");
		expect(input).toHaveAttribute("aria-invalid", "true");
		expect(input).toHaveAccessibleDescription("Enter an email");
	});

	it("chips expose their checked state", async () => {
		const onClick = vi.fn();
		render(
			<Chip selected onClick={onClick}>
				Daily
			</Chip>,
		);
		const chip = screen.getByRole("radio", { name: "Daily" });
		expect(chip).toHaveAttribute("aria-checked", "true");
		await userEvent.click(chip);
		expect(onClick).toHaveBeenCalled();
	});

	it("sheets close on Escape and backdrop", async () => {
		const onClose = vi.fn();
		render(
			<Sheet open onClose={onClose} label="Add task">
				<p>Body</p>
			</Sheet>,
		);
		expect(
			screen.getByRole("dialog", { name: "Add task" }),
		).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("toasts show a message with an action", async () => {
		const onUndo = vi.fn();
		function Trigger() {
			const toast = useToast();
			return (
				<Button
					onClick={() =>
						toast.show({
							message: "Done",
							action: { label: "Undo", onClick: onUndo },
						})
					}
				>
					Go
				</Button>
			);
		}
		render(
			<ToastProvider>
				<Trigger />
			</ToastProvider>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Go" }));
		expect(screen.getByRole("status")).toHaveTextContent("Done");
		await userEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(onUndo).toHaveBeenCalled();
		expect(screen.queryByRole("status")).not.toHaveTextContent("Done");
	});
});
