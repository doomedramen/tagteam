import { createContext, useContext } from "react";

/** `off`: switched off on this device. `loading`: starting. `ready`: can answer. `unavailable`: not available this app start. */
export type EmojiEngineStatus = "off" | "loading" | "ready" | "unavailable";

/**
 * What the screens know about the on-device emoji model. Plan 9 only ever sees the
 * unavailable engine below; Plan 10 provides a real one through `EmojiEngineProvider`
 * (a new engine object whenever the status changes). Screens never touch the model directly.
 */
export interface EmojiEngine {
	status: EmojiEngineStatus;
	/** The best emoji for a task title, best first. Resolves to `[]` when there is nothing to say. */
	suggest(title: string): Promise<string[]>;
	/** Emoji whose meaning matches the text, best first. */
	search(text: string): Promise<string[]>;
}

export const unavailableEngine: EmojiEngine = {
	status: "unavailable",
	suggest: async () => [],
	search: async () => [],
};

const EmojiEngineContext = createContext<EmojiEngine>(unavailableEngine);

export const EmojiEngineProvider = EmojiEngineContext.Provider;

export const useEmojiEngine = (): EmojiEngine => useContext(EmojiEngineContext);
