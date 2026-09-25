import { Hono } from "hono";
import type { Db } from "../db/client";
import type { AppEnv, SessionUser } from "../http/session";
import { listMyGroups, type MyGroup } from "../services/groups";
import { type ProfileDto, toProfileDto } from "../services/profiles";

export interface MeResponse {
	user: SessionUser;
	profile: ProfileDto;
	groups: MyGroup[];
}

export function meRoutes(deps: { db: Db; now: () => number }) {
	const routes = new Hono<AppEnv>();
	routes.get("/", (c) => {
		const body: MeResponse = {
			user: c.var.user,
			profile: toProfileDto(c.var.profile),
			groups: listMyGroups(deps.db, c.var.user.id),
		};
		return c.json(body);
	});
	return routes;
}
