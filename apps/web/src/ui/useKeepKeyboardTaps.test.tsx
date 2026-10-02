import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { touchCancelled, touchMultiTap, touchTap } from "../test/touch";
import { Sheet } from "./Sheet";

function Harness({
	onAction = vi.fn(),
	onSubmit = vi.fn(),
	onLink = vi.fn(),
}: {
	onAction?: () => void;
	onSubmit?: () => void;
	onLink?: () => void;
}) {
	const [color, setColor] = useState("blue");
	return (
		<Sheet
			open
			onClose={vi.fn()}
			label="New task"
			tint="blue"
			action={
				<button type="submit" form="f" disabled={color === "locked"}>
					Create
				</button>
			}
		>
			<form
				id="f"
				onSubmit={(e) => {
					e.preventDefault();
					onSubmit();
				}}
			>
				{/* biome-ignore lint/a11y/noAutofocus: mirrors the title field of the task sheet */}
				<input aria-label="Title" autoFocus />
				<textarea aria-label="Notes" />
				<label>
					<input
						type="radio"
						name="c"
						aria-label="Pink"
						checked={color === "pink"}
						onChange={() => setColor("pink")}
					/>
					<span data-testid="pink-swatch" />
				</label>
				<button type="button" onClick={onAction}>
					Repeat
				</button>
				<button type="button" disabled onClick={onAction}>
					Disabled row
				</button>
				<a
					href="/tasks/1"
					onClick={(e) => {
						e.preventDefault();
						onLink();
					}}
				>
					Open task details
				</a>
				<select aria-label="For" onClick={onAction}>
					<option>Me</option>
				</select>
				<input type="time" aria-label="Due by" onClick={onAction} />
				<label>
					Name
					<input aria-label="Name" onClick={onAction} />
				</label>
			</form>
		</Sheet>
	);
}

const title = () => screen.getByLabelText("Title");

describe("keyboard-open taps in a Sheet", () => {
	it("activates the header submit button once and keeps the title focused", () => {
		const onSubmit = vi.fn();
		render(<Harness onSubmit={onSubmit} />);
		expect(title()).toHaveFocus();
		const end = touchTap(screen.getByRole("button", { name: "Create" }));
		expect(end.defaultPrevented).toBe(true);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(title()).toHaveFocus();
	});

	it("checks a colour radio by tapping its label content, once", () => {
		render(<Harness />);
		const end = touchTap(screen.getByTestId("pink-swatch"));
		expect(end.defaultPrevented).toBe(true);
		expect(screen.getByLabelText("Pink")).toBeChecked();
		expect(title()).toHaveFocus();
	});

	it("runs a row button's handler exactly once", () => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		const end = touchTap(screen.getByRole("button", { name: "Repeat" }));
		expect(end.defaultPrevented).toBe(true);
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(title()).toHaveFocus();
	});

	it("clicks a link once", () => {
		const onLink = vi.fn();
		render(<Harness onLink={onLink} />);
		touchTap(screen.getByRole("link", { name: "Open task details" }));
		expect(onLink).toHaveBeenCalledTimes(1);
	});

	it("leaves taps alone when no text field is focused", () => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		screen.getByRole("button", { name: "Repeat" }).focus();
		const end = touchTap(screen.getByRole("button", { name: "Repeat" }));
		expect(end.defaultPrevented).toBe(false);
		expect(onAction).not.toHaveBeenCalled();
	});

	it("leaves taps alone when the focused text field is outside the sheet", () => {
		const onAction = vi.fn();
		render(
			<>
				<input aria-label="Outside" />
				<Harness onAction={onAction} />
			</>,
		);
		screen.getByLabelText("Outside").focus();
		const end = touchTap(screen.getByRole("button", { name: "Repeat" }));
		expect(end.defaultPrevented).toBe(false);
		expect(onAction).not.toHaveBeenCalled();
	});

	it.each([
		["select", () => screen.getByLabelText("For")],
		["time input", () => screen.getByLabelText("Due by")],
		[
			"disabled button",
			() => screen.getByRole("button", { name: "Disabled row" }),
		],
		["plain content", () => document.getElementById("f") as HTMLElement],
	])("does not intercept a tap on a %s", (_name, target) => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		const end = touchTap(target());
		expect(end.defaultPrevented).toBe(false);
		expect(onAction).not.toHaveBeenCalled();
	});

	// Base UI's own keyboard handling (not ours) takes taps on text fields, and jsdom cannot run
	// it, so these taps are observed on the popup and stopped before they reach Base UI.
	it.each([
		["text field", () => screen.getByLabelText("Notes")],
		["label of a text field", () => screen.getByText("Name")],
	])("does not intercept a tap on a %s", (_name, target) => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		let prevented: boolean | null = null;
		screen.getByRole("dialog").addEventListener("touchend", (event) => {
			prevented = event.defaultPrevented;
			event.stopPropagation();
		});
		touchTap(target());
		expect(prevented).toBe(false);
		expect(onAction).not.toHaveBeenCalled();
	});

	it("does not intercept a touch that moved more than 10 px", () => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		const end = touchTap(screen.getByRole("button", { name: "Repeat" }), {
			moveTo: { x: 100, y: 125 },
		});
		expect(end.defaultPrevented).toBe(false);
		expect(onAction).not.toHaveBeenCalled();
	});

	it("still treats a 5 px wobble as a tap", () => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		touchTap(screen.getByRole("button", { name: "Repeat" }), {
			moveTo: { x: 103, y: 104 },
		});
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("does not intercept multi-touch or a cancelled touch", () => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		const button = screen.getByRole("button", { name: "Repeat" });
		expect(touchMultiTap(button).defaultPrevented).toBe(false);
		expect(touchCancelled(button).defaultPrevented).toBe(false);
		expect(onAction).not.toHaveBeenCalled();
	});

	it("keeps mouse behaviour: a click works and keeps the title focused", async () => {
		const onAction = vi.fn();
		render(<Harness onAction={onAction} />);
		await userEvent.click(screen.getByRole("button", { name: "Repeat" }));
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(title()).toHaveFocus();
	});

	it("keeps working after the sheet re-renders", () => {
		const onAction = vi.fn();
		const { rerender } = render(<Harness onAction={onAction} />);
		rerender(<Harness onAction={onAction} />);
		touchTap(screen.getByRole("button", { name: "Repeat" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	describe("timing", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("still activates a slow tap that was held for 1.2 s", () => {
			vi.useFakeTimers();
			const onAction = vi.fn();
			render(<Harness onAction={onAction} />);
			const end = touchTap(screen.getByRole("button", { name: "Repeat" }), {
				beforeEnd: () => vi.advanceTimersByTime(1200),
			});
			expect(end.defaultPrevented).toBe(true);
			expect(onAction).toHaveBeenCalledTimes(1);
		});

		it("ignores a tap that starts within 100 ms of a scroll, as it only stopped momentum", () => {
			vi.useFakeTimers();
			const onAction = vi.fn();
			render(<Harness onAction={onAction} />);
			const button = screen.getByRole("button", { name: "Repeat" });
			fireEvent.scroll(button);
			vi.advanceTimersByTime(100);
			const end = touchTap(button);
			expect(end.defaultPrevented).toBe(false);
			expect(onAction).not.toHaveBeenCalled();
		});

		it("handles a tap that starts 400 ms after a scroll", () => {
			vi.useFakeTimers();
			const onAction = vi.fn();
			render(<Harness onAction={onAction} />);
			const button = screen.getByRole("button", { name: "Repeat" });
			fireEvent.scroll(button);
			vi.advanceTimersByTime(400);
			const end = touchTap(button);
			expect(end.defaultPrevented).toBe(true);
			expect(onAction).toHaveBeenCalledTimes(1);
		});
	});
});
