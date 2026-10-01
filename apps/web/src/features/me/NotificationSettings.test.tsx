import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithSession } from "../../test/fakes";
import { NotificationSettings } from "./NotificationSettings";

vi.mock("../../lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/api")>()),
	apiFetch: vi.fn(async () => ({
		configured: true,
		publicKey: "key",
		settings: {
			remindersEnabled: true,
			nudgesEnabled: true,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
		},
		subscriptionCount: 0,
	})),
}));

describe("NotificationSettings", () => {
	it("labels the nudge toggle so it also covers suggestions", async () => {
		renderWithSession(<NotificationSettings />);
		expect(
			await screen.findByRole("switch", { name: "Nudges and suggestions" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("A teammate nudges you or suggests a task"),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Reminders and suggestions wait until quiet hours end. Nudges arrive right away.",
			),
		).toBeInTheDocument();
		expect(screen.queryByText("Nudges from your team")).not.toBeInTheDocument();
	});
});
