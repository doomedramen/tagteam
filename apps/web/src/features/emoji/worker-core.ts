import { EMOJI_ASSETS_ROOT } from "./assets";
import { BIT_BYTES, DIM, type EmojiIndex, rank } from "./search";
import type {
	FailureKind,
	WorkerReply,
	WorkerRequest,
} from "./worker-protocol";

export interface Embedder {
	/** The normalised 384-number embedding of `text`. */
	embed(text: string): Promise<Float32Array>;
}

/** What the worker needs from its environment. Real implementations are in worker.ts; tests pass fakes. */
export interface WorkerDeps {
	/** True when every file of the model and the runtime is already stored in the Cache API. Never throws. */
	filesCached(): Promise<boolean>;
	loadIndex(): Promise<{ bits: Uint8Array; int8: Int8Array }>;
	/**
	 * Loads the model; `onBytes(n)` reports the bytes downloaded so far. With `allowNetwork` false
	 * it must not make any request: a file that is not stored is a `NotCachedError`. The core passes
	 * this on so that the "never downloads" rule does not rest on the `filesCached()` pre-check
	 * alone (a file could be evicted between that check and the load).
	 */
	loadEmbedder(
		onBytes: (loaded: number) => void,
		options: { allowNetwork: boolean },
	): Promise<Embedder>;
	isOnline(): boolean;
	post(reply: WorkerReply): void;
}

/**
 * Wraps a `fetch` so that, while `allowed()` is false, any request for a model or runtime file
 * (a URL whose path starts with `/assets/emoji/`) is rejected with a NotCachedError before it
 * reaches the network. Everything else, such as the index files under `/assets/`, passes through.
 * `base` resolves relative URLs the way the worker would.
 */
export function createNetworkGuard(
	real: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	base: string,
	allowed: () => boolean,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
	return (input, init) => {
		if (!allowed()) {
			const raw =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			let path = "";
			try {
				path = new URL(raw, base).pathname;
			} catch {
				// An unparseable URL cannot be a model file; let fetch reject it.
			}
			if (path.startsWith(EMOJI_ASSETS_ROOT))
				return Promise.reject(new NotCachedError());
		}
		return real(input, init);
	};
}

export class NotCachedError extends Error {
	constructor() {
		super("the model is not stored on this device");
		this.name = "NotCachedError";
	}
}

/** loadIndex failed (a failed fetch of bits.bin or int8.bin). Never a reason to delete the model. */
class IndexLoadError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.name = "IndexLoadError";
	}
}

class IndexMismatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IndexMismatchError";
	}
}

export function classifyFailure(
	error: unknown,
	context: { filesCached: boolean; online: boolean },
): FailureKind {
	const name = error instanceof Error ? error.name : "";
	const message = error instanceof Error ? error.message : String(error);
	if (name === "QuotaExceededError" || /quota/i.test(message)) return "quota";
	if (name === "NotCachedError") return "uncached";
	if (name === "IndexMismatchError") return "index";
	// A failed fetch of the index says nothing about the stored model: never "corrupt".
	if (name === "IndexLoadError") return "load";
	if (context.filesCached) return "corrupt";
	if (!context.online) return "offline";
	return "load";
}

const messageOf = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Returns the function that handles one request. Requests are answered one at a time, in order. */
export function createWorkerCore(
	deps: WorkerDeps,
): (request: WorkerRequest) => Promise<void> {
	let index: EmojiIndex | null = null;
	let embedder: Embedder | null = null;
	let queue: Promise<void> = Promise.resolve();
	/** A closed port must not stop the queue: a reply that cannot be posted is dropped. */
	const post = (reply: WorkerReply) => {
		try {
			deps.post(reply);
		} catch {
			// Nothing else can be done with it.
		}
	};

	async function init(
		id: number,
		count: number,
		allowNetwork: boolean,
		totalBytes: number,
	) {
		let filesCached = false;
		try {
			try {
				filesCached = await deps.filesCached();
			} catch {
				filesCached = false;
			}
			if (!allowNetwork && !filesCached) throw new NotCachedError();
			const files = await deps.loadIndex().catch((error) => {
				throw new IndexLoadError(error);
			});
			if (
				files.bits.length !== count * BIT_BYTES ||
				files.int8.length !== count * DIM
			)
				throw new IndexMismatchError(
					`index holds ${Math.floor(files.bits.length / BIT_BYTES)} emoji, catalog has ${count}`,
				);
			let percent = -1;
			const loaded = await deps.loadEmbedder(
				(bytes) => {
					const done = Math.min(Math.max(bytes, 0), totalBytes);
					const next =
						totalBytes > 0 ? Math.floor((done / totalBytes) * 100) : 0;
					if (next === percent) return;
					percent = next;
					post({ type: "progress", id, loaded: done, total: totalBytes });
				},
				{ allowNetwork },
			);
			await loaded.embed("warm up");
			index = { count, bits: files.bits, int8: files.int8 };
			embedder = loaded;
			post({ type: "ready", id });
		} catch (error) {
			post({
				type: "error",
				id,
				kind: classifyFailure(error, {
					filesCached,
					online: deps.isOnline(),
				}),
				message: messageOf(error),
			});
		}
	}

	async function search(id: number, text: string) {
		try {
			if (!index || !embedder) throw new Error("the worker is not initialised");
			const ranked = rank(await embedder.embed(text), index);
			post({ type: "ranked", id, ...ranked });
		} catch (error) {
			post({
				type: "error",
				id,
				kind: "runtime",
				message: messageOf(error),
			});
		}
	}

	return (request) => {
		queue = queue.then(() =>
			(request.type === "init"
				? init(
						request.id,
						request.count,
						request.allowNetwork,
						request.totalBytes,
					)
				: search(request.id, request.text)
			).catch(() => {}),
		);
		return queue;
	};
}
