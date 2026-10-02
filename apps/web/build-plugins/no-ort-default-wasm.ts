import type { Plugin } from "vite";

// transformers.js bundles onnxruntime-web, which names its default 27 MB wasm file with
// `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url)`. Vite turns every such
// expression into an emitted asset, which would put that file in dist/ and in the Docker image
// although the app never loads it (the worker points `wasmPaths` at the plain 14 MB runtime
// that scripts/fetch-emoji-assets.mjs copies into public/). Giving the expression a base Vite
// cannot resolve keeps the string in the bundle and the file out of the build.
const ORT_WASM_URL =
	/new URL\(("ort-wasm-[a-z.-]+\.wasm"),\s*import\.meta\.url\)/g;

/** Rewrites each ORT default-wasm URL so Vite does not emit the file. Returns null when nothing matched. */
export function rewriteOrtWasmUrls(code: string): string | null {
	if (!code.includes("ort-wasm-")) return null;
	const rewritten = code.replace(
		ORT_WASM_URL,
		'new URL($1, "http://wasm.invalid/")',
	);
	return rewritten === code ? null : rewritten;
}

export function noOrtDefaultWasm(): Plugin {
	return {
		name: "tagteam:no-ort-default-wasm",
		enforce: "pre",
		transform(code, id) {
			if (
				!id.includes("/onnxruntime-web/") &&
				!id.includes("/@huggingface/transformers/")
			)
				return null;
			const rewritten = rewriteOrtWasmUrls(code);
			return rewritten === null ? null : { code: rewritten, map: null };
		},
	};
}
