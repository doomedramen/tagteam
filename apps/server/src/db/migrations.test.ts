import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const files = readdirSync(folder)
	.filter((name) => name.endsWith(".sql"))
	.sort();
const statements = (name: string) =>
	readFileSync(join(folder, name), "utf8")
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter(Boolean);

it("keeps queued notification deliveries when the log is rebuilt for suggestions", () => {
	const migration = files.find((name) => name.startsWith("0004_"));
	expect(migration).toBeDefined();

	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	for (const name of files.filter((name) => name < "0004_"))
		for (const statement of statements(name)) sqlite.exec(statement);
	sqlite.exec(`
		insert into user (id, name, email) values ('u1', 'Sam', 'sam@example.com');
		insert into groups (id, name, created_by, created_at) values ('g1', 'Home', 'u1', 0);
		insert into task (id, group_id, owner_id, title, timezone, start_date, rules, created_at, clocks, seq)
			values ('t1', 'g1', 'u1', 'Wash dishes', 'UTC', '2026-09-27', '[]', 0, '{}', 1);
		insert into notification_log (id, task_id, user_id, occurrence_key, kind, title, body, url, created_at)
			values ('n1', 't1', 'u1', '2026-09-27', 'due', 'Task due', 'Wash dishes is due.', '/', 5);
		insert into notification_delivery (id, notification_id, endpoint, next_attempt_at)
			values ('d1', 'n1', 'https://fcm.googleapis.com/test', 9);
	`);

	// The app's migrator runs each migration inside one transaction, where
	// `PRAGMA foreign_keys = OFF` has no effect; mirror that here.
	sqlite.transaction(() => {
		for (const statement of statements(migration as string))
			sqlite.exec(statement);
	})();

	expect(
		sqlite
			.prepare("select id, task_id, suggestion_id, kind from notification_log")
			.all(),
	).toEqual([{ id: "n1", task_id: "t1", suggestion_id: null, kind: "due" }]);
	expect(
		sqlite
			.prepare(
				"select id, notification_id, status, next_attempt_at from notification_delivery",
			)
			.all(),
	).toEqual([
		{ id: "d1", notification_id: "n1", status: "pending", next_attempt_at: 9 },
	]);
	expect(sqlite.pragma("foreign_key_check")).toEqual([]);
	expect(
		sqlite
			.prepare(
				"select name from sqlite_master where type = 'index' and tbl_name = 'notification_delivery' and name like 'notification_delivery_%' order by name",
			)
			.all(),
	).toEqual([
		{ name: "notification_delivery_notification_endpoint_unique" },
		{ name: "notification_delivery_pending_idx" },
	]);

	// Suggestion notifications have no task and dedupe by (suggestion, kind).
	sqlite.exec(`
		insert into suggestion (id, group_id, from_user_id, to_user_id, title, start_date, status, created_at, seq)
			values ('sg1', 'g1', 'u1', 'u1', 'Wash dishes', '2026-09-27', 'pending', 0, 2);
	`);
	const insertLog = sqlite.prepare(
		"insert or ignore into notification_log (id, task_id, suggestion_id, user_id, occurrence_key, kind, title, body, url, created_at) values (?, null, 'sg1', 'u1', 'sg1', 'suggested', 'T', 'B', '/', 5)",
	);
	expect(insertLog.run("n2").changes).toBe(1);
	expect(insertLog.run("n3").changes).toBe(0);
	sqlite.close();
});
