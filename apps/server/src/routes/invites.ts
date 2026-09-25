import { Hono } from "hono";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import type { AppEnv } from "../http/session";
import type { LiveHub } from "../live";
import { pokeGroups } from "../live";
import { createRateLimiter, REDEEM_LIMITS } from "../rate-limit";
import { isActiveMember } from "../services/groups";
import {
	createInvite,
	listPendingInvites,
	redeemInvite,
	revokeInvite,
} from "../services/invites";

export function inviteRoutes(deps: {
	db: Db;
	now: () => number;
	live: LiveHub;
}) {
	const routes = new Hono<AppEnv>();
	const limiter = createRateLimiter(REDEEM_LIMITS);

	routes.post("/groups/:groupId/invites", (c) => {
		const groupId = c.req.param("groupId");
		if (!isActiveMember(deps.db, groupId, c.var.user.id))
			return fail(c, 404, "not_found", "Not found.");
		const invite = createInvite(deps.db, groupId, c.var.user.id, deps.now());
		if (!invite)
			return fail(
				c,
				409,
				"too_many_invites",
				"You have 10 unused codes. Revoke one first.",
			);
		return c.json(invite, 201);
	});

	routes.get("/groups/:groupId/invites", (c) => {
		const groupId = c.req.param("groupId");
		if (!isActiveMember(deps.db, groupId, c.var.user.id))
			return fail(c, 404, "not_found", "Not found.");
		return c.json({
			invites: listPendingInvites(deps.db, groupId, c.var.user.id, deps.now()),
		});
	});

	routes.delete("/invites/:code", (c) => {
		if (
			!revokeInvite(deps.db, c.req.param("code"), c.var.user.id, deps.now())
		) {
			return fail(c, 404, "not_found", "Not found.");
		}
		return c.body(null, 204);
	});

	routes.post("/invites/redeem", async (c) => {
		const now = deps.now();
		if (!limiter.attempt(c.var.user.id, now)) {
			return fail(
				c,
				429,
				"rate_limited",
				"Too many attempts. Try again in a minute.",
			);
		}

		const input = (await c.req.json().catch(() => undefined)) as
			| { code?: unknown }
			| undefined;
		const code = typeof input?.code === "string" ? input.code.trim() : "";
		const result = /^\d{6}$/.test(code)
			? redeemInvite(deps.db, code, c.var.user.id, now)
			: null;
		if (!result || (!result.ok && result.reason === "invalid")) {
			return fail(
				c,
				404,
				"invalid_code",
				"That code isn't valid. Ask for a new one.",
			);
		}
		if (!result.ok)
			return fail(c, 409, "already_member", "You're already in this group.");
		pokeGroups(deps.db, deps.live, [result.group.id]);
		return c.json({ group: result.group });
	});

	return routes;
}
