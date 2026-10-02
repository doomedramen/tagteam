import { getMeta, setMeta, type TagTeamDb } from "../../store/db";

// The device-local "awaiting emoji" list (spec §6): ids of tasks this device created, or accepted,
// with no stored emoji. It lives in the Dexie meta table, so it is never synced and sign-out
// clears it with the rest of the local data.

export async function listAwaitingEmoji(store: TagTeamDb): Promise<string[]> {
	const value = await getMeta<unknown>(store, "awaitingEmoji");
	return Array.isArray(value)
		? value.filter((id): id is string => typeof id === "string")
		: [];
}

export async function addAwaitingEmoji(
	store: TagTeamDb,
	taskId: string,
): Promise<void> {
	await store.transaction("rw", store.meta, async () => {
		const ids = await listAwaitingEmoji(store);
		if (!ids.includes(taskId))
			await setMeta(store, "awaitingEmoji", [...ids, taskId]);
	});
}

export async function removeAwaitingEmoji(
	store: TagTeamDb,
	taskId: string,
): Promise<void> {
	await store.transaction("rw", store.meta, async () => {
		const ids = await listAwaitingEmoji(store);
		if (ids.includes(taskId))
			await setMeta(
				store,
				"awaitingEmoji",
				ids.filter((id) => id !== taskId),
			);
	});
}
