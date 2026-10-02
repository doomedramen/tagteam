import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../src/features/emoji/catalog.json";
import { norm } from "./emoji-eval-norm.mjs";

const titles = JSON.parse(
	readFileSync(join(import.meta.dirname, "emoji-eval-titles.json"), "utf8"),
) as { t: string; ok: string[] }[];

describe("the labelled evaluation titles", () => {
	it("hold 79 distinct titles, each with at least one acceptable emoji", () => {
		expect(titles).toHaveLength(79);
		expect(new Set(titles.map((title) => title.t)).size).toBe(79);
		for (const title of titles) {
			expect(title.t.trim().length, title.t).toBeGreaterThanOrEqual(3);
			expect(title.ok.length, title.t).toBeGreaterThan(0);
		}
	});

	it("only accept emoji that the catalog can offer", () => {
		const known = new Set(
			(catalog as { e: string }[]).map((entry) => norm(entry.e)),
		);
		for (const title of titles)
			for (const emoji of title.ok)
				expect(known.has(norm(emoji)), `${title.t}: ${emoji}`).toBe(true);
	});
});

describe("norm", () => {
	it("drops presentation selectors, skin tones and the gender and direction suffixes", () => {
		expect(norm("\u{1F4CB}\u{FE0F}")).toBe(norm("\u{1F4CB}"));
		expect(norm("\u{1F44B}\u{1F3FD}")).toBe(norm("\u{1F44B}"));
		expect(norm("\u{1F3C3}\u{1F3FD}\u{200D}\u{2640}\u{FE0F}")).toBe(
			norm("\u{1F3C3}"),
		);
		expect(norm("\u{1F3C3}\u{200D}\u{2642}\u{FE0F}")).toBe("\u{1F3C3}");
		expect(norm("\u{1F3C3}\u{200D}\u{27A1}\u{FE0F}")).toBe("\u{1F3C3}");
	});

	it("keeps emoji that differ apart, and other ZWJ sequences whole", () => {
		expect(norm("\u{1F3C3}")).not.toBe(norm("\u{1F6B6}"));
		const family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";
		expect(norm(family)).toBe(family);
	});
});
