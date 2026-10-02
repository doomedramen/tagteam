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
import {
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

// The only gate on the network for the model. `init` with allowNetwork false turns it off for the
// whole load, so neither storeFiles nor the library's own lookups (env.fetch) can make a request
// even if a stored file went missing after the `filesCached()` pre-check.
let networkAllowed = false;
env.fetch = (input, init) => {
	if (!networkAllowed) return Promise.reject(new NotCachedError());
	return fetch(input, init);
};

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.arrayBuffer();
}

/**
 * Puts every file that is not stored yet (only with `allowNetwork`; otherwise a missing file stops the load) into the Cache API under the URL transformers.js looks it
 * up by, counting the bytes as they arrive. transformers.js then finds all six files in its cache
 * and makes no request of its own. Fetching them here gives one progress bar for the whole 49 MB
 * (the library reports only the model weights) and one request per file; `no-store` keeps the
 * browser's HTTP cache from keeping a second copy. A storage quota error from `cache.put`
 * surfaces as `QuotaExceededError`; an HTML answer (a dev server's fallback page) is refused.
 */
async function storeFiles(
	onBytes: (loaded: number) => void,
	allowNetwork: boolean,
) {
	if (typeof caches === "undefined") {
		if (allowNetwork) return;
		throw new NotCachedError();
	}
	const cache = await caches.open(EMOJI_CACHE_NAME);
	let loaded = 0;
	for (const path of EMOJI_STORED_PATHS) {
		const url = new URL(path, scope.location.href).href;
		if ((await cache.match(url)) !== undefined) continue;
		// A load that may not use the network never fetches: a missing file is "not stored".
		if (!allowNetwork) throw new NotCachedError();
		const response = await fetch(url, { cache: "no-store" });
		if (!response.ok || !response.body)
			throw new Error(`${path}: HTTP ${response.status}`);
		// A server that answers an unknown path with its app shell must not get stored as a model file.
		if (response.headers.get("content-type")?.includes("text/html"))
			throw new Error(`${path}: the server sent a web page, not the file`);
		const reader = response.body.getReader();
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value as Uint8Array<ArrayBuffer>);
			loaded += value.length;
			onBytes(loaded);
		}
		await cache.put(
			url,
			new Response(new Blob(chunks), {
				headers: {
					"content-type":
						response.headers.get("content-type") ?? "application/octet-stream",
				},
			}),
		);
	}
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
			await storeFiles(onBytes, allowNetwork);
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
