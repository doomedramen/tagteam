import { MAX_BATCH } from "@tagteam/core";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import type { AppEnv } from "../http/session";
import type { SuggestionPushEvent } from "../services/notifications";
import { pull } from "../services/sync-pull";
import { applyMutations } from "../services/sync-push";

const SUGGESTION_EVENTS = new Map<string, SuggestionPushEvent>([
	["suggestion.create", "suggested"],
	["suggestion.accept", "accepted"],
	["suggestion.decline", "declined"],
]);

export interface SyncDeps {
	db: Db;
	now: () => number;
	/** Called after a push that changed data: groups whose members to poke, plus individual users to poke. */
	onChange?: (groupIds: Set<string>, userIds: Set<string>) => void;
	onNudge?: (input: {
		taskId: string;
		eventId: string;
		senderId: string;
	}) => void | Promise<void>;
	/** Called for each applied suggestion.create/accept/decline; never for withdraw. */
	onSuggestion?: (input: {
		suggestionId: string;
		event: SuggestionPushEvent;
	}) => void | Promise<void>;
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
		const { results, groupIds, userIds } = applyMutations(
			deps.db,
			c.var.user.id,
			mutations,
			deps.now(),
		);
		for (const [index, input] of mutations.entries()) {
			const mutation = input as {
				id?: unknown;
				taskId?: unknown;
				suggestionId?: unknown;
				type?: unknown;
			} | null;
			if (
				results[index]?.status === "applied" &&
				mutation?.type === "task.nudge" &&
				typeof mutation.id === "string" &&
				typeof mutation.taskId === "string"
			) {
				const nudge = {
					taskId: mutation.taskId,
					eventId: mutation.id,
					senderId: c.var.user.id,
				};
				void Promise.resolve()
					.then(() => deps.onNudge?.(nudge))
					.catch((error: unknown) => console.error("Nudge push failed", error));
			}
			const event =
				typeof mutation?.type === "string"
					? SUGGESTION_EVENTS.get(mutation.type)
					: undefined;
			if (
				results[index]?.status === "applied" &&
				event &&
				typeof mutation?.suggestionId === "string"
			) {
				const suggestion = { suggestionId: mutation.suggestionId, event };
				void Promise.resolve()
					.then(() => deps.onSuggestion?.(suggestion))
					.catch((error: unknown) =>
						console.error("Suggestion push failed", error),
					);
			}
		}
		if (groupIds.size > 0 || userIds.size > 0)
			deps.onChange?.(groupIds, userIds);
		return c.json({ results });
	});

	routes.get("/pull", (c) => {
		const raw = c.req.query("cursor") ?? "0";
		if (!/^\d{1,15}$/.test(raw))
			return fail(
				c,
				400,
				"invalid_request",
				"cursor must be a non-negative integer.",
			);
		return c.json(pull(deps.db, c.var.user.id, Number(raw)));
	});

	return routes;
}
