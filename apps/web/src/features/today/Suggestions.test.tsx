import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeSuggestion } from "../../test/fakes";
import { IncomingSuggestions, OutgoingSuggestions } from "./Suggestions";

const members = [
	{
		groupId: "g1",
		userId: "u2",
		displayName: "Jo",
		avatarColor: "blue",
		role: "member" as const,
		joinedAt: 0,
		leftAt: null,
	},
];

describe("suggestion cards", () => {
	it("show the suggested emoji and color beside the title", () => {
		render(
			<IncomingSuggestions
				suggestions={[
					fakeSuggestion({
						emoji: "\u{1FAB4}",
						color: "green",
						title: "Water plants",
					}),
				]}
				members={members}
				today="2026-10-01"
				onAccept={vi.fn()}
				onDecline={vi.fn()}
			/>,
		);
		const circle = document.querySelector('[data-slot="task-emoji"]');
		expect(circle).toHaveTextContent("\u{1FAB4}");
		expect(circle).toHaveAttribute("data-task-color", "green");
		expect(circle).toHaveAttribute("aria-hidden", "true");
		expect(screen.getByText("Water plants")).toBeInTheDocument();
	});

	it("show the default emoji when the sender chose none", () => {
		render(
			<IncomingSuggestions
				suggestions={[fakeSuggestion()]}
				members={members}
				today="2026-10-01"
				onAccept={vi.fn()}
				onDecline={vi.fn()}
			/>,
		);
		expect(
			document.querySelector('[data-slot="task-emoji"]'),
		).toHaveTextContent("\u{1F4CB}");
	});

	it("show the emoji on suggestions I sent", () => {
		render(
			<OutgoingSuggestions
				suggestions={[
					fakeSuggestion({
						fromUserId: "u1",
						toUserId: "u2",
						emoji: "\u{1F9FA}",
						title: "Laundry",
					}),
				]}
				members={members}
				onWithdraw={vi.fn()}
			/>,
		);
		expect(
			document.querySelector('[data-slot="task-emoji"]'),
		).toHaveTextContent("\u{1F9FA}");
		expect(screen.getByText("Waiting for Jo")).toBeInTheDocument();
	});
});

describe("suggestion cards full-width rows", () => {
	it("keeps the horizontal padding on each row, not on the card content", () => {
		render(
			<OutgoingSuggestions
				suggestions={[fakeSuggestion({ fromUserId: "u1", toUserId: "u2" })]}
				members={members}
				onWithdraw={vi.fn()}
			/>,
		);
		const row = document.querySelector("[data-suggestion-row]");
		const content = row?.closest('[data-slot="card-content"]');
		expect(content).toHaveClass("px-0");
		expect(content).not.toHaveClass("px-4");
		expect(row).toHaveClass("px-4");
	});
});
