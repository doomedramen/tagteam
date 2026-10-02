import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask, renderWithSession } from "../../test/fakes";
import { loadCatalog } from "../emoji/catalog";
import { type EmojiEngine, EmojiEngineProvider } from "../emoji/engine";
import { AddTaskSheet } from "./AddTaskSheet";
import { AUTO_EMOJI_DEBOUNCE_MS } from "./useAutoEmoji";

const PLANT = "\u{1FAB4}"; // potted plant
const DOG = "\u{1F415}"; // dog
const DEBOUNCE = AUTO_EMOJI_DEBOUNCE_MS;

// Only the timers the debounce uses are faked, and only while a test drives time by hand: the
// picker and the submit path are exercised with real timers, so waitFor keeps working there.
const fake = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const real = () => vi.useRealTimers();
// Moves the clock and lets the promises the engine answers with settle, inside act.
const advance = (ms: number) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
const user = () => userEvent.setup({ delay: null });

// Testing Library's own waiting (inside userEvent and waitFor) only copes with fake timers when a
// `jest` global tells it how to advance them; Vitest has none, so give it the one function it uses.
const globals = globalThis as { jest?: unknown };
// The emoji names come from a lazily imported catalog, which needs real time to load once.
beforeAll(async () => {
	await loadCatalog();
	globals.jest = { advanceTimersByTime: vi.advanceTimersByTime };
});
afterAll(() => {
	delete globals.jest;
});
afterEach(() => real());

function setup(
	emoji: EmojiEngine,
	props: Partial<Parameters<typeof AddTaskSheet>[0]> = {},
) {
	const sync = fakeEngine();
	const view = renderWithSession(
		<EmojiEngineProvider value={emoji}>
			<AddTaskSheet open onClose={vi.fn()} {...props} />
		</EmojiEngineProvider>,
		{ engine: sync },
	);
	return { sync, view };
}
const emojiButton = (name: string | RegExp) =>
	screen.getByRole("button", { name });
const title = () => screen.getByLabelText("Task");

describe("automatic emoji in the New task sheet", () => {
	it("fills the emoji 300 ms after the title stops changing", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE - 1);
		expect(engine.suggest).not.toHaveBeenCalled();
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
		await advance(1);
		expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument();
		expect(engine.suggest).toHaveBeenCalledTimes(1);
		expect(engine.suggest).toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
	});

	it("asks only once for a title typed in a burst", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		fake();
		const typist = user();
		// 400 ms pass in total, but never 300 ms between two keystrokes.
		await typist.type(title(), "Water");
		await advance(DEBOUNCE - 100);
		await typist.type(title(), " the");
		await advance(DEBOUNCE - 100);
		await typist.type(title(), " plants");
		await advance(DEBOUNCE - 100);
		expect(engine.suggest).not.toHaveBeenCalled();
		await advance(100);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
		expect(engine.suggest).toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
		await advance(DEBOUNCE * 3);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
	});

	it("does not ask for a title shorter than three characters", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		fake();
		await user().type(title(), "ab");
		await advance(DEBOUNCE * 2);
		expect(engine.suggest).not.toHaveBeenCalled();
	});

	it("does not ask while the engine is not ready", async () => {
		for (const status of ["loading", "unavailable", "off"] as const) {
			const engine = fakeEmojiEngine({
				status,
				suggest: vi.fn(async () => [PLANT]),
			});
			const { view } = setup(engine);
			fake();
			await user().type(screen.getByLabelText("Task"), "Water the plants");
			await advance(DEBOUNCE * 2);
			expect(engine.suggest).not.toHaveBeenCalled();
			view.unmount();
			real();
		}
	});

	it("starts suggesting when the engine becomes ready after the title was typed", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		let makeReady: () => void = () => {};
		function Harness() {
			const [status, setStatus] = useState<EmojiEngine["status"]>("loading");
			makeReady = () => setStatus("ready");
			const engine = useMemo<EmojiEngine>(
				() => ({ status, suggest, search: async () => [] }),
				[status],
			);
			return (
				<EmojiEngineProvider value={engine}>
					<AddTaskSheet open onClose={vi.fn()} />
				</EmojiEngineProvider>
			);
		}
		renderWithSession(<Harness />);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE * 2);
		expect(suggest).not.toHaveBeenCalled();
		act(() => makeReady());
		await advance(DEBOUNCE);
		expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument();
	});

	it("drops the result for a title that has since changed", async () => {
		let release: (emoji: string[]) => void = () => {};
		const first = new Promise<string[]>((resolve) => {
			release = resolve;
		});
		const suggest = vi
			.fn<EmojiEngine["suggest"]>()
			.mockImplementationOnce(async () => first)
			.mockImplementation(async () => [DOG]);
		setup(fakeEmojiEngine({ suggest }));
		fake();
		const typist = user();
		await typist.type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(suggest).toHaveBeenCalledTimes(1);
		await typist.clear(title());
		await typist.type(title(), "Walk the dog");
		await advance(DEBOUNCE);
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
		await act(async () => release([PLANT]));
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
	});

	it("never overwrites an emoji the person typed or picked", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.type(
			await screen.findByLabelText("Type or paste an emoji"),
			DOG,
		);
		await waitFor(() =>
			expect(emojiButton("Emoji: dog, change")).toBeInTheDocument(),
		);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE * 2);
		expect(engine.suggest).not.toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
	});

	it("keeps an emoji picked by hand while a suggestion is still in flight, and creates the task with it", async () => {
		let release: (emoji: string[]) => void = () => {};
		const pending = new Promise<string[]>((resolve) => {
			release = resolve;
		});
		const engine = fakeEmojiEngine({ suggest: vi.fn(() => pending) });
		const { sync } = setup(engine);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
		real();
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.type(
			await screen.findByLabelText("Type or paste an emoji"),
			DOG,
		);
		await waitFor(() =>
			expect(emojiButton("Emoji: dog, change")).toBeInTheDocument(),
		);
		await act(async () => release([PLANT]));
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({
			type: "task.create",
			emoji: DOG,
		});
	});

	it("stops following the title once the person picks, even after an automatic fill", async () => {
		const suggest = vi
			.fn<EmojiEngine["suggest"]>()
			.mockImplementation(async (text) =>
				text.startsWith("Walk") ? [DOG] : [PLANT],
			);
		setup(fakeEmojiEngine({ suggest }));
		fake();
		const typist = user();
		await typist.type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument();
		real();
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.click(
			await screen.findByRole("button", { name: "Use default" }),
		);
		await waitFor(() =>
			expect(emojiButton("Emoji: clipboard, change")).toBeInTheDocument(),
		);
		fake();
		await typist.clear(title());
		await typist.type(title(), "Walk the dog");
		await advance(DEBOUNCE * 2);
		// The picker asks for its own "Suggested" row without autoPick; only the sheet's fill counts.
		expect(
			suggest.mock.calls.filter(([, options]) => options?.autoPick),
		).toEqual([["Water the plants", { autoPick: true }]]);
		expect(emojiButton("Emoji: clipboard, change")).toBeInTheDocument();
	});

	it("never changes the colour, and creates the task with the filled emoji and the chosen colour", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		const { sync } = setup(engine);
		await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument();
		expect(screen.getByRole("dialog", { name: "New task" })).toHaveAttribute(
			"data-task-color",
			"teal",
		);
		real();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({
			type: "task.create",
			title: "Water the plants",
			emoji: PLANT,
			color: "teal",
		});
	});

	it("creates the task at once, with no stored emoji, when no suggestion has arrived", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(() => new Promise<string[]>(() => {})),
		});
		const { sync } = setup(engine);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(engine.suggest).toHaveBeenCalled();
		real();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).not.toHaveProperty("emoji");
	});

	it("ignores a suggestion that is not a valid emoji, and the task still saves", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(async () => ["not an emoji"]),
		});
		const { sync } = setup(engine);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(engine.suggest).toHaveBeenCalled();
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
		real();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).not.toHaveProperty("emoji");
	});

	it("survives an engine that rejects", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(async () => Promise.reject(new Error("worker gone"))),
		});
		const { sync } = setup(engine);
		fake();
		await user().type(title(), "Water the plants");
		await advance(DEBOUNCE);
		expect(engine.suggest).toHaveBeenCalled();
		real();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	});

	it("never fills the emoji when editing, whatever the task's age", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine, { task: fakeTask({ emoji: null }) });
		fake();
		const typist = user();
		await typist.clear(title());
		await typist.type(title(), "Water the plants");
		await advance(DEBOUNCE * 2);
		expect(engine.suggest).not.toHaveBeenCalled();
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
	});

	it("wakes the engine when a New task sheet opens, but not for Edit or a closed sheet", async () => {
		const creating = fakeEmojiEngine();
		setup(creating);
		expect(creating.wake).toHaveBeenCalled();

		const editing = fakeEmojiEngine();
		setup(editing, { task: fakeTask() });
		expect(editing.wake).not.toHaveBeenCalled();

		const closed = fakeEmojiEngine();
		setup(closed, { open: false });
		expect(closed.wake).not.toHaveBeenCalled();
	});
});
