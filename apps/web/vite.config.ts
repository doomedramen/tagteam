import { serwist } from "@serwist/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		serwist({
			swSrc: "src/sw.ts",
			swDest: "sw.js",
			globDirectory: "dist",
			globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
			injectionPoint: "self.__SW_MANIFEST",
		}),
	],
	server: {
		port: 5173,
		// The API server (apps/server) runs on 3000 in development.
		proxy: { "/api": { target: "http://localhost:3000" } },
	},
});
