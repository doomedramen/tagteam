import { randomUUID } from "node:crypto";
import type { Mutation, MutationType } from "@tagteam/core";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import type { PullResponse } from "../services/sync-pull";
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
	return { id: randomUUID(), at, type, ...fields } as unknown as Mutation;
}

export async function push(app: Hono, cookie: string, mutations: unknown[]) {
	const res = await api(app, cookie, "POST", "/api/sync/push", { mutations });
	const body =
		res.status === 200
			? await readJson<{ results: MutationResult[] }>(res)
			: { results: [] };
	return { status: res.status, results: body.results };
}

export async function pullAll(
	app: Hono,
	cookie: string,
	cursor = 0,
): Promise<PullResponse> {
	const res = await api(app, cookie, "GET", `/api/sync/pull?cursor=${cursor}`);
	if (res.status !== 200)
		throw new Error(`pull failed: ${res.status} ${await res.text()}`);
	return readJson<PullResponse>(res);
}

/** The id Better Auth assigned to the user who signed up with `email`. */
export function userIdOf(db: Db, email: string): string {
	const row = db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.get();
	if (!row) throw new Error(`no user with email ${email}`);
	return row.id;
}
