import { existsSync } from "node:fs";
import { loadConfig } from "./config";
import { startServer } from "./server";

if (existsSync(".env")) process.loadEnvFile(".env");

const server = await startServer(loadConfig(process.env));
console.log(`TagTeam server listening on port ${server.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		server.stop().then(
			() => process.exit(0),
			(err: unknown) => {
				console.error(err);
				process.exit(1);
			},
		);
	});
}
