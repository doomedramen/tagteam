import { execFile, execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assetVersion,
	buildManifest,
	checkFile,
	currentRevision,
	download,
	downloadBytes,
	type EmojiAssetManifest,
	fetchEmojiAssets,
	loadManifest,
	modelFilesDigest,
	sha256Of,
} from "./emoji-assets.mjs";

const bytes = (text: string) => Buffer.from(text);
const entry = (path: string, text: string) => ({
	path,
	sha256: sha256Of(bytes(text)),
	bytes: bytes(text).length,
});

const REVISION = "a".repeat(40);
const manifest: EmojiAssetManifest = {
	model: {
		id: "Org/tiny-model",
		revision: REVISION,
		files: [entry("config.json", "{}"), entry("onnx/model.onnx", "weights")],
	},
	runtime: {
		transformers: "9.9.9",
		onnxruntimeWeb: "1.0.0",
		files: [entry("ort.mjs", "glue"), entry("ort.wasm", "wasm")],
	},
};
const CONTENT: Record<string, string> = {
	"config.json": "{}",
	"onnx/model.onnx": "weights",
};

let root: string;
let ortDist: string;
beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "emoji-assets-"));
	root = join(dir, "emoji");
	ortDist = join(dir, "ort-dist");
	mkdirSync(ortDist);
	writeFileSync(join(ortDist, "ort.mjs"), "glue");
	writeFileSync(join(ortDist, "ort.wasm"), "wasm");
});
afterEach(() => rmSync(join(root, ".."), { recursive: true, force: true }));

function fakeFetch(overrides: Record<string, () => Response> = {}) {
	return vi.fn(async (url: string) => {
		const path = url.replace(
			`https://huggingface.co/Org/tiny-model/resolve/${REVISION}/`,
			"",
		);
		const override = overrides[path];
		if (override) return override();
		return new Response(CONTENT[path] ?? "", {
			status: path in CONTENT ? 200 : 404,
		});
	});
}
const run = (fetchImpl: ReturnType<typeof fakeFetch>, extra = {}) =>
	fetchEmojiAssets({
		manifest,
		root,
		ortDist,
		transformersVersion: "9.9.9",
		fetchImpl,
		retryDelayMs: 0,
		...extra,
	});

describe("assetVersion", () => {
	it("is 12 hex digits and does not depend on file order", () => {
		const version = assetVersion(manifest);
		expect(version).toMatch(/^[0-9a-f]{12}$/);
		const reordered = {
			...manifest,
			model: { ...manifest.model, files: [...manifest.model.files].reverse() },
		};
		expect(assetVersion(reordered)).toBe(version);
	});

	it("changes with any file checksum, but not with the revision alone", () => {
		const version = assetVersion(manifest);
		expect(
			assetVersion({
				...manifest,
				model: { ...manifest.model, revision: "b".repeat(40) },
			}),
		).toBe(version);
		expect(
			assetVersion({
				...manifest,
				runtime: {
					...manifest.runtime,
					files: [entry("ort.mjs", "glue"), entry("ort.wasm", "other wasm")],
				},
			}),
		).not.toBe(version);
		expect(
			assetVersion({
				...manifest,
				model: {
					...manifest.model,
					files: [
						entry("config.json", "{}"),
						entry("onnx/model.onnx", "new weights"),
					],
				},
			}),
		).not.toBe(version);
	});
});

describe("modelFilesDigest and downloadBytes", () => {
	it("digest only the model files, so a runtime change keeps the index valid", () => {
		const digest = modelFilesDigest(manifest);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(
			modelFilesDigest({
				...manifest,
				runtime: { ...manifest.runtime, files: [entry("ort.wasm", "other")] },
			}),
		).toBe(digest);
		expect(
			modelFilesDigest({
				...manifest,
				model: { ...manifest.model, files: [entry("onnx/model.onnx", "new")] },
			}),
		).not.toBe(digest);
	});

	it("add up every file a device downloads", () => {
		expect(downloadBytes(manifest)).toBe(2 + 7 + 4 + 4);
	});
});

describe("committed manifest", () => {
	it("pins a full revision and a checksum and size for every file", () => {
		const committed = loadManifest();
		expect(committed.model.revision).toMatch(/^[0-9a-f]{40}$/);
		expect(committed.model.files.map((file) => file.path).sort()).toEqual([
			"config.json",
			"onnx/model_quantized.onnx",
			"tokenizer.json",
			"tokenizer_config.json",
		]);
		for (const file of [...committed.model.files, ...committed.runtime.files]) {
			expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
			expect(file.bytes, file.path).toBeGreaterThan(0);
		}
		expect(committed.runtime.files.map((file) => file.path).sort()).toEqual([
			"ort-wasm-simd-threaded.mjs",
			"ort-wasm-simd-threaded.wasm",
		]);
	});
});

describe("fetchEmojiAssets", () => {
	it("downloads the model, copies the runtime and verifies every file", async () => {
		const fetchImpl = fakeFetch();
		const result = await run(fetchImpl);
		expect(result.downloaded).toEqual(["config.json", "onnx/model.onnx"]);
		expect(result.copied).toEqual(["ort.mjs", "ort.wasm"]);
		const dir = join(root, assetVersion(manifest));
		expect(result.dir).toBe(dir);
		expect(
			readFileSync(join(dir, "models/Org/tiny-model/onnx/model.onnx"), "utf8"),
		).toBe("weights");
		expect(readFileSync(join(dir, "ort/ort.wasm"), "utf8")).toBe("wasm");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("skips files that are present and pass their checksum", async () => {
		await run(fakeFetch());
		const fetchImpl = fakeFetch();
		const result = await run(fetchImpl);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.downloaded).toEqual([]);
		expect(result.kept).toHaveLength(4);
	});

	it("downloads again a file that is damaged or the wrong size", async () => {
		const first = await run(fakeFetch());
		const damaged = join(first.dir, "models/Org/tiny-model/config.json");
		writeFileSync(damaged, "{x}");
		expect(checkFile(damaged, manifest.model.files[0])).toBe("bad");
		const fetchImpl = fakeFetch();
		const result = await run(fetchImpl);
		expect(result.downloaded).toEqual(["config.json"]);
		expect(readFileSync(damaged, "utf8")).toBe("{}");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("rejects a download whose checksum differs and leaves nothing behind", async () => {
		const fetchImpl = fakeFetch({
			"onnx/model.onnx": () => new Response("tampered"),
		});
		await expect(run(fetchImpl)).rejects.toThrow(
			/checksum mismatch for onnx\/model\.onnx/,
		);
		const target = join(
			root,
			assetVersion(manifest),
			"models/Org/tiny-model/onnx/model.onnx",
		);
		expect(existsSync(target)).toBe(false);
		expect(existsSync(`${target}.part`)).toBe(false);
	});

	it("removes the .part file when storing a file fails", async () => {
		const target = join(
			root,
			assetVersion(manifest),
			"models/Org/tiny-model/config.json",
		);
		// A non-empty folder where the file belongs: the final rename cannot succeed.
		mkdirSync(join(target, "blocker"), { recursive: true });
		await expect(run(fakeFetch())).rejects.toThrow();
		expect(existsSync(`${target}.part`)).toBe(false);
	});

	it("rejects a runtime file that no longer matches the manifest", async () => {
		writeFileSync(join(ortDist, "ort.wasm"), "different runtime");
		await expect(run(fakeFetch())).rejects.toThrow(
			/checksum mismatch for ort\.wasm/,
		);
	});

	it("rejects an installed transformers.js that is not the pinned version", async () => {
		await expect(
			run(fakeFetch(), { transformersVersion: "9.9.8" }),
		).rejects.toThrow(
			/9\.9\.8 is installed but emoji-assets\.json pins 9\.9\.9/,
		);
	});

	it("retries a server error and gives up at once on a 404", async () => {
		let calls = 0;
		const flaky = fakeFetch({
			"config.json": () =>
				++calls < 3 ? new Response("", { status: 503 }) : new Response("{}"),
		});
		await run(flaky);
		expect(calls).toBe(3);

		const missing = fakeFetch({
			"config.json": () => new Response("", { status: 404 }),
		});
		await expect(run(missing, { root: join(root, "other") })).rejects.toThrow(
			/HTTP 404/,
		);
		expect(missing).toHaveBeenCalledTimes(1);
	});

	it("retries a 408 and a 429 like a server error", async () => {
		const statuses = [408, 429, 200];
		const fetchImpl = vi.fn(async () => {
			const status = statuses.shift() ?? 200;
			return new Response(status === 200 ? "ok" : "", { status });
		});
		const bytes = await download("https://t.test/x", {
			fetchImpl,
			retryDelayMs: 0,
		});
		expect(bytes.toString()).toBe("ok");
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const forbidden = vi.fn(async () => new Response("", { status: 403 }));
		await expect(
			download("https://t.test/x", { fetchImpl: forbidden, retryDelayMs: 0 }),
		).rejects.toThrow(/HTTP 403/);
		expect(forbidden).toHaveBeenCalledTimes(1);
	});

	it("removes folders of other versions", async () => {
		mkdirSync(join(root, "old-version"), { recursive: true });
		writeFileSync(join(root, "old-version", "file"), "x");
		const result = await run(fakeFetch());
		expect(result.pruned).toEqual(["old-version"]);
		expect(existsSync(join(root, "old-version"))).toBe(false);
	});
});

describe("buildManifest", () => {
	it("records the size and checksum of each file at the given revision", async () => {
		const next = await buildManifest({
			manifest,
			revision: "c".repeat(40),
			ortDist,
			transformersVersion: "9.9.9",
			ortVersion: "1.0.0",
			fetchImpl: vi.fn(async (url: string) => {
				expect(url).toContain(`/resolve/${"c".repeat(40)}/`);
				return new Response(url.endsWith("config.json") ? "{}" : "weights");
			}),
			retryDelayMs: 0,
		});
		expect(next.model.revision).toBe("c".repeat(40));
		expect(next.model.files).toEqual(manifest.model.files);
		expect(next.runtime.files).toEqual(manifest.runtime.files);
	});
});

describe("the command", () => {
	it("does nothing and succeeds when SKIP_EMOJI_MODEL=1", () => {
		const output = execFileSync(
			process.execPath,
			[join(import.meta.dirname, "fetch-emoji-assets.mjs")],
			{ encoding: "utf8", env: { ...process.env, SKIP_EMOJI_MODEL: "1" } },
		);
		expect(output).toContain("SKIP_EMOJI_MODEL is set");
	});
});

describe("currentRevision (--update)", () => {
	const api = (response: Response) => vi.fn(async () => response);

	it("returns the sha of the model's current revision", async () => {
		const fetchImpl = api(Response.json({ sha: REVISION }));
		await expect(currentRevision("Org/tiny-model", fetchImpl)).resolves.toBe(
			REVISION,
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://huggingface.co/api/models/Org/tiny-model",
		);
	});

	it("throws a clear error when the API answers with a failure or without a sha", async () => {
		await expect(
			currentRevision("Org/tiny-model", api(new Response("", { status: 404 }))),
		).rejects.toThrow(/api\/models\/Org\/tiny-model: HTTP 404/);
		await expect(
			currentRevision("Org/tiny-model", api(Response.json({ id: "x" }))),
		).rejects.toThrow(/no revision \(sha\)/);
		await expect(
			currentRevision("Org/tiny-model", api(Response.json({ sha: "" }))),
		).rejects.toThrow(/no revision \(sha\)/);
	});
});

describe("the command against a checksum mismatch", () => {
	it("exits non-zero without SKIP_EMOJI_MODEL and writes nothing usable", async () => {
		// A hub that answers every file with bytes the manifest does not describe.
		const hub = createServer((_request, response) => response.end("tampered"));
		await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
		const { port } = hub.address() as { port: number };
		const dir = mkdtempSync(join(tmpdir(), "emoji-cli-"));
		try {
			const pinned = loadManifest();
			const manifestPath = join(dir, "emoji-assets.json");
			writeFileSync(manifestPath, JSON.stringify(pinned));
			const outputRoot = join(dir, "emoji");
			const env = { ...process.env, SKIP_EMOJI_MODEL: "" };
			Object.assign(env, {
				EMOJI_ASSETS_MANIFEST: manifestPath,
				EMOJI_ASSETS_ROOT: outputRoot,
				EMOJI_ASSETS_HUB: `http://127.0.0.1:${port}`,
			});
			const result = await promisify(execFile)(
				process.execPath,
				[join(import.meta.dirname, "fetch-emoji-assets.mjs")],
				{ env },
			).then(
				() => ({ code: 0, stderr: "" }),
				(error: { code: number; stderr: string }) => error,
			);
			expect(result.code).toBe(1);
			expect(result.stderr).toMatch(/emoji assets: checksum mismatch for /);
			const version = assetVersion(pinned);
			expect(existsSync(join(outputRoot, version, "models"))).toBe(false);
		} finally {
			hub.close();
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);
});
