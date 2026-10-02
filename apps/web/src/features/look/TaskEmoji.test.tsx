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
		const { container } = render(<TaskEmoji emoji={"\u{1FAB4}"} size="bare" />);
		expect(circle(container)).toHaveTextContent("\u{1FAB4}");
	});

	it("shows the default emoji when none is stored, including for undefined", () => {
		const first = render(<TaskEmoji emoji={null} size="bare" />);
		expect(circle(first.container)).toHaveTextContent(DEFAULT_EMOJI);
		const second = render(<TaskEmoji emoji={undefined} size="bare" />);
		expect(circle(second.container)).toHaveTextContent(DEFAULT_EMOJI);
	});

	it("is decorative", () => {
		const { container } = render(<TaskEmoji emoji={null} size="bare" />);
		expect(circle(container)).toHaveAttribute("aria-hidden", "true");
	});

	it("is a bare glyph in a 36 px slot, with no fill, ring or hue", () => {
		const { container } = render(<TaskEmoji emoji={null} size="bare" />);
		const element = circle(container);
		expect(element).toHaveClass("h-9", "w-9", "text-[28px]", "overflow-hidden");
		expect(element).not.toHaveAttribute("data-task-color");
		for (const name of Array.from(element.classList)) {
			expect(name).not.toMatch(/^(bg-|border|rounded|ring)/);
		}
	});

	it("is a large bare glyph in an 80 px box on the sheet, with no background or circle", () => {
		const { container } = render(<TaskEmoji emoji={null} size="sheet" />);
		const element = circle(container);
		expect(element).toHaveClass("size-20", "text-[64px]", "leading-none");
		for (const name of Array.from(element.classList)) {
			expect(name).not.toMatch(/^(bg-|border|rounded|ring)/);
		}
	});

	it("is a card-colored circle on the task detail", () => {
		const { container } = render(<TaskEmoji emoji={null} size="detail" />);
		const element = circle(container);
		expect(element).toHaveClass(
			"size-16",
			"rounded-full",
			"bg-task-card",
			"text-[32px]",
		);
		expect(element).not.toHaveClass("border-2");
		expect(element).not.toHaveClass("bg-task-swatch");
	});
});
