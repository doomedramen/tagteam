import { expect, it } from "vitest";
import { openDb } from "./client";

it("creates every table on a fresh database", () => {
	const { db, close } = openDb(":memory:");
	const rows = db.$client
		.prepare(
			"select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name not like 'sqlite_%'",
		)
		.all() as { name: string }[];
	expect(rows.map((r) => r.name).sort()).toEqual([
		"account",
		"applied_mutation",
		"groups",
		"invite_code",
		"membership",
		"passkey",
		"profile",
		"session",
		"sync_state",
		"task",
		"task_event",
		"user",
		"verification",
	]);
	close();
});
