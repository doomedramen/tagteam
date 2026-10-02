import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	test: {
		environment: "jsdom",
		// Interaction-heavy sheet tests make many sequential userEvent calls and slow down under parallel CPU load.
		testTimeout: 15_000,
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.test.{ts,tsx}", "build-plugins/**/*.test.ts"],
	},
});
