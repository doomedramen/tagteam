import { describe, expect, it } from "vitest";
import { rewriteOrtWasmUrls } from "./no-ort-default-wasm";

describe("rewriteOrtWasmUrls", () => {
	it("gives the default wasm URL a base that Vite cannot resolve", () => {
		const code =
			'const wasm = new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href;';
		expect(rewriteOrtWasmUrls(code)).toBe(
			'const wasm = new URL("ort-wasm-simd-threaded.asyncify.wasm", "http://wasm.invalid/").href;',
		);
	});

	it("rewrites every occurrence, with or without a space after the comma", () => {
		const code =
			'a(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url));b(new URL("ort-wasm-simd-threaded.jspi.wasm", import.meta.url));';
		const result = rewriteOrtWasmUrls(code);
		expect(result).not.toContain("import.meta.url");
		expect(result?.match(/wasm\.invalid/g)).toHaveLength(2);
	});

	it("leaves other URLs and unrelated code alone", () => {
		expect(
			rewriteOrtWasmUrls('new URL("./worker.ts", import.meta.url)'),
		).toBeNull();
		expect(rewriteOrtWasmUrls("const x = 1;")).toBeNull();
	});
});
