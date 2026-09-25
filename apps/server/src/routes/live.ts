import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../http/session";
import type { LiveHub } from "../live";

/** Cloudflare closes idle connections after ~100 s; stay well under that. */
export const KEEPALIVE_MS = 25_000;

export function liveRoutes(deps: { hub: LiveHub }) {
	const routes = new Hono<AppEnv>();

	routes.get("/", (c) =>
		streamSSE(c, async (stream) => {
			let pending = false;
			let wake: (() => void) | undefined;
			const unsubscribe = deps.hub.subscribe(c.var.user.id, () => {
				pending = true;
				wake?.();
			});
			stream.onAbort(() => {
				unsubscribe();
				wake?.(); // end the wait so the loop exits instead of sleeping out the keep-alive
			});

			await stream.writeSSE({ event: "ready", data: "" });
			while (!stream.aborted) {
				if (pending) {
					pending = false;
					await stream.writeSSE({ event: "poke", data: "" });
					continue;
				}
				const woke = await Promise.race([
					new Promise<boolean>((resolve) => {
						wake = () => resolve(true);
					}),
					stream.sleep(KEEPALIVE_MS).then(() => false),
				]);
				wake = undefined;
				if (!woke && !stream.aborted) await stream.write(": keepalive\n\n");
			}
			unsubscribe();
		}),
	);

	return routes;
}
