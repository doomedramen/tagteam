/** Messages between the main thread (engine.ts) and the emoji worker (worker.ts). */

export type WorkerRequest =
	/**
	 * Load the index and the model, then answer `ready`. `count` is the number of catalog entries
	 * the index must have. With `allowNetwork` false the worker only loads a model that is already
	 * stored on the device and answers `uncached` otherwise: nothing is downloaded. `totalBytes` is
	 * the size of a full download, for `progress`.
	 */
	| {
			type: "init";
			id: number;
			count: number;
			allowNetwork: boolean;
			totalBytes: number;
	  }
	/** Embed `text` and answer `ranked`. */
	| { type: "rank"; id: number; text: string };

/**
 * Why the worker failed.
 * - `uncached`: a load that may not use the network found the model is not stored on the device.
 * - `offline`: files were not stored on the device and the device is offline.
 * - `quota`: the browser refused to store the files.
 * - `corrupt`: files were stored on the device and loading the model still failed (a failed fetch of the
 *   index files is `load`, never `corrupt`: it says nothing about the stored model).
 * - `index`: index.bin files do not match the catalog.
 * - `load`: loading failed for any other reason (a missing file, a failed download or index fetch, no memory).
 * - `runtime`: the worker failed while answering.
 */
export type FailureKind =
	| "uncached"
	| "offline"
	| "quota"
	| "corrupt"
	| "index"
	| "load"
	| "runtime";

export type WorkerReply =
	| { type: "ready"; id: number }
	/** Bytes downloaded so far (at most `total`), sent when the whole-number percentage changes. */
	| { type: "progress"; id: number; loaded: number; total: number }
	/** Catalog positions, best first, with their scores. */
	| { type: "ranked"; id: number; indices: number[]; scores: number[] }
	/** `id` is null for a failure that belongs to no request (an uncaught error). */
	| { type: "error"; id: number | null; kind: FailureKind; message: string };
