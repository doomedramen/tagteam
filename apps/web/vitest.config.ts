import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import {
	assetVersion,
	downloadBytes,
	loadManifest,
} from "./scripts/emoji-assets.mjs";

export default defineConfig({
	// The folder of the emoji model files under /assets/emoji/ and the size of the download,
	// both derived from emoji-assets.json.
	define: {
		__EMOJI_ASSET_VERSION__: JSON.stringify(assetVersion(loadManifest())),
		__EMOJI_DOWNLOAD_BYTES__: JSON.stringify(downloadBytes(loadManifest())),
	},
	plugins: [react()],
	resolve: {
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	test: {
		environment: "jsdom",
		// Interaction-heavy sheet tests make many sequential userEvent calls and slow down under parallel CPU load.
		testTimeout: 15_000,
		setupFiles: ["./src/test/setup.ts"],
		include: [
			"src/**/*.test.{ts,tsx}",
			"build-plugins/**/*.test.ts",
			"scripts/**/*.test.ts",
		],
	},
});
