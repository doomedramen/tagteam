import {
	MAX_BATCH,
	type Mutation,
	type MutationResult,
	type PullResponse,
} from "@tagteam/core";
import { AccessExpiredError, ApiError, OfflineError } from "../lib/api";
import { applyLocal, applyPull, type LocalUser } from "../store/apply";
import { getMeta, type TagTeamDb } from "../store/db";

export type SyncState =
	| "idle"
	| "syncing"
	| "offline"
	| "reauth"
	| "signedOut"
	| "error";

export interface SyncStatus {
	state: SyncState;
	pending: number;
	lastSyncedAt: number | null;
}

export interface SyncApi {
	push(mutations: Mutation[]): Promise<MutationResult[]>;
	pull(cursor: number): Promise<PullResponse>;
}

export interface SyncEngine {
	enqueue(mutation: Mutation): Promise<void>;
	sync(): Promise<void>;
	getStatus(): SyncStatus;
	subscribe(listener: (status: SyncStatus) => void): () => void;
	dispose(): void;
}

const stateFor = (err: unknown): SyncState => {
	if (err instanceof OfflineError) return "offline";
	if (err instanceof AccessExpiredError) return "reauth";
	if (err instanceof ApiError && err.status === 401) return "signedOut";
	return "error";
};

export function createSyncEngine(opts: {
	store: TagTeamDb;
	api: SyncApi;
	me: LocalUser;
	debounceMs?: number;
	now?: () => number;
}): SyncEngine {
	const { store, api, me, debounceMs = 400, now = Date.now } = opts;
	let status: SyncStatus = { state: "idle", pending: 0, lastSyncedAt: null };
	const listeners = new Set<(s: SyncStatus) => void>();
	let running: Promise<void> | null = null;
	let again = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const update = (patch: Partial<SyncStatus>) => {
		status = { ...status, ...patch };
		for (const listener of listeners) listener(status);
	};
	const refreshPending = async () =>
		update({ pending: await store.outbox.count() });

	async function runOnce(): Promise<void> {
		update({ state: "syncing" });
		try {
			let rejected = false;
			for (;;) {
				const batch = await store.outbox
					.orderBy("seq")
					.limit(MAX_BATCH)
					.toArray();
				if (batch.length === 0) break;
				const results = await api.push(batch.map((row) => row.mutation));
				if (results.some((r) => r.status === "rejected")) rejected = true;
				await store.outbox.bulkDelete(batch.map((row) => row.seq as number));
				await refreshPending();
			}
			const cursor = rejected
				? 0
				: ((await getMeta<number>(store, "cursor")) ?? 0);
			await applyPull(store, await api.pull(cursor), me, { reset: rejected });
			update({ state: "idle", lastSyncedAt: now() });
		} catch (err) {
			update({ state: stateFor(err) });
		}
	}

	const engine: SyncEngine = {
		async enqueue(mutation) {
			await store.transaction(
				"rw",
				[store.outbox, store.tasks, store.events],
				async () => {
					await store.outbox.add({ mutation });
					await applyLocal(store, mutation, me);
				},
			);
			await refreshPending();
			clearTimeout(timer);
			timer = setTimeout(() => void engine.sync(), debounceMs);
		},
		sync() {
			if (running) {
				again = true;
				return running;
			}
			running = (async () => {
				do {
					again = false;
					await runOnce();
				} while (again && status.state === "idle");
			})().finally(() => {
				running = null;
			});
			return running;
		},
		getStatus: () => status,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			clearTimeout(timer);
			listeners.clear();
		},
	};
	void refreshPending();
	return engine;
}
