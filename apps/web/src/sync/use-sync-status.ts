import { useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "./engine";

export function useSyncStatus(engine: SyncEngine): SyncStatus {
	return useSyncExternalStore(engine.subscribe, engine.getStatus);
}
