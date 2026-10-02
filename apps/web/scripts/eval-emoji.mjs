// Measures emoji suggestion accuracy on the labelled titles in emoji-eval-titles.json, using the
// committed index and the pinned model. Run by hand (needs the model files: `emoji:assets`):
//   pnpm --filter @tagteam/web emoji:eval
// It prints hit@1 and hit@3 for full-precision vectors, sign bits alone, and the shipped search
// (bits shortlist + int8 re-rank), then for the shipped search with the auto-pick exclusion, and a
// verdict for the exclusion. Not part of CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { isAutoPickExcluded } from "../src/features/emoji/auto-pick.ts";
import { DIM, rank, signBits } from "../src/features/emoji/search.ts";
import { assetVersion, loadManifest, WEB_ROOT } from "./emoji-assets.mjs";
import { norm } from "./emoji-eval-norm.mjs";

const TOP = 3;
const manifest = loadManifest();
const emojiDir = join(WEB_ROOT, "src/features/emoji");
const catalog = JSON.parse(
	readFileSync(join(emojiDir, "catalog.json"), "utf8"),
);
const titles = JSON.parse(
	readFileSync(join(WEB_ROOT, "scripts/emoji-eval-titles.json"), "utf8"),
);
const meta = JSON.parse(
	readFileSync(join(emojiDir, "index/index.json"), "utf8"),
);
const bytes = (name) => readFileSync(join(emojiDir, "index", name));
const bitsFile = bytes("bits.bin");
const int8File = bytes("int8.bin");
const index = {
	count: meta.count,
	bits: new Uint8Array(bitsFile.buffer, bitsFile.byteOffset, bitsFile.length),
	int8: new Int8Array(int8File.buffer, int8File.byteOffset, int8File.length),
};
if (index.count !== catalog.length)
	throw new Error(
		"the index does not match catalog.json; run `pnpm --filter @tagteam/web emoji:index`",
	);

const keys = catalog.map((entry) => norm(entry.e));

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = join(
	WEB_ROOT,
	"public/assets/emoji",
	assetVersion(manifest),
	"models",
);
const extractor = await pipeline("feature-extraction", manifest.model.id, {
	dtype: "q8",
});
const embed = async (texts) => {
	const out = new Float32Array(texts.length * DIM);
	for (let i = 0; i < texts.length; i += 32) {
		const result = await extractor(texts.slice(i, i + 32), {
			pooling: "cls",
			normalize: true,
		});
		out.set(result.data, i * DIM);
	}
	return out;
};

const docs = await embed(
	catalog.map((entry) => `${entry.n}: ${entry.t.join(", ")}`),
);
const queries = await embed(titles.map((title) => title.t));
const query = (i) => queries.subarray(i * DIM, (i + 1) * DIM);
const ordered = (scores, descending) =>
	Array.from({ length: scores.length }, (_, i) => i).sort(
		(a, b) =>
			(descending ? scores[b] - scores[a] : scores[a] - scores[b]) || a - b,
	);

const rankers = {
	"float (full precision)": (q) => {
		const scores = new Float32Array(catalog.length);
		for (let i = 0; i < catalog.length; i++)
			for (let k = 0; k < DIM; k++) scores[i] += docs[i * DIM + k] * q[k];
		return ordered(scores, true);
	},
	"sign bits only": (q) => {
		const queryBits = signBits(q);
		const distance = new Int32Array(catalog.length);
		for (let i = 0; i < catalog.length; i++)
			for (let j = 0; j < DIM / 8; j++) {
				let x = index.bits[i * (DIM / 8) + j] ^ queryBits[j];
				while (x) {
					distance[i] += x & 1;
					x >>= 1;
				}
			}
		return ordered(distance, false);
	},
	"shipped: bits shortlist + int8 re-rank": (q) => rank(q, index).indices,
	"shipped + auto-pick exclusion": (q) =>
		rank(q, index).indices.filter((i) => !isAutoPickExcluded(catalog[i])),
};

const topDistinct = (order) => {
	const seen = new Set();
	const top = [];
	for (const i of order) {
		if (seen.has(keys[i])) continue;
		seen.add(keys[i]);
		top.push(i);
		if (top.length === TOP) break;
	}
	return top;
};
const accepted = titles.map((title) => new Set(title.ok.map(norm)));
const results = {};
for (const [name, ranker] of Object.entries(rankers)) {
	const tops = titles.map((_, i) => topDistinct(ranker(query(i))));
	results[name] = {
		tops,
		hit1: tops.filter(
			(top, i) => top[0] !== undefined && accepted[i].has(keys[top[0]]),
		).length,
		hit3: tops.filter((top, i) => top.some((j) => accepted[i].has(keys[j])))
			.length,
	};
}

const pct = (n) => `${Math.round((n / titles.length) * 100)}%`;
console.log(
	`${titles.length} labelled titles, ${catalog.length} emoji, model ${manifest.model.id}@${manifest.model.revision.slice(0, 8)}\n`,
);
console.log("| ranking | first right | in top 3 |\n|---|---|---|");
for (const [name, r] of Object.entries(results))
	console.log(
		`| ${name} | ${r.hit1} (${pct(r.hit1)}) | ${r.hit3} (${pct(r.hit3)}) |`,
	);

const plain = results["shipped: bits shortlist + int8 re-rank"];
const excluded = results["shipped + auto-pick exclusion"];
console.log("\nTitles where the exclusion changes the first pick:");
let changed = 0;
titles.forEach((title, i) => {
	const before = plain.tops[i][0];
	const after = excluded.tops[i][0];
	if (before === after) return;
	changed++;
	const mark = (j) =>
		`${catalog[j].e} ${catalog[j].n}${accepted[i].has(keys[j]) ? " (right)" : ""}`;
	console.log(
		`- ${title.t}: ${mark(before)} -> ${after === undefined ? "nothing" : mark(after)}`,
	);
});
if (changed === 0) console.log("- none");

const adopt = excluded.hit1 >= plain.hit1;
console.log(
	`\nAuto-pick exclusion: first pick right ${plain.hit1} -> ${excluded.hit1} of ${titles.length}: ${adopt ? "ADOPT" : "REJECT"}. Set AUTO_PICK_EXCLUSION to ${adopt} in src/features/emoji/auto-pick.ts.`,
);
