import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import type { Config } from "./config";
import { openDb } from "./db/client";
import { startNotificationScheduler } from "./services/notifications";
import { createPushTransport } from "./services/push";

export interface RunningServer {
	port: number;
	stop(): Promise<void>;
}

export function startServer(config: Config): Promise<RunningServer> {
	const { db, close } = openDb(config.databasePath, config.migrationsDir);
	const push = config.vapid ? createPushTransport(config.vapid) : undefined;
	const stopNotifications = push
		? startNotificationScheduler(db, push)
		: async () => {};
	const app = createApp({
		db,
		auth: createAuth(db, config),
		trustedOrigin: config.baseUrl,
		webDir: config.webDir,
		push,
	});
	return new Promise((resolve) => {
		const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
			resolve({
				port: info.port,
				stop: async () => {
					await stopNotifications();
					try {
						await new Promise<void>((done, reject) => {
							server.close((err) => {
								if (err) reject(err);
								else done();
							});
							// Long-lived SSE connections would otherwise keep close pending.
							if ("closeAllConnections" in server) server.closeAllConnections();
						});
					} finally {
						close();
					}
				},
			});
		});
	});
}
