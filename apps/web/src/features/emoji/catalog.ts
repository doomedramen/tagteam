import { DEFAULT_EMOJI, DEFAULT_EMOJI_NAME } from "@tagteam/core";
import { useEffect, useState } from "react";

export interface EmojiEntry {
	/** The emoji itself. */
	e: string;
	/** Its name, for example "grinning face". */
	n: string;
	/** Keywords. */
	t: string[];
	/** Its group, lower case, for example "smileys & emotion". */
	g: string;
}

export interface EmojiGroup {
	name: string;
	entries: EmojiEntry[];
}

const EMOJI_PRESENTATION_SELECTOR = "\uFE0F";

/**
 * Emoji compare equal whatever their emoji-presentation selector: the catalog spells the
 * clipboard with U+FE0F and the stored default does not.
 */
export const emojiKey = (emoji: string): string =>
	emoji.replaceAll(EMOJI_PRESENTATION_SELECTOR, "");

let loading: Promise<EmojiEntry[]> | null = null;

/** Loads the catalog as its own chunk, once. A failed load is retried on the next call. */
export function loadCatalog(): Promise<EmojiEntry[]> {
	loading ??= import("./catalog.json")
		.then((module) => module.default as EmojiEntry[])
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

const wordsOf = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

/**
 * Entries matching every word of `query`, best first. A word scores highest as a whole name
 * word (4), then a whole keyword or the start of a name word (3), then the start of a keyword
 * (2), then, from three letters, anywhere in the name (1). An entry whose whole name is the
 * query gets a bonus of 3. Catalog order breaks ties.
 */
export function searchEmoji(
	entries: EmojiEntry[],
	query: string,
): EmojiEntry[] {
	const words = wordsOf(query);
	if (words.length === 0) return [];
	const whole = words.join(" ");
	const scored: { entry: EmojiEntry; score: number; index: number }[] = [];
	entries.forEach((entry, index) => {
		const nameWords = wordsOf(entry.n);
		const tagWords = entry.t.flatMap(wordsOf);
		let total = 0;
		for (const word of words) {
			let best = 0;
			for (const nameWord of nameWords) {
				if (nameWord === word) best = Math.max(best, 4);
				else if (nameWord.startsWith(word)) best = Math.max(best, 3);
			}
			for (const tag of tagWords) {
				if (tag === word) best = Math.max(best, 3);
				else if (tag.startsWith(word)) best = Math.max(best, 2);
			}
			if (
				best === 0 &&
				word.length >= 3 &&
				entry.n.toLowerCase().includes(word)
			)
				best = 1;
			if (best === 0) {
				total = 0;
				break;
			}
			total += best;
		}
		if (total === 0) return;
		if (nameWords.join(" ") === whole) total += 3;
		scored.push({ entry, score: total, index });
	});
	return scored
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((item) => item.entry);
}

/** Groups in order of first appearance; entries keep their order inside a group. */
export function groupEntries(entries: EmojiEntry[]): EmojiGroup[] {
	const groups = new Map<string, EmojiEntry[]>();
	for (const entry of entries) {
		const group = groups.get(entry.g);
		if (group) group.push(entry);
		else groups.set(entry.g, [entry]);
	}
	return [...groups].map(([name, list]) => ({ name, entries: list }));
}

export const groupLabel = (name: string): string =>
	name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The name of `emoji` for assistive technology. The default emoji is named at once without
 * loading the catalog; any other emoji is named once the catalog has loaded, and stays null
 * when the catalog does not list it (the screen reader then reads the emoji itself).
 */
export function useEmojiName(emoji: string | null): string | null {
	const [names, setNames] = useState<Map<string, string> | null>(null);
	const isDefault =
		emoji !== null && emojiKey(emoji) === emojiKey(DEFAULT_EMOJI);
	useEffect(() => {
		if (emoji === null || isDefault) return;
		let current = true;
		loadCatalog()
			.then((entries) => {
				if (current)
					setNames(
						new Map(entries.map((entry) => [emojiKey(entry.e), entry.n])),
					);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [emoji, isDefault]);
	if (emoji === null) return null;
	if (isDefault) return DEFAULT_EMOJI_NAME;
	return names?.get(emojiKey(emoji)) ?? null;
}
