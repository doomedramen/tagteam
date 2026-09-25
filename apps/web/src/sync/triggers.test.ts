import { afterEach, expect, it, vi } from "vitest";
import { connectLive } from "./live";
import { startSyncTriggers } from "./triggers";

afterEach(() => vi.useRealTimers());

it("syncs when coming online, on live pokes, and on a timer", () => {
	vi.useFakeTimers();
	const engine = { sync: vi.fn(async () => {}) };
	let poke = () => {};
	const stop = startSyncTriggers(engine, {
		intervalMs: 1000,
		connect: (onPoke) => {
			poke = onPoke;
			return () => {};
		},
	});
	window.dispatchEvent(new Event("online"));
	poke();
	vi.advanceTimersByTime(1000);
	expect(engine.sync).toHaveBeenCalledTimes(3);
	stop();
	window.dispatchEvent(new Event("online"));
	expect(engine.sync).toHaveBeenCalledTimes(3);
});

it("listens for ready and poke events on the live stream", () => {
	const listeners: Record<string, () => void> = {};
	class FakeEventSource {
		closed = false;
		constructor(public url: string) {}
		addEventListener(type: string, fn: () => void) {
			listeners[type] = fn;
		}
		close() {
			this.closed = true;
		}
	}
	const onPoke = vi.fn();
	const disconnect = connectLive(
		onPoke,
		FakeEventSource as unknown as typeof EventSource,
	);
	listeners.ready?.();
	listeners.poke?.();
	expect(onPoke).toHaveBeenCalledTimes(2);
	disconnect();
});
