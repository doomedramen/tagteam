import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { groups, membership } from "../db/schema";
import type { ErrorBody } from "../http/errors";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import type { MeResponse } from "./me";

describe("PATCH /api/me", () => {
	let ctx: TestContext;
	let cookie: string;
	let userId: string;

	beforeEach(async () => {
		ctx = createTestContext();
		cookie = await signUp(ctx.app, "sam@example.com", "Sam");
		userId = (
			await readJson<MeResponse>(await api(ctx.app, cookie, "GET", "/api/me"))
		).user.id;
	});
	afterEach(() => ctx.close());

	const addGroup = (id: string, memberId: string | null) => {
		ctx.db
			.insert(groups)
			.values({ id, name: id, createdBy: userId, createdAt: ctx.clock.now })
			.run();
		if (memberId) {
			ctx.db
				.insert(membership)
				.values({
					groupId: id,
					userId: memberId,
					role: "member",
					joinedAt: ctx.clock.now,
				})
				.run();
		}
	};

	it("updates display name, colour and timezone", async () => {
		const res = await api(ctx.app, cookie, "PATCH", "/api/me", {
			displayName: "  Sammy  ",
			avatarColor: "teal",
			timezone: "Europe/London",
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			profile: {
				displayName: "Sammy",
				avatarColor: "teal",
				timezone: "Europe/London",
				activeGroupId: null,
			},
		});
		const me = await readJson<MeResponse>(
			await api(ctx.app, cookie, "GET", "/api/me"),
		);
		expect(me.profile.displayName).toBe("Sammy");
	});

	it("lists every problem and changes nothing when invalid", async () => {
		const res = await api(ctx.app, cookie, "PATCH", "/api/me", {
			displayName: "",
			avatarColor: "neon",
			timezone: "Mars/Base",
			nickname: "x",
		});
		expect(res.status).toBe(400);
		expect(await readJson<ErrorBody>(res)).toEqual({
			error: {
				code: "invalid_request",
				message: "Check the highlighted fields.",
				details: [
					"displayName must be 1-40 characters",
					"avatarColor must be one of: blue, green, amber, coral, purple, teal, pink, gray",
					"timezone must be an IANA zone",
					"unknown field: nickname",
				],
			},
		});
		const me = await readJson<MeResponse>(
			await api(ctx.app, cookie, "GET", "/api/me"),
		);
		expect(me.profile.displayName).toBe("Sam");
	});

	it("only switches to a group you actively belong to", async () => {
		addGroup("mine", userId);
		addGroup("theirs", null);

		const ok = await api(ctx.app, cookie, "PATCH", "/api/me", {
			activeGroupId: "mine",
		});
		expect(ok.status).toBe(200);
		expect(
			(await readJson<{ profile: { activeGroupId: string } }>(ok)).profile
				.activeGroupId,
		).toBe("mine");

		const bad = await api(ctx.app, cookie, "PATCH", "/api/me", {
			activeGroupId: "theirs",
		});
		expect(bad.status).toBe(400);
		expect((await readJson<ErrorBody>(bad)).error.details).toEqual([
			"activeGroupId must be a group you belong to",
		]);

		const cleared = await api(ctx.app, cookie, "PATCH", "/api/me", {
			activeGroupId: null,
		});
		expect(
			(await readJson<{ profile: { activeGroupId: null } }>(cleared)).profile
				.activeGroupId,
		).toBeNull();
	});

	it("rejects bodies that are not JSON objects", async () => {
		const res = await api(ctx.app, cookie, "PATCH", "/api/me", ["displayName"]);
		expect(res.status).toBe(400);
		expect((await readJson<ErrorBody>(res)).error.details).toEqual([
			"body must be a JSON object",
		]);
	});
});
