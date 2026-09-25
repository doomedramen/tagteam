import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ErrorBody } from "../http/errors";
import { INVITE_TTL_MS } from "../services/invites";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import type { MeResponse } from "./me";

describe("invites", () => {
	let ctx: TestContext;
	let sam: string;
	let jo: string;
	let groupId: string;

	beforeEach(async () => {
		ctx = createTestContext();
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
		jo = await signUp(ctx.app, "jo@example.com", "Jo");
		const res = await api(ctx.app, sam, "POST", "/api/groups", {
			name: "Smiths",
		});
		groupId = (await readJson<{ group: { id: string } }>(res)).group.id;
	});
	afterEach(() => ctx.close());

	const invite = async (cookie = sam) => {
		const res = await api(
			ctx.app,
			cookie,
			"POST",
			`/api/groups/${groupId}/invites`,
		);
		expect(res.status).toBe(201);
		return readJson<{ code: string; expiresAt: number }>(res);
	};
	const redeem = (
		cookie: string,
		code: string,
		headers: Record<string, string> = {},
	) => api(ctx.app, cookie, "POST", "/api/invites/redeem", { code }, headers);
	const pending = async (cookie = sam) =>
		(
			await readJson<{ invites: { code: string }[] }>(
				await api(ctx.app, cookie, "GET", `/api/groups/${groupId}/invites`),
			)
		).invites;

	it("issues a 6-digit code that expires in 7 days", async () => {
		const created = await invite();
		expect(created.code).toMatch(/^\d{6}$/);
		expect(created.expiresAt).toBe(ctx.clock.now + INVITE_TTL_MS);
		expect((await pending()).map((i) => i.code)).toEqual([created.code]);
	});

	it("only lets members create or list invites", async () => {
		expect(
			(await api(ctx.app, jo, "POST", `/api/groups/${groupId}/invites`)).status,
		).toBe(404);
		expect(
			(await api(ctx.app, jo, "GET", `/api/groups/${groupId}/invites`)).status,
		).toBe(404);
	});

	it("joins the group once and switches to it", async () => {
		const { code } = await invite();
		const res = await redeem(jo, code);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			group: { id: groupId, name: "Smiths" },
		});

		const me = await readJson<MeResponse>(
			await api(ctx.app, jo, "GET", "/api/me"),
		);
		expect(me.groups).toEqual([
			{ id: groupId, name: "Smiths", role: "member", joinedAt: ctx.clock.now },
		]);
		expect(me.profile.activeGroupId).toBe(groupId);

		const again = await redeem(jo, code);
		expect(again.status).toBe(404);
		expect((await readJson<ErrorBody>(again)).error.code).toBe("invalid_code");
		expect(await pending()).toEqual([]);
	});

	it("does not consume the code when the caller is already a member", async () => {
		const { code } = await invite();
		const res = await redeem(sam, code);
		expect(res.status).toBe(409);
		expect((await readJson<ErrorBody>(res)).error.code).toBe("already_member");
		expect((await pending()).map((i) => i.code)).toEqual([code]);
	});

	it("rejects expired codes", async () => {
		const { code } = await invite();
		ctx.clock.now += INVITE_TTL_MS;
		expect((await redeem(jo, code)).status).toBe(404);
	});

	it("lets the creator revoke a pending code", async () => {
		const { code } = await invite();
		expect(
			(await api(ctx.app, jo, "DELETE", `/api/invites/${code}`)).status,
		).toBe(404);
		expect(
			(await api(ctx.app, sam, "DELETE", `/api/invites/${code}`)).status,
		).toBe(204);
		expect(
			(await api(ctx.app, sam, "DELETE", `/api/invites/${code}`)).status,
		).toBe(404);
		expect((await redeem(jo, code)).status).toBe(404);
	});

	it("lets a former member rejoin with a new code", async () => {
		await redeem(jo, (await invite()).code);
		expect(
			(await api(ctx.app, jo, "POST", `/api/groups/${groupId}/leave`)).status,
		).toBe(204);
		ctx.clock.now += 1000;
		expect((await redeem(jo, (await invite()).code)).status).toBe(200);
		const me = await readJson<MeResponse>(
			await api(ctx.app, jo, "GET", "/api/me"),
		);
		expect(me.groups).toEqual([
			{ id: groupId, name: "Smiths", role: "member", joinedAt: ctx.clock.now },
		]);
	});

	it("rate limits redeem attempts per user", async () => {
		const { code } = await invite();
		for (let i = 0; i < 5; i++)
			expect((await redeem(jo, "nope")).status).toBe(404);
		const blocked = await redeem(jo, code);
		expect(blocked.status).toBe(429);
		expect((await readJson<ErrorBody>(blocked)).error.code).toBe(
			"rate_limited",
		);

		ctx.clock.now += 61_000;
		expect((await redeem(jo, code)).status).toBe(200);
	});

	it("ignores client IP headers when rate limiting", async () => {
		const { code } = await invite();
		for (let i = 0; i < 5; i++) {
			await redeem(jo, "nope", {
				"cf-connecting-ip": `203.0.113.${i}`,
				"x-forwarded-for": `198.51.100.${i}`,
			});
		}
		expect(
			(await redeem(jo, code, { "cf-connecting-ip": "203.0.113.99" })).status,
		).toBe(429);

		const kim = await signUp(ctx.app, "kim@example.com", "Kim");
		expect((await redeem(kim, code)).status).toBe(200);
	});
});
