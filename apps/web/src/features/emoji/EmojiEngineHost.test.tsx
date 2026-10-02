import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "../../sync/engine";
import { fakeEmojiController } from "../../test/emoji";
import { fakeEngine, renderWithSession } from "../../test/fakes";
import {
	EmojiEngineHost,
	useEmojiSettings,
	WARM_UP_DELAY_MS,
} from "./EmojiEngineHost";
import { useEmojiEngine } from "./engine";

function Probe() {
	const engine = useEmojiEngine();
	const settings = useEmojiSettings();
	return (
		<p>
			{engine.status} / {settings.optedIn ? "on" : "off"} /{" "}
			{settings.download.kind}
		</p>
	);
}

/** A sync engine whose status the test controls. */
function controlledSync() {
	const base = fakeEngine();
	let status: SyncStatus = { state: "idle", pending: 0, lastSyncedAt: null };
	const listeners = new Set<(s: SyncStatus) => void>();
	return {
		engine: {
			...base,
			getStatus: () => status,
			subscribe: (listener: (s: SyncStatus) => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		set(next: Partial<SyncStatus>) {
			status = { ...status, ...next };
			for (const listener of listeners) listener(status);
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("EmojiEngineHost", () => {
	it("provides the engine and the settings, and follows the controller", () => {
		const { controller, change } = fakeEmojiController();
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
		);
		expect(screen.getByText("off / off / notDownloaded")).toBeInTheDocument();
		act(() =>
			change({
				optedIn: true,
				status: "loading",
				download: { kind: "downloading", progress: 0.5 },
			}),
		);
		expect(screen.getByText("loading / on / downloading")).toBeInTheDocument();
		act(() => change({ status: "ready", download: { kind: "ready" } }));
		expect(screen.getByText("ready / on / ready")).toBeInTheDocument();
	});

	it("passes the Download and Remove download buttons through to the controller", () => {
		const { controller } = fakeEmojiController();
		function Buttons() {
			const settings = useEmojiSettings();
			return (
				<>
					<button type="button" onClick={settings.startDownload}>
						start
					</button>
					<button type="button" onClick={settings.removeDownload}>
						remove
					</button>
				</>
			);
		}
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Buttons />
			</EmojiEngineHost>,
		);
		fireEvent.click(screen.getByText("start"));
		expect(controller.download).toHaveBeenCalledTimes(1);
		expect(controller.remove).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("remove"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
	});

	it("asks the controller to load the stored copy five seconds after the first successful sync", () => {
		const { controller } = fakeEmojiController();
		const sync = controlledSync();
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
			{ engine: sync.engine },
		);
		act(() => sync.set({ state: "syncing" }));
		act(() => sync.set({ state: "offline" }));
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS * 2));
		expect(controller.warmUp).not.toHaveBeenCalled();

		act(() => sync.set({ state: "idle", lastSyncedAt: 1000 }));
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS - 1));
		expect(controller.warmUp).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(controller.warmUp).toHaveBeenCalledTimes(1);

		// Later syncs do not start it again.
		act(() => sync.set({ state: "idle", lastSyncedAt: 2000 }));
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS));
		expect(controller.warmUp).toHaveBeenCalledTimes(1);
	});

	it("starts the timer at once when a sync has already succeeded", () => {
		const { controller } = fakeEmojiController();
		const sync = controlledSync();
		sync.set({ state: "idle", lastSyncedAt: 5 });
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
			{ engine: sync.engine },
		);
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS));
		expect(controller.warmUp).toHaveBeenCalledTimes(1);
	});

	it("does not ask the controller to load if the app goes away first, and disposes the controller", () => {
		const { controller } = fakeEmojiController();
		const sync = controlledSync();
		sync.set({ state: "idle", lastSyncedAt: 5 });
		const { unmount } = renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
			{ engine: sync.engine },
		);
		unmount();
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS * 2));
		expect(controller.warmUp).not.toHaveBeenCalled();
		expect(controller.dispose).toHaveBeenCalled();
	});

	it("falls back to nothing downloaded and an unavailable engine outside the host", () => {
		render(<Probe />);
		expect(
			screen.getByText("unavailable / off / notDownloaded"),
		).toBeInTheDocument();
	});
});
