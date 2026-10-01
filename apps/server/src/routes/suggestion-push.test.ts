import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	notificationLog,
	notificationSettings,
	pushSubscription,
} from "../db/schema";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, push, userIdOf } from "../test/sync-helpers";

describe("suggestion push notifications over sync", () => {
	const send = vi.fn(async (_subscription: unknown, _payload: string) => {});
	let ctx: TestContext;
	let sam: string;
	let jo: string;
	let groupId: string;

	const create = (suggestionId: string, toUserId: string) =>
		mutation(
			"suggestion.create",
			{
				suggestionId,
				groupId,
				toUserId,
				title: "Wash dishes",
				notes: null,
				startDate: "2026-10-01",
				dueTime: null,
				rule: null,
			},
			ctx.clock.now,
		);
	const payload = (call: number) =>
		JSON.parse(send.mock.calls[call]?.[1] ?? "{}") as Record<string, string>;
	const endpoint = (call: number) =>
		(send.mock.calls[call]?.[0] as { endpoint: string } | undefined)?.endpoint;

	beforeEach(async () => {
		send.mockClear();
		ctx = createTestContext({ push: { publicKey: "test", send } });
		sam = await signUp(ctx.app, "sam@example.com", "Sam");
		jo = await signUp(ctx.app, "jo@example.com", "Jo");
		groupId = (
			await readJson<{ group: { id: string } }>(
				await api(ctx.app, sam, "POST", "/api/groups", { name: "Smiths" }),
			)
		).group.id;
		const { code } = await readJson<{ code: string }>(
			await api(ctx.app, sam, "POST", `/api/groups/${groupId}/invites`),
		);
		await api(ctx.app, jo, "POST", "/api/invites/redeem", { code });
		// Explicit settings and devices that predate the test clock, so opt-in cutoffs never apply.
		for (const email of ["sam@example.com", "jo@example.com"]) {
			const userId = userIdOf(ctx.db, email);
			ctx.db
				.insert(notificationSettings)
				.values({ userId, updatedAt: 0 })
				.run();
			ctx.db
				.insert(pushSubscription)
				.values({
					id: `${userId}-device`,
					userId,
					endpoint: `https://fcm.googleapis.com/${email.split("@")[0]}`,
					p256dh: "key",
					auth: "auth",
					deviceLabel: "Phone",
					createdAt: 0,
				})
				.run();
		}
	});
	afterEach(() => ctx.close());

	it("notifies the recipient of a suggestion and the sender of an answer, but never of a withdrawal", async () => {
		const joId = userIdOf(ctx.db, "jo@example.com");
		const first = randomUUID();
		const second = randomUUID();
		const third = randomUUID();

		await push(ctx.app, sam, [create(first, joId)]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(endpoint(0)).toBe("https://fcm.googleapis.com/jo");
		expect(payload(0)).toEqual({
			title: "Sam suggests a task",
			body: "Wash dishes",
			url: "/",
		});

		await push(ctx.app, jo, [
			mutation(
				"suggestion.accept",
				{
					suggestionId: first,
					taskId: randomUUID(),
					timezone: "UTC",
					startDate: "2026-10-01",
				},
				ctx.clock.now,
			),
		]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		expect(endpoint(1)).toBe("https://fcm.googleapis.com/sam");
		expect(payload(1).title).toBe("Jo accepted your suggestion");

		await push(ctx.app, sam, [create(second, joId)]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
		await push(ctx.app, jo, [
			mutation("suggestion.decline", { suggestionId: second }, ctx.clock.now),
		]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
		expect(endpoint(3)).toBe("https://fcm.googleapis.com/sam");
		expect(payload(3).title).toBe("Jo declined your suggestion");

		await push(ctx.app, sam, [create(third, joId)]);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5));
		await push(ctx.app, sam, [
			mutation("suggestion.withdraw", { suggestionId: third }, ctx.clock.now),
		]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(send).toHaveBeenCalledTimes(5);
		expect(ctx.db.select().from(notificationLog).all()).toHaveLength(5);
	});
});
