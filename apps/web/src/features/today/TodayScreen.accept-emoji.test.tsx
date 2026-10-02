import type { MemberDto } from "@tagteam/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEmojiEngine } from "../../test/emoji";
import {
	fakeEngine,
	fakeSuggestion,
	renderWithSession,
} from "../../test/fakes";
import { listAwaitingEmoji } from "../emoji/awaiting";
import { type EmojiEngine, EmojiEngineProvider } from "../emoji/engine";
import { TodayScreen } from "./TodayScreen";

vi.mock("../../ui/confetti", () => ({ fireScreenConfettiCannon: vi.fn() }));

const jo: MemberDto = {
	groupId: "g1",
	userId: "u2",
	displayName: "Jo",
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
};

async function accept(emoji: EmojiEngine, suggestionEmoji: string | null) {
	const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.put(jo);
	await store.suggestions.put(fakeSuggestion({ emoji: suggestionEmoji }));
	const sync = fakeEngine();
	renderWithSession(
		<EmojiEngineProvider value={emoji}>
			<TodayScreen />
		</EmojiEngineProvider>,
		{ store, engine: sync },
	);
	await userEvent.click(
		await screen.findByRole("button", { name: /1 suggestion for you/ }),
	);
	const sheet = await screen.findByRole("dialog", { name: "Suggestions" });
	await userEvent.click(
		within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
	);
	await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	const mutation = sync.enqueue.mock.calls[0][0] as { taskId: string };
	return { store, mutation };
}

describe("accepting a suggestion that has no emoji", () => {
	it("lists the new task for a late pick", async () => {
		const { store, mutation } = await accept(
			fakeEmojiEngine({ status: "loading" }),
			null,
		);
		await waitFor(async () =>
			expect(await listAwaitingEmoji(store)).toEqual([mutation.taskId]),
		);
	});

	it("does not list a task whose suggestion came with an emoji", async () => {
		const { store } = await accept(fakeEmojiEngine(), "\u{1FAB4}");
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("does not list it when suggestions are switched off on this device", async () => {
		const { store } = await accept(fakeEmojiEngine({ status: "off" }), null);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});
});
