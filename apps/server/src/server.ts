import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import type { Config } from "./config";
import { openDb } from "./db/client";

export interface RunningServer {
	port: number;
	stop(): Promise<void>;
}

export function startServer(config: Config): Promise<RunningServer> {
	const { db, close } = openDb(config.databasePath);
	const app = createApp({
		db,
		auth: createAuth(db, config),
		trustedOrigin: config.baseUrl,
	});
	return new Promise((resolve) => {
		const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
			resolve({
				port: info.port,
				stop: () =>
					new Promise<void>((done, reject) => {
						server.close((err) => {
							close();
							if (err) reject(err);
							else done();
						});
					}),
			});
		});
	});
}
