import type { Hono } from "hono";
import { createApp } from "../app";
import { createAuth } from "../auth";
import type { Config } from "../config";
import { type Db, openDb } from "../db/client";

export const TEST_CONFIG: Config = {
	port: 0,
	databasePath: ":memory:",
	baseUrl: "http://localhost:3000",
	authSecret: "test-secret-that-is-at-least-32-characters",
	rpId: "localhost",
	rpName: "TagTeam",
};

export interface TestContext {
	db: Db;
	app: Hono;
	/** Mutable clock injected as the app's `now`. */
	clock: { now: number };
	close: () => void;
}

export function createTestContext(): TestContext {
	const clock = { now: Date.UTC(2026, 8, 25, 12) };
	const { db, close } = openDb(":memory:");
	const auth = createAuth(db, TEST_CONFIG);
	const app = createApp({
		db,
		auth,
		trustedOrigin: TEST_CONFIG.baseUrl,
		now: () => clock.now,
	});
	return { db, app, clock, close };
}

/** Signs up a user and returns the session cookie (`name=value`) for later requests. */
export async function signUp(
	app: Hono,
	email = "sam@example.com",
	name = "Sam",
): Promise<string> {
	const res = await app.request("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: "correct-horse-battery", name }),
	});
	if (res.status !== 200)
		throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0] ?? "")
		.find((c) => c.startsWith("better-auth.session_token="));
	if (!cookie) throw new Error("sign-up returned no session cookie");
	return cookie;
}

export function api(
	app: Hono,
	cookie: string | null,
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	const allHeaders: Record<string, string> = { ...headers };
	if (cookie) allHeaders.cookie = cookie;
	if (body !== undefined) allHeaders["content-type"] = "application/json";
	return Promise.resolve(
		app.request(path, {
			method,
			headers: allHeaders,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

export const readJson = <T>(res: Response): Promise<T> =>
	res.json() as Promise<T>;
