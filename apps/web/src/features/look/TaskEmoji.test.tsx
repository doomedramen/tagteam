import { DEFAULT_EMOJI } from "@tagteam/core";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskEmoji } from "./TaskEmoji";

const circle = (container: HTMLElement) => {
	const element = container.querySelector<HTMLElement>(
		'[data-slot="task-emoji"]',
	);
	if (!element) throw new Error("emoji circle not found");
	return element;
};

describe("TaskEmoji", () => {
	it("shows the stored emoji", () => {
		const { container } = render(<TaskEmoji emoji={"\u{1FAB4}"} size="row" />);
		expect(circle(container)).toHaveTextContent("\u{1FAB4}");
	});

	it("shows the default emoji when none is stored, including for undefined", () => {
		const first = render(<TaskEmoji emoji={null} size="row" />);
		expect(circle(first.container)).toHaveTextContent(DEFAULT_EMOJI);
		const second = render(<TaskEmoji emoji={undefined} size="row" />);
		expect(circle(second.container)).toHaveTextContent(DEFAULT_EMOJI);
	});

	it("is decorative", () => {
		const { container } = render(<TaskEmoji emoji={null} size="row" />);
		expect(circle(container)).toHaveAttribute("aria-hidden", "true");
	});

	it("is a circle of the requested size", () => {
		const row = render(<TaskEmoji emoji={null} size="row" />);
		expect(circle(row.container)).toHaveClass("size-9", "rounded-full");
		const sheet = render(<TaskEmoji emoji={null} size="sheet" />);
		expect(circle(sheet.container)).toHaveClass("size-15", "rounded-full");
		const detail = render(<TaskEmoji emoji={null} size="detail" />);
		expect(circle(detail.container)).toHaveClass("size-16", "rounded-full");
	});

	it("wears its own hue only when given one", () => {
		const tinted = render(<TaskEmoji emoji={null} color="teal" size="row" />);
		expect(circle(tinted.container)).toHaveAttribute("data-task-color", "teal");
		const plain = render(<TaskEmoji emoji={null} color={null} size="row" />);
		expect(circle(plain.container)).not.toHaveAttribute("data-task-color");
	});
	describe("fill and ring", () => {
		it("rings a colored row in its hue over the pale sheet fill", () => {
			const { container } = render(
				<TaskEmoji emoji={null} color="green" size="row" />,
			);
			const element = circle(container);
			expect(element).toHaveAttribute("data-task-color", "green");
			expect(element).toHaveClass(
				"bg-task-sheet",
				"border-2",
				"border-task-ring",
			);
			expect(element).not.toHaveClass("bg-task-swatch");
		});

		it("keeps a colorless row neutral and unringed", () => {
			for (const props of [{ color: null }, {}]) {
				const { container } = render(
					<TaskEmoji emoji={null} size="row" {...props} />,
				);
				const element = circle(container);
				expect(element).toHaveClass("bg-surface-2");
				expect(element).not.toHaveClass("border-2");
				expect(element).not.toHaveAttribute("data-task-color");
				expect(element).not.toHaveClass("bg-task-swatch");
			}
		});

		it("uses the card color on tinted surfaces, without a ring", () => {
			for (const size of ["sheet", "detail"] as const) {
				const { container } = render(<TaskEmoji emoji={null} size={size} />);
				const element = circle(container);
				expect(element).toHaveClass("bg-task-card");
				expect(element).not.toHaveClass("border-2");
				expect(element).not.toHaveClass("bg-task-swatch");
			}
		});
	});
});
