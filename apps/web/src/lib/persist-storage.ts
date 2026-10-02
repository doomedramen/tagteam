/**
 * Asks the browser to keep this origin's data (including the outbox of unsynced changes)
 * through storage pressure. Safe to call any number of times: it asks at most once per
 * requester, only when the API exists and storage is not already persistent, and it
 * ignores both the answer and any failure. On iOS the answer is yes for the installed
 * Home Screen app and no in a Safari tab; nothing in the UI depends on it.
 */
export function createPersistentStorageRequester(
	getStorage: () => StorageManager | undefined,
): () => Promise<void> {
	let requested = false;
	return async () => {
		if (requested) return;
		const storage = getStorage();
		if (!storage || typeof storage.persist !== "function") return;
		requested = true;
		try {
			if (
				typeof storage.persisted === "function" &&
				(await storage.persisted())
			)
				return;
			await storage.persist();
		} catch {
			// The browser refused or the call failed; the app works the same.
		}
	};
}

/** The app's shared requester: once per app start. */
export const requestPersistentStorage = createPersistentStorageRequester(() =>
	typeof navigator === "undefined" ? undefined : navigator.storage,
);
