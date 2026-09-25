import type { Mutation, MutationResult, PullResponse } from "@tagteam/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessExpiredError, OfflineError } from "../lib/api";
import { getMeta, TagTeamDb } from "../store/db";
import { createSyncEngine, type SyncApi } from "./engine";

const groupId = "11111111-1111-4111-8111-111111111111";
const me = { userId: "u1" };
const emptyPull = (cursor: number): PullResponse => ({
	cursor,
	groups: [],
	members: [],
	tasks: [],
	events: [],
	removedGroupIds: [],
});
const create = (taskId = crypto.randomUUID()): Mutation => ({
	id: crypto.randomUUID(),
	at: Date.now(),
	type: "task.create",
	taskId,
	groupId,
	title: "Bins",
	notes: null,
	timezone: "UTC",
	startDate: "2026-09-21",
	dueTime: null,
	rule: null,
});

function fakeApi(
	results: (m: Mutation[]) => MutationResult[] = (ms) =>
		ms.map((m) => ({ id: m.id, status: "applied" })),
) {
	const api = {
		push: vi.fn(async (ms: Mutation[]) => results(ms)),
		pull: vi.fn(async (cursor: number) => emptyPull(cursor + 1)),
	} satisfies SyncApi;
	return api;
}

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

describe("sync engine", () => {
	it("applies locally at once, then pushes, empties the outbox and pulls", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		const m = create();
		await engine.enqueue(m);
		expect(await store.tasks.count()).toBe(1);
		expect(engine.getStatus().pending).toBe(1);

		await engine.sync();
		expect(api.push).toHaveBeenCalledWith([m]);
		expect(api.pull).toHaveBeenCalledWith(0);
		expect(await store.outbox.count()).toBe(0);
		expect(await getMeta(store, "cursor")).toBe(1);
		expect(engine.getStatus()).toMatchObject({ state: "idle", pending: 0 });
		engine.dispose();
	});

	it("syncs automatically after the debounce", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 5 });
		await engine.enqueue(create());
		await vi.waitFor(() => expect(api.pull).toHaveBeenCalled());
		engine.dispose();
	});

	it("rebuilds from scratch after a rejection", async () => {
		const api = fakeApi((ms) =>
			ms.map((m) => ({
				id: m.id,
				status: "rejected",
				reason: "not a member of this group",
			})),
		);
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await engine.enqueue(create());
		await engine.sync();
		expect(api.pull).toHaveBeenCalledWith(0);
		expect(await store.tasks.count()).toBe(0);
		engine.dispose();
	});

	it("pushes large outboxes in batches of 100", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		for (let i = 0; i < 150; i++) await engine.enqueue(create());
		await engine.sync();
		expect(api.push.mock.calls.map((c) => c[0].length)).toEqual([100, 50]);
		engine.dispose();
	});

	it("keeps the outbox and reports offline or expired sessions", async () => {
		const api = fakeApi();
		api.push.mockRejectedValueOnce(new OfflineError());
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await engine.enqueue(create());
		await engine.sync();
		expect(engine.getStatus()).toMatchObject({ state: "offline", pending: 1 });

		api.push.mockRejectedValueOnce(new AccessExpiredError());
		await engine.sync();
		expect(engine.getStatus().state).toBe("reauth");
		expect(await store.outbox.count()).toBe(1);
		engine.dispose();
	});

	it("runs once more when sync is requested mid-run", async () => {
		const api = fakeApi();
		const engine = createSyncEngine({ store, api, me, debounceMs: 10_000 });
		await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
		expect(api.pull).toHaveBeenCalledTimes(2);
		engine.dispose();
	});

	it("notifies subscribers", async () => {
		const engine = createSyncEngine({
			store,
			api: fakeApi(),
			me,
			debounceMs: 10_000,
		});
		const states: string[] = [];
		const stop = engine.subscribe((s) => states.push(s.state));
		await engine.sync();
		stop();
		expect(states).toContain("syncing");
		expect(states.at(-1)).toBe("idle");
		engine.dispose();
	});
});
