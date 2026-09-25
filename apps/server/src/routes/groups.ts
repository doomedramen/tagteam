import { Hono } from "hono";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import type { AppEnv } from "../http/session";
import {
	createGroup,
	isActiveMember,
	leaveGroup,
	listMembers,
	validateGroupName,
} from "../services/groups";

export function groupRoutes(deps: { db: Db; now: () => number }) {
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
		return c.json(
			{ group: createGroup(deps.db, c.var.user.id, name, deps.now()) },
			201,
		);
	});

	routes.get("/:groupId/members", (c) => {
		const groupId = c.req.param("groupId");
		if (!isActiveMember(deps.db, groupId, c.var.user.id))
			return fail(c, 404, "not_found", "Not found.");
		return c.json({ members: listMembers(deps.db, groupId) });
	});

	routes.post("/:groupId/leave", (c) => {
		if (
			!leaveGroup(deps.db, c.req.param("groupId"), c.var.user.id, deps.now())
		) {
			return fail(c, 404, "not_found", "Not found.");
		}
		return c.body(null, 204);
	});

	return routes;
}
