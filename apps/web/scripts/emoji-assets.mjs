// Fetching and checking the emoji model files. Used by scripts/fetch-emoji-assets.mjs (the command),
// by vite.config.ts and vitest.config.ts (for the asset version) and by tests.
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const WEB_ROOT = join(import.meta.dirname, "..");
export const MANIFEST_PATH = join(WEB_ROOT, "emoji-assets.json");
export const ASSETS_ROOT = join(WEB_ROOT, "public/assets/emoji");

export const loadManifest = (path = MANIFEST_PATH) =>
	JSON.parse(readFileSync(path, "utf8"));

const digestOf = (files) =>
	createHash("sha256")
		.update(
			files
				.map((file) => `${file.path}:${file.sha256}`)
				.sort()
				.join("\n"),
		)
		.digest("hex");

/**
 * A digest of the model files' checksums. The committed index is built for exactly these files
 * (index.json records the digest), so a model that digests differently needs a rebuilt index.
 */
export const modelFilesDigest = (manifest) => digestOf(manifest.model.files);

/**
 * The folder name under /assets/emoji/: the first 12 hex digits of a digest of every model and
 * runtime file checksum. It changes exactly when a byte the device runs changes (the model, the
 * tokenizer, or the ONNX Runtime glue and wasm), so a cached copy of one version is never used
 * as another, and re-pinning the model repository to a new revision with identical files keeps
 * the version, and the device's download, as it is.
 */
export function assetVersion(manifest) {
	return digestOf([...manifest.model.files, ...manifest.runtime.files]).slice(
		0,
		12,
	);
}

/** Bytes a device downloads for one version: every model and runtime file. */
export const downloadBytes = (manifest) =>
	[...manifest.model.files, ...manifest.runtime.files].reduce(
		(sum, file) => sum + file.bytes,
		0,
	);

export const modelUrl = (manifest, file) =>
	`https://huggingface.co/${manifest.model.id}/resolve/${manifest.model.revision}/${file.path}`;

export const sha256Of = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

/** "ok" when the file exists with the expected size and checksum, "missing" when absent, "bad" otherwise. */
export function checkFile(path, entry) {
	if (!existsSync(path)) return "missing";
	if (statSync(path).size !== entry.bytes) return "bad";
	return sha256Of(readFileSync(path)) === entry.sha256 ? "ok" : "bad";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Statuses worth another attempt: server errors, "request timeout" and "too many requests". */
const retryable = (status) => status >= 500 || status === 408 || status === 429;

/** Downloads `url`, retrying network failures, server errors, 408 and 429. Returns the bytes. */
export async function download(
	url,
	{ fetchImpl = fetch, attempts = 3, retryDelayMs = 2000 } = {},
) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetchImpl(url);
			if (response.ok) return Buffer.from(await response.arrayBuffer());
			lastError = new Error(`${url}: HTTP ${response.status}`);
			if (!retryable(response.status)) break;
		} catch (error) {
			lastError = error;
		}
		if (attempt < attempts) await sleep(retryDelayMs);
	}
	throw lastError;
}

function writeVerified(path, bytes, entry) {
	if (bytes.length !== entry.bytes || sha256Of(bytes) !== entry.sha256)
		throw new Error(
			`checksum mismatch for ${entry.path}: expected ${entry.sha256} (${entry.bytes} bytes), got ${sha256Of(bytes)} (${bytes.length} bytes)`,
		);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.part`;
	try {
		writeFileSync(temporary, bytes);
		renameSync(temporary, path);
	} catch (error) {
		// A half-written .part file must not stay: a later vite build would copy it into dist.
		rmSync(temporary, { force: true });
		throw error;
	}
}

/** The model repository's current `main` revision, from the Hugging Face API. */
export async function currentRevision(modelId, fetchImpl = fetch) {
	const url = `https://huggingface.co/api/models/${modelId}`;
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const { sha } = await response.json();
	if (typeof sha !== "string" || sha === "")
		throw new Error(`${url}: the response has no revision (sha)`);
	return sha;
}

/** The folder onnxruntime-web's files live in: next to transformers.js in node_modules, whatever the package manager. */
export function findOrtDist(webRoot = WEB_ROOT) {
	const transformers = realpathSync(
		join(webRoot, "node_modules/@huggingface/transformers"),
	);
	return join(transformers, "..", "..", "onnxruntime-web", "dist");
}

export function installedTransformersVersion(webRoot = WEB_ROOT) {
	const transformers = realpathSync(
		join(webRoot, "node_modules/@huggingface/transformers"),
	);
	return JSON.parse(readFileSync(join(transformers, "package.json"), "utf8"))
		.version;
}

/**
 * Puts every file of the manifest under `<root>/<version>/` (models/<id>/<path> and ort/<file>),
 * keeps files that already pass their checksum, removes folders of other versions, and returns
 * what it did. Throws on a checksum mismatch or when a file cannot be fetched.
 */
export async function fetchEmojiAssets({
	manifest,
	root = ASSETS_ROOT,
	ortDist,
	transformersVersion,
	fetchImpl = fetch,
	attempts,
	retryDelayMs,
	log = () => {},
}) {
	if (transformersVersion !== manifest.runtime.transformers)
		throw new Error(
			`@huggingface/transformers ${transformersVersion} is installed but emoji-assets.json pins ${manifest.runtime.transformers}; run \`pnpm --filter @tagteam/web emoji:assets -- --update\``,
		);
	const version = assetVersion(manifest);
	const dir = join(root, version);
	const result = {
		version,
		dir,
		downloaded: [],
		kept: [],
		copied: [],
		pruned: [],
	};

	for (const file of manifest.model.files) {
		const destination = join(dir, "models", manifest.model.id, file.path);
		if (checkFile(destination, file) === "ok") {
			result.kept.push(file.path);
			continue;
		}
		log(`downloading ${file.path} (${file.bytes} bytes)`);
		const bytes = await download(modelUrl(manifest, file), {
			fetchImpl,
			attempts,
			retryDelayMs,
		});
		writeVerified(destination, bytes, file);
		result.downloaded.push(file.path);
	}

	for (const file of manifest.runtime.files) {
		const destination = join(dir, "ort", file.path);
		if (checkFile(destination, file) === "ok") {
			result.kept.push(file.path);
			continue;
		}
		log(`copying ${file.path} from onnxruntime-web`);
		writeVerified(destination, readFileSync(join(ortDist, file.path)), file);
		result.copied.push(file.path);
	}

	if (existsSync(root))
		for (const entry of readdirSync(root, { withFileTypes: true }))
			if (entry.name !== version) {
				rmSync(join(root, entry.name), { recursive: true, force: true });
				result.pruned.push(entry.name);
			}
	return result;
}

/**
 * Rebuilds the manifest for `revision`: downloads each model file at that revision and copies
 * the runtime files, recording size and checksum. A maintainer runs it when bumping the model
 * or `@huggingface/transformers`, then reviews the diff.
 */
export async function buildManifest({
	manifest,
	revision,
	ortDist,
	transformersVersion,
	ortVersion,
	fetchImpl = fetch,
	attempts,
	retryDelayMs,
}) {
	const pinned = { ...manifest.model, revision };
	const describe = (path, bytes) => ({
		path,
		sha256: sha256Of(bytes),
		bytes: bytes.length,
	});
	const modelFiles = [];
	for (const file of manifest.model.files)
		modelFiles.push(
			describe(
				file.path,
				await download(modelUrl({ model: pinned }, file), {
					fetchImpl,
					attempts,
					retryDelayMs,
				}),
			),
		);
	const runtimeFiles = manifest.runtime.files.map((file) =>
		describe(file.path, readFileSync(join(ortDist, file.path))),
	);
	return {
		model: { id: manifest.model.id, revision, files: modelFiles },
		runtime: {
			transformers: transformersVersion,
			onnxruntimeWeb: ortVersion,
			files: runtimeFiles,
		},
	};
}
