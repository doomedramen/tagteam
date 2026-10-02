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

export class NotCachedError extends Error {
	constructor() {
		super("the model is not stored on this device");
		this.name = "NotCachedError";
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

	async function init(
		id: number,
		count: number,
		allowNetwork: boolean,
		totalBytes: number,
	) {
		const filesCached = await deps.filesCached();
		try {
			if (!allowNetwork && !filesCached) throw new NotCachedError();
			const files = await deps.loadIndex();
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
					deps.post({ type: "progress", id, loaded: done, total: totalBytes });
				},
				{ allowNetwork },
			);
			await loaded.embed("warm up");
			index = { count, bits: files.bits, int8: files.int8 };
			embedder = loaded;
			deps.post({ type: "ready", id });
		} catch (error) {
			deps.post({
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
			deps.post({ type: "ranked", id, ...ranked });
		} catch (error) {
			deps.post({
				type: "error",
				id,
				kind: "runtime",
				message: messageOf(error),
			});
		}
	}

	return (request) => {
		queue = queue.then(() =>
			request.type === "init"
				? init(
						request.id,
						request.count,
						request.allowNetwork,
						request.totalBytes,
					)
				: search(request.id, request.text),
		);
		return queue;
	};
}
