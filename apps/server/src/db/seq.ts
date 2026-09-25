import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { syncState } from "./schema";

export type SeqDb = Pick<Db, "insert" | "select">;

/** Advances and returns the global change sequence. Call inside the transaction that writes the rows. */
export function nextSeq(db: SeqDb): number {
	const row = db
		.insert(syncState)
		.values({ key: "seq", value: 1 })
		.onConflictDoUpdate({
			target: syncState.key,
			set: { value: sql`${syncState.value} + 1` },
		})
		.returning({ value: syncState.value })
		.get();
	if (!row) throw new Error("failed to advance the change sequence");
	return row.value;
}

/** Latest assigned sequence value (0 before any write). */
export function currentSeq(db: Pick<Db, "select">): number {
	return (
		db
			.select({ value: syncState.value })
			.from(syncState)
			.where(eq(syncState.key, "seq"))
			.get()?.value ?? 0
	);
}
