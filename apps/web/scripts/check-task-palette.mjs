// Re-checks the contrast of the task palette in src/index.css.
// Run: pnpm --filter @tagteam/web check:palette (also runs inside `pnpm test`).
import { readFileSync } from "node:fs";

const HUES = ["pink", "coral", "amber", "green", "teal", "blue", "purple"];
const css = readFileSync(
	process.argv[2] ?? new URL("../src/index.css", import.meta.url),
	"utf8",
);

/** The text between the braces that open right after `marker`. */
function blockAfter(source, marker) {
	const start = source.indexOf(marker);
	if (start < 0) throw new Error(`${marker} not found in index.css`);
	const open = source.indexOf("{", start);
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
	}
	throw new Error(`${marker} is not closed`);
}

const declarations = (block) =>
	Object.fromEntries(
		[...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
			(match) => [match[1], match[2]],
		),
	);

const light = declarations(blockAfter(css, ":root"));
const dark = {
	...light,
	...declarations(
		blockAfter(blockAfter(css, "@media (prefers-color-scheme: dark)"), ":root"),
	),
};

const luminance = (hex) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const value = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

const failures = [];
const ratios = [];
let checked = 0;
for (const [mode, tokens] of [
	["light", light],
	["dark", dark],
]) {
	for (const hue of HUES) {
		const role = (name) => {
			const value = tokens[`--task-${hue}-${name}`];
			if (!value) throw new Error(`--task-${hue}-${name} missing (${mode})`);
			return value;
		};
		const text = (name) => {
			const value = tokens[name];
			if (!value) throw new Error(`${name} missing (${mode})`);
			return value;
		};
		const pairs = [
			["--text on sheet", text("--text"), role("sheet"), 4.5],
			["--text-2 on sheet", text("--text-2"), role("sheet"), 4.5],
			["--text-3 on sheet", text("--text-3"), role("sheet"), 4.5],
			["fg on sheet", role("fg"), role("sheet"), 4.5],
			// Dark swatches are mid-tone: the tinted fg reaches only about 4:1 there, so on a
			// swatch it is used for icons (3:1 for graphics) and text uses --text.
			["fg on swatch", role("fg"), role("swatch"), mode === "light" ? 4.5 : 3],
			["--text on swatch", text("--text"), role("swatch"), 4.5],
			["fg on card", role("fg"), role("card"), 4.5],
			["ring on sheet", role("ring"), role("sheet"), 3],
		];
		if (mode === "dark")
			pairs.push(
				["--text-2 on card", text("--text-2"), role("card"), 4.5],
				["--text-3 on card", text("--text-3"), role("card"), 4.5],
			);
		for (const [name, foreground, background, minimum] of pairs) {
			checked++;
			const ratio = contrast(foreground, background);
			ratios.push({
				label: `${mode} ${hue}: ${name}`,
				ratio,
				minimum,
				margin: ratio - minimum,
			});
			if (ratio < minimum)
				failures.push(
					`${mode} ${hue}: ${name} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
				);
		}
	}
}
if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log(`task palette ok: ${checked} contrast pairs`);
if (process.env.PALETTE_VERBOSE)
	for (const r of ratios.sort((a, b) => a.margin - b.margin).slice(0, 5))
		console.log(`  ${r.label} ${r.ratio.toFixed(2)}:1 (needs ${r.minimum})`);
