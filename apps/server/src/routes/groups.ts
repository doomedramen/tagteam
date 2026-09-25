import { Hono } from "hono";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import type { AppEnv } from "../http/session";
import type { LiveHub } from "../live";
import { pokeGroups } from "../live";
import {
	createGroup,
	isActiveMember,
	leaveGroup,
	listMembers,
	validateGroupName,
} from "../services/groups";

export function groupRoutes(deps: {
	db: Db;
	now: () => number;
	live: LiveHub;
}) {
	const routes = new Hono<AppEnv>();

	routes.post("/", async (c) => {
		const input = (await c.req.json().catch(() => undefined)) as
			| { name?: unknown }
			| undefined;
		const name = validateGroupName(input?.name);
		if (!name)
			return fail(c, 400, "invalid_request", "Check the highlighted fields.", [
				"name must be 1-40 characters",
			]);
		const group = createGroup(deps.db, c.var.user.id, name, deps.now());
		deps.live.pokeUsers([c.var.user.id]);
		return c.json({ group }, 201);
	});

	routes.get("/:groupId/members", (c) => {
		const groupId = c.req.param("groupId");
		if (!isActiveMember(deps.db, groupId, c.var.user.id))
			return fail(c, 404, "not_found", "Not found.");
		return c.json({ members: listMembers(deps.db, groupId) });
	});

	routes.post("/:groupId/leave", (c) => {
		const groupId = c.req.param("groupId");
		if (!leaveGroup(deps.db, groupId, c.var.user.id, deps.now())) {
			return fail(c, 404, "not_found", "Not found.");
		}
		pokeGroups(deps.db, deps.live, [groupId], [c.var.user.id]);
		return c.body(null, 204);
	});

	return routes;
}
