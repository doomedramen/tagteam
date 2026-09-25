import { randomUUID } from "node:crypto";
import type { Mutation, MutationType } from "@tagteam/core";
import type { Hono } from "hono";
import type { MutationResult } from "../services/sync-push";
import { api, readJson } from "./harness";

type Fields<T extends MutationType> = Omit<
	Extract<Mutation, { type: T }>,
	"id" | "at" | "type"
>;

export function mutation<T extends MutationType>(
	type: T,
	fields: Fields<T>,
	at: number,
): Mutation {
	return { id: randomUUID(), at, type, ...fields } as Mutation;
}

export async function push(app: Hono, cookie: string, mutations: unknown[]) {
	const res = await api(app, cookie, "POST", "/api/sync/push", { mutations });
	const body =
		res.status === 200
			? await readJson<{ results: MutationResult[] }>(res)
			: { results: [] };
	return { status: res.status, results: body.results };
}
