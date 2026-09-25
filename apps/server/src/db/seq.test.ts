import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse } from "../routes/me";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { groups, membership, profile } from "./schema";
import { currentSeq, nextSeq } from "./seq";

describe("change sequence", () => {
	let ctx: TestContext;
	beforeEach(() => {
		ctx = createTestContext();
	});
	afterEach(() => ctx.close());

	it("counts up from 1", () => {
		expect(currentSeq(ctx.db)).toBe(0);
		expect(nextSeq(ctx.db)).toBe(1);
		expect(nextSeq(ctx.db)).toBe(2);
		expect(currentSeq(ctx.db)).toBe(2);
	});

	it("stamps profile, group and membership writes", async () => {
		const sam = await signUp(ctx.app);
		await api(ctx.app, sam, "GET", "/api/me");
		const afterProfile = currentSeq(ctx.db);
		expect(afterProfile).toBeGreaterThan(0);
		expect(ctx.db.select().from(profile).get()?.seq).toBe(afterProfile);

		await api(ctx.app, sam, "POST", "/api/groups", { name: "Smiths" });
		const afterGroup = currentSeq(ctx.db);
		expect(afterGroup).toBeGreaterThan(afterProfile);
		expect(ctx.db.select().from(groups).get()?.seq).toBe(afterGroup);
		expect(ctx.db.select().from(membership).get()?.seq).toBe(afterGroup);

		await api(ctx.app, sam, "PATCH", "/api/me", { displayName: "Sammy" });
		expect(ctx.db.select().from(profile).get()?.seq).toBe(currentSeq(ctx.db));
		expect(currentSeq(ctx.db)).toBeGreaterThan(afterGroup);

		const me = await readJson<MeResponse>(
			await api(ctx.app, sam, "GET", "/api/me"),
		);
		const before = currentSeq(ctx.db);
		await api(ctx.app, sam, "POST", `/api/groups/${me.groups[0]?.id}/leave`);
		expect(ctx.db.select().from(membership).get()?.seq).toBe(
			currentSeq(ctx.db),
		);
		expect(currentSeq(ctx.db)).toBeGreaterThan(before);
	});
});
