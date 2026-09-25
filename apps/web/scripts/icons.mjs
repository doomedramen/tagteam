// Renders PNG app icons from the SVG sources. Run after changing public/icon*.svg: pnpm --filter @tagteam/web icons
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });
const render = (svg, size, name) =>
	sharp(new URL(`../public/${svg}`, import.meta.url).pathname)
		.resize(size, size)
		.png()
		.toFile(new URL(name, out).pathname);

await render("icon.svg", 192, "icon-192.png");
await render("icon.svg", 512, "icon-512.png");
await render("icon-maskable.svg", 512, "icon-maskable-512.png");
await render("icon-maskable.svg", 180, "apple-touch-icon.png");
console.log("icons written");
