import { EMOJI_ASSETS_ROOT, EMOJI_CACHE_NAME } from "./assets";

/**
 * Which Cache API entries to delete. Entries are the model and wasm files transformers.js stored,
 * keyed by their URL under /assets/emoji/<version>/.
 * - `otherVersions`: everything except `version` (cleanup after an update).
 * - `thisVersion`: only `version` (the stored model is corrupt; the next start downloads it again).
 * - `all`: every version (the person switched emoji suggestions off).
 */
export type CacheScope = "otherVersions" | "thisVersion" | "all";

export async function deleteEmojiCache(
	scope: CacheScope,
	version: string,
	storage: CacheStorage | undefined = typeof caches === "undefined"
		? undefined
		: caches,
): Promise<void> {
	if (!storage || !(await storage.has(EMOJI_CACHE_NAME))) return;
	const cache = await storage.open(EMOJI_CACHE_NAME);
	const own = `${EMOJI_ASSETS_ROOT}${version}/`;
	for (const request of await cache.keys()) {
		const path = new URL(request.url).pathname;
		if (!path.startsWith(EMOJI_ASSETS_ROOT)) continue;
		const isOwn = path.startsWith(own);
		if (
			scope === "all" ||
			(scope === "thisVersion" && isOwn) ||
			(scope === "otherVersions" && !isOwn)
		)
			await cache.delete(request);
	}
}
