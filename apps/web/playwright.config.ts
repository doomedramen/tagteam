import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	use: { baseURL: BASE_URL, serviceWorkers: "allow" },
	projects: [
		{ name: "iphone", use: { ...devices["iPhone 13"], browserName: "webkit" } },
		{
			name: "chromium",
			use: { ...devices["Pixel 7"], browserName: "chromium" },
		},
	],
	webServer: {
		command: "pnpm --filter @tagteam/server start",
		url: `${BASE_URL}/api/health`,
		reuseExistingServer: false,
		env: {
			AUTH_SECRET: "e2e-secret-that-is-at-least-32-characters",
			BASE_URL,
			PORT: String(PORT),
			DATABASE_PATH: join(tmpdir(), `tagteam-e2e-${Date.now()}.db`),
			WEB_DIR: join(import.meta.dirname, "dist"),
		},
	},
});
