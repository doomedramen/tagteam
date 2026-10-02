import { beforeEach, describe, expect, it } from "vitest";
import { clearStore, setMeta, TagTeamDb } from "../../store/db";
import {
	addAwaitingEmoji,
	listAwaitingEmoji,
	removeAwaitingEmoji,
} from "./awaiting";

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

describe("the awaiting-emoji list", () => {
	it("starts empty", async () => {
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("keeps ids in the order they were added, without repeats", async () => {
		await addAwaitingEmoji(store, "a");
		await addAwaitingEmoji(store, "b");
		await addAwaitingEmoji(store, "a");
		expect(await listAwaitingEmoji(store)).toEqual(["a", "b"]);
	});

	it("removes one id and ignores one that is not listed", async () => {
		await addAwaitingEmoji(store, "a");
		await addAwaitingEmoji(store, "b");
		await removeAwaitingEmoji(store, "a");
		await removeAwaitingEmoji(store, "zzz");
		expect(await listAwaitingEmoji(store)).toEqual(["b"]);
	});

	it("does not lose ids added at the same time", async () => {
		await Promise.all(
			["a", "b", "c", "d"].map((id) => addAwaitingEmoji(store, id)),
		);
		expect((await listAwaitingEmoji(store)).sort()).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
	});

	it("ignores damaged data", async () => {
		await setMeta(store, "awaitingEmoji", "not a list");
		expect(await listAwaitingEmoji(store)).toEqual([]);
		await setMeta(store, "awaitingEmoji", ["a", 7, null, "b"]);
		expect(await listAwaitingEmoji(store)).toEqual(["a", "b"]);
	});

	it("is device metadata: the sign-out clear removes it with the rest of the local data", async () => {
		await addAwaitingEmoji(store, "a");
		await clearStore(store);
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});
});
