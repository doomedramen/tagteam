import { describe, expect, it } from "vitest";
import { EMOJI_CACHE_NAME } from "./assets";
import { deleteEmojiCache } from "./cache";

/** A CacheStorage with one cache, keyed by URL. */
function fakeStorage(urls: string[]) {
	const entries = new Set(urls);
	const cache = {
		keys: async () => [...entries].map((url) => new Request(url)),
		delete: async (request: Request) => entries.delete(request.url),
	};
	const storage = {
		has: async (name: string) => name === EMOJI_CACHE_NAME,
		open: async () => cache,
	} as unknown as CacheStorage;
	return { storage, entries };
}

const ORIGIN = "https://tagteam.example";
const url = (version: string, file: string) =>
	`${ORIGIN}/assets/emoji/${version}/${file}`;
const OTHER_APP_FILE = `${ORIGIN}/assets/app.js`;

describe("deleteEmojiCache", () => {
	const seed = () =>
		fakeStorage([
			url("old", "models/m/onnx/model_quantized.onnx"),
			url("old", "ort/ort.wasm"),
			url("new", "models/m/config.json"),
			OTHER_APP_FILE,
		]);

	it("removes other versions and keeps this one", async () => {
		const { storage, entries } = seed();
		await deleteEmojiCache("otherVersions", "new", storage);
		expect([...entries]).toEqual([
			url("new", "models/m/config.json"),
			OTHER_APP_FILE,
		]);
	});

	it("removes only this version", async () => {
		const { storage, entries } = seed();
		await deleteEmojiCache("thisVersion", "new", storage);
		expect(entries.has(url("new", "models/m/config.json"))).toBe(false);
		expect(entries.size).toBe(3);
	});

	it("removes every version, and never anything outside /assets/emoji/", async () => {
		const { storage, entries } = seed();
		await deleteEmojiCache("all", "new", storage);
		expect([...entries]).toEqual([OTHER_APP_FILE]);
	});

	it("does nothing without a Cache API or without a model cache", async () => {
		await expect(
			deleteEmojiCache("all", "v", undefined),
		).resolves.toBeUndefined();
		const empty = { has: async () => false } as unknown as CacheStorage;
		await expect(deleteEmojiCache("all", "v", empty)).resolves.toBeUndefined();
	});
});
