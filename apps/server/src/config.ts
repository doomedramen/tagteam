export interface Config {
	port: number;
	databasePath: string;
	/** Public origin the app is served from, e.g. https://tagteam.example.com */
	baseUrl: string;
	authSecret: string;
	/** WebAuthn relying-party id (the host name). */
	rpId: string;
	rpName: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
	const errors: string[] = [];
	const authSecret = env.AUTH_SECRET ?? "";
	if (authSecret.length < 32)
		errors.push("AUTH_SECRET must be at least 32 characters");
	const rawUrl = env.BASE_URL ?? "http://localhost:3000";
	const url = URL.canParse(rawUrl) ? new URL(rawUrl) : null;
	if (!url) errors.push("BASE_URL must be a URL");
	const port = Number(env.PORT ?? 3000);
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		errors.push("PORT must be 0-65535");
	if (errors.length > 0 || !url)
		throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
	return {
		port,
		databasePath: env.DATABASE_PATH ?? "./data/tagteam.db",
		baseUrl: url.origin,
		authSecret,
		rpId: env.RP_ID ?? url.hostname,
		rpName: env.RP_NAME ?? "TagTeam",
	};
}
