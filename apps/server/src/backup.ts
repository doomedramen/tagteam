import Database from "better-sqlite3";

/** Consistent online copy of the SQLite database; safe while the server is running. */
export async function backupDatabase(
	sourcePath: string,
	destinationPath: string,
): Promise<void> {
	const db = new Database(sourcePath, { fileMustExist: true });
	try {
		await db.backup(destinationPath);
	} finally {
		db.close();
	}
}
