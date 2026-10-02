import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "./server";
import { TEST_CONFIG } from "./test/harness";

describe("static web app", () => {
	let dir: string;
	let server: RunningServer;
	let base: string;
	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "tagteam-web-"));
		mkdirSync(join(dir, "assets", "emoji", "v1"), { recursive: true });
		writeFileSync(join(dir, "index.html"), '<div id="root"></div>');
		writeFileSync(join(dir, "assets", "app.js"), "export {};");
		writeFileSync(join(dir, "assets", "emoji", "v1", "config.json"), "{}");
		server = await startServer({
			...TEST_CONFIG,
			port: 0,
			webDir: dir,
			databasePath: join(dir, "tagteam.db"),
		});
		base = `http://localhost:${server.port}`;
	});
	afterEach(async () => {
		await server.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	it("serves files under /assets/ as immutable", async () => {
		for (const path of ["/assets/app.js", "/assets/emoji/v1/config.json"]) {
			const res = await fetch(`${base}${path}`);
			expect(res.status, path).toBe(200);
			expect(res.headers.get("cache-control"), path).toBe(
				"public, max-age=31536000, immutable",
			);
		}
	});

	it("answers 404, not the app shell, for a missing file under /assets/", async () => {
		// A model file served as index.html would be cached by the browser as if it were the model.
		const res = await fetch(`${base}/assets/emoji/v1/missing.onnx`);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).not.toContain("text/html");
	});

	it("serves the app shell with no-cache for other paths", async () => {
		const res = await fetch(`${base}/today`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(await res.text()).toContain('id="root"');
	});
});
