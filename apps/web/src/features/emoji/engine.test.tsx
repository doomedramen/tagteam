import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
	type EmojiEngine,
	EmojiEngineProvider,
	unavailableEngine,
	useEmojiEngine,
} from "./engine";

describe("the emoji engine seam", () => {
	it("defaults to an engine that is unavailable and suggests nothing", async () => {
		const { result } = renderHook(() => useEmojiEngine());
		expect(result.current).toBe(unavailableEngine);
		expect(result.current.status).toBe("unavailable");
		expect(await result.current.suggest("Wash dishes")).toEqual([]);
		expect(await result.current.search("dish")).toEqual([]);
	});

	it("uses the engine it is given", async () => {
		const ready: EmojiEngine = {
			status: "ready",
			suggest: async () => ["\u{1F9FC}"],
			search: async () => ["\u{1F37D}\uFE0F"],
		};
		const { result } = renderHook(() => useEmojiEngine(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<EmojiEngineProvider value={ready}>{children}</EmojiEngineProvider>
			),
		});
		expect(result.current.status).toBe("ready");
		expect(await result.current.suggest("Wash dishes")).toEqual(["\u{1F9FC}"]);
	});
});
