// The emoji worker: loads bge-small-en-v1.5 (q8) with transformers.js from same-origin files, then
// answers `rank` requests with the nearest emoji (sign-bit shortlist, int8 re-rank).
// The library is imported here and nowhere else.
import { env, pipeline } from "@huggingface/transformers";
import {
	EMOJI_CACHE_NAME,
	EMOJI_MODEL_ID,
	EMOJI_MODEL_PATH,
	EMOJI_ORT_MJS_PATH,
	EMOJI_ORT_WASM_PATH,
	EMOJI_STORED_PATHS,
} from "./assets";
import bitsUrl from "./index/bits.bin?url";
import int8Url from "./index/int8.bin?url";
import { storeFiles } from "./store-files";
import {
	createNetworkGuard,
	createWorkerCore,
	NotCachedError,
	type WorkerDeps,
} from "./worker-core";
import type { WorkerReply, WorkerRequest } from "./worker-protocol";

interface Scope {
	location: { href: string };
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
	postMessage(message: WorkerReply): void;
}
const scope = self as unknown as Scope;
const realFetch = self.fetch.bind(self);

// Nothing may leave this origin: the model is the one in the image, never Hugging Face.
env.allowLocalModels = true;
env.allowRemoteModels = false;
// A path, not an absolute URL: with a URL transformers.js 4.3 skips its local-file probe and
// reports the tokenizer as missing.
env.localModelPath = EMOJI_MODEL_PATH;
// The Cache API keeps the model between visits ("transformers-cache"); absent on insecure origins.
env.useBrowserCache = typeof caches !== "undefined";
env.cacheKey = EMOJI_CACHE_NAME;
// Without this the library fetches its 27 MB default wasm from a CDN.
const ortWasm = env.backends.onnx.wasm;
if (!ortWasm) throw new Error("onnxruntime-web is not available");
ortWasm.wasmPaths = {
	mjs: new URL(EMOJI_ORT_MJS_PATH, scope.location.href).href,
	wasm: new URL(EMOJI_ORT_WASM_PATH, scope.location.href).href,
};

// What is and is not guaranteed about the network. While a load runs without `allowNetwork`
// (`networkAllowed` false) every `fetch` for a path under /assets/emoji/ is rejected with a
// NotCachedError, on both `env.fetch` (transformers.js's own fetches, including its wasm/mjs
// pre-load, which on a failure falls back to ORT's own loading) and `self.fetch` (ORT's fallback
// fetch of the wasm). Not guarded: ORT's fallback `import()` of the runtime .mjs, which a worker
// cannot intercept. `storeFiles` therefore checks, before the library is called, that all six
// files (the .mjs and .wasm included) are in the cache and answers `uncached` otherwise; the
// library then finds them in the cache and falls back to nothing. The one residual window is a
// file evicted by the browser between that check and the library's own cache lookup.
let networkAllowed = false;
const guardedFetch = createNetworkGuard(
	(input, init) => realFetch(input, init),
	scope.location.href,
	() => networkAllowed,
);
env.fetch = guardedFetch;
self.fetch = guardedFetch;

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.arrayBuffer();
}

const createExtractor = () =>
	pipeline("feature-extraction", EMOJI_MODEL_ID, {
		dtype: "q8",
		device: "wasm",
	});

const deps: WorkerDeps = {
	async filesCached() {
		try {
			if (typeof caches === "undefined") return false;
			const cache = await caches.open(EMOJI_CACHE_NAME);
			for (const path of EMOJI_STORED_PATHS)
				if (
					(await cache.match(new URL(path, scope.location.href).href)) ===
					undefined
				)
					return false;
			return true;
		} catch {
			return false;
		}
	},
	async loadIndex() {
		const [bits, int8] = await Promise.all([
			fetchBytes(bitsUrl),
			fetchBytes(int8Url),
		]);
		return { bits: new Uint8Array(bits), int8: new Int8Array(int8) };
	},
	async loadEmbedder(onBytes, { allowNetwork }) {
		networkAllowed = allowNetwork;
		let extractor: Awaited<ReturnType<typeof createExtractor>>;
		try {
			if (typeof caches === "undefined") {
				if (!allowNetwork) throw new NotCachedError();
			} else {
				await storeFiles({
					urls: EMOJI_STORED_PATHS.map(
						(path) => new URL(path, scope.location.href).href,
					),
					cache: await caches.open(EMOJI_CACHE_NAME),
					fetch: guardedFetch,
					allowNetwork,
					onBytes,
				});
			}
			extractor = await createExtractor();
		} finally {
			networkAllowed = false;
		}
		return {
			async embed(text) {
				const output = await extractor(text, {
					pooling: "cls",
					normalize: true,
				});
				return Float32Array.from(output.data as Float32Array);
			},
		};
	},
	isOnline: () => navigator.onLine,
	post: (reply) => scope.postMessage(reply),
};

const handle = createWorkerCore(deps);
scope.onmessage = (event) => void handle(event.data);
scope.onunhandledrejection = (event) =>
	deps.post({
		type: "error",
		id: null,
		kind: "runtime",
		message: String(event.reason),
	});
