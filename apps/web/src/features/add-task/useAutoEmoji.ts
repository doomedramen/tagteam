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
 * has since changed, or after `active` turned false, is dropped.
 *
 * `onSuggest(null, forTitle)` means "back to the default emoji". It is called at once when the
 * title drops below three characters, and when a settled result for `forTitle` is empty or not a
 * valid emoji. It is never called while a request is pending, so the emoji does not flicker.
 * `onSuggest` must be stable.
 */
export function useAutoEmoji({
	active,
	title,
	onSuggest,
}: {
	active: boolean;
	title: string;
	onSuggest: (emoji: string | null, forTitle: string) => void;
}) {
	const engine = useEmojiEngine();
	const clean = title.trim();
	const ready = engine.status === "ready";
	useEffect(() => {
		if (!active) return;
		if (clean.length < AUTO_EMOJI_MIN_TITLE) {
			onSuggest(null, clean);
			return;
		}
		if (!ready) return;
		let current = true;
		const timer = setTimeout(() => {
			engine
				.suggest(clean, { autoPick: true })
				.then((list) => {
					if (!current) return;
					const first = list[0];
					onSuggest(
						first !== undefined && isEmoji(first) ? first : null,
						clean,
					);
				})
				// Suggestions are best-effort: no UI for a failure, and Create never waits for one.
				.catch(() => {});
		}, AUTO_EMOJI_DEBOUNCE_MS);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [active, ready, engine, clean, onSuggest]);
}
