import { isEmoji } from "@tagteam/core";
import type { TagTeamDb } from "../../store/db";
import type { SyncEngine } from "../../sync/engine";
import { listAwaitingEmoji, removeAwaitingEmoji } from "./awaiting";
import type { EmojiEngine } from "./engine";

/**
 * Gives each listed task an emoji from its title (spec §6 "Late pick"). One task at a time, one
 * attempt each: the id leaves the list before the engine is asked. A task is only picked for when
 * this user still owns it, it is not archived, and it still has no stored emoji. The change is an
 * ordinary `task.update` carrying the emoji and nothing else: never the colour, and the server
 * writes no activity entry and sends no push for it. A failure for one task leaves it with the
 * default and moves on. Stops, leaving the rest listed, when the engine is no longer ready.
 * Returns how many tasks received an emoji.
 */
export async function runLatePicks({
	store,
	sync,
	userId,
	getEngine,
	now = Date.now,
}: {
	store: TagTeamDb;
	sync: Pick<SyncEngine, "enqueue">;
	userId: string;
	/** The current engine; read again before every task, because its status can change. */
	getEngine: () => EmojiEngine;
	now?: () => number;
}): Promise<number> {
	let picked = 0;
	for (;;) {
		const [taskId] = await listAwaitingEmoji(store);
		if (taskId === undefined) return picked;
		const engine = getEngine();
		if (engine.status !== "ready") return picked;

		const task = await store.tasks.get(taskId);
		await removeAwaitingEmoji(store, taskId);
		if (
			!task ||
			task.ownerId !== userId ||
			task.archivedAt !== null ||
			(task.emoji ?? null) !== null
		)
			continue;
		try {
			const [emoji] = await engine.suggest(task.title, { autoPick: true });
			if (emoji === undefined || !isEmoji(emoji)) continue;
			// It may have gained an emoji or been archived while the engine was thinking.
			const current = await store.tasks.get(taskId);
			if (
				!current ||
				current.archivedAt !== null ||
				(current.emoji ?? null) !== null
			)
				continue;
			await sync.enqueue({
				id: crypto.randomUUID(),
				at: now(),
				type: "task.update",
				taskId,
				emoji,
			});
			picked++;
		} catch {
			// This task keeps the default; the next one is tried.
		}
	}
}
