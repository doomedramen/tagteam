import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask, renderWithSession } from "../../test/fakes";
import { type EmojiEngine, EmojiEngineProvider } from "../emoji/engine";
import { AddTaskSheet } from "./AddTaskSheet";
import { AUTO_EMOJI_DEBOUNCE_MS } from "./useAutoEmoji";

const PLANT = "\u{1FAB4}"; // potted plant
const DOG = "\u{1F415}"; // dog
const LONG_WAIT = AUTO_EMOJI_DEBOUNCE_MS * 2;

function setup(
	emoji: EmojiEngine,
	props: Partial<Parameters<typeof AddTaskSheet>[0]> = {},
) {
	const sync = fakeEngine();
	renderWithSession(
		<EmojiEngineProvider value={emoji}>
			<AddTaskSheet open onClose={vi.fn()} {...props} />
		</EmojiEngineProvider>,
		{ engine: sync },
	);
	return { sync };
}
const emojiButton = (name: string | RegExp) =>
	screen.getByRole("button", { name });
const title = () => screen.getByLabelText("Task");
const pause = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("automatic emoji in the New task sheet", () => {
	it("fills the emoji 300 ms after the title stops changing", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.type(title(), "Water the plants");
		expect(engine.suggest).not.toHaveBeenCalled();
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
		expect(engine.suggest).toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
	});

	it("asks only once for a title typed in a burst", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.type(title(), "Water the plants", { delay: 20 });
		await pause(LONG_WAIT);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
	});

	it("does not ask for a title shorter than three characters", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.type(title(), "ab");
		await pause(LONG_WAIT);
		expect(engine.suggest).not.toHaveBeenCalled();
	});

	it("does not ask while the engine is not ready", async () => {
		for (const status of ["loading", "unavailable", "off"] as const) {
			const engine = fakeEmojiEngine({
				status,
				suggest: vi.fn(async () => [PLANT]),
			});
			const view = renderWithSession(
				<EmojiEngineProvider value={engine}>
					<AddTaskSheet open onClose={vi.fn()} />
				</EmojiEngineProvider>,
			);
			await userEvent.type(screen.getByLabelText("Task"), "Water the plants");
			await pause(LONG_WAIT);
			expect(engine.suggest).not.toHaveBeenCalled();
			view.unmount();
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
		await userEvent.type(title(), "Water the plants");
		await pause(LONG_WAIT);
		expect(suggest).not.toHaveBeenCalled();
		act(() => makeReady());
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
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
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
		await userEvent.clear(title());
		await userEvent.type(title(), "Walk the dog");
		await waitFor(() =>
			expect(emojiButton("Emoji: dog, change")).toBeInTheDocument(),
		);
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
		await userEvent.type(title(), "Water the plants");
		await pause(LONG_WAIT);
		expect(engine.suggest).not.toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
	});

	it("stops following the title once the person picks, even after an automatic fill", async () => {
		const suggest = vi
			.fn<EmojiEngine["suggest"]>()
			.mockImplementation(async (text) =>
				text.startsWith("Walk") ? [DOG] : [PLANT],
			);
		setup(fakeEmojiEngine({ suggest }));
		await userEvent.type(title(), "Water the plants");
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.click(
			await screen.findByRole("button", { name: "Use default" }),
		);
		await waitFor(() =>
			expect(emojiButton("Emoji: clipboard, change")).toBeInTheDocument(),
		);
		await userEvent.clear(title());
		await userEvent.type(title(), "Walk the dog");
		await pause(LONG_WAIT);
		expect(emojiButton("Emoji: clipboard, change")).toBeInTheDocument();
	});

	it("never changes the colour, and creates the task with the filled emoji and the chosen colour", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		const { sync } = setup(engine);
		await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
		await userEvent.type(title(), "Water the plants");
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		expect(screen.getByRole("dialog", { name: "New task" })).toHaveAttribute(
			"data-task-color",
			"teal",
		);
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
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(engine.suggest).toHaveBeenCalled());
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).not.toHaveProperty("emoji");
	});

	it("ignores a suggestion that is not a valid emoji, and the task still saves", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(async () => ["not an emoji"]),
		});
		const { sync } = setup(engine);
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(engine.suggest).toHaveBeenCalled());
		await pause(50);
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).not.toHaveProperty("emoji");
	});

	it("survives an engine that rejects", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(async () => Promise.reject(new Error("worker gone"))),
		});
		const { sync } = setup(engine);
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(engine.suggest).toHaveBeenCalled());
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	});

	it("never fills the emoji when editing, whatever the task's age", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine, { task: fakeTask({ emoji: null }) });
		await userEvent.clear(title());
		await userEvent.type(title(), "Water the plants");
		await pause(LONG_WAIT);
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
