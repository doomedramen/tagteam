import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import type { SyncStatus } from "../../sync/engine";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask, renderWithSession } from "../../test/fakes";
import { addAwaitingEmoji, listAwaitingEmoji } from "./awaiting";
import { type EmojiEngine, EmojiEngineProvider } from "./engine";
import { LatePicks } from "./LatePicks";

const PLANT = "\u{1FAB4}";

function setup(options: { emoji: EmojiEngine; lastSyncedAt?: number | null }) {
	const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	const base = fakeEngine();
	let status: SyncStatus = {
		state: "idle",
		pending: 0,
		lastSyncedAt:
			options.lastSyncedAt === undefined ? 100 : options.lastSyncedAt,
	};
	const listeners = new Set<(s: SyncStatus) => void>();
	const sync = {
		...base,
		getStatus: () => status,
		subscribe: (listener: (s: SyncStatus) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	renderWithSession(
		<EmojiEngineProvider value={options.emoji}>
			<LatePicks />
		</EmojiEngineProvider>,
		{ store, engine: sync },
	);
	return {
		store,
		sync,
		finishSync() {
			status = { ...status, lastSyncedAt: 200 };
			for (const listener of listeners) listener(status);
		},
	};
}
const addTask = async (
	store: TagTeamDb,
	id: string,
	title = "Water the plants",
) => {
	await store.tasks.put(fakeTask({ id, title }));
	await addAwaitingEmoji(store, id);
};

describe("LatePicks", () => {
	it("picks an emoji for a listed task once the engine is ready and a sync has finished", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync } = setup({ emoji: fakeEmojiEngine({ suggest }) });
		await addTask(store, "t1");
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({
			type: "task.update",
			taskId: "t1",
			emoji: PLANT,
		});
	});

	it("waits for the first successful sync", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync, finishSync } = setup({
			emoji: fakeEmojiEngine({ suggest }),
			lastSyncedAt: null,
		});
		await addTask(store, "t1");
		await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
		expect(suggest).not.toHaveBeenCalled();
		act(() => finishSync());
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	});

	it("does nothing while the engine is not ready", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store } = setup({
			emoji: fakeEmojiEngine({ status: "loading", suggest }),
		});
		await addTask(store, "t1");
		await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
		expect(suggest).not.toHaveBeenCalled();
	});

	it("picks for a task listed after the engine was already ready", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync } = setup({ emoji: fakeEmojiEngine({ suggest }) });
		await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
		await addTask(store, "t9", "Walk the dog");
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ taskId: "t9" });
	});

	it("stays silent when a run fails, and still works for the next task", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync } = setup({ emoji: fakeEmojiEngine({ suggest }) });
		// A damaged local store: reading the task throws outside the per-task guard.
		const get = vi
			.spyOn(store.tasks, "get")
			.mockRejectedValueOnce(new Error("store broke"));
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			await addTask(store, "t1");
			await waitFor(() => expect(get).toHaveBeenCalled());
			await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
			expect(unhandled).not.toHaveBeenCalled();
			expect(sync.enqueue).not.toHaveBeenCalled();
			// The id stays listed, and a later task starts a new run that handles both.
			expect(await listAwaitingEmoji(store)).toEqual(["t1"]);
			await addTask(store, "t2", "Walk the dog");
			await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(2));
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});
});
