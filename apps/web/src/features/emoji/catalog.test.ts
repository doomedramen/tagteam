import { DEFAULT_EMOJI, DEFAULT_EMOJI_NAME, isEmoji } from "@tagteam/core";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	type EmojiEntry,
	emojiKey,
	groupEntries,
	groupLabel,
	loadCatalog,
	searchEmoji,
	useEmojiName,
} from "./catalog";

const DOG_FACE = "\u{1F436}";
const DOG = "\u{1F415}";
const BASKET = "\u{1F9FA}";
const PLATE = "\u{1F37D}\uFE0F"; // fork and knife with plate
const PLANT = "\u{1FAB4}";
// "technologist: medium skin tone". Skin tones are collapsed onto the base emoji, so the catalog does not list it.
const TECHNOLOGIST_MEDIUM = "\u{1F9D1}\u{1F3FD}\u200D\u{1F4BB}";

const fixture: EmojiEntry[] = [
	{
		e: DOG_FACE,
		n: "dog face",
		t: ["dog", "pet", "puppy"],
		g: "animals & nature",
	},
	{ e: DOG, n: "dog", t: ["pet"], g: "animals & nature" },
	{ e: BASKET, n: "basket", t: ["farming", "laundry", "picnic"], g: "objects" },
	{
		e: PLATE,
		n: "fork and knife with plate",
		t: ["cooking", "dinner", "eat", "fork", "knife", "plate"],
		g: "food & drink",
	},
	{
		e: PLANT,
		n: "potted plant",
		t: ["grow", "house", "plant"],
		g: "animals & nature",
	},
];
const names = (entries: EmojiEntry[]) => entries.map((entry) => entry.n);

describe("searchEmoji", () => {
	it("ranks an exact name above a name that merely contains the word", () => {
		expect(names(searchEmoji(fixture, "dog"))).toEqual(["dog", "dog face"]);
	});

	it("matches keywords, and keeps catalog order for equal scores", () => {
		expect(names(searchEmoji(fixture, "pet"))).toEqual(["dog face", "dog"]);
		expect(names(searchEmoji(fixture, "laundry"))).toEqual(["basket"]);
	});

	it("matches the start of a word", () => {
		expect(names(searchEmoji(fixture, "pla"))).toEqual([
			"fork and knife with plate",
			"potted plant",
		]);
	});

	it("needs every word to match", () => {
		expect(names(searchEmoji(fixture, "potted plant"))).toEqual([
			"potted plant",
		]);
		expect(searchEmoji(fixture, "dog plant")).toEqual([]);
	});

	it("matches inside a name only from three letters", () => {
		expect(names(searchEmoji(fixture, "ork"))).toEqual([
			"fork and knife with plate",
		]);
		expect(searchEmoji(fixture, "or")).toEqual([]);
	});

	it("ignores case and surrounding space, and finds nothing for an empty query", () => {
		expect(names(searchEmoji(fixture, "  DOG "))).toEqual(["dog", "dog face"]);
		expect(searchEmoji(fixture, "")).toEqual([]);
		expect(searchEmoji(fixture, "   ")).toEqual([]);
	});
});

describe("groupEntries and groupLabel", () => {
	it("groups by first appearance and keeps order inside a group", () => {
		const groups = groupEntries(fixture);
		expect(groups.map((group) => group.name)).toEqual([
			"animals & nature",
			"objects",
			"food & drink",
		]);
		expect(names(groups[0]?.entries ?? [])).toEqual([
			"dog face",
			"dog",
			"potted plant",
		]);
	});

	it("labels a group in sentence case", () => {
		expect(groupLabel("smileys & emotion")).toBe("Smileys & emotion");
	});
});

describe("emojiKey", () => {
	it("ignores the emoji presentation selector", () => {
		expect(emojiKey(`${DEFAULT_EMOJI}\uFE0F`)).toBe(emojiKey(DEFAULT_EMOJI));
		expect(emojiKey(PLATE)).toBe("\u{1F37D}");
	});
});

describe("the committed catalog", () => {
	it("holds 1,794 distinct, valid emoji in the nine groups, in one cached load", async () => {
		const entries = await loadCatalog();
		expect(entries).toHaveLength(1794);
		expect(new Set(entries.map((entry) => emojiKey(entry.e))).size).toBe(1794);
		expect(entries.filter((entry) => !isEmoji(entry.e))).toEqual([]);
		expect(groupEntries(entries).map((group) => group.name)).toEqual([
			"smileys & emotion",
			"people & body",
			"animals & nature",
			"food & drink",
			"travel & places",
			"activities",
			"objects",
			"symbols",
			"flags",
		]);
		expect(await loadCatalog()).toBe(entries);
	});

	it("lists the default emoji as the clipboard, even though the catalog spells it with a selector", async () => {
		const entries = await loadCatalog();
		const clipboard = entries.find(
			(entry) => emojiKey(entry.e) === emojiKey(DEFAULT_EMOJI),
		);
		expect(clipboard?.n).toBe(DEFAULT_EMOJI_NAME);
	});

	it("finds a flag by its upper-case country code", async () => {
		const entries = await loadCatalog();
		expect(names(searchEmoji(entries, "gb"))).toContain("flag: United Kingdom");
		expect(names(searchEmoji(entries, "GB"))).toContain("flag: United Kingdom");
	});

	it("finds an emoji by a hyphenated keyword typed as separate words", async () => {
		const entries = await loadCatalog();
		const found = names(searchEmoji(entries, "stuck out"));
		expect(found).toContain("face with tongue");
	});

	it("still ranks a name match above a keyword match", async () => {
		const entries = await loadCatalog();
		const hits = searchEmoji(entries, "plant");
		expect(hits[0]?.n).toBe("potted plant");
	});

	it("finds emoji by name and by keyword", async () => {
		const entries = await loadCatalog();
		expect(names(searchEmoji(entries, "potted plant"))[0]).toBe("potted plant");
		expect(names(searchEmoji(entries, "laundry"))).toContain("basket");
	});
});

describe("useEmojiName", () => {
	it("names the default emoji straight away", () => {
		const { result } = renderHook(() => useEmojiName(DEFAULT_EMOJI));
		expect(result.current).toBe("clipboard");
	});

	it("names a catalog emoji once the catalog has loaded", async () => {
		const { result } = renderHook(() => useEmojiName(PLANT));
		await waitFor(() => expect(result.current).toBe("potted plant"));
	});

	it("is null for no emoji", () => {
		const { result } = renderHook(() => useEmojiName(null));
		expect(result.current).toBeNull();
	});

	it("is null for an emoji the catalog does not list, once the catalog has loaded", async () => {
		const entries = await loadCatalog();
		expect(
			entries.find(
				(entry) => emojiKey(entry.e) === emojiKey(TECHNOLOGIST_MEDIUM),
			),
		).toBeUndefined();

		const { result, rerender } = renderHook(
			({ emoji }: { emoji: string }) => useEmojiName(emoji),
			{ initialProps: { emoji: TECHNOLOGIST_MEDIUM } },
		);
		expect(result.current).toBeNull();

		// Proves the hook's own catalog lookup has resolved: it now names a listed emoji…
		rerender({ emoji: PLANT });
		await waitFor(() => expect(result.current).toBe("potted plant"));

		// …and, with that lookup in place, still gives no name (not the previous one) for the unlisted emoji.
		rerender({ emoji: TECHNOLOGIST_MEDIUM });
		expect(result.current).toBeNull();
	});
});
