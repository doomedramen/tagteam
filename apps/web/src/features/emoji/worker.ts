// Task 1 smoke version: proves the library loads and runs inside a Vite-built module worker.
// Task 4 replaces this file with the real worker.
import { env, pipeline } from "@huggingface/transformers";

const BASE = "/assets/emoji/smoke/";

env.allowLocalModels = true;
env.allowRemoteModels = false;
// A path, not an absolute URL: with a URL transformers.js 4.3 skips its local-file probe and
// reports the tokenizer as missing.
env.localModelPath = `${BASE}models/`;
env.useBrowserCache = typeof caches !== "undefined";
// Without this the library fetches its 27 MB default wasm from a CDN.
const ortWasm = env.backends.onnx.wasm;
if (!ortWasm) throw new Error("onnxruntime-web is not available");
ortWasm.wasmPaths = {
	mjs: new URL(`${BASE}ort/ort-wasm-simd-threaded.mjs`, self.location.href)
		.href,
	wasm: new URL(`${BASE}ort/ort-wasm-simd-threaded.wasm`, self.location.href)
		.href,
};

interface Scope {
	onmessage: ((event: MessageEvent<{ text: string }>) => void) | null;
	postMessage(message: unknown): void;
}
const scope = self as unknown as Scope;

scope.onmessage = async (event) => {
	try {
		const extractor = await pipeline(
			"feature-extraction",
			"Xenova/bge-small-en-v1.5",
			{
				dtype: "q8",
				device: "wasm",
			},
		);
		const output = await extractor(event.data.text, {
			pooling: "cls",
			normalize: true,
		});
		const vector = Array.from(output.data as Float32Array);
		scope.postMessage({
			ok: true,
			libraryVersion: env.version,
			length: vector.length,
			norm: Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)),
		});
	} catch (error) {
		scope.postMessage({
			ok: false,
			libraryVersion: env.version,
			name: error instanceof Error ? error.name : "unknown",
			message: String(error),
		});
	}
};
