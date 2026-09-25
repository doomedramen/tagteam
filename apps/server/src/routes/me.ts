import { Hono } from "hono";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import type { AppEnv, SessionUser } from "../http/session";
import type { LiveHub } from "../live";
import { pokeGroups } from "../live";
import { listMyGroups, type MyGroup } from "../services/groups";
import {
	type ProfileDto,
	toProfileDto,
	updateProfile,
	validateProfilePatch,
} from "../services/profiles";

export interface MeResponse {
	user: SessionUser;
	profile: ProfileDto;
	groups: MyGroup[];
}

export function meRoutes(deps: { db: Db; now: () => number; live: LiveHub }) {
	const routes = new Hono<AppEnv>();
	routes.get("/", (c) => {
		const body: MeResponse = {
			user: c.var.user,
			profile: toProfileDto(c.var.profile),
			groups: listMyGroups(deps.db, c.var.user.id),
		};
		return c.json(body);
	});
	routes.patch("/", async (c) => {
		const input: unknown = await c.req.json().catch(() => undefined);
		const { patch, errors } = validateProfilePatch(
			deps.db,
			c.var.user.id,
			input,
		);
		if (errors.length > 0)
			return fail(
				c,
				400,
				"invalid_request",
				"Check the highlighted fields.",
				errors,
			);
		const updated = updateProfile(deps.db, c.var.user.id, patch, deps.now());
		pokeGroups(
			deps.db,
			deps.live,
			listMyGroups(deps.db, c.var.user.id).map((g) => g.id),
			[c.var.user.id],
		);
		return c.json({ profile: toProfileDto(updated) });
	});
	return routes;
}
