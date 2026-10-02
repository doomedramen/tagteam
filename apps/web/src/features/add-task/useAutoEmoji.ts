import { isEmoji } from "@tagteam/core";
import { useEffect } from "react";
import { useEmojiEngine } from "../emoji/engine";

/** The title must stop changing for this long before the engine is asked. */
export const AUTO_EMOJI_DEBOUNCE_MS = 300;
export const AUTO_EMOJI_MIN_TITLE = 3;

/**
 * Fills the sheet's emoji from the title while `active`. `onSuggest(emoji, forTitle)` is called
 * with the engine's top automatic pick for `forTitle`, 300 ms after the title stops changing, only
 * when the engine is ready and the title has at least three characters. A result for a title that
 * has since changed, or after `active` turned false, is dropped. `onSuggest` must be stable.
 */
export function useAutoEmoji({
	active,
	title,
	onSuggest,
}: {
	active: boolean;
	title: string;
	onSuggest: (emoji: string, forTitle: string) => void;
}) {
	const engine = useEmojiEngine();
	const clean = title.trim();
	const ready = engine.status === "ready";
	useEffect(() => {
		if (!active || !ready || clean.length < AUTO_EMOJI_MIN_TITLE) return;
		let current = true;
		const timer = setTimeout(() => {
			engine
				.suggest(clean, { autoPick: true })
				.then((list) => {
					const first = list[0];
					if (current && first !== undefined && isEmoji(first))
						onSuggest(first, clean);
				})
				.catch(() => {});
		}, AUTO_EMOJI_DEBOUNCE_MS);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [active, ready, engine, clean, onSuggest]);
}
