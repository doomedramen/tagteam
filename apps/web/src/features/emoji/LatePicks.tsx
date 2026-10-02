import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session";
import { getMeta } from "../../store/db";
import { useEmojiEngine } from "./engine";
import { runLatePicks } from "./late-pick";

/**
 * Runs the late picks in the background: whenever the engine is ready, a sync has succeeded since
 * the app started (so the local copy of each task is current), and tasks are waiting.
 * It never starts a download (a ready engine already has its model) and shows nothing: a failed
 * run is dropped silently and the next trigger tries again. It renders nothing.
 */
export function LatePicks() {
	const { store, engine: sync, me } = useSession();
	const emoji = useEmojiEngine();
	const latest = useRef(emoji);
	latest.current = emoji;
	const running = useRef(false);
	const [synced, setSynced] = useState(
		() => sync.getStatus().lastSyncedAt !== null,
	);
	const waiting = useLiveQuery(
		async () => (await getMeta<string[]>(store, "awaitingEmoji"))?.length ?? 0,
		[store],
		0,
	);

	useEffect(() => {
		if (synced) return;
		return sync.subscribe((status) => {
			if (status.state === "idle" && status.lastSyncedAt !== null)
				setSynced(true);
		});
	}, [sync, synced]);

	const ready = emoji.status === "ready";
	useEffect(() => {
		if (!ready || !synced || waiting === 0 || running.current) return;
		running.current = true;
		void runLatePicks({
			store,
			sync,
			userId: me.user.id,
			getEngine: () => latest.current,
		})
			.catch(() => {
				// Best effort: a failed run never reaches the person; tasks keep the default.
			})
			.finally(() => {
				running.current = false;
			});
	}, [ready, synced, waiting, store, sync, me.user.id]);
	return null;
}
