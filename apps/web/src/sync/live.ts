/** Opens the server's SSE stream; calls `onPoke` when it connects and whenever data changed. Returns a disconnect function. */
export function connectLive(
	onPoke: () => void,
	EventSourceImpl: typeof EventSource = EventSource,
): () => void {
	const source = new EventSourceImpl("/api/live", { withCredentials: true });
	source.addEventListener("ready", onPoke);
	source.addEventListener("poke", onPoke);
	return () => source.close();
}
