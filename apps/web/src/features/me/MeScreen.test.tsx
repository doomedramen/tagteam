import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ME, renderWithSession } from "../../test/fakes";
import { MeScreen } from "./MeScreen";

describe("MeScreen", () => {
	it("paints the profile block in the app-colour page header", () => {
		renderWithSession(<MeScreen />);
		const header = screen
			.getByText(ME.profile.displayName)
			.closest('[data-slot="page-header"]');
		expect(header).toHaveClass(
			"bg-header",
			"rounded-none",
			"border-b",
			"border-line",
		);
		expect(
			screen
				.getByRole("button", { name: "Edit profile" })
				.closest('[data-slot="page-header"]'),
		).toBe(header);
	});

	it("has a Group section that names the current group and opens the switcher", async () => {
		const user = userEvent.setup();
		renderWithSession(<MeScreen />);
		expect(screen.getByText("Group")).toBeInTheDocument();
		const trigger = screen.getByRole("button", {
			name: "Switch group. Current group: Smiths",
		});
		expect(trigger).toHaveTextContent("Smiths");
		await user.click(trigger);
		const sheet = await screen.findByRole("dialog", { name: "Your groups" });
		expect(
			within(sheet).getByRole("button", { name: "Create group" }),
		).toBeInTheDocument();
	});
});
