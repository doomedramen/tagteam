import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import { useSession } from "../../session/session";
import { getBrowserEmojiController } from "./browser-deps";
import type { DownloadState, EmojiController } from "./controller";
import { EmojiEngineProvider, type EmojiEngineStatus } from "./engine";

/** Loading an already-downloaded model starts this long after the first successful sync, so it never competes with it. */
export const WARM_UP_DELAY_MS = 5_000;

/** What the Me screen shows and changes. */
export interface EmojiSettings {
	/** The person pressed Download on this device and has not removed it. */
	optedIn: boolean;
	status: EmojiEngineStatus;
	download: DownloadState;
	/** The Download, Update and Try again buttons: the only way anything is downloaded. */
	startDownload(): void;
	/** The Cancel and Remove download buttons. */
	removeDownload(): void;
}

const noSettings: EmojiSettings = {
	optedIn: false,
	status: "off",
	download: { kind: "notDownloaded", note: null },
	startDownload: () => {},
	removeDownload: () => {},
};
const SettingsContext = createContext<EmojiSettings>(noSettings);

export const useEmojiSettings = (): EmojiSettings =>
	useContext(SettingsContext);

/**
 * After the first successful sync, waits a moment and loads the model that is already stored on
 * this device, if the person downloaded it. The controller makes this a no-op for every other
 * device, so nothing is ever downloaded from here.
 */
function WarmUp({ controller }: { controller: EmojiController }) {
	const { engine } = useSession();
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const check = (status: { state: string; lastSyncedAt: number | null }) => {
			if (timer !== undefined) return;
			if (status.state !== "idle" || status.lastSyncedAt === null) return;
			timer = setTimeout(() => controller.warmUp(), WARM_UP_DELAY_MS);
		};
		check(engine.getStatus());
		const stop = engine.subscribe(check);
		return () => {
			stop();
			clearTimeout(timer);
		};
	}, [engine, controller]);
	return null;
}

/**
 * Provides the emoji engine and the Me settings to the signed-in app, starts the background
 * warm-up, and stops the worker when the app signs out. Needs the session (it watches the sync engine).
 */
export function EmojiEngineHost({
	controller: provided,
	children,
}: {
	controller?: EmojiController;
	children: ReactNode;
}) {
	const controller = useMemo(
		() => provided ?? getBrowserEmojiController(),
		[provided],
	);
	const snapshot = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
	);
	useEffect(() => () => controller.dispose(), [controller]);
	const settings = useMemo<EmojiSettings>(
		() => ({
			optedIn: snapshot.optedIn,
			status: snapshot.engine.status,
			download: snapshot.download,
			startDownload: () => void controller.download(),
			removeDownload: () => void controller.remove(),
		}),
		[snapshot, controller],
	);
	return (
		<EmojiEngineProvider value={snapshot.engine}>
			<SettingsContext.Provider value={settings}>
				<WarmUp controller={controller} />
				{children}
			</SettingsContext.Provider>
		</EmojiEngineProvider>
	);
}
