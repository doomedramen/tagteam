import { describe, expect, it } from "vitest";
import {
	DEFAULT_EMOJI,
	DEFAULT_EMOJI_NAME,
	isEmoji,
	isTaskColor,
	TASK_COLORS,
} from "./look";

describe("TASK_COLORS", () => {
	it("names the seven hues in palette order", () => {
		expect([...TASK_COLORS]).toEqual([
			"pink",
			"coral",
			"amber",
			"green",
			"teal",
			"blue",
			"purple",
		]);
	});

	it("isTaskColor accepts only those names", () => {
		for (const hue of TASK_COLORS) expect(isTaskColor(hue)).toBe(true);
		for (const bad of ["Pink", "red", "", null, undefined, 3, {}])
			expect(isTaskColor(bad)).toBe(false);
	});
});

describe("DEFAULT_EMOJI", () => {
	it("is the clipboard, a valid emoji", () => {
		expect(DEFAULT_EMOJI).toBe("\u{1F4CB}");
		expect(DEFAULT_EMOJI_NAME).toBe("clipboard");
		expect(isEmoji(DEFAULT_EMOJI)).toBe(true);
	});
});

describe("isEmoji", () => {
	it.each([
		["a simple emoji", "\u{1F600}"],
		["a skin tone", "\u{1F44D}\u{1F3FD}"],
		["a ZWJ person", "\u{1F9D1}‍\u{1F4BB}"],
		["a ZWJ family", "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}"],
		["a flag", "\u{1F1EC}\u{1F1E7}"],
		[
			"a subdivision flag (14 code units)",
			"\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
		],
		["a keycap digit", "1️⃣"],
		["a keycap hash", "#️⃣"],
		["a text-style heart with selector", "❤️"],
		["copyright with selector", "©️"],
	])("accepts %s", (_name, value) => {
		expect(isEmoji(value)).toBe(true);
	});

	it.each([
		["empty", ""],
		["a letter", "a"],
		["two letters", "ab"],
		["a digit", "1"],
		["a hash", "#"],
		["two emoji", "\u{1F600}\u{1F600}"],
		["emoji and a letter", "\u{1F600}a"],
		["a leading space", " \u{1F600}"],
		["a trailing zero-width space", "\u{1F600}​"],
		["33 code units", "x".repeat(33)],
		[
			"one grapheme longer than 32 code units",
			Array(17).fill("\u{1F600}").join("‍"),
		],
	])("rejects %s", (_name, value) => {
		expect(isEmoji(value)).toBe(false);
	});

	it("rejects things that are not strings", () => {
		for (const bad of [null, undefined, 5, {}, ["\u{1F600}"]])
			expect(isEmoji(bad)).toBe(false);
	});
});
