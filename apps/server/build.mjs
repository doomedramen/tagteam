// Bundles the server for production. better-sqlite3 is native, so it stays external
// and is installed next to the bundle (see Dockerfile).
import { build } from "esbuild";

await build({
	entryPoints: { index: "src/index.ts", backup: "src/backup-cli.ts" },
	outdir: "dist",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	sourcemap: true,
	external: ["better-sqlite3"],
	// Some bundled dependencies are CommonJS and call require().
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	logLevel: "info",
});
