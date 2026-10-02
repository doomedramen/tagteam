import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ME, renderWithSession } from "../../test/fakes";
import { MeScreen } from "./MeScreen";

describe("MeScreen", () => {
	it("paints the profile block in the app-colour page header", () => {
		renderWithSession(<MeScreen />);
		const header = screen
			.getByText(ME.profile.displayName)
			.closest('[data-slot="page-header"]');
		expect(header).toHaveClass("bg-header", "rounded-none");
		expect(
			screen
				.getByRole("button", { name: "Edit profile" })
				.closest('[data-slot="page-header"]'),
		).toBe(header);
	});
});
