import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorOptions } from "./ColorOptions";

const HUES = ["Pink", "Coral", "Amber", "Green", "Teal", "Blue", "Purple"];

describe("ColorOptions", () => {
	it("offers the seven hues as one labelled radio group", () => {
		render(<ColorOptions value="blue" onChange={vi.fn()} />);
		const group = screen.getByRole("radiogroup", { name: "Color" });
		expect(
			within(group)
				.getAllByRole("radio")
				.map((radio) => radio.getAttribute("aria-label")),
		).toEqual(HUES);
	});

	it("checks the current hue and shows a check mark on it only", () => {
		render(<ColorOptions value="blue" onChange={vi.fn()} />);
		for (const hue of HUES) {
			const radio = screen.getByRole("radio", { name: hue });
			const mark = radio.closest("label")?.querySelector("svg");
			if (hue === "Blue") {
				expect(radio).toBeChecked();
				expect(mark).not.toBeNull();
			} else {
				expect(radio).not.toBeChecked();
				expect(mark).toBeNull();
			}
		}
	});

	it("checks nothing when the task has no color", () => {
		render(<ColorOptions value={null} onChange={vi.fn()} />);
		expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
		expect(
			screen.getByRole("radiogroup", { name: "Color" }).querySelector("svg"),
		).toBeNull();
	});

	it("reports the hue that was tapped", async () => {
		const onChange = vi.fn();
		render(<ColorOptions value="blue" onChange={onChange} />);
		await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
		expect(onChange).toHaveBeenCalledWith("teal");
	});

	it("moves between hues with the arrow keys", async () => {
		const onChange = vi.fn();
		render(<ColorOptions value="blue" onChange={onChange} />);
		screen.getByRole("radio", { name: "Blue" }).focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(onChange).toHaveBeenCalledWith("purple");
	});

	it("gives each option a 44 px target around a 32 px swatch in its own hue", () => {
		render(<ColorOptions value="blue" onChange={vi.fn()} />);
		const label = screen.getByRole("radio", { name: "Pink" }).closest("label");
		expect(label).toHaveClass("size-11");
		expect(label).toHaveAttribute("data-task-color", "pink");
		expect(label?.querySelector("span")).toHaveClass("size-8", "rounded-full");
	});
});
