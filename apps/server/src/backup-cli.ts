import { backupDatabase } from "./backup";

const destination = process.argv[2];
if (!destination) {
	console.error("Usage: node dist/backup.js <destination.db>");
	process.exit(2);
}
const source = process.env.DATABASE_PATH ?? "./data/tagteam.db";
await backupDatabase(source, destination);
console.log(`Backed up ${source} to ${destination}`);
