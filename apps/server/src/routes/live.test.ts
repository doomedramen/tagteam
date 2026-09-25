import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	api,
	createTestContext,
	readJson,
	signUp,
	type TestContext,
} from "../test/harness";
import { mutation, push } from "../test/sync-helpers";

async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	needle: string,
	timeoutMs = 2000,
) {
	const decoder = new TextDecoder();
	let text = "";
	const deadline = Date.now() + timeoutMs;
	while (!text.includes(needle)) {
		const remaining = deadline - Date.now();
		if (remaining <= 0)
			throw new Error(
				`timed out waiting for ${JSON.stringify(needle)}; got ${JSON.stringify(text)}`,
			);
		const chunk = await Promise.race([
			reader.read(),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`timed out; got ${JSON.stringify(text)}`)),
					remaining,
				),
			),
		]);
		if (chunk.done)
			throw new Error(`stream ended; got ${JSON.stringify(text)}`);
		text += decoder.decode(chunk.value, { stream: true });
	}
	return text;
}

describe("GET /api/live", () => {
	let ctx: TestContext;
	beforeEach(() => {
		ctx = createTestContext();
	});
	afterEach(() => ctx.close());

	it("requires a session", async () => {
		expect((await api(ctx.app, null, "GET", "/api/live")).status).toBe(401);
	});

	it("pokes group members when another member syncs a change", async () => {
		const sam = await signUp(ctx.app, "sam@example.com", "Sam");
		const jo = await signUp(ctx.app, "jo@example.com", "Jo");
		const groupId = (
			await readJson<{ group: { id: string } }>(
				await api(ctx.app, sam, "POST", "/api/groups", { name: "Smiths" }),
			)
		).group.id;
		const { code } = await readJson<{ code: string }>(
			await api(ctx.app, sam, "POST", `/api/groups/${groupId}/invites`),
		);
		await api(ctx.app, jo, "POST", "/api/invites/redeem", { code });

		const res = await api(ctx.app, jo, "GET", "/api/live");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const reader = (res.body as ReadableStream<Uint8Array>).getReader();
		try {
			await readUntil(reader, "event: ready");
			await push(ctx.app, sam, [
				mutation(
					"task.create",
					{
						taskId: randomUUID(),
						groupId,
						title: "Bins",
						notes: null,
						timezone: "UTC",
						startDate: "2026-09-21",
						dueTime: null,
						rule: null,
					},
					ctx.clock.now,
				),
			]);
			await readUntil(reader, "event: poke");
		} finally {
			await reader.cancel();
		}
	});
});
