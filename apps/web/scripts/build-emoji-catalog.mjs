// Rebuilds src/features/emoji/catalog.json from emojibase-data. The output is committed.
// Run: pnpm --filter @tagteam/web emoji:catalog
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const data = require("emojibase-data/en/data.json");
const messages = require("emojibase-data/en/messages.json");

const COMPONENT_GROUP = 2;
// "man running" (…200D 2642 FE0F) and "person walking facing right" (…200D 27A1 FE0F) collapse
// onto the base "person …" emoji. Skin tones are already nested under their base emoji.
const GENDER_VARIANT = /-200D-(2640|2642)-FE0F$/;
const DIRECTION_VARIANT = /-200D-27A1-FE0F$/;

const groupNames = new Map(messages.groups.map((g) => [g.order, g.message]));
const entries = data
	.filter((item) => item.group !== undefined && item.group !== COMPONENT_GROUP)
	.filter(
		(item) =>
			!GENDER_VARIANT.test(item.hexcode) &&
			!DIRECTION_VARIANT.test(item.hexcode),
	)
	.sort((a, b) => a.order - b.order)
	.map((item) => ({
		e: item.emoji,
		n: item.label,
		t: item.tags ?? [],
		g: groupNames.get(item.group),
	}));

const out = fileURLToPath(
	new URL("../src/features/emoji/catalog.json", import.meta.url),
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(entries)}\n`);
console.log(`wrote ${entries.length} emoji to ${out}`);
