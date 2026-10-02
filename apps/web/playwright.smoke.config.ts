import { defineConfig, devices } from "@playwright/test";

const BUILD_URL = "http://localhost:4175";
const DEV_URL = "http://localhost:4176";

// Smoke test for the emoji worker: the production build (preview server) in Chromium and WebKit,
// and the dev server in Chromium. Run with `pnpm --filter @tagteam/web smoke:emoji-worker`.
export default defineConfig({
	testDir: "e2e-smoke",
	timeout: 90_000,
	projects: [
		{
			name: "build-chromium",
			use: {
				...devices["Pixel 7"],
				browserName: "chromium",
				baseURL: BUILD_URL,
			},
		},
		{
			name: "build-webkit",
			use: {
				...devices["iPhone 13"],
				browserName: "webkit",
				baseURL: BUILD_URL,
			},
		},
		{
			name: "dev-chromium",
			use: { ...devices["Pixel 7"], browserName: "chromium", baseURL: DEV_URL },
		},
	],
	webServer: [
		{
			command: "pnpm exec vite preview --port 4175 --strictPort",
			url: `${BUILD_URL}/emoji-smoke.html`,
			env: { EMOJI_SMOKE: "1" },
			reuseExistingServer: false,
		},
		{
			command: "pnpm exec vite --port 4176 --strictPort",
			url: `${DEV_URL}/emoji-smoke.html`,
			env: { EMOJI_SMOKE: "1" },
			reuseExistingServer: false,
		},
	],
});
