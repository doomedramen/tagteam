/** Per-device UI preferences. Storage can be unavailable (private mode), so failures fall back silently. */
export function readFlag(key: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : value === "true";
	} catch {
		return fallback;
	}
}

export function writeFlag(key: string, value: boolean): void {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Preference is not persisted; the UI still works.
	}
}
