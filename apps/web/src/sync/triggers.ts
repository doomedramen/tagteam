import type { SyncEngine } from "./engine";
import { connectLive } from "./live";

export function startSyncTriggers(
	engine: Pick<SyncEngine, "sync">,
	opts: {
		connect?: (onPoke: () => void) => () => void;
		intervalMs?: number;
	} = {},
): () => void {
	const { connect = connectLive, intervalMs = 60_000 } = opts;
	const sync = () => void engine.sync();
	const onVisible = () => {
		if (document.visibilityState === "visible") sync();
	};
	window.addEventListener("online", sync);
	document.addEventListener("visibilitychange", onVisible);
	const interval = setInterval(onVisible, intervalMs);
	const disconnect = connect(sync);
	return () => {
		window.removeEventListener("online", sync);
		document.removeEventListener("visibilitychange", onVisible);
		clearInterval(interval);
		disconnect();
	};
}
