import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config";
import type { Db } from "./db/client";
import * as schema from "./db/schema";

export function createAuth(
	db: Db,
	config: Config,
	options: { rateLimit?: boolean } = {},
) {
	return betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		secret: config.authSecret,
		baseURL: config.baseUrl,
		basePath: "/api/auth",
		trustedOrigins: [config.baseUrl],
		emailAndPassword: { enabled: true, minPasswordLength: 10 },
		rateLimit: { enabled: options.rateLimit ?? true },
		// Keep in sync with scripts/auth-schema.config.ts.
		plugins: [
			passkey({
				rpID: config.rpId,
				rpName: config.rpName,
				origin: config.baseUrl,
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
