import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pushSubscription } from "../db/schema";
import { fail } from "../http/errors";
import type { AppEnv } from "../http/session";
import {
	getNotificationSettings,
	updateNotificationSettings,
	validateNotificationSettingsPatch,
} from "../services/notification-settings";
import { validatePushEndpoint } from "../services/notifications";
import type { PushTransport } from "../services/push";

export function pushRoutes(deps: {
	db: Db;
	now: () => number;
	push?: PushTransport;
}) {
	const routes = new Hono<AppEnv>();
	routes.get("/", (c) => {
		const settings = getNotificationSettings(deps.db, c.var.user.id);
		const subscriptionCount =
			deps.db
				.select({ value: count() })
				.from(pushSubscription)
				.where(eq(pushSubscription.userId, c.var.user.id))
				.get()?.value ?? 0;
		return c.json({
			configured: Boolean(deps.push),
			publicKey: deps.push?.publicKey ?? null,
			settings: {
				remindersEnabled: settings.remindersEnabled,
				nudgesEnabled: settings.nudgesEnabled,
				quietHoursStart: settings.quietHoursStart,
				quietHoursEnd: settings.quietHoursEnd,
			},
			subscriptionCount,
		});
	});

	routes.patch("/settings", async (c) => {
		const input: unknown = await c.req.json().catch(() => undefined);
		const { patch, errors } = validateNotificationSettingsPatch(input);
		if (errors.length > 0)
			return fail(
				c,
				400,
				"invalid_request",
				"Check notification settings.",
				errors,
			);
		const settings = updateNotificationSettings(
			deps.db,
			c.var.user.id,
			patch,
			deps.now(),
		);
		return c.json({
			settings: {
				remindersEnabled: settings.remindersEnabled,
				nudgesEnabled: settings.nudgesEnabled,
				quietHoursStart: settings.quietHoursStart,
				quietHoursEnd: settings.quietHoursEnd,
			},
		});
	});

	routes.post("/subscriptions", async (c) => {
		if (!deps.push)
			return fail(
				c,
				503,
				"push_unavailable",
				"Push notifications are not configured.",
			);
		const body = (await c.req.json().catch(() => undefined)) as
			| {
					subscription?: {
						endpoint?: unknown;
						keys?: { p256dh?: unknown; auth?: unknown };
					};
					deviceLabel?: unknown;
			  }
			| undefined;
		const endpoint = body?.subscription?.endpoint;
		const p256dh = body?.subscription?.keys?.p256dh;
		const auth = body?.subscription?.keys?.auth;
		const deviceLabel =
			typeof body?.deviceLabel === "string"
				? body.deviceLabel.trim().slice(0, 64) || "This device"
				: "This device";
		if (
			!validatePushEndpoint(endpoint) ||
			typeof p256dh !== "string" ||
			p256dh.length < 20 ||
			p256dh.length > 256 ||
			typeof auth !== "string" ||
			auth.length < 8 ||
			auth.length > 128
		) {
			return fail(
				c,
				400,
				"invalid_request",
				"Send a valid web push subscription.",
			);
		}
		const id = randomUUID();
		const existing = deps.db
			.select({ id: pushSubscription.id })
			.from(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, c.var.user.id),
					eq(pushSubscription.endpoint, endpoint),
				),
			)
			.get();
		const subscriptionCount =
			deps.db
				.select({ value: count() })
				.from(pushSubscription)
				.where(eq(pushSubscription.userId, c.var.user.id))
				.get()?.value ?? 0;
		if (!existing && subscriptionCount >= 10)
			return fail(
				c,
				409,
				"subscription_limit",
				"This account already has 10 subscribed devices.",
			);
		deps.db
			.insert(pushSubscription)
			.values({
				id,
				userId: c.var.user.id,
				endpoint,
				p256dh,
				auth,
				deviceLabel,
				createdAt: deps.now(),
			})
			.onConflictDoUpdate({
				target: pushSubscription.endpoint,
				set: {
					userId: c.var.user.id,
					p256dh,
					auth,
					deviceLabel,
				},
			})
			.run();
		return c.json({ ok: true }, 201);
	});

	routes.delete("/subscriptions", async (c) => {
		const body = (await c.req.json().catch(() => undefined)) as
			| { endpoint?: unknown }
			| undefined;
		if (!validatePushEndpoint(body?.endpoint))
			return fail(c, 400, "invalid_request", "Send a valid web push endpoint.");
		deps.db
			.delete(pushSubscription)
			.where(
				and(
					eq(pushSubscription.userId, c.var.user.id),
					eq(pushSubscription.endpoint, body.endpoint),
				),
			)
			.run();
		return c.body(null, 204);
	});

	return routes;
}
