/** Opens the server's SSE stream; calls `onPoke` when it connects and whenever data changed. Returns a disconnect function. */
export function connectLive(
	onPoke: () => void,
	EventSourceImpl: typeof EventSource = EventSource,
): () => void {
	const source = new EventSourceImpl("/api/live", { withCredentials: true });
	let reportedDisconnect = false;
	const onReady = () => {
		reportedDisconnect = false;
		onPoke();
	};
	const onError = () => {
		if (reportedDisconnect) return;
		reportedDisconnect = true;
		onPoke();
	};
	source.addEventListener("ready", onReady);
	source.addEventListener("poke", onPoke);
	source.addEventListener("error", onError);
	return () => source.close();
}
