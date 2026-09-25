import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config";
import type { Db } from "./db/client";
import * as schema from "./db/schema";

export function createAuth(db: Db, config: Config) {
	return betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		secret: config.authSecret,
		baseURL: config.baseUrl,
		basePath: "/api/auth",
		trustedOrigins: [config.baseUrl],
		// Better Auth defaults origin/CSRF checks to disabled when isTest() is true; force them on in every environment.
		advanced: { disableOriginCheck: false },
		emailAndPassword: { enabled: true, minPasswordLength: 10 },
		// Better Auth's limiter keys on client IP; behind cloudflared every request shares one IP,
		// so it would throttle all users together. Sign-in brute force is stopped by Cloudflare Access.
		rateLimit: { enabled: false },
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
