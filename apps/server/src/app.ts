import type { Context } from "hono";
import { Hono } from "hono";
import type { Auth } from "./auth";
import type { Db } from "./db/client";
import { fail } from "./http/errors";
import { type AppEnv, requireSession } from "./http/session";
import { groupRoutes } from "./routes/groups";
import { inviteRoutes } from "./routes/invites";
import { meRoutes } from "./routes/me";

export interface AppDeps {
	db: Db;
	auth: Auth;
	now?: () => number;
}

export function createApp({ db, auth, now = Date.now }: AppDeps) {
	const app = new Hono();

	// Public routes are registered first: they respond without calling next(),
	// so the session middleware of the /api sub-app never runs for them.
	app.get("/api/health", (c) => c.json({ ok: true }));

	const authHandler = async (c: Context) => {
		const origin = c.req.header("origin");
		if (!origin) {
			return fail(c, 403, "forbidden", "Origin header required.");
		}
		return auth.handler(c.req.raw);
	};
	app.get("/api/auth/*", authHandler);
	app.post("/api/auth/*", authHandler);

	const api = new Hono<AppEnv>();
	api.use("*", requireSession({ db, auth, now }));
	api.route("/me", meRoutes({ db, now }));
	api.route("/groups", groupRoutes({ db, now }));
	api.route("/", inviteRoutes({ db, now }));
	app.route("/api", api);

	app.notFound((c) => fail(c, 404, "not_found", "Not found."));
	return app;
}
