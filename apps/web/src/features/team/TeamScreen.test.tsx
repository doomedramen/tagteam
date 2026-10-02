import type { MemberDto } from "@tagteam/core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeTask, renderWithSession } from "../../test/fakes";
import { TeamScreen } from "./TeamScreen";

const member = (userId: string, displayName: string): MemberDto => ({
	groupId: "g1",
	userId,
	displayName,
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
});

let store: TagTeamDb;
beforeEach(async () => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.bulkPut([member("u1", "Sam"), member("u2", "Jo")]);
	await store.tasks.put(fakeTask({ startDate: "2020-01-01" }));
});

describe("TeamScreen full-width rows", () => {
	it("keeps the horizontal padding on each member row, not on the card content", async () => {
		renderWithSession(<TeamScreen />, { store });
		const toggle = (
			await screen.findAllByRole("button", { expanded: false })
		)[0];
		const row = toggle?.closest("li");
		const content = row?.closest('[data-slot="card-content"]');
		expect(content).toHaveClass("px-0");
		expect(content).not.toHaveClass("px-4");
		// The button carries the expanded highlight, so it must reach both card edges.
		expect(toggle).toHaveClass("px-4");
		expect(toggle).not.toHaveClass("px-0");
	});

	it("insets an expanded member's task list to match the member name", async () => {
		const user = userEvent.setup();
		renderWithSession(<TeamScreen />, { store });
		const toggle = (
			await screen.findAllByRole("button", { expanded: false })
		)[0];
		if (!toggle) throw new Error("no member row");
		await user.click(toggle);
		const panel = document.getElementById(
			toggle.getAttribute("aria-controls") ?? "",
		);
		expect(panel).toHaveClass("pl-16");
		expect(panel).toHaveClass("pr-5");
	});
});
