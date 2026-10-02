import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorker, memoryEngineStorage } from "../../test/emoji";
import type { EmojiEntry } from "./catalog";
import {
	type ControllerDeps,
	createEmojiController,
	LOAD_TIMEOUT_MS,
	SUGGEST_TIMEOUT_MS,
} from "./controller";

const catalog: EmojiEntry[] = [
	{ e: "\u{1FAB4}", n: "potted plant", t: ["plant"], g: "animals & nature" },
	{ e: "\u{1F331}", n: "seedling", t: ["plant"], g: "animals & nature" },
	{ e: "\u{1F4A7}", n: "droplet", t: ["water"], g: "travel & places" },
	{ e: "\u{1F1EA}\u{1F1F8}", n: "flag: Spain", t: ["flag"], g: "flags" },
	{ e: "\u{1F6AE}", n: "litter in bin sign", t: ["bin"], g: "symbols" },
	{ e: "\u{1F555}️", n: "six o’clock", t: ["time"], g: "travel & places" },
	// The same emoji spelled with and without the presentation selector.
	{ e: "\u{1F4CB}", n: "clipboard", t: [], g: "objects" },
	{ e: "\u{1F4CB}️", n: "clipboard", t: [], g: "objects" },
];
const [PLANT, SEEDLING, DROPLET, FLAG, LITTER, CLOCK] = catalog.map((e) => e.e);
const TOTAL = 1000;

type Storage = ReturnType<typeof memoryEngineStorage>;

/** By default the person has downloaded version "v1" on this device. */
const downloaded = (extra: Parameters<typeof memoryEngineStorage>[0] = {}) =>
	memoryEngineStorage({ optedIn: true, installed: "v1", ...extra });

function setup(
	options: { storage?: Storage; deps?: Partial<ControllerDeps> } = {},
) {
	const storage = options.storage ?? downloaded();
	const workers: FakeWorker[] = [];
	const deleteCaches = vi.fn(async () => {});
	const clearAwaiting = vi.fn(async () => {});
	const controller = createEmojiController({
		version: "v1",
		downloadBytes: TOTAL,
		storage,
		createWorker: () => {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
		loadCatalog: async () => catalog,
		supported: () => true,
		deleteCaches,
		clearAwaiting,
		autoPickExclusion: true,
		...options.deps,
	});
	const statuses: string[] = [];
	controller.subscribe(() =>
		statuses.push(controller.getSnapshot().engine.status),
	);
	return {
		controller,
		storage,
		workers,
		deleteCaches,
		clearAwaiting,
		statuses,
	};
}
type Context = ReturnType<typeof setup>;

const status = (c: Context) => c.controller.getSnapshot().engine.status;
const state = (c: Context) => c.controller.getSnapshot().download;
const tick = () => vi.advanceTimersByTimeAsync(0);

/** wake(), let the catalog load, and answer `ready` (a load of the stored copy). */
async function ready(c: Context) {
	c.controller.wake();
	await tick();
	const worker = c.workers.at(-1) as FakeWorker;
	worker.reply({ type: "ready", id: 0 });
	return worker;
}

/** Presses Download and lets the worker start. */
async function startDownload(c: Context) {
	await c.controller.download();
	await tick();
	return c.workers.at(-1) as FakeWorker;
}

/** Asks for suggestions and answers the worker's rank request with `indices`. */
async function suggestWith(
	c: Context,
	worker: FakeWorker,
	indices: number[],
	title = "Water the plants",
	autoPick = false,
) {
	const result = c.controller.getSnapshot().engine.suggest(title, { autoPick });
	worker.reply({
		type: "ranked",
		id: worker.last("rank")?.id,
		indices,
		scores: indices.map(() => 1),
	});
	return result;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	vi.useFakeTimers();
	// The controller logs the errors it swallows; keep test output pristine.
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("a device that has not opted in", () => {
	it("is off and never starts, whatever wakes it, so nothing is downloaded", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		expect(status(c)).toBe("off");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
		c.controller.wake();
		c.controller.warmUp();
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS * 2);
		expect(c.workers).toHaveLength(0);
		expect(c.deleteCaches).not.toHaveBeenCalled();
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
		expect(await c.controller.getSnapshot().engine.search("plant")).toEqual([]);
	});

	it("does not let an opt-in stand when no download ever finished", () => {
		const storage = memoryEngineStorage({ optedIn: true, installed: null });
		const c = setup({ storage });
		expect(storage.optedIn).toBe(false);
		expect(c.controller.getSnapshot().optedIn).toBe(false);
		expect(status(c)).toBe("off");
	});
});

describe("starting from the stored copy", () => {
	it("is unavailable until woken, then loads without the network, then is ready", async () => {
		const c = setup();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "ready" });
		c.controller.wake();
		expect(status(c)).toBe("loading");
		expect(state(c)).toEqual({ kind: "loading" });
		await tick();
		const worker = c.workers[0];
		expect(worker.sent).toEqual([
			{
				type: "init",
				id: 0,
				count: catalog.length,
				allowNetwork: false,
				totalBytes: TOTAL,
			},
		]);
		worker.reply({ type: "ready", id: 0 });
		expect(status(c)).toBe("ready");
		expect(state(c)).toEqual({ kind: "ready" });
		expect(c.statuses).toEqual(["loading", "ready"]);
	});

	it("hands out a new engine object whenever the status changes, and the same one otherwise", async () => {
		const c = setup();
		const first = c.controller.getSnapshot().engine;
		expect(c.controller.getSnapshot().engine).toBe(first);
		await ready(c);
		const second = c.controller.getSnapshot().engine;
		expect(second).not.toBe(first);
		expect(second.status).toBe("ready");
	});

	it("starts once per app start however often it is woken", async () => {
		const c = setup();
		await ready(c);
		c.controller.wake();
		c.controller.warmUp();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("loads the stored copy in the background even when the device is offline: it never needs the network", async () => {
		const c = setup();
		c.controller.warmUp();
		await tick();
		expect(c.workers).toHaveLength(1);
		expect(c.workers[0].sent[0]).toMatchObject({ allowNetwork: false });
	});

	it("deletes the stored files of older versions once this one is loaded", async () => {
		const c = setup();
		await ready(c);
		expect(c.deleteCaches).toHaveBeenCalledWith("otherVersions");
	});

	it("goes back to the default, without counting a failure, when the browser removed the stored copy", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].reply({
			type: "error",
			id: 0,
			kind: "uncached",
			message: "gone",
		});
		await tick();
		expect(state(c)).toEqual({ kind: "notDownloaded", note: "evicted" });
		expect(status(c)).toBe("off");
		expect(c.storage).toMatchObject({ optedIn: false, installed: null });
		expect(c.storage.state?.failedStarts).toBe(0);
		expect(c.workers[0].terminated).toBe(true);
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});
});

describe("a download from an older asset version", () => {
	it("is never used by this build: no worker starts and the Me screen offers an update", async () => {
		const c = setup({ storage: downloaded({ installed: "v0" }) });
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "updateAvailable" });
		c.controller.wake();
		c.controller.warmUp();
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
		expect(c.workers).toHaveLength(0);
		expect(c.deleteCaches).not.toHaveBeenCalled();
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
	});

	it("is replaced when the person presses Download, and only then is the old copy deleted", async () => {
		const c = setup({ storage: downloaded({ installed: "v0" }) });
		const worker = await startDownload(c);
		expect(worker.sent[0]).toMatchObject({ allowNetwork: true });
		expect(c.deleteCaches).not.toHaveBeenCalled();
		worker.reply({ type: "ready", id: 0 });
		expect(c.storage.installed).toBe("v1");
		expect(state(c)).toEqual({ kind: "ready" });
		await tick();
		expect(c.deleteCaches).toHaveBeenCalledWith("otherVersions");
	});
});

describe("downloading", () => {
	it("starts only when the person presses Download, opts in, and reports progress", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		expect(c.storage.optedIn).toBe(true);
		expect(status(c)).toBe("loading");
		expect(state(c)).toEqual({ kind: "downloading", progress: null });
		expect(worker.sent).toEqual([
			{
				type: "init",
				id: 0,
				count: catalog.length,
				allowNetwork: true,
				totalBytes: TOTAL,
			},
		]);
		worker.reply({ type: "progress", id: 0, loaded: 250, total: TOTAL });
		expect(state(c)).toEqual({ kind: "downloading", progress: 0.25 });
		worker.reply({ type: "progress", id: 0, loaded: 5000, total: TOTAL });
		expect(state(c)).toEqual({ kind: "downloading", progress: 1 });
		worker.reply({ type: "ready", id: 0 });
		expect(state(c)).toEqual({ kind: "ready" });
		expect(status(c)).toBe("ready");
		expect(c.storage.installed).toBe("v1");
		expect(c.storage.state).toMatchObject({
			loading: false,
			strikes: 0,
			failedStarts: 0,
		});
	});

	it("presses of Download while it is already downloading or ready change nothing", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		await startDownload(c);
		await c.controller.download();
		await tick();
		expect(c.workers).toHaveLength(1);
		c.workers[0].reply({ type: "ready", id: 0 });
		await c.controller.download();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("allows a slow download as long as bytes keep arriving, and gives up after 60 seconds of silence", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		worker.reply({ type: "progress", id: 0, loaded: 10, total: TOTAL });
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		expect(status(c)).toBe("loading");
		await vi.advanceTimersByTimeAsync(1);
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(worker.terminated).toBe(true);
	});

	it("says why it failed, in one of four plain reasons, and Try again downloads again", async () => {
		const cases = [
			["offline", "offline"],
			["quota", "storage"],
			["load", "load"],
			["runtime", "load"],
		] as const;
		for (const [kind, reason] of cases) {
			const c = setup({ storage: memoryEngineStorage() });
			const worker = await startDownload(c);
			worker.reply({ type: "error", id: 0, kind, message: kind });
			await tick();
			expect(state(c), kind).toEqual({ kind: "failed", reason });
			expect(status(c)).toBe("unavailable");
			expect(worker.terminated).toBe(true);

			const retry = await startDownload(c);
			expect(retry).not.toBe(worker);
			expect(state(c)).toEqual({ kind: "downloading", progress: null });
			retry.reply({ type: "ready", id: 0 });
			expect(state(c)).toEqual({ kind: "ready" });
		}
	});

	it("does not count an offline failure as a failed start", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "offline", message: "offline" });
		await tick();
		expect(c.storage.state?.failedStarts).toBe(0);
	});

	it("a failed first download lapses the opt-in at the next app start", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "load", message: "x" });
		await tick();
		expect(c.storage.optedIn).toBe(true);
		const next = setup({ storage: c.storage });
		expect(next.controller.getSnapshot().optedIn).toBe(false);
		expect(next.controller.getSnapshot().download).toEqual({
			kind: "notDownloaded",
			note: null,
		});
	});

	it("a download that finishes while another tab lapsed the opt-in ends opted in and installed", async () => {
		const storage = memoryEngineStorage();
		const a = setup({ storage });
		const worker = await startDownload(a);
		worker.reply({ type: "progress", id: 0, loaded: TOTAL, total: TOTAL });
		// A second tab starts mid-download: it sees an opt-in without an install and lapses it.
		setup({ storage });
		expect(storage.optedIn).toBe(false);
		worker.reply({ type: "ready", id: 0 });
		expect(storage).toMatchObject({ optedIn: true, installed: "v1" });
		expect(storage.state).toMatchObject({ loading: false, strikes: 0 });
		const next = setup({ storage });
		expect(next.controller.getSnapshot().download).toEqual({ kind: "ready" });
	});

	it("in a browser without WebAssembly, module workers or the Cache API says so, opts in to nothing and starts nothing", async () => {
		const c = setup({
			storage: memoryEngineStorage(),
			deps: { supported: () => false },
		});
		await c.controller.download();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "unsupported" });
		expect(c.workers).toHaveLength(0);
		expect(c.storage.optedIn).toBe(false);
	});

	it("cancel and remove stop a download, delete what arrived, and return to the default", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "progress", id: 0, loaded: 100, total: TOTAL });
		await c.controller.remove();
		expect(worker.terminated).toBe(true);
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
		expect(status(c)).toBe("off");
		expect(c.storage).toMatchObject({ optedIn: false, installed: null });
		expect(c.storage.state?.loading).toBe(false);
		// A reply from the stopped worker is ignored.
		worker.reply({ type: "ready", id: 0 });
		expect(status(c)).toBe("off");
	});

	it("catalog files that fail to load end the download as a plain load failure", async () => {
		const c = setup({
			storage: memoryEngineStorage(),
			deps: { loadCatalog: async () => Promise.reject(new Error("offline")) },
		});
		await c.controller.download();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(c.workers).toHaveLength(0);
	});
});

describe("Remove download", () => {
	it("also clears the awaiting-emoji list, so a later Download late-picks nothing old", async () => {
		const c = setup();
		await ready(c);
		expect(c.clearAwaiting).not.toHaveBeenCalled();
		await c.controller.remove();
		expect(c.clearAwaiting).toHaveBeenCalledTimes(1);
	});

	it("clears the awaiting list on Cancel of a download too", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		await startDownload(c);
		await c.controller.remove();
		expect(c.clearAwaiting).toHaveBeenCalledTimes(1);
	});

	it("clears the list before a Download that follows, and does not clear it on Download", async () => {
		const order: string[] = [];
		let finish: () => void = () => {};
		const c = setup({
			storage: memoryEngineStorage(),
			deps: {
				clearAwaiting: async () => {
					order.push("clear start");
					await new Promise<void>((resolve) => {
						finish = resolve;
					});
					order.push("cleared");
				},
				createWorker: () => {
					order.push("worker");
					return new FakeWorker();
				},
			},
		});
		const removing = c.controller.remove();
		const downloading = c.controller.download();
		await tick();
		expect(order).toEqual(["clear start"]);
		finish();
		await removing;
		await downloading;
		await tick();
		expect(order).toEqual(["clear start", "cleared", "worker"]);
	});

	it("logs and carries on when the list cannot be cleared", async () => {
		const c = setup({
			deps: { clearAwaiting: async () => Promise.reject(new Error("locked")) },
		});
		await c.controller.remove();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("[emoji]"),
			expect.any(Error),
		);
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		expect(status(c)).toBe("off");
	});

	it("stops the worker, deletes every stored version and returns to the default", async () => {
		const c = setup();
		const worker = await ready(c);
		await c.controller.remove();
		expect(worker.terminated).toBe(true);
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		expect(status(c)).toBe("off");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
		expect(c.storage).toMatchObject({ optedIn: false, installed: null });
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});
});

describe("suggestions", () => {
	it("returns up to three valid emoji, best first, without repeats", async () => {
		const c = setup();
		const worker = await ready(c);
		// 6 and 7 are the clipboard with and without U+FE0F: one emoji.
		expect(await suggestWith(c, worker, [1, 0, 6, 7, 2])).toEqual([
			SEEDLING,
			PLANT,
			"\u{1F4CB}",
		]);
	});

	it("leaves flags, symbols and clock faces out of an automatic pick only", async () => {
		const c = setup();
		const worker = await ready(c);
		expect(await suggestWith(c, worker, [3, 4, 5, 2], "x1x", true)).toEqual([
			DROPLET,
		]);
		expect(await suggestWith(c, worker, [3, 4, 5, 2], "x1x", false)).toEqual([
			FLAG,
			LITTER,
			CLOCK,
		]);
	});

	it("keeps them for an automatic pick when the exclusion is off", async () => {
		const c = setup({ deps: { autoPickExclusion: false } });
		const worker = await ready(c);
		expect(await suggestWith(c, worker, [3, 2], "x1x", true)).toEqual([
			FLAG,
			DROPLET,
		]);
	});

	it("answers search with every distinct valid match", async () => {
		const c = setup();
		const worker = await ready(c);
		const result = c.controller.getSnapshot().engine.search("plant");
		worker.reply({
			type: "ranked",
			id: worker.last("rank")?.id,
			indices: [0, 1, 0],
			scores: [3, 2, 1],
		});
		expect(await result).toEqual([PLANT, SEEDLING]);
	});

	it("says nothing for a short title, a short search, or before it is ready", async () => {
		const c = setup();
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
		const worker = await ready(c);
		const engine = c.controller.getSnapshot().engine;
		expect(await engine.suggest("ab")).toEqual([]);
		expect(await engine.search("a")).toEqual([]);
		expect(worker.last("rank")).toBeUndefined();
	});

	it("trims the title before asking", async () => {
		const c = setup();
		const worker = await ready(c);
		const pending = c.controller.getSnapshot().engine.suggest("  Water  ");
		expect(worker.last("rank")?.text).toBe("Water");
		worker.reply({
			type: "ranked",
			id: worker.last("rank")?.id,
			indices: [],
			scores: [],
		});
		await pending;
	});
});

describe("failure handling when loading the stored copy", () => {
	it("goes unavailable for this app start when the worker reports a load failure, and does not restart", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].reply({ type: "error", id: 0, kind: "load", message: "x" });
		await tick();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(c.workers[0].terminated).toBe(true);
		expect(c.storage.state?.failedStarts).toBe(1);
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("is unavailable, and never tries again, in a browser without WebAssembly, module workers or the Cache API", async () => {
		const c = setup({ deps: { supported: () => false } });
		c.controller.wake();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "unsupported" });
		expect(c.workers).toHaveLength(0);
		expect(c.storage.state).toBeNull();
	});

	it("terminates a worker that takes longer than 60 seconds to load", async () => {
		const c = setup();
		c.controller.wake();
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		expect(status(c)).toBe("loading");
		await vi.advanceTimersByTimeAsync(1);
		expect(status(c)).toBe("unavailable");
		expect(c.workers[0].terminated).toBe(true);
	});

	it("terminates the worker and goes unavailable when it throws while loading", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].onerror?.({});
		await tick();
		expect(status(c)).toBe("unavailable");
		expect(c.workers[0].terminated).toBe(true);
	});

	it("terminates the worker and goes unavailable when it posts an error after it was ready, and answers what was waiting with nothing", async () => {
		const c = setup();
		const worker = await ready(c);
		const waiting = c.controller
			.getSnapshot()
			.engine.suggest("Water the plants");
		worker.reply({ type: "error", id: null, kind: "runtime", message: "boom" });
		await tick();
		expect(await waiting).toEqual([]);
		expect(status(c)).toBe("unavailable");
		expect(worker.terminated).toBe(true);
	});

	it("drops a suggestion that takes longer than 2 seconds, and ignores its late reply", async () => {
		const c = setup();
		const worker = await ready(c);
		const slow = c.controller.getSnapshot().engine.suggest("Water the plants");
		const id = worker.last("rank")?.id;
		await vi.advanceTimersByTimeAsync(SUGGEST_TIMEOUT_MS);
		expect(await slow).toEqual([]);
		worker.reply({ type: "ranked", id, indices: [0], scores: [1] });
		expect(status(c)).toBe("ready");
	});

	it("goes unavailable after three bad results in a row, but not when a good one comes between", async () => {
		const c = setup();
		const worker = await ready(c);
		const timeOut = async () => {
			const pending = c.controller
				.getSnapshot()
				.engine.suggest("Water the plants");
			await vi.advanceTimersByTimeAsync(SUGGEST_TIMEOUT_MS);
			await pending;
		};
		await timeOut();
		await timeOut();
		expect(await suggestWith(c, worker, [0])).toEqual([PLANT]);
		await timeOut();
		await timeOut();
		expect(status(c)).toBe("ready");
		await timeOut();
		expect(status(c)).toBe("unavailable");
		expect(worker.terminated).toBe(true);
	});

	it("treats malformed output as a bad result: dropped, and three in a row make the engine unavailable", async () => {
		const malformed = [
			{ indices: "not a list" },
			{ indices: [0, 99] },
			{ indices: [0.5] },
			{ indices: Array.from({ length: 41 }, () => 0) },
		];
		for (const reply of malformed) {
			const c = setup();
			const worker = await ready(c);
			for (let attempt = 1; attempt <= 3; attempt++) {
				const pending = c.controller
					.getSnapshot()
					.engine.suggest("Water the plants");
				worker.reply({
					type: "ranked",
					id: worker.last("rank")?.id,
					scores: [],
					...reply,
				});
				expect(await pending).toEqual([]);
				expect(status(c), JSON.stringify(reply)).toBe(
					attempt < 3 ? "ready" : "unavailable",
				);
			}
		}
	});

	it("deletes this version's stored files, and forgets the download, when loading fails with files present", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].reply({
			type: "error",
			id: 0,
			kind: "corrupt",
			message: "bad onnx",
		});
		await tick();
		expect(c.deleteCaches).toHaveBeenCalledWith("thisVersion");
		expect(c.storage.installed).toBeNull();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
	});

	it("goes unavailable on a storage quota error and touches nothing else", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "quota", message: "quota" });
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "storage" });
		expect(c.deleteCaches).not.toHaveBeenCalled();
	});

	it("goes unavailable when the catalog cannot be loaded, or the worker cannot be created", async () => {
		const noCatalog = setup({
			deps: { loadCatalog: async () => Promise.reject(new Error("x")) },
		});
		noCatalog.controller.wake();
		await tick();
		expect(status(noCatalog)).toBe("unavailable");
		expect(noCatalog.workers).toHaveLength(0);

		const noWorker = setup({
			deps: {
				createWorker: () => {
					throw new Error("no workers");
				},
			},
		});
		noWorker.controller.wake();
		await tick();
		expect(status(noWorker)).toBe("unavailable");
	});
});

describe("the loading marker", () => {
	it("is written before the model loads, and cleared on ready and on every handled failure", async () => {
		const c = setup();
		c.controller.wake();
		expect(c.storage.state?.loading).toBe(true);
		await tick();
		c.workers[0].reply({ type: "ready", id: 0 });
		expect(c.storage.state?.loading).toBe(false);

		const failing = setup();
		failing.controller.wake();
		await tick();
		failing.workers[0].reply({
			type: "error",
			id: 0,
			kind: "load",
			message: "x",
		});
		await tick();
		expect(failing.storage.state?.loading).toBe(false);
	});

	it("is cleared when the engine is disposed or removed during a load", async () => {
		const disposed = setup();
		disposed.controller.wake();
		await tick();
		disposed.controller.dispose();
		expect(disposed.storage.state?.loading).toBe(false);

		const removed = setup();
		removed.controller.wake();
		await tick();
		await removed.controller.remove();
		expect(removed.storage.state?.loading).toBe(false);
	});

	it("counts a marker still set at start as a strike, and skips the warm-up that start", async () => {
		const storage = downloaded({ state: { loading: true, strikes: 0 } });
		const c = setup({ storage });
		expect(storage.state).toMatchObject({ loading: false, strikes: 1 });
		expect(status(c)).toBe("unavailable");
		c.controller.warmUp();
		await tick();
		expect(c.workers).toHaveLength(0);
		// A person opening the New task sheet still gets the engine.
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("goes back to the default after two strikes, deletes the download, and explains why", async () => {
		const storage = downloaded({ state: { loading: true, strikes: 1 } });
		const c = setup({ storage });
		const snapshot = c.controller.getSnapshot();
		expect(snapshot.optedIn).toBe(false);
		expect(snapshot.download).toEqual({ kind: "notDownloaded", note: "crash" });
		expect(snapshot.engine.status).toBe("off");
		expect(storage).toMatchObject({
			optedIn: false,
			installed: null,
			autoOff: "crash",
		});
		await tick();
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(0);

		// Pressing Download again clears the explanation and tries once more.
		await c.controller.download();
		await tick();
		expect(c.controller.getSnapshot().download).toEqual({
			kind: "downloading",
			progress: null,
		});
		expect(storage.autoOff).toBeNull();
		expect(c.workers).toHaveLength(1);
		expect(storage.state?.strikes).toBe(2);
	});

	it("forgets strikes and failed starts after a success", async () => {
		const storage = downloaded({ state: { strikes: 1, failedStarts: 2 } });
		const c = setup({ storage });
		await ready(c);
		expect(storage.state).toMatchObject({
			strikes: 0,
			failedStarts: 0,
			loading: false,
		});
	});
});

describe("stopping after repeated failures", () => {
	it("does not load once three app starts in a row have ended unavailable, and says so", async () => {
		const storage = downloaded({ state: { failedStarts: 3 } });
		const c = setup({ storage });
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(0);
		expect(state(c)).toEqual({ kind: "failed", reason: "stopped" });
		expect(status(c)).toBe("unavailable");
	});

	it("tries again when the asset version changes", async () => {
		const storage = downloaded({ state: { version: "old", failedStarts: 3 } });
		const c = setup({ storage });
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("tries again when the person presses Download again", async () => {
		const storage = downloaded({ state: { failedStarts: 3 } });
		const c = setup({ storage });
		c.controller.wake();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "stopped" });
		await c.controller.download();
		await tick();
		expect(storage.state?.failedStarts).toBe(0);
		expect(c.workers).toHaveLength(1);
		expect(state(c)).toEqual({ kind: "downloading", progress: null });
	});

	it("counts a failed start once, however many things go wrong in it", async () => {
		const c = setup();
		const worker = await ready(c);
		worker.reply({ type: "error", id: null, kind: "runtime", message: "a" });
		await tick();
		expect(c.storage.state?.failedStarts).toBe(1);
	});
});

describe("disposing", () => {
	it("stops the worker and lets a screen that mounts later start the engine again", async () => {
		const c = setup();
		const worker = await ready(c);
		c.controller.dispose();
		expect(worker.terminated).toBe(true);
		expect(status(c)).toBe("unavailable");
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(2);
		expect(status(c)).toBe("loading");
	});
});

describe("an interrupted download is not a crash", () => {
	it("writes no loading marker while bytes are still arriving, so closing the tab counts no strike", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		expect(c.storage.state?.loading).toBe(false);
		worker.reply({ type: "progress", id: 0, loaded: 500, total: TOTAL });
		expect(c.storage.state?.loading).toBe(false);

		// The next app start finds nothing to count.
		const next = setup({ storage: c.storage });
		expect(c.storage.state).toMatchObject({ strikes: 0, loading: false });
		expect(next.controller.getSnapshot().download).toEqual({
			kind: "notDownloaded",
			note: null,
		});
	});

	it("keeps counting a crash in the model load after the last byte arrived", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "progress", id: 0, loaded: TOTAL, total: TOTAL });
		expect(c.storage.state?.loading).toBe(true);

		setup({ storage: c.storage });
		expect(c.storage.state).toMatchObject({ strikes: 1, loading: false });
	});

	it("clears the marker again when the model load after a download fails or finishes", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "progress", id: 0, loaded: TOTAL, total: TOTAL });
		worker.reply({ type: "ready", id: 0 });
		expect(c.storage.state?.loading).toBe(false);
	});
});

describe("less common paths", () => {
	it("a corrupt error during a download deletes this version's files and forgets the download", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "corrupt", message: "bad" });
		await tick();
		expect(c.deleteCaches).toHaveBeenCalledWith("thisVersion");
		expect(c.storage.installed).toBeNull();
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(worker.terminated).toBe(true);
	});

	it("Download pressed while the stored copy is loading replaces that load with a download", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		const loading = c.workers[0];
		await c.controller.download();
		await tick();
		expect(loading.terminated).toBe(true);
		expect(c.workers).toHaveLength(2);
		expect(c.workers[1].sent[0]).toMatchObject({ allowNetwork: true });
		// The replaced worker's reply is ignored.
		loading.reply({ type: "ready", id: 0 });
		expect(state(c)).toEqual({ kind: "downloading", progress: null });
		c.workers[1].reply({ type: "ready", id: 0 });
		expect(state(c)).toEqual({ kind: "ready" });
	});

	it("Remove while the catalog is still loading starts no worker afterwards", async () => {
		let release: (entries: EmojiEntry[]) => void = () => {};
		const c = setup({
			deps: {
				loadCatalog: () =>
					new Promise<EmojiEntry[]>((resolve) => {
						release = resolve;
					}),
			},
		});
		c.controller.wake();
		await tick();
		await c.controller.remove();
		release(catalog);
		await tick();
		expect(c.workers).toHaveLength(0);
		expect(status(c)).toBe("off");
		expect(c.storage.state?.loading).toBe(false);
	});

	it("a message the browser cannot decode ends the engine like any other worker error", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].onmessageerror?.({});
		await tick();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(c.workers[0].terminated).toBe(true);
	});

	it("disposing in the middle of a download stops it, and the unfinished opt-in lapses like it does at the next start", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "progress", id: 0, loaded: 100, total: TOTAL });
		c.controller.dispose();
		expect(worker.terminated).toBe(true);
		expect(c.storage.optedIn).toBe(false);
		expect(c.storage.state?.loading).toBe(false);
		expect(status(c)).toBe("off");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
	});

	it("Download waits for the deletion Remove started, so it cannot delete the files it is about to store", async () => {
		let finish: () => void = () => {};
		const order: string[] = [];
		const c = setup({
			deps: {
				deleteCaches: (scope) =>
					new Promise<void>((resolve) => {
						order.push(`delete ${scope}`);
						finish = () => {
							order.push("deleted");
							resolve();
						};
					}),
				createWorker: () => {
					order.push("worker");
					return new FakeWorker();
				},
			},
		});
		const removing = c.controller.remove();
		const downloading = c.controller.download();
		await tick();
		expect(order).toEqual(["delete all"]);
		finish();
		await removing;
		await downloading;
		await tick();
		expect(order).toEqual(["delete all", "deleted", "worker"]);
	});

	it("logs what it swallows: a failed deletion, a failed catalog, a worker that cannot be created", async () => {
		const c = setup({
			deps: { deleteCaches: async () => Promise.reject(new Error("locked")) },
		});
		await c.controller.remove();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("[emoji]"),
			expect.any(Error),
		);
		warn.mockClear();
		const noCatalog = setup({
			deps: { loadCatalog: async () => Promise.reject(new Error("x")) },
		});
		noCatalog.controller.wake();
		await tick();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("the engine object", () => {
	it("stays the same while only the download progress changes, and still tells listeners", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		const engine = c.controller.getSnapshot().engine;
		const before = c.statuses.length;
		worker.reply({ type: "progress", id: 0, loaded: 100, total: TOTAL });
		worker.reply({ type: "progress", id: 0, loaded: 200, total: TOTAL });
		expect(c.controller.getSnapshot().engine).toBe(engine);
		expect(c.statuses.length).toBe(before + 2);
		expect(state(c)).toEqual({ kind: "downloading", progress: 0.2 });
		worker.reply({ type: "ready", id: 0 });
		expect(c.controller.getSnapshot().engine).not.toBe(engine);
	});
});
