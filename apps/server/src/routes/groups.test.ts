import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { membership } from "../db/schema";
import type { ErrorBody } from "../http/errors";
import type { Member } from "../services/groups";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import type { MeResponse } from "./me";

describe("groups", () => {
	let ctx: TestContext;
	let sam: string;

	beforeEach(async () => {
		ctx = createTestContext();
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
	});
	afterEach(() => ctx.close());

	const me = async (cookie: string) =>
		readJson<MeResponse>(await api(ctx.app, cookie, "GET", "/api/me"));
	const create = async (cookie: string, name: string) =>
		readJson<{ group: { id: string; name: string } }>(
			await api(ctx.app, cookie, "POST", "/api/groups", { name }),
		);

	it("creates a group, makes the creator admin, and activates it", async () => {
		const res = await api(ctx.app, sam, "POST", "/api/groups", {
			name: "  Smith family ",
		});
		expect(res.status).toBe(201);
		const { group } = await readJson<{ group: { id: string; name: string } }>(
			res,
		);
		expect(group.name).toBe("Smith family");

		const body = await me(sam);
		expect(body.groups).toEqual([
			{
				id: group.id,
				name: "Smith family",
				role: "admin",
				joinedAt: ctx.clock.now,
			},
		]);
		expect(body.profile.activeGroupId).toBe(group.id);
	});

	it("validates the group name", async () => {
		const res = await api(ctx.app, sam, "POST", "/api/groups", { name: "   " });
		expect(res.status).toBe(400);
		expect((await readJson<ErrorBody>(res)).error.details).toEqual([
			"name must be 1-40 characters",
		]);
	});

	it("lists members only to members", async () => {
		const { group } = await create(sam, "Smiths");
		const jo = await signUp(ctx.app, "jo@example.com", "Jo");
		expect(
			(await api(ctx.app, jo, "GET", `/api/groups/${group.id}/members`)).status,
		).toBe(404);

		const joId = (await me(jo)).user.id;
		ctx.clock.now += 1000;
		ctx.db
			.insert(membership)
			.values({
				groupId: group.id,
				userId: joId,
				role: "member",
				joinedAt: ctx.clock.now,
			})
			.run();

		const res = await api(
			ctx.app,
			jo,
			"GET",
			`/api/groups/${group.id}/members`,
		);
		expect(res.status).toBe(200);
		const { members } = await readJson<{ members: Member[] }>(res);
		expect(members.map((m) => [m.displayName, m.role])).toEqual([
			["Sam", "admin"],
			["Jo", "member"],
		]);
	});

	it("leaving moves the active group to the earliest remaining one", async () => {
		const first = (await create(sam, "First")).group;
		ctx.clock.now += 1000;
		const second = (await create(sam, "Second")).group;
		expect((await me(sam)).profile.activeGroupId).toBe(second.id);

		expect(
			(await api(ctx.app, sam, "POST", `/api/groups/${second.id}/leave`))
				.status,
		).toBe(204);
		let body = await me(sam);
		expect(body.groups.map((g) => g.id)).toEqual([first.id]);
		expect(body.profile.activeGroupId).toBe(first.id);

		expect(
			(await api(ctx.app, sam, "POST", `/api/groups/${first.id}/leave`)).status,
		).toBe(204);
		body = await me(sam);
		expect(body.groups).toEqual([]);
		expect(body.profile.activeGroupId).toBeNull();

		expect(
			(await api(ctx.app, sam, "POST", `/api/groups/${first.id}/leave`)).status,
		).toBe(404);
	});

	it("returns 404 for groups that do not exist", async () => {
		expect(
			(await api(ctx.app, sam, "GET", "/api/groups/nope/members")).status,
		).toBe(404);
		expect(
			(await api(ctx.app, sam, "POST", "/api/groups/nope/leave")).status,
		).toBe(404);
	});
});
