import { createContext, useContext } from "react";

/** `off`: switched off on this device. `loading`: starting. `ready`: can answer. `unavailable`: not available this app start. */
export type EmojiEngineStatus = "off" | "loading" | "ready" | "unavailable";

export interface SuggestOptions {
	/**
	 * True for an emoji that will be stored without the person choosing it (the New task sheet's
	 * automatic fill and late picks). The engine then leaves out what auto-pick.ts excludes.
	 * The picker's "Suggested" row leaves this off.
	 */
	autoPick?: boolean;
}

/**
 * What the screens know about the on-device emoji model. The real engine is provided through
 * `EmojiEngineProvider` by `EmojiEngineHost` (a new engine object whenever the status changes);
 * until then, and in tests, the engine is unavailable. Screens never touch the model directly.
 */
export interface EmojiEngine {
	status: EmojiEngineStatus;
	/**
	 * Up to three emoji for a task title, best first, each a valid emoji and none repeated.
	 * Resolves to `[]` when there is nothing to say (not ready, too short, a timeout).
	 */
	suggest(title: string, options?: SuggestOptions): Promise<string[]>;
	/** Emoji whose meaning matches the text, best first. */
	search(text: string): Promise<string[]>;
	/** Start loading the model if it has not started. Cheap to call again. The New task sheet calls it when it opens. */
	wake?(): void;
}

export const unavailableEngine: EmojiEngine = {
	status: "unavailable",
	suggest: async () => [],
	search: async () => [],
};

const EmojiEngineContext = createContext<EmojiEngine>(unavailableEngine);

export const EmojiEngineProvider = EmojiEngineContext.Provider;

export const useEmojiEngine = (): EmojiEngine => useContext(EmojiEngineContext);
