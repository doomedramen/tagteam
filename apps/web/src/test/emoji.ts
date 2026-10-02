import { type Mock, vi } from "vitest";
import type {
	EmojiController,
	EmojiSnapshot,
	WorkerLike,
} from "../features/emoji/controller";
import type { EmojiEngine } from "../features/emoji/engine";
import type {
	EngineStorage,
	PersistedState,
} from "../features/emoji/engine-storage";
import type { WorkerRequest } from "../features/emoji/worker-protocol";

/** A Web Worker the test drives by hand: `reply()` is the worker talking, `sent` is what the engine asked. */
export class FakeWorker implements WorkerLike {
	sent: WorkerRequest[] = [];
	terminated = false;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onmessageerror: ((event: unknown) => void) | null = null;
	postMessage(request: WorkerRequest) {
		this.sent.push(request);
	}
	terminate() {
		this.terminated = true;
	}
	reply(data: unknown) {
		this.onmessage?.({ data });
	}
	/** The most recent request of a type. */
	last<T extends WorkerRequest["type"]>(type: T) {
		return this.sent.filter((request) => request.type === type).at(-1) as
			| Extract<WorkerRequest, { type: T }>
			| undefined;
	}
}

/** EngineStorage in memory, so tests can set the crash marker and read what the engine wrote. */
export function memoryEngineStorage(
	initial: {
		optedIn?: boolean;
		autoOff?: "crash" | null;
		installed?: string | null;
		state?: Partial<PersistedState>;
	} = {},
): EngineStorage & {
	optedIn: boolean;
	autoOff: "crash" | null;
	installed: string | null;
	state: PersistedState | null;
} {
	const store = {
		optedIn: initial.optedIn ?? false,
		autoOff: initial.autoOff ?? null,
		installed: initial.installed ?? null,
		state: initial.state
			? ({
					version: "v1",
					loading: false,
					strikes: 0,
					failedStarts: 0,
					...initial.state,
				} as PersistedState)
			: null,
	};
	return Object.assign(store, {
		readOptedIn: () => store.optedIn,
		writeOptedIn: (value: boolean) => {
			store.optedIn = value;
		},
		readAutoOff: () => store.autoOff,
		writeAutoOff: (value: "crash" | null) => {
			store.autoOff = value;
		},
		readInstalled: () => store.installed,
		writeInstalled: (value: string | null) => {
			store.installed = value;
		},
		readState: (version: string): PersistedState =>
			store.state && store.state.version === version
				? { ...store.state }
				: { version, loading: false, strikes: 0, failedStarts: 0 },
		writeState: (state: PersistedState) => {
			store.state = { ...state };
		},
	});
}

/** An EmojiEngine for screen tests. Ready by default; `suggest` answers with the emoji given. */
export function fakeEmojiEngine(
	overrides: Partial<EmojiEngine> = {},
): EmojiEngine & {
	suggest: ReturnType<typeof vi.fn>;
	search: ReturnType<typeof vi.fn>;
	wake: ReturnType<typeof vi.fn>;
} {
	return {
		status: "ready",
		suggest: vi.fn(async () => [] as string[]),
		search: vi.fn(async () => [] as string[]),
		wake: vi.fn(),
		...overrides,
	} as EmojiEngine & {
		suggest: ReturnType<typeof vi.fn>;
		search: ReturnType<typeof vi.fn>;
		wake: ReturnType<typeof vi.fn>;
	};
}

/** An EmojiController for host and Me tests: `change()` publishes a new snapshot to subscribers. */
export function fakeEmojiController(initial: Partial<EmojiSnapshot> = {}) {
	let snapshot: EmojiSnapshot = {
		engine: {
			status: "off",
			suggest: async () => [],
			search: async () => [],
		},
		optedIn: false,
		download: { kind: "notDownloaded", note: null },
		...initial,
	};
	const listeners = new Set<() => void>();
	const controller: EmojiController & {
		wake: Mock<() => void>;
		warmUp: Mock<() => void>;
		download: Mock<() => Promise<void>>;
		remove: Mock<() => Promise<void>>;
		dispose: Mock<() => void>;
	} = {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		wake: vi.fn<() => void>(),
		warmUp: vi.fn<() => void>(),
		download: vi.fn<() => Promise<void>>(async () => {}),
		remove: vi.fn<() => Promise<void>>(async () => {}),
		dispose: vi.fn<() => void>(),
	};
	const change = (
		next: Partial<Omit<EmojiSnapshot, "engine">> & {
			status?: EmojiEngine["status"];
		},
	) => {
		const { status, ...rest } = next;
		snapshot = {
			...snapshot,
			...rest,
			engine: { ...snapshot.engine, status: status ?? snapshot.engine.status },
		};
		for (const listener of listeners) listener();
	};
	return { controller, change };
}
