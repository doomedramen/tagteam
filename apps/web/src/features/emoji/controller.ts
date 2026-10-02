import { isEmoji, MAX_TITLE } from "@tagteam/core";
import { AUTO_PICK_EXCLUSION, isAutoPickExcluded } from "./auto-pick";
import type { CacheScope } from "./cache";
import { type EmojiEntry, emojiKey } from "./catalog";
import type { EmojiEngine, EmojiEngineStatus, SuggestOptions } from "./engine";
import type { EngineStorage } from "./engine-storage";
import { SHORTLIST } from "./search";
import type {
	FailureKind,
	WorkerReply,
	WorkerRequest,
} from "./worker-protocol";

/** The part of a Web Worker the controller uses, so tests can pass a fake. */
export interface WorkerLike {
	postMessage(request: WorkerRequest): void;
	terminate(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onmessageerror: ((event: unknown) => void) | null;
}

export interface ControllerDeps {
	/** The asset version. A download of another version is not used, and counters from another version are ignored. */
	version: string;
	/** Bytes of a full download, the denominator of the progress. */
	downloadBytes: number;
	storage: EngineStorage;
	createWorker(): WorkerLike;
	loadCatalog(): Promise<EmojiEntry[]>;
	/** WebAssembly, module workers and the Cache API all exist. */
	supported(): boolean;
	deleteCaches(scope: CacheScope): Promise<void>;
	/** Defaults to AUTO_PICK_EXCLUSION. */
	autoPickExclusion?: boolean;
	loadTimeoutMs?: number;
	suggestTimeoutMs?: number;
}

/** Why a download or a load ended in failure, in words the Me screen can use. */
export type FailureReason =
	| "offline"
	| "storage"
	| "load"
	| "stopped"
	| "unsupported";

/** What the Me screen shows. Only the Me screen ever shows it: nothing else in the app reacts to an update or a failure. */
export type DownloadState =
	/** The default. `note` explains a switch-off the person did not ask for. */
	| { kind: "notDownloaded"; note: "crash" | "evicted" | null }
	/** A download of an older asset version is on the device and cannot run with this build. */
	| { kind: "updateAvailable" }
	/** The person pressed Download. `progress` is 0 to 1, or null before the first byte. */
	| { kind: "downloading"; progress: number | null }
	/** Loading the stored copy. */
	| { kind: "loading" }
	/** Downloaded; suggestions work (the model loads from the device when the app wants it). */
	| { kind: "ready" }
	| { kind: "failed"; reason: FailureReason };

/** What the screens read: a new `engine` object whenever anything below changes. */
export interface EmojiSnapshot {
	engine: EmojiEngine;
	/** The person pressed Download on this device and has not removed it. */
	optedIn: boolean;
	download: DownloadState;
}

export interface EmojiController {
	getSnapshot(): EmojiSnapshot;
	subscribe(listener: () => void): () => void;
	/** The person opened a screen that wants suggestions: load the stored copy if there is one. Never downloads. */
	wake(): void;
	/** Background load after the first sync. Same rules as `wake`, and skipped in the app start that found a crash. Never downloads. */
	warmUp(): void;
	/** The Download button: opts in and downloads (or loads the stored copy). The only way anything is downloaded. */
	download(): Promise<void>;
	/** The Cancel and Remove download buttons: stops the engine, deletes every stored version, opts out. */
	remove(): Promise<void>;
	dispose(): void;
}

export const LOAD_TIMEOUT_MS = 60_000;
export const SUGGEST_TIMEOUT_MS = 2_000;
const BAD_RESULTS_IN_A_ROW = 3;
const STRIKES_TO_SWITCH_OFF = 2;
const FAILED_STARTS_TO_STOP = 3;
const MAX_SUGGESTIONS = 3;
const MIN_TITLE = 3;
const MIN_QUERY = 2;
const INIT_ID = 0;

type Phase = "idle" | "loading" | "ready" | "unavailable";
type Mode = "download" | "cache";
type Failure = FailureKind | "timeout";
interface Pending {
	resolve(indices: number[]): void;
	timer: ReturnType<typeof setTimeout>;
}

const isReply = (data: unknown): data is WorkerReply =>
	typeof data === "object" &&
	data !== null &&
	typeof (data as { type?: unknown }).type === "string";

const reasonFor = (kind: Failure): FailureReason =>
	kind === "offline" ? "offline" : kind === "quota" ? "storage" : "load";

export function createEmojiController(deps: ControllerDeps): EmojiController {
	const { storage, version } = deps;
	const loadTimeoutMs = deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
	const suggestTimeoutMs = deps.suggestTimeoutMs ?? SUGGEST_TIMEOUT_MS;
	const exclusion = deps.autoPickExclusion ?? AUTO_PICK_EXCLUSION;

	let optedIn = storage.readOptedIn();
	let autoOff = storage.readAutoOff();
	let installed = storage.readInstalled();
	let phase: Phase = "idle";
	let mode: Mode = "cache";
	let progress: number | null = null;
	let failure: FailureReason | null = null;
	let evicted = false;
	let crashedAtStart = false;
	let countedThisStart = false;
	let generation = 0;
	let worker: WorkerLike | null = null;
	let catalog: EmojiEntry[] = [];
	let loadTimer: ReturnType<typeof setTimeout> | undefined;
	let badInARow = 0;
	let nextId = INIT_ID + 1;
	const pending = new Map<number, Pending>();
	const listeners = new Set<() => void>();
	/** Deletions of stored files run one after another, and a download waits for them, so it never loses fresh files. */
	let cleanup: Promise<void> = Promise.resolve();
	const warn = (what: string, error: unknown) =>
		console.warn(`[emoji] ${what}`, error);
	function deleteStored(scope: CacheScope): Promise<void> {
		cleanup = cleanup
			.then(() => deps.deleteCaches(scope))
			.catch((error) =>
				warn(`could not delete stored files (${scope})`, error),
			);
		return cleanup;
	}

	// A "loading" marker still set means the last attempt never finished: the app crashed or reloaded.
	const saved = storage.readState(version);
	if (saved.loading) {
		crashedAtStart = true;
		const next = { ...saved, loading: false, strikes: saved.strikes + 1 };
		storage.writeState(next);
		if (next.strikes >= STRIKES_TO_SWITCH_OFF) {
			// A device that cannot hold the model should not keep it either.
			optedIn = false;
			installed = null;
			autoOff = "crash";
			storage.writeOptedIn(false);
			storage.writeInstalled(null);
			storage.writeAutoOff("crash");
			void deleteStored("all");
		}
	}
	// An opt-in only lasts once a download has finished: after an interrupted first download
	// the next app start is back to the default.
	if (optedIn && installed === null) {
		optedIn = false;
		storage.writeOptedIn(false);
	}

	const status = (): EmojiEngineStatus =>
		!optedIn ? "off" : phase === "idle" ? "unavailable" : phase;

	function downloadState(): DownloadState {
		if (failure === "unsupported") return { kind: "failed", reason: failure };
		if (!optedIn)
			return {
				kind: "notDownloaded",
				note: autoOff === "crash" ? "crash" : evicted ? "evicted" : null,
			};
		if (failure !== null) return { kind: "failed", reason: failure };
		if (phase === "loading")
			return mode === "download"
				? { kind: "downloading", progress }
				: { kind: "loading" };
		if (phase === "ready") return { kind: "ready" };
		if (installed === version) return { kind: "ready" };
		return installed !== null
			? { kind: "updateAvailable" }
			: { kind: "notDownloaded", note: null };
	}

	function pick(indices: number[], autoPick: boolean): string[] {
		const seen = new Set<string>();
		const emoji: string[] = [];
		for (const index of indices) {
			const entry = catalog[index];
			if (!entry || !isEmoji(entry.e)) continue;
			if (autoPick && exclusion && isAutoPickExcluded(entry)) continue;
			const key = emojiKey(entry.e);
			if (seen.has(key)) continue;
			seen.add(key);
			emoji.push(entry.e);
		}
		return emoji;
	}

	function rankText(text: string): Promise<number[]> {
		const target = worker;
		if (phase !== "ready" || !target) return Promise.resolve([]);
		return new Promise((resolve) => {
			const id = nextId++;
			// A reply after the timeout finds no pending entry and is ignored.
			const timer = setTimeout(() => {
				pending.delete(id);
				resolve([]);
				countBadResult();
			}, suggestTimeoutMs);
			pending.set(id, { resolve, timer });
			target.postMessage({ type: "rank", id, text });
		});
	}

	function countBadResult() {
		badInARow++;
		if (badInARow >= BAD_RESULTS_IN_A_ROW) void fail("runtime", generation);
	}

	const engineFor = (current: EmojiEngineStatus): EmojiEngine => ({
		status: current,
		async suggest(title: string, options?: SuggestOptions) {
			const text = title.trim().slice(0, MAX_TITLE);
			if (text.length < MIN_TITLE || phase !== "ready") return [];
			return pick(await rankText(text), options?.autoPick === true).slice(
				0,
				MAX_SUGGESTIONS,
			);
		},
		async search(query: string) {
			const text = query.trim().slice(0, MAX_TITLE);
			if (text.length < MIN_QUERY || phase !== "ready") return [];
			return pick(await rankText(text), false);
		},
		wake,
	});

	let engine = engineFor(status());
	let snapshot: EmojiSnapshot = {
		engine,
		optedIn,
		download: downloadState(),
	};
	const rebuild = () => {
		// A new engine object only when the status changes; progress alone keeps the same one.
		if (engine.status !== status()) engine = engineFor(status());
		snapshot = { engine, optedIn, download: downloadState() };
	};
	function publish() {
		rebuild();
		for (const listener of [...listeners]) listener();
	}

	/** Written before the model loads: found set at the next start, the load crashed the app. */
	function setMarker() {
		storage.writeState({ ...storage.readState(version), loading: true });
	}

	/** The attempt ended on purpose (not by a crash), so it must not count as one. */
	function clearMarker() {
		const state = storage.readState(version);
		if (state.loading) storage.writeState({ ...state, loading: false });
	}

	function stopWorker() {
		clearTimeout(loadTimer);
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.resolve([]);
		}
		pending.clear();
		const old = worker;
		worker = null;
		if (old) {
			old.onmessage = old.onerror = old.onmessageerror = null;
			old.terminate();
		}
	}

	/** Every failure ends here: the worker is gone, the engine is unavailable for this app start. */
	async function fail(kind: Failure, owner: number) {
		if (owner !== generation || (phase !== "loading" && phase !== "ready"))
			return;
		stopWorker();
		progress = null;
		if (kind === "uncached") {
			// The browser evicted the stored copy. Not a failure: back to the default, Download again.
			clearMarker();
			installed = null;
			optedIn = false;
			evicted = true;
			storage.writeInstalled(null);
			storage.writeOptedIn(false);
			phase = "idle";
			publish();
			return;
		}
		phase = "unavailable";
		failure = reasonFor(kind);
		// A device that is simply offline has not failed; every other failure counts toward stopping.
		const counts = kind !== "offline" && !countedThisStart;
		countedThisStart ||= kind !== "offline";
		const state = storage.readState(version);
		storage.writeState({
			...state,
			loading: false,
			failedStarts: state.failedStarts + (counts ? 1 : 0),
		});
		if (kind === "corrupt") {
			// The files are stored but could not be loaded: drop them so Try again downloads them anew.
			installed = null;
			storage.writeInstalled(null);
		}
		publish();
		if (kind === "corrupt") await deleteStored("thisVersion");
	}

	/** Gives the load another `loadTimeoutMs`: a slow download is fine while bytes keep arriving. */
	function armLoadTimer(owner: number) {
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => void fail("timeout", owner), loadTimeoutMs);
	}

	function onMessage(data: unknown, owner: number) {
		if (owner !== generation || !isReply(data)) return;
		if (data.type === "error") {
			void fail(data.kind, owner);
		} else if (data.type === "progress") {
			if (phase !== "loading" || data.total <= 0) return;
			progress = Math.min(1, Math.max(0, data.loaded / data.total));
			// Closing the tab mid-download is not a crash: only the model load after the last byte can be one.
			if (mode === "download" && data.loaded >= data.total) setMarker();
			armLoadTimer(owner);
			publish();
		} else if (data.type === "ready") {
			if (phase !== "loading") return;
			clearTimeout(loadTimer);
			storage.writeState({
				version,
				loading: false,
				strikes: 0,
				failedStarts: 0,
			});
			installed = version;
			storage.writeInstalled(version);
			progress = null;
			phase = "ready";
			publish();
			// Older versions are unusable with this build: drop them now that this one is installed.
			void deleteStored("otherVersions");
		} else if (data.type === "ranked") {
			const entry = pending.get(data.id);
			if (!entry) return;
			pending.delete(data.id);
			clearTimeout(entry.timer);
			const valid =
				Array.isArray(data.indices) &&
				data.indices.length <= SHORTLIST &&
				data.indices.every(
					(index) =>
						Number.isInteger(index) && index >= 0 && index < catalog.length,
				);
			if (valid) {
				badInARow = 0;
				entry.resolve(data.indices);
			} else {
				entry.resolve([]);
				countBadResult();
			}
		}
	}

	async function load(next: Mode) {
		const owner = ++generation;
		mode = next;
		phase = "loading";
		progress = null;
		publish();
		// A download starts the marker only once its bytes have all arrived (see onMessage).
		if (next === "cache") setMarker();
		try {
			catalog = await deps.loadCatalog();
		} catch (error) {
			warn("could not load the catalog", error);
			await fail("load", owner);
			return;
		}
		if (owner !== generation) return;
		try {
			const created = deps.createWorker();
			worker = created;
			created.onmessage = (event) => onMessage(event.data, owner);
			created.onerror = () => void fail("runtime", owner);
			created.onmessageerror = () => void fail("runtime", owner);
			armLoadTimer(owner);
			created.postMessage({
				type: "init",
				id: INIT_ID,
				count: catalog.length,
				allowNetwork: next === "download",
				totalBytes: deps.downloadBytes,
			});
		} catch (error) {
			warn("could not start the worker", error);
			await fail("load", owner);
		}
	}

	/** Loads the stored copy. Never touches the network: the worker answers `uncached` if there is none. */
	function startFromStored(source: "wake" | "warmUp") {
		if (!optedIn || phase !== "idle" || installed !== version) return;
		if (source === "warmUp" && crashedAtStart) return;
		if (!deps.supported()) {
			phase = "unavailable";
			failure = "unsupported";
			publish();
			return;
		}
		if (storage.readState(version).failedStarts >= FAILED_STARTS_TO_STOP) {
			phase = "unavailable";
			failure = "stopped";
			publish();
			return;
		}
		void load("cache");
	}

	function wake() {
		startFromStored("wake");
	}

	function reset() {
		generation++;
		stopWorker();
		clearMarker();
		progress = null;
		failure = null;
		evicted = false;
		countedThisStart = false;
		badInARow = 0;
		phase = "idle";
	}

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		wake,
		warmUp: () => startFromStored("warmUp"),
		async download() {
			await cleanup;
			if (phase === "ready" || (phase === "loading" && mode === "download"))
				return;
			reset();
			if (!deps.supported()) {
				phase = "unavailable";
				failure = "unsupported";
				publish();
				return;
			}
			optedIn = true;
			autoOff = null;
			storage.writeOptedIn(true);
			storage.writeAutoOff(null);
			// Strikes stay (crashes are counted until a success); the failed-start count starts over.
			storage.writeState({ ...storage.readState(version), failedStarts: 0 });
			await load("download");
		},
		async remove() {
			reset();
			optedIn = false;
			installed = null;
			autoOff = null;
			storage.writeOptedIn(false);
			storage.writeInstalled(null);
			storage.writeAutoOff(null);
			publish();
			await deleteStored("all");
		},
		/** Stops everything and returns to "not started", so a screen that mounts again can wake it. */
		dispose() {
			generation++;
			stopWorker();
			clearMarker();
			listeners.clear();
			// Same rule as the next start: an opt-in without a finished download does not last.
			if (optedIn && installed === null) {
				optedIn = false;
				storage.writeOptedIn(false);
			}
			phase = "idle";
			progress = null;
			failure = null;
			countedThisStart = false;
			badInARow = 0;
			rebuild();
		},
	};
}
