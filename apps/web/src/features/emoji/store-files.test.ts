import { describe, expect, it, vi } from "vitest";
import { storeFiles } from "./store-files";
import { NotCachedError } from "./worker-core";

function fakeCache(initial: Record<string, Response> = {}) {
	const entries = new Map(Object.entries(initial));
	return {
		entries,
		match: async (url: string) => entries.get(url)?.clone(),
		put: async (url: string, response: Response) => {
			entries.set(url, response);
		},
	};
}

const file = (text: string, headers: Record<string, string> = {}) =>
	new Response(text, { headers: { "content-type": "text/plain", ...headers } });

const urls = ["https://t.test/a", "https://t.test/b", "https://t.test/c"];

describe("storeFiles", () => {
	it("fetches and stores only the missing files, and counts the bytes of the stored ones first", async () => {
		const cache = fakeCache({
			[urls[0]]: file("aaaa", { "content-length": "4" }),
			// No content-length header: the size is read from the body.
			[urls[1]]: file("bbbbbb"),
		});
		const fetchFile = vi.fn(async () => file("cc"));
		const seen: number[] = [];
		await storeFiles({
			urls,
			cache,
			fetch: fetchFile,
			allowNetwork: true,
			onBytes: (loaded) => seen.push(loaded),
		});
		expect(fetchFile).toHaveBeenCalledTimes(1);
		expect(fetchFile).toHaveBeenCalledWith(urls[2], { cache: "no-store" });
		expect(seen[0]).toBe(10);
		expect(seen.at(-1)).toBe(12);
		expect(cache.entries.has(urls[2])).toBe(true);
		expect((await cache.match(urls[2]))?.headers.get("content-length")).toBe(
			"2",
		);
	});

	it("never fetches without allowNetwork: a missing file is not stored", async () => {
		const fetchFile = vi.fn(async () => file("x"));
		await expect(
			storeFiles({
				urls,
				cache: fakeCache({ [urls[0]]: file("a") }),
				fetch: fetchFile,
				allowNetwork: false,
				onBytes: () => {},
			}),
		).rejects.toBeInstanceOf(NotCachedError);
		expect(fetchFile).not.toHaveBeenCalled();
	});

	it("does nothing without allowNetwork when every file is stored", async () => {
		const fetchFile = vi.fn();
		await storeFiles({
			urls: [urls[0]],
			cache: fakeCache({ [urls[0]]: file("a") }),
			fetch: fetchFile,
			allowNetwork: false,
			onBytes: () => {},
		});
		expect(fetchFile).not.toHaveBeenCalled();
	});

	it("reports the stored total even when every file is already stored", async () => {
		const fetchFile = vi.fn();
		const seen: number[] = [];
		await storeFiles({
			urls: [urls[0], urls[1]],
			cache: fakeCache({
				[urls[0]]: file("aaaa", { "content-length": "4" }),
				[urls[1]]: file("bb", { "content-length": "2" }),
			}),
			fetch: fetchFile,
			allowNetwork: true,
			onBytes: (loaded) => seen.push(loaded),
		});
		expect(seen).toEqual([6]);
		expect(fetchFile).not.toHaveBeenCalled();
	});

	it("refuses an HTML answer and a failed response", async () => {
		const html = file("<html>", { "content-type": "text/html" });
		await expect(
			storeFiles({
				urls: [urls[0]],
				cache: fakeCache(),
				fetch: async () => html,
				allowNetwork: true,
				onBytes: () => {},
			}),
		).rejects.toThrow(/web page/);
		await expect(
			storeFiles({
				urls: [urls[0]],
				cache: fakeCache(),
				fetch: async () => new Response("no", { status: 404 }),
				allowNetwork: true,
				onBytes: () => {},
			}),
		).rejects.toThrow(/HTTP 404/);
	});
});
