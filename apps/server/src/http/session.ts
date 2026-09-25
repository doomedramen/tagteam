import type { SessionUser } from "@tagteam/core";
import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth";
import type { Db } from "../db/client";
import { ensureProfile, type Profile } from "../services/profiles";
import { fail } from "./errors";

export type { SessionUser };

export type AppEnv = { Variables: { user: SessionUser; profile: Profile } };

/** Rejects requests without a Better Auth session; exposes `user` and (lazily created) `profile`. */
export const requireSession = (deps: {
	db: Db;
	auth: Auth;
	now: () => number;
}) =>
	createMiddleware<AppEnv>(async (c, next) => {
		const session = await deps.auth.api.getSession({
			headers: c.req.raw.headers,
		});
		if (!session) return fail(c, 401, "unauthorized", "Sign in first.");
		const { id, email, name } = session.user;
		c.set("user", { id, email, name });
		c.set("profile", ensureProfile(deps.db, { id, name }, deps.now()));
		await next();
	});
