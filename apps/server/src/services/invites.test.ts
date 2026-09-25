import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { user } from "../db/schema";
import { createTestContext, type TestContext } from "../test/harness";
import { createGroup } from "./groups";
import { createInvite, INVITE_TTL_MS, MAX_PENDING_INVITES } from "./invites";

describe("createInvite", () => {
	let ctx: TestContext;
	let groupId: string;
	const now = Date.UTC(2026, 8, 25, 12);

	beforeEach(() => {
		ctx = createTestContext();
		ctx.db
			.insert(user)
			.values({
				id: "u1",
				name: "Sam",
				email: "sam@example.com",
				createdAt: new Date(now),
				updatedAt: new Date(now),
			})
			.run();
		groupId = createGroup(ctx.db, "u1", "Smiths", now).id;
	});
	afterEach(() => ctx.close());

	const sequence =
		(...values: number[]) =>
		() =>
			values.shift() ?? 999_999;

	it("zero-pads codes and expires them after 7 days", () => {
		expect(createInvite(ctx.db, groupId, "u1", now, sequence(42))).toEqual({
			code: "000042",
			expiresAt: now + INVITE_TTL_MS,
		});
	});

	it("never issues a code that is already pending", () => {
		createInvite(ctx.db, groupId, "u1", now, sequence(42));
		expect(
			createInvite(ctx.db, groupId, "u1", now, sequence(42, 42, 43))?.code,
		).toBe("000043");
	});

	it("reissues a code once the old one has expired", () => {
		createInvite(ctx.db, groupId, "u1", now, sequence(42));
		const later = now + INVITE_TTL_MS + 1;
		expect(createInvite(ctx.db, groupId, "u1", later, sequence(42))?.code).toBe(
			"000042",
		);
	});

	it("caps pending codes per creator", () => {
		for (let i = 0; i < MAX_PENDING_INVITES; i++)
			expect(
				createInvite(ctx.db, groupId, "u1", now, sequence(i)),
			).not.toBeNull();
		expect(createInvite(ctx.db, groupId, "u1", now, sequence(500))).toBeNull();
	});
});
