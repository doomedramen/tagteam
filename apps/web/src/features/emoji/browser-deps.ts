import { EMOJI_ASSET_VERSION, EMOJI_DOWNLOAD_BYTES } from "./assets";
import { deleteEmojiCache } from "./cache";
import { loadCatalog } from "./catalog";
import {
	createEmojiController,
	type EmojiController,
	type WorkerLike,
} from "./controller";
import { createLocalStorageEngineStorage } from "./engine-storage";
import { detectSupport } from "./support";

let shared: EmojiController | null = null;

/**
 * The app's one emoji controller. It is created on first use and lives for the whole app start,
 * so React's double-mounting in development cannot run its startup bookkeeping twice.
 */
export function getBrowserEmojiController(): EmojiController {
	shared ??= createEmojiController({
		version: EMOJI_ASSET_VERSION,
		downloadBytes: EMOJI_DOWNLOAD_BYTES,
		storage: createLocalStorageEngineStorage(),
		// The `new Worker(new URL(...), { type: "module" })` form is what Vite bundles.
		createWorker: () =>
			new Worker(new URL("./worker.ts", import.meta.url), {
				type: "module",
			}) as unknown as WorkerLike,
		loadCatalog,
		supported: () => detectSupport(),
		deleteCaches: (scope) => deleteEmojiCache(scope, EMOJI_ASSET_VERSION),
	});
	return shared;
}
