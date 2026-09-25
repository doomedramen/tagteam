// Verifies a production build contains a service worker with a precache manifest and the web manifest.
import { existsSync, readFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const fail = (message) => {
	console.error(`check-build: ${message}`);
	process.exit(1);
};
const sw = new URL("sw.js", dist);
if (!existsSync(sw)) fail("dist/sw.js missing");
const source = readFileSync(sw, "utf8");
if (source.includes("self.__SW_MANIFEST"))
	fail("precache manifest was not injected");
if (!source.includes("index.html")) fail("index.html is not precached");
if (!existsSync(new URL("manifest.webmanifest", dist)))
	fail("dist/manifest.webmanifest missing");
console.log("check-build: ok");
