import { serwist } from "@serwist/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { noOrtDefaultWasm } from "./build-plugins/no-ort-default-wasm.ts";
import {
	assetVersion,
	downloadBytes,
	loadManifest,
} from "./scripts/emoji-assets.mjs";

// `EMOJI_SMOKE=1` builds only emoji-smoke.html into dist-smoke (see playwright.smoke.config.ts).
const smoke = process.env.EMOJI_SMOKE === "1";

export default defineConfig({
	// The folder of the emoji model files under /assets/emoji/ and the size of the download,
	// both derived from emoji-assets.json.
	define: {
		__EMOJI_ASSET_VERSION__: JSON.stringify(assetVersion(loadManifest())),
		__EMOJI_DOWNLOAD_BYTES__: JSON.stringify(downloadBytes(loadManifest())),
	},
	plugins: [
		react(),
		tailwindcss(),
		...(smoke
			? []
			: [
					serwist({
						swSrc: "src/sw.ts",
						swDest: "sw.js",
						globDirectory: "dist",
						globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,bin}"],
						injectionPoint: "self.__SW_MANIFEST",
					}),
				]),
	],
	// The emoji worker imports transformers.js, which code-splits, so workers are built as ES modules.
	worker: { format: "es", plugins: () => [noOrtDefaultWasm()] },
	build: smoke
		? {
				outDir: "dist-smoke",
				rollupOptions: { input: { "emoji-smoke": "emoji-smoke.html" } },
			}
		: {},
	resolve: {
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	server: {
		port: 5173,
		// The API server (apps/server) runs on 3000 in development.
		proxy: { "/api": { target: "http://localhost:3000" } },
	},
});
