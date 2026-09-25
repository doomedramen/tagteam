import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startServer } from "./server";
import { TEST_CONFIG } from "./test/harness";

it("serves the API over HTTP with a file database and rejects cookie-bearing auth requests without Origin", async () => {
	const dir = mkdtempSync(join(tmpdir(), "tagteam-"));
	const databasePath = join(dir, "data", "tagteam.db");
	const server = await startServer({ ...TEST_CONFIG, port: 0, databasePath });
	try {
		const base = `http://localhost:${server.port}`;
		expect((await fetch(`${base}/api/health`)).status).toBe(200);

		const signUpBody = JSON.stringify({
			email: "sam@example.com",
			password: "correct-horse-battery",
			name: "Sam",
		});
		const jsonHeaders = { "content-type": "application/json" };

		// Sign-up with correct origin to get a session cookie
		const signUpRes = await fetch(`${base}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { ...jsonHeaders, origin: TEST_CONFIG.baseUrl },
			body: signUpBody,
		});
		expect(signUpRes.status).toBe(200);
		const cookie = signUpRes.headers
			.getSetCookie()
			.find((c) => c.startsWith("better-auth.session_token="));
		expect(cookie).toBeDefined();
		if (!cookie) throw new Error("expected a session cookie");

		// Sign-out with cookie but no origin header (CSRF protection)
		const signOutRes = await fetch(`${base}/api/auth/sign-out`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: "{}",
		});
		expect(signOutRes.status).toBe(403);

		// Sign-out with cookie AND origin header succeeds
		const signOutWithOriginRes = await fetch(`${base}/api/auth/sign-out`, {
			method: "POST",
			headers: {
				cookie,
				"content-type": "application/json",
				origin: TEST_CONFIG.baseUrl,
			},
			body: "{}",
		});
		expect(signOutWithOriginRes.status).toBe(200);

		expect(existsSync(databasePath)).toBe(true);
	} finally {
		await server.stop();
		rmSync(dir, { recursive: true, force: true });
	}
});
