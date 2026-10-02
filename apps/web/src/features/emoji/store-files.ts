import { NotCachedError } from "./worker-core";

/** The part of the Cache API `storeFiles` uses. */
export interface FileCache {
	match(url: string): Promise<Response | undefined>;
	put(url: string, response: Response): Promise<void>;
}

export interface StoreFilesOptions {
	/** Absolute URLs, the keys transformers.js looks the files up by. */
	urls: readonly string[];
	cache: FileCache;
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	allowNetwork: boolean;
	/** Bytes held so far: files that were already stored count from the start, fetched ones as they arrive. */
	onBytes: (loaded: number) => void;
}

/** The size of a stored file: the length header `storeFiles` writes, else the body itself. */
async function storedSize(response: Response): Promise<number> {
	const header = Number(response.headers.get("content-length"));
	if (Number.isFinite(header) && header > 0) return header;
	return (await response.blob()).size;
}

/**
 * Puts every file that is not stored yet into the Cache API, counting bytes as they arrive.
 * Files that are already stored count toward `onBytes` first, so a download that resumes after a
 * partial earlier one still ends at the full total instead of stalling below it. Without
 * `allowNetwork` nothing is fetched: a file that is not stored stops the load with a
 * NotCachedError. A response that is not ok, or that is an HTML page (a dev server's fallback), is
 * refused; a storage quota error from `cache.put` surfaces as `QuotaExceededError`.
 */
export async function storeFiles(options: StoreFilesOptions) {
	const { urls, cache, allowNetwork, onBytes } = options;
	const missing: string[] = [];
	let loaded = 0;
	for (const url of urls) {
		const stored = await cache.match(url);
		if (stored === undefined) missing.push(url);
		else loaded += await storedSize(stored);
	}
	// A load that may not use the network never fetches: a missing file is "not stored".
	if (missing.length > 0 && !allowNetwork) throw new NotCachedError();
	// Reported even when nothing is missing, so a Download that finds every file stored still
	// reaches the full total (the model load is then covered by the crash marker).
	onBytes(loaded);
	if (missing.length === 0) return;
	for (const url of missing) {
		const response = await options.fetch(url, { cache: "no-store" });
		const name = new URL(url).pathname;
		if (!response.ok || !response.body)
			throw new Error(`${name}: HTTP ${response.status}`);
		// A server that answers an unknown path with its app shell must not get stored as a model file.
		if (response.headers.get("content-type")?.includes("text/html"))
			throw new Error(`${name}: the server sent a web page, not the file`);
		const reader = response.body.getReader();
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value as Uint8Array<ArrayBuffer>);
			size += value.length;
			loaded += value.length;
			onBytes(loaded);
		}
		await cache.put(
			url,
			new Response(new Blob(chunks), {
				headers: {
					"content-type":
						response.headers.get("content-type") ?? "application/octet-stream",
					"content-length": String(size),
				},
			}),
		);
	}
}
