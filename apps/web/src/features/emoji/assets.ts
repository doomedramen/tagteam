// `__EMOJI_ASSET_VERSION__` is defined by vite.config.ts and vitest.config.ts from emoji-assets.json
// (the same function scripts/fetch-emoji-assets.mjs uses to name the folder it writes).
declare const __EMOJI_ASSET_VERSION__: string;
declare const __EMOJI_DOWNLOAD_BYTES__: number;

export const EMOJI_MODEL_ID = "Xenova/bge-small-en-v1.5";
export const EMOJI_ASSET_VERSION: string = __EMOJI_ASSET_VERSION__;
/** Bytes a device downloads for this version (every model and runtime file); the denominator of the progress. */
export const EMOJI_DOWNLOAD_BYTES: number = __EMOJI_DOWNLOAD_BYTES__;
/** Where the build serves the model files; the server marks everything under /assets/ immutable. */
export const EMOJI_ASSET_BASE = `/assets/emoji/${EMOJI_ASSET_VERSION}/`;
/** transformers.js `env.localModelPath`: a path, never an absolute URL. */
export const EMOJI_MODEL_PATH = `${EMOJI_ASSET_BASE}models/`;
export const EMOJI_ORT_MJS_PATH = `${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.mjs`;
export const EMOJI_ORT_WASM_PATH = `${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.wasm`;
/** The six files a device stores for this version, as paths under the site root. */
export const EMOJI_STORED_PATHS = [
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/config.json`,
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/tokenizer.json`,
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/tokenizer_config.json`,
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/onnx/model_quantized.onnx`,
	EMOJI_ORT_MJS_PATH,
	EMOJI_ORT_WASM_PATH,
] as const;
/** Every emoji model file of every version is under this folder; the engine cleans up through it. */
export const EMOJI_ASSETS_ROOT = "/assets/emoji/";
/** The Cache API cache transformers.js keeps the model and the wasm in (`env.cacheKey`). */
export const EMOJI_CACHE_NAME = "transformers-cache";
