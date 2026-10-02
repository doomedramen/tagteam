import { mutationErrors, type TaskDto } from "@tagteam/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask } from "../../test/fakes";
import { addAwaitingEmoji, listAwaitingEmoji } from "./awaiting";
import type { EmojiEngine } from "./engine";
import { runLatePicks } from "./late-pick";

const PLANT = "\u{1FAB4}";
const DOG = "\u{1F415}";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

async function listed(...tasks: TaskDto[]) {
	for (const task of tasks) {
		await store.tasks.put(task);
		await addAwaitingEmoji(store, task.id);
	}
}
const run = (
	emoji: EmojiEngine,
	sync = fakeEngine(),
	getEngine: () => EmojiEngine = () => emoji,
) =>
	runLatePicks({ store, sync, userId: "u1", getEngine, now: () => 1234 }).then(
		(picked) => ({ picked, sync }),
	);

describe("late picks", () => {
	it("gives each listed task without an emoji one task.update carrying the emoji only", async () => {
		await listed(
			fakeTask({ id: ID1, title: "Water the plants", color: "teal" }),
			fakeTask({ id: ID2, title: "Walk the dog" }),
		);
		const suggest = vi.fn(async (title: string) =>
			title.startsWith("Water") ? [PLANT] : [DOG],
		);
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(2);
		expect(sync.enqueue).toHaveBeenCalledTimes(2);
		const [first, second] = sync.enqueue.mock.calls.map((call) => call[0]);
		expect(first).toEqual({
			id: expect.any(String),
			at: 1234,
			type: "task.update",
			taskId: ID1,
			emoji: PLANT,
		});
		expect(second).toMatchObject({ taskId: ID2, emoji: DOG });
		for (const mutation of [first, second]) {
			expect(mutation).not.toHaveProperty("color");
			expect(mutation).not.toHaveProperty("title");
			expect(mutationErrors(mutation)).toEqual([]);
		}
		expect(suggest).toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("asks the engine for one task at a time, in the order they were listed", async () => {
		await listed(
			fakeTask({ id: "t1", title: "First" }),
			fakeTask({ id: "t2", title: "Second" }),
		);
		const order: string[] = [];
		let release: (emoji: string[]) => void = () => {};
		const suggest = vi.fn(async (title: string) => {
			order.push(`start ${title}`);
			if (title === "First")
				await new Promise<void>((resolve) => {
					release = () => resolve();
				});
			order.push(`end ${title}`);
			return [PLANT];
		});
		const done = run(fakeEmojiEngine({ suggest }));
		await vi.waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
		expect(order).toEqual(["start First"]);
		release([]);
		await done;
		expect(order).toEqual([
			"start First",
			"end First",
			"start Second",
			"end Second",
		]);
	});

	it("skips tasks that already have an emoji, including a deliberate default", async () => {
		await listed(
			fakeTask({ id: "picked", emoji: DOG }),
			fakeTask({ id: "default", emoji: "\u{1F4CB}" }),
			fakeTask({ id: "empty", title: "Water the plants" }),
		);
		const suggest = vi.fn(async () => [PLANT]);
		const { sync } = await run(fakeEmojiEngine({ suggest }));
		expect(suggest).toHaveBeenCalledTimes(1);
		expect(sync.enqueue).toHaveBeenCalledTimes(1);
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ taskId: "empty" });
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("skips tasks another user owns, archived tasks, and tasks that no longer exist", async () => {
		await listed(
			fakeTask({ id: "theirs", ownerId: "u2" }),
			fakeTask({ id: "archived", archivedAt: 5 }),
		);
		await addAwaitingEmoji(store, "gone");
		const suggest = vi.fn(async () => [PLANT]);
		const { picked } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(suggest).not.toHaveBeenCalled();
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("never picks for a task that was not on the list, such as every task that predates the feature", async () => {
		await store.tasks.put(fakeTask({ id: "old", title: "Brush teeth" }));
		const suggest = vi.fn(async () => [PLANT]);
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(suggest).not.toHaveBeenCalled();
		expect(sync.enqueue).not.toHaveBeenCalled();
	});

	it("makes one attempt per task: an empty answer leaves the default and the id is not kept", async () => {
		await listed(fakeTask({ id: "t1", title: "Zzz" }));
		const suggest = vi.fn(async () => [] as string[]);
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(sync.enqueue).not.toHaveBeenCalled();
		expect(await listAwaitingEmoji(store)).toEqual([]);
		await run(fakeEmojiEngine({ suggest }));
		expect(suggest).toHaveBeenCalledTimes(1);
	});

	it("tries the next task when one fails, and ignores a reply that is not a valid emoji", async () => {
		await listed(
			fakeTask({ id: "t1", title: "One" }),
			fakeTask({ id: "t2", title: "Two" }),
			fakeTask({ id: "t3", title: "Three" }),
		);
		const suggest = vi.fn(async (title: string) => {
			if (title === "One") throw new Error("worker gone");
			if (title === "Two") return ["not an emoji"];
			return [PLANT];
		});
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(1);
		expect(sync.enqueue).toHaveBeenCalledTimes(1);
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ taskId: "t3" });
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("does nothing, and keeps the list, while the engine is not ready", async () => {
		await listed(fakeTask({ id: "t1" }));
		const suggest = vi.fn(async () => [PLANT]);
		const { picked } = await run(
			fakeEmojiEngine({ status: "loading", suggest }),
		);
		expect(picked).toBe(0);
		expect(suggest).not.toHaveBeenCalled();
		expect(await listAwaitingEmoji(store)).toEqual(["t1"]);
	});

	it("stops, keeping the rest of the list, when the engine stops being ready", async () => {
		await listed(
			fakeTask({ id: "t1", title: "One" }),
			fakeTask({ id: "t2", title: "Two" }),
		);
		let status: EmojiEngine["status"] = "ready";
		const engine: EmojiEngine = {
			get status() {
				return status;
			},
			suggest: vi.fn(async () => {
				status = "unavailable";
				return [] as string[];
			}),
			search: async () => [],
		};
		const { picked } = await run(engine);
		expect(picked).toBe(0);
		expect(await listAwaitingEmoji(store)).toEqual(["t2"]);
	});

	it("does not overwrite an emoji the task gained while the engine was thinking", async () => {
		await listed(fakeTask({ id: "t1", title: "One" }));
		const suggest = vi.fn(async () => {
			await store.tasks.update("t1", { emoji: DOG });
			return [PLANT];
		});
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(sync.enqueue).not.toHaveBeenCalled();
	});

	it("picks up tasks listed while it runs", async () => {
		await listed(fakeTask({ id: "t1", title: "One" }));
		const suggest = vi.fn(async (title: string) => {
			if (title === "One") {
				await store.tasks.put(fakeTask({ id: "t2", title: "Two" }));
				await addAwaitingEmoji(store, "t2");
			}
			return [PLANT];
		});
		const { picked } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(2);
	});
});
