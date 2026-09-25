import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const secret = "x".repeat(32);

describe("loadConfig", () => {
	it("applies defaults", () => {
		expect(loadConfig({ AUTH_SECRET: secret })).toEqual({
			port: 3000,
			databasePath: "./data/tagteam.db",
			baseUrl: "http://localhost:3000",
			authSecret: secret,
			rpId: "localhost",
			rpName: "TagTeam",
		});
	});

	it("derives origin and passkey RP id from BASE_URL", () => {
		const config = loadConfig({
			AUTH_SECRET: secret,
			BASE_URL: "https://tagteam.example.com/some/path",
		});
		expect(config.baseUrl).toBe("https://tagteam.example.com");
		expect(config.rpId).toBe("tagteam.example.com");
	});

	it("passes MIGRATIONS_DIR through", () => {
		expect(
			loadConfig({ AUTH_SECRET: secret, MIGRATIONS_DIR: "/app/drizzle" })
				.migrationsDir,
		).toBe("/app/drizzle");
		expect(loadConfig({ AUTH_SECRET: secret }).migrationsDir).toBeUndefined();
	});

	it("reports every invalid value", () => {
		expect(() =>
			loadConfig({
				AUTH_SECRET: "short",
				BASE_URL: "not a url",
				PORT: "99999",
			}),
		).toThrow(
			/AUTH_SECRET must be at least 32 characters[\s\S]*BASE_URL must be a URL[\s\S]*PORT must be 0-65535/,
		);
	});
});
