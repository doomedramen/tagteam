import { readFlag, writeFlag } from "../../lib/storage";

// The engine's device-local state lives in localStorage, not in the Dexie store: it is read
// synchronously at startup (before any async open), it must survive a tab that crashes while the
// model loads, and sign-out clears the Dexie store but a device setting is not the user's data.
const OPTED_IN_KEY = "tagteam.emoji.optedIn";
const AUTO_OFF_KEY = "tagteam.emoji.autoOff";
const INSTALLED_KEY = "tagteam.emoji.installed";
const STATE_KEY = "tagteam.emoji.state";

/** What survives between app starts, for one asset version. */
export interface PersistedState {
	/** The asset version these counters belong to; a different version starts afresh. */
	version: string;
	/** Written before the model loads and cleared after. Found set at start, the last load crashed the app. */
	loading: boolean;
	/** Starts that found `loading` still set, since the last success. */
	strikes: number;
	/** App starts in a row that ended unavailable, since the last success. */
	failedStarts: number;
}

export interface EngineStorage {
	/** The person pressed Download on this device and has not removed it. Off by default: nothing downloads until then. */
	readOptedIn(): boolean;
	writeOptedIn(optedIn: boolean): void;
	/** Set when two crashes switched emoji suggestions off, so Me can say why. */
	readAutoOff(): "crash" | null;
	writeAutoOff(reason: "crash" | null): void;
	/** The asset version whose download finished and loaded on this device, or null. */
	readInstalled(): string | null;
	writeInstalled(version: string | null): void;
	readState(version: string): PersistedState;
	writeState(state: PersistedState): void;
}

const fresh = (version: string): PersistedState => ({
	version,
	loading: false,
	strikes: 0,
	failedStarts: 0,
});

const count = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: 0;

export function createLocalStorageEngineStorage(): EngineStorage {
	return {
		readOptedIn: () => readFlag(OPTED_IN_KEY, false),
		writeOptedIn: (optedIn) => writeFlag(OPTED_IN_KEY, optedIn),
		readAutoOff() {
			try {
				return localStorage.getItem(AUTO_OFF_KEY) === "crash" ? "crash" : null;
			} catch {
				return null;
			}
		},
		writeAutoOff(reason) {
			try {
				if (reason === null) localStorage.removeItem(AUTO_OFF_KEY);
				else localStorage.setItem(AUTO_OFF_KEY, reason);
			} catch {
				// Not persisted; the Me section still shows the right state this session.
			}
		},
		readInstalled() {
			try {
				const value = localStorage.getItem(INSTALLED_KEY);
				return value !== null && value !== "" ? value : null;
			} catch {
				return null;
			}
		},
		writeInstalled(version) {
			try {
				if (version === null) localStorage.removeItem(INSTALLED_KEY);
				else localStorage.setItem(INSTALLED_KEY, version);
			} catch {
				// Not persisted; the engine then asks for a download again next start.
			}
		},
		readState(version) {
			try {
				const raw = localStorage.getItem(STATE_KEY);
				if (raw === null) return fresh(version);
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (parsed.version !== version) return fresh(version);
				return {
					version,
					loading: parsed.loading === true,
					strikes: count(parsed.strikes),
					failedStarts: count(parsed.failedStarts),
				};
			} catch {
				return fresh(version);
			}
		},
		writeState(state) {
			try {
				localStorage.setItem(STATE_KEY, JSON.stringify(state));
			} catch {
				// Not persisted; the engine still works this session.
			}
		},
	};
}
