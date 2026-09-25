import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startServer } from "./server";
import { TEST_CONFIG } from "./test/harness";

it("serves the API over HTTP with a file database and enforces Origin on auth", async () => {
	const dir = mkdtempSync(join(tmpdir(), "tagteam-"));
	const databasePath = join(dir, "data", "tagteam.db");
	const server = await startServer({ ...TEST_CONFIG, port: 0, databasePath });
	try {
		const base = `http://localhost:${server.port}`;
		expect((await fetch(`${base}/api/health`)).status).toBe(200);

		const body = JSON.stringify({
			email: "sam@example.com",
			password: "correct-horse-battery",
			name: "Sam",
		});
		const headers = { "content-type": "application/json" };
		const withOrigin = await fetch(`${base}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { ...headers, origin: TEST_CONFIG.baseUrl },
			body,
		});
		expect(withOrigin.status).toBe(200);
		expect(existsSync(databasePath)).toBe(true);

		const signInBody = JSON.stringify({
			email: "sam@example.com",
			password: "correct-horse-battery",
		});
		const noOrigin = await fetch(`${base}/api/auth/sign-in/email`, {
			method: "POST",
			headers,
			body: signInBody,
		});
		expect(noOrigin.status).toBe(403);
	} finally {
		await server.stop();
		rmSync(dir, { recursive: true, force: true });
	}
});
