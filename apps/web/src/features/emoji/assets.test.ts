import { describe, expect, it } from "vitest";
import {
	assetVersion,
	downloadBytes,
	loadManifest,
} from "../../../scripts/emoji-assets.mjs";
import {
	EMOJI_ASSET_BASE,
	EMOJI_ASSET_VERSION,
	EMOJI_DOWNLOAD_BYTES,
	EMOJI_MODEL_ID,
	EMOJI_MODEL_PATH,
	EMOJI_ORT_MJS_PATH,
	EMOJI_ORT_WASM_PATH,
	EMOJI_STORED_PATHS,
} from "./assets";

describe("emoji asset paths", () => {
	const manifest = loadManifest();

	it("uses the version derived from the manifest", () => {
		expect(EMOJI_ASSET_VERSION).toBe(assetVersion(manifest));
		expect(EMOJI_ASSET_VERSION).toMatch(/^[0-9a-f]{12}$/);
	});

	it("serves everything from one immutable folder", () => {
		expect(EMOJI_ASSET_BASE).toBe(`/assets/emoji/${EMOJI_ASSET_VERSION}/`);
		expect(EMOJI_MODEL_PATH).toBe(`${EMOJI_ASSET_BASE}models/`);
		expect(EMOJI_ORT_MJS_PATH).toBe(
			`${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.mjs`,
		);
		expect(EMOJI_ORT_WASM_PATH).toBe(
			`${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.wasm`,
		);
	});

	it("lists the six stored files and the download size from the manifest", () => {
		expect(EMOJI_STORED_PATHS).toHaveLength(6);
		for (const path of EMOJI_STORED_PATHS)
			expect(path.startsWith(EMOJI_ASSET_BASE)).toBe(true);
		expect(EMOJI_DOWNLOAD_BYTES).toBe(downloadBytes(manifest));
		expect(EMOJI_DOWNLOAD_BYTES).toBeGreaterThan(49_000_000);
	});

	it("names the model the manifest pins", () => {
		expect(EMOJI_MODEL_ID).toBe(manifest.model.id);
	});
});
