// Puts the emoji model and the ONNX Runtime wasm under apps/web/public/assets/emoji/<version>/.
//
//   pnpm --filter @tagteam/web emoji:assets             fetch (skips files that already pass their checksum)
//   pnpm --filter @tagteam/web emoji:assets -- --update [revision]
//                                                       re-pin: rewrite emoji-assets.json for a revision
//                                                       (default: the model's current main) and review the diff
//
// SKIP_EMOJI_MODEL=1 does nothing and exits 0: the app then builds without the model files and
// every device reports the emoji engine as unavailable. Any other failure, including a checksum
// mismatch, exits 1 so that a build never ships a half-fetched or altered model.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildManifest,
	fetchEmojiAssets,
	findOrtDist,
	installedTransformersVersion,
	loadManifest,
	MANIFEST_PATH,
} from "./emoji-assets.mjs";

async function main(argv, env) {
	if (env.SKIP_EMOJI_MODEL === "1" || env.SKIP_EMOJI_MODEL === "true") {
		console.log(
			"emoji assets: SKIP_EMOJI_MODEL is set, not fetching the model",
		);
		return;
	}
	const manifest = loadManifest();
	const ortDist = findOrtDist();
	const transformersVersion = installedTransformersVersion();

	if (argv.includes("--update")) {
		const given = argv[argv.indexOf("--update") + 1];
		const revision =
			given && !given.startsWith("--")
				? given
				: (
						await (
							await fetch(
								`https://huggingface.co/api/models/${manifest.model.id}`,
							)
						).json()
					).sha;
		const ortVersion = JSON.parse(
			readFileSync(join(ortDist, "..", "package.json"), "utf8"),
		).version;
		const next = await buildManifest({
			manifest,
			revision,
			ortDist,
			transformersVersion,
			ortVersion,
		});
		writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, "\t")}\n`);
		console.log(`emoji assets: pinned ${manifest.model.id} at ${revision}`);
		return;
	}

	const result = await fetchEmojiAssets({
		manifest,
		ortDist,
		transformersVersion,
		log: (message) => console.log(`emoji assets: ${message}`),
	});
	console.log(
		`emoji assets: ${result.version} ready (${result.downloaded.length} downloaded, ${result.copied.length} copied, ${result.kept.length} already present${result.pruned.length ? `, removed ${result.pruned.join(", ")}` : ""})`,
	);
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
	main(process.argv.slice(2), process.env).catch((error) => {
		console.error(`emoji assets: ${error.message}`);
		process.exit(1);
	});
