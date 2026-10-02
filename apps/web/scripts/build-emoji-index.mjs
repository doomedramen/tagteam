// Rebuilds src/features/emoji/index/{bits.bin,int8.bin,index.json} from catalog.json. The output is committed.
// Run after `pnpm --filter @tagteam/web emoji:assets` whenever catalog.json or the pinned model changes:
//   pnpm --filter @tagteam/web emoji:index
// Each emoji is embedded as "<name>: <keyword, keyword, ...>" with the pinned model (q8, CLS pooling,
// normalised), so the index and the on-device queries use the same model.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { DIM, quantiseIndex, SHORTLIST } from "../src/features/emoji/search.ts";
import {
	assetVersion,
	loadManifest,
	modelFilesDigest,
	WEB_ROOT,
} from "./emoji-assets.mjs";

const manifest = loadManifest();
const modelsDir = join(
	WEB_ROOT,
	"public/assets/emoji",
	assetVersion(manifest),
	"models",
);
if (
	!existsSync(join(modelsDir, manifest.model.id, "onnx/model_quantized.onnx"))
) {
	console.error(
		"emoji index: model files not found; run `pnpm --filter @tagteam/web emoji:assets` first",
	);
	process.exit(1);
}

const catalogPath = join(WEB_ROOT, "src/features/emoji/catalog.json");
const catalogBytes = readFileSync(catalogPath);
const catalog = JSON.parse(catalogBytes.toString("utf8"));
const texts = catalog.map((entry) => `${entry.n}: ${entry.t.join(", ")}`);

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelsDir;
const extractor = await pipeline("feature-extraction", manifest.model.id, {
	dtype: "q8",
});

const embeddings = new Float32Array(texts.length * DIM);
const BATCH = 32;
for (let start = 0; start < texts.length; start += BATCH) {
	const output = await extractor(texts.slice(start, start + BATCH), {
		pooling: "cls",
		normalize: true,
	});
	embeddings.set(output.data, start * DIM);
	if ((start / BATCH) % 16 === 15 || start + BATCH >= texts.length)
		console.log(
			`emoji index: embedded ${Math.min(start + BATCH, texts.length)} of ${texts.length}`,
		);
}

const { bits, int8, scale } = quantiseIndex(embeddings);
const outDir = join(WEB_ROOT, "src/features/emoji/index");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "bits.bin"), bits);
writeFileSync(join(outDir, "int8.bin"), Buffer.from(int8.buffer));
writeFileSync(
	join(outDir, "index.json"),
	`${JSON.stringify(
		{
			count: catalog.length,
			dim: DIM,
			shortlist: SHORTLIST,
			int8Scale: scale,
			catalogSha256: createHash("sha256").update(catalogBytes).digest("hex"),
			modelId: manifest.model.id,
			modelFilesDigest: modelFilesDigest(manifest),
			modelRevision: manifest.model.revision,
			docText: "name: keywords",
		},
		null,
		"\t",
	)}\n`,
);
console.log(
	`emoji index: wrote ${catalog.length} emoji (bits.bin ${bits.length} bytes, int8.bin ${int8.length} bytes)`,
);
