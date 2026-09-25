import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profile } from "./db/schema";
import type { ErrorBody } from "./http/errors";
import type { MeResponse } from "./routes/me";
import { AVATAR_COLORS } from "./services/profiles";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "./test/harness";

describe("server foundation", () => {
	let ctx: TestContext;
	beforeEach(() => {
		ctx = createTestContext();
	});
	afterEach(() => ctx.close());

	it("reports health without auth", async () => {
		const res = await ctx.app.request("/api/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("rejects unauthenticated API calls", async () => {
		const res = await api(ctx.app, null, "GET", "/api/me");
		expect(res.status).toBe(401);
		expect(await readJson<ErrorBody>(res)).toEqual({
			error: { code: "unauthorized", message: "Sign in first." },
		});
	});

	it("returns JSON 404 for unknown API paths", async () => {
		const cookie = await signUp(ctx.app);
		const res = await api(ctx.app, cookie, "GET", "/api/nope");
		expect(res.status).toBe(404);
		expect(await readJson<ErrorBody>(res)).toEqual({
			error: { code: "not_found", message: "Not found." },
		});
	});

	it("creates a profile once, on the first authenticated call", async () => {
		const cookie = await signUp(ctx.app, "sam@example.com", "Sam");
		const res = await api(ctx.app, cookie, "GET", "/api/me");
		expect(res.status).toBe(200);
		const body = await readJson<MeResponse>(res);
		expect(body.user).toMatchObject({ email: "sam@example.com", name: "Sam" });
		expect(body.profile).toEqual({
			displayName: "Sam",
			avatarColor: expect.any(String),
			timezone: "UTC",
			activeGroupId: null,
		});
		expect(AVATAR_COLORS).toContain(body.profile.avatarColor);
		expect(body.groups).toEqual([]);

		await api(ctx.app, cookie, "GET", "/api/me");
		expect(ctx.db.select().from(profile).all()).toHaveLength(1);
	});

	it("serves passkey endpoints backed by the passkey table", async () => {
		const cookie = await signUp(ctx.app);
		const res = await api(
			ctx.app,
			cookie,
			"GET",
			"/api/auth/passkey/list-user-passkeys",
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("returns JSON error for unhandled exceptions in routes", async () => {
		const cookie = await signUp(ctx.app);
		// Close the database to force an exception when the route tries to query
		ctx.close();
		// Spy on console.error to keep test output clean, verify it was called
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await api(ctx.app, cookie, "GET", "/api/me");
		expect(res.status).toBe(500);
		expect(await readJson<ErrorBody>(res)).toEqual({
			error: {
				code: "internal_error",
				message: "Something went wrong. Try again.",
			},
		});
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
		// Do not call ctx.close() again in afterEach since we already closed it
	});
});
