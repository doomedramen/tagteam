import { MAX_BATCH } from "@tagteam/core";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import type { AppEnv } from "../http/session";
import { applyMutations } from "../services/sync-push";

export interface SyncDeps {
	db: Db;
	now: () => number;
	/** Called after a push that changed data, with the affected group ids. */
	onChange?: (groupIds: Set<string>) => void;
}

export function syncRoutes(deps: SyncDeps) {
	const routes = new Hono<AppEnv>();

	routes.post("/push", async (c) => {
		const body = (await c.req.json().catch(() => undefined)) as
			| { mutations?: unknown }
			| undefined;
		const mutations = body?.mutations;
		if (!Array.isArray(mutations) || mutations.length > MAX_BATCH) {
			return fail(
				c,
				400,
				"invalid_request",
				`Send { mutations: [...] } with at most ${MAX_BATCH} items.`,
			);
		}
		const { results, groupIds } = applyMutations(
			deps.db,
			c.var.user.id,
			mutations,
			deps.now(),
		);
		if (groupIds.size > 0) deps.onChange?.(groupIds);
		return c.json({ results });
	});

	return routes;
}
