// Used only by `pnpm auth:schema` to generate src/db/auth-schema.ts.
// Keep the plugin list in sync with src/auth.ts.
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export const auth = betterAuth({
	database: drizzleAdapter(drizzle(new Database(":memory:")), {
		provider: "sqlite",
	}),
	emailAndPassword: { enabled: true },
	plugins: [passkey()],
});
