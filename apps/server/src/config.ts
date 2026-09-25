export interface Config {
	port: number;
	databasePath: string;
	/** Public origin the app is served from, e.g. https://tagteam.example.com */
	baseUrl: string;
	authSecret: string;
	/** WebAuthn relying-party id (the host name). */
	rpId: string;
	rpName: string;
	/** Folder of drizzle SQL migrations; defaults to the source tree's drizzle/ (set in the Docker image). */
	migrationsDir?: string;
	/** Built web app to serve (production image); unset in development where Vite serves it. */
	webDir?: string;
	vapid?: { publicKey: string; privateKey: string; subject: string };
}

export function loadConfig(env: Record<string, string | undefined>): Config {
	const errors: string[] = [];
	const authSecret = env.AUTH_SECRET ?? "";
	if (authSecret.length < 32)
		errors.push("AUTH_SECRET must be at least 32 characters");
	const rawUrl = env.BASE_URL ?? "http://localhost:3000";
	const url = URL.canParse(rawUrl) ? new URL(rawUrl) : null;
	if (!url) errors.push("BASE_URL must be a URL");
	const vapidPublicKey = env.VAPID_PUBLIC_KEY;
	const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
	const vapidSubject = env.VAPID_SUBJECT;
	if (Boolean(vapidPublicKey) !== Boolean(vapidPrivateKey)) {
		errors.push("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together");
	} else if (vapidPublicKey && vapidPrivateKey) {
		const validMailto =
			typeof vapidSubject === "string" &&
			/^mailto:[^@\s]+@[^@\s]+$/.test(vapidSubject);
		const validHttps =
			typeof vapidSubject === "string" &&
			URL.canParse(vapidSubject) &&
			new URL(vapidSubject).protocol === "https:" &&
			new URL(vapidSubject).hostname.length > 0;
		if (!validMailto && !validHttps)
			errors.push("VAPID_SUBJECT must be an https URL or mailto address");
	}
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
		migrationsDir: env.MIGRATIONS_DIR,
		webDir: env.WEB_DIR,
		...(vapidPublicKey && vapidPrivateKey && vapidSubject
			? {
					vapid: {
						publicKey: vapidPublicKey,
						privateKey: vapidPrivateKey,
						subject: vapidSubject,
					},
				}
			: {}),
	};
}
