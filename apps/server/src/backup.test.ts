import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { backupDatabase } from "./backup";
import { openDb } from "./db/client";

it("copies a live database, including its tables", async () => {
	const dir = mkdtempSync(join(tmpdir(), "tagteam-backup-"));
	try {
		const source = join(dir, "live.db");
		const { close } = openDb(source);
		const destination = join(dir, "copy.db");
		await backupDatabase(source, destination);
		close();

		const copy = new Database(destination, { readonly: true });
		const row = copy
			.prepare(
				"select count(*) as n from sqlite_master where type = 'table' and name = 'profile'",
			)
			.get() as {
			n: number;
		};
		copy.close();
		expect(row.n).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
