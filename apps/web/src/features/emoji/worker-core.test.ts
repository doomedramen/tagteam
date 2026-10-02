import { describe, expect, it, vi } from "vitest";
import { BIT_BYTES, DIM, quantiseIndex } from "./search";
import {
	classifyFailure,
	createWorkerCore,
	NotCachedError,
	type WorkerDeps,
} from "./worker-core";
import type { WorkerReply } from "./worker-protocol";

/** Three emoji whose vectors point along axes 0, 1 and 2. */
function axisVectors(count: number): Float32Array[] {
	return Array.from({ length: count }, (_, i) => {
		const v = new Float32Array(DIM);
		v[i] = 1;
		return v;
	});
}
function indexFiles(vectors: Float32Array[]) {
	const all = new Float32Array(vectors.length * DIM);
	vectors.forEach((v, i) => {
		all.set(v, i * DIM);
	});
	const { bits, int8 } = quantiseIndex(all);
	return { bits, int8 };
}

const init = (id: number, count: number, allowNetwork = true) =>
	({ type: "init", id, count, allowNetwork, totalBytes: 1000 }) as const;

function setup(overrides: Partial<WorkerDeps> = {}) {
	const vectors = axisVectors(3);
	const replies: WorkerReply[] = [];
	const embed = vi.fn(async (text: string) => {
		const axis = text.startsWith("axis ") ? Number(text.slice(5)) : 0;
		return vectors[axis];
	});
	const deps: WorkerDeps = {
		filesCached: async () => false,
		loadIndex: async () => indexFiles(vectors),
		loadEmbedder: async (_onBytes) => ({ embed }),
		isOnline: () => true,
		post: (reply) => replies.push(reply),
		...overrides,
	};
	return { handle: createWorkerCore(deps), replies, embed };
}

describe("the worker core", () => {
	it("loads the index and the model, warms up once, and says ready", async () => {
		const { handle, replies, embed } = setup();
		await handle(init(1, 3));
		expect(replies).toEqual([{ type: "ready", id: 1 }]);
		expect(embed).toHaveBeenCalledTimes(1);
		expect(embed).toHaveBeenCalledWith("warm up");
	});

	it("ranks by the embedding of the text", async () => {
		const { handle, replies } = setup();
		await handle(init(1, 3));
		await handle({ type: "rank", id: 2, text: "axis 2" });
		const reply = replies.at(-1);
		expect(reply).toMatchObject({ type: "ranked", id: 2 });
		expect(reply?.type === "ranked" && reply.indices[0]).toBe(2);
		expect(reply?.type === "ranked" && reply.indices).toHaveLength(3);
	});

	it("answers requests one at a time, in order", async () => {
		let release: () => void = () => {};
		const slow = new Promise<void>((resolve) => {
			release = resolve;
		});
		const vectors = axisVectors(3);
		const { handle, replies } = setup({
			loadEmbedder: async (_onBytes) => ({
				embed: async (text: string) => {
					if (text === "axis 1") await slow;
					return vectors[text === "axis 1" ? 1 : 0];
				},
			}),
		});
		await handle(init(1, 3));
		const first = handle({ type: "rank", id: 2, text: "axis 1" });
		const second = handle({ type: "rank", id: 3, text: "axis 0" });
		release();
		await Promise.all([first, second]);
		expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3]);
	});

	it("loads a model that is stored on the device without the network, and never downloads when it is not", async () => {
		const stored = setup({ filesCached: async () => true });
		await stored.handle(init(1, 3, false));
		expect(stored.replies).toEqual([{ type: "ready", id: 1 }]);

		const loadEmbedder = vi.fn(async () => ({
			embed: async () => new Float32Array(DIM),
		}));
		const absent = setup({ filesCached: async () => false, loadEmbedder });
		await absent.handle(init(1, 3, false));
		expect(absent.replies[0]).toMatchObject({
			type: "error",
			id: 1,
			kind: "uncached",
		});
		expect(loadEmbedder).not.toHaveBeenCalled();

		const download = setup({ filesCached: async () => false });
		await download.handle(init(1, 3, true));
		expect(download.replies).toEqual([{ type: "ready", id: 1 }]);
	});

	it("tells the loader whether it may use the network, and reports a stored file that went missing as uncached", async () => {
		const seen: boolean[] = [];
		const allowed = setup({
			loadEmbedder: async (_onBytes, options) => {
				seen.push(options.allowNetwork);
				return { embed: async () => new Float32Array(DIM) };
			},
		});
		await allowed.handle(init(1, 3, true));
		const stored = setup({
			filesCached: async () => true,
			loadEmbedder: async (_onBytes, options) => {
				seen.push(options.allowNetwork);
				return { embed: async () => new Float32Array(DIM) };
			},
		});
		await stored.handle(init(1, 3, false));
		expect(seen).toEqual([true, false]);

		// The pre-check said "stored", then the browser evicted a file before the load: the loader
		// refuses to fetch it instead of downloading.
		const evicted = setup({
			filesCached: async () => true,
			loadEmbedder: async () => {
				throw new NotCachedError();
			},
		});
		await evicted.handle(init(1, 3, false));
		expect(evicted.replies[0]).toMatchObject({ kind: "uncached" });
	});

	it("reports download progress once per whole percent, never above the total", async () => {
		const { handle, replies } = setup({
			loadEmbedder: async (onBytes) => {
				for (const bytes of [0, 4, 9, 10, 500, 505, 2000]) onBytes(bytes);
				return { embed: async () => new Float32Array(DIM) };
			},
		});
		await handle(init(1, 3));
		const progress = replies.filter((reply) => reply.type === "progress");
		expect(
			progress.map((reply) => reply.type === "progress" && reply.loaded),
		).toEqual([0, 10, 500, 1000]);
		expect(
			progress.every(
				(reply) => reply.type === "progress" && reply.total === 1000,
			),
		).toBe(true);
	});

	it("refuses an index that does not match the catalog", async () => {
		const { handle, replies } = setup();
		await handle(init(1, 4));
		expect(replies[0]).toMatchObject({ type: "error", id: 1, kind: "index" });
	});

	it("reports a runtime error for a rank before init and for an embedding that throws", async () => {
		const early = setup();
		await early.handle({ type: "rank", id: 5, text: "x" });
		expect(early.replies[0]).toMatchObject({
			type: "error",
			id: 5,
			kind: "runtime",
		});

		const vectors = axisVectors(3);
		let fail = false;
		const later = setup({
			loadEmbedder: async (_onBytes) => ({
				embed: async () => {
					if (fail) throw new Error("session lost");
					return vectors[0];
				},
			}),
		});
		await later.handle(init(1, 3));
		fail = true;
		await later.handle({ type: "rank", id: 2, text: "x" });
		expect(later.replies.at(-1)).toMatchObject({
			type: "error",
			id: 2,
			kind: "runtime",
		});
	});

	it("classifies a failed load by what the device had", async () => {
		const failing = (extra: Partial<WorkerDeps>) =>
			setup({
				loadEmbedder: async () => {
					throw new Error("could not load");
				},
				...extra,
			});
		const cached = failing({ filesCached: async () => true });
		await cached.handle(init(1, 3));
		expect(cached.replies[0]).toMatchObject({ kind: "corrupt" });

		const offline = failing({ isOnline: () => false });
		await offline.handle(init(1, 3));
		expect(offline.replies[0]).toMatchObject({ kind: "offline" });

		const missing = failing({});
		await missing.handle(init(1, 3));
		expect(missing.replies[0]).toMatchObject({ kind: "load" });
	});
});

describe("classifyFailure", () => {
	const none = { filesCached: false, online: true };
	it("recognises a storage quota error by name or message, whatever else is true", () => {
		const named = new Error("x");
		named.name = "QuotaExceededError";
		expect(classifyFailure(named, { filesCached: true, online: false })).toBe(
			"quota",
		);
		expect(classifyFailure(new Error("Storage quota exceeded"), none)).toBe(
			"quota",
		);
	});

	it("prefers corrupt over offline when files were stored", () => {
		expect(
			classifyFailure(new Error("bad"), { filesCached: true, online: false }),
		).toBe("corrupt");
	});

	it("handles values that are not errors", () => {
		expect(classifyFailure("nope", none)).toBe("load");
	});
});

describe("index layout", () => {
	it("is 48 bytes of bits and 384 int8 values per emoji", () => {
		const files = indexFiles(axisVectors(3));
		expect(files.bits).toHaveLength(3 * BIT_BYTES);
		expect(files.int8).toHaveLength(3 * DIM);
	});
});
