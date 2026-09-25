import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseClient } from "better-sqlite3";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

// drizzle()'s return type is `BetterSQLite3Database<TSchema> & { $client: Database }`;
// `$client` isn't part of the class itself, so it must be added back here explicitly.
export type Db = BetterSQLite3Database<typeof schema> & {
	$client: DatabaseClient;
};

const defaultMigrations = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);

/** Opens (creating if needed) the SQLite database at `path` and applies pending migrations. */
export function openDb(
	path: string,
	migrationsFolder = defaultMigrations,
): { db: Db; close: () => void } {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });
	return { db, close: () => sqlite.close() };
}
