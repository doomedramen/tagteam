import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./auth";
import type { Db } from "./db/client";
import { fail } from "./http/errors";
import { rejectUntrustedOrigin } from "./http/origin";
import { type AppEnv, requireSession } from "./http/session";
import { createLiveHub, type LiveHub, pokeGroups } from "./live";
import { groupRoutes } from "./routes/groups";
import { inviteRoutes } from "./routes/invites";
import { liveRoutes } from "./routes/live";
import { meRoutes } from "./routes/me";
import { syncRoutes } from "./routes/sync";

export const MAX_BODY_BYTES = 1024 * 1024;

export interface AppDeps {
	db: Db;
	auth: Auth;
	/** The app's public origin (Config.baseUrl). */
	trustedOrigin: string;
	now?: () => number;
	live?: LiveHub;
	webDir?: string;
}

export function createApp({
	db,
	auth,
	trustedOrigin,
	now = Date.now,
	live = createLiveHub(),
	webDir,
}: AppDeps) {
	const app = new Hono();

	// Public routes are registered first: they respond without calling next(),
	// so the session middleware of the /api sub-app never runs for them.
	app.get("/api/health", (c) => c.json({ ok: true }));
	app.use(
		"/api/*",
		bodyLimit({
			maxSize: MAX_BODY_BYTES,
			onError: (c) =>
				fail(c, 413, "payload_too_large", "That request is too large."),
		}),
	);
	app.use("/api/auth/*", rejectUntrustedOrigin(trustedOrigin));
	app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

	const api = new Hono<AppEnv>();
	api.use("*", requireSession({ db, auth, now }));
	api.route("/me", meRoutes({ db, now, live }));
	api.route("/groups", groupRoutes({ db, now, live }));
	api.route("/", inviteRoutes({ db, now, live }));
	api.route(
		"/sync",
		syncRoutes({
			db,
			now,
			onChange: (groupIds) => pokeGroups(db, live, groupIds),
		}),
	);
	api.route("/live", liveRoutes({ hub: live }));
	app.route("/api", api);

	if (webDir) {
		const isApi = (path: string) => path === "/api" || path.startsWith("/api/");
		const noCache = (_path: string, c: Context) =>
			c.header("cache-control", "no-cache");
		const files = serveStatic({
			root: webDir,
			onFound: (path, c) =>
				c.header(
					"cache-control",
					path.includes("/assets/")
						? "public, max-age=31536000, immutable"
						: "no-cache",
				),
		});
		const appShell = serveStatic({
			root: webDir,
			path: "index.html",
			onFound: noCache,
		});
		app.on(["GET", "HEAD"], "*", (c, next) =>
			isApi(c.req.path) ? next() : files(c, next),
		);
		app.on(["GET", "HEAD"], "*", (c, next) =>
			isApi(c.req.path) ? next() : appShell(c, next),
		);
	}

	app.onError((err, c) => {
		if (err instanceof HTTPException) return err.getResponse();
		console.error(err);
		return fail(c, 500, "internal_error", "Something went wrong. Try again.");
	});
	app.notFound((c) => fail(c, 404, "not_found", "Not found."));
	return app;
}
