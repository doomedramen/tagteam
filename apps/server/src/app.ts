import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./auth";
import type { Db } from "./db/client";
import { fail } from "./http/errors";
import { rejectUntrustedOrigin } from "./http/origin";
import { type AppEnv, requireSession } from "./http/session";
import { groupRoutes } from "./routes/groups";
import { inviteRoutes } from "./routes/invites";
import { meRoutes } from "./routes/me";
import { syncRoutes } from "./routes/sync";

export interface AppDeps {
	db: Db;
	auth: Auth;
	/** The app's public origin (Config.baseUrl). */
	trustedOrigin: string;
	now?: () => number;
}

export function createApp({
	db,
	auth,
	trustedOrigin,
	now = Date.now,
}: AppDeps) {
	const app = new Hono();

	// Public routes are registered first: they respond without calling next(),
	// so the session middleware of the /api sub-app never runs for them.
	app.get("/api/health", (c) => c.json({ ok: true }));
	app.use("/api/auth/*", rejectUntrustedOrigin(trustedOrigin));
	app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

	const api = new Hono<AppEnv>();
	api.use("*", requireSession({ db, auth, now }));
	api.route("/me", meRoutes({ db, now }));
	api.route("/groups", groupRoutes({ db, now }));
	api.route("/", inviteRoutes({ db, now }));
	api.route("/sync", syncRoutes({ db, now }));
	app.route("/api", api);

	app.onError((err, c) => {
		if (err instanceof HTTPException) return err.getResponse();
		console.error(err);
		return fail(c, 500, "internal_error", "Something went wrong. Try again.");
	});
	app.notFound((c) => fail(c, 404, "not_found", "Not found."));
	return app;
}
