import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

type SmokeResult =
	| { ok: true; indices: number[] }
	| { ok: false; kind: string; message: string };

const requireModel = process.env.EMOJI_SMOKE_REQUIRE_MODEL === "1";
const catalog = JSON.parse(
	readFileSync(
		join(import.meta.dirname, "../src/features/emoji/catalog.json"),
		"utf8",
	),
) as { e: string; n: string }[];

test("the real emoji worker loads, with the self-hosted wasm, inside the Vite build", async ({
	page,
	baseURL,
}) => {
	const origin = new URL(baseURL as string).origin;
	const foreign: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.origin !== origin && url.protocol.startsWith("http"))
			foreign.push(request.url());
	});

	await page.goto("/emoji-smoke.html");
	await page.waitForFunction(
		() => document.getElementById("result")?.textContent !== "pending",
		null,
		{ timeout: 80_000 },
	);
	const result = JSON.parse(
		await page.locator("#result").innerText(),
	) as SmokeResult;

	// Nothing came from a CDN or from Hugging Face.
	expect(foreign).toEqual([]);
	if (requireModel) {
		expect(result.ok, JSON.stringify(result)).toBe(true);
		if (!result.ok) return;
		expect(result.indices).toHaveLength(40);
		const top = result.indices
			.slice(0, 3)
			.map((index) => catalog[index].e.replace("️", ""));
		// "Water the plants": any of potted plant, seedling, droplet, herb.
		expect(top.some((emoji) => ["🪴", "🌱", "💧", "🌿"].includes(emoji))).toBe(
			true,
		);
	} else if (!result.ok) {
		// Without the model files the worker must fail with a plain load error, not a bundling one.
		expect(result.kind).toBe("load");
	}
});

async function runSmoke(page: Page, path: string) {
	const modelRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/assets/emoji/"))
			modelRequests.push(new URL(request.url()).pathname);
	});
	await page.goto(path);
	await page.waitForFunction(
		() => document.getElementById("result")?.textContent !== "pending",
		null,
		{ timeout: 80_000 },
	);
	const result = JSON.parse(
		await page.locator("#result").innerText(),
	) as SmokeResult;
	return { result, modelRequests };
}

test("a load that may not use the network answers uncached and requests no model file", async ({
	page,
}) => {
	const { result, modelRequests } = await runSmoke(
		page,
		"/emoji-smoke.html?network=0",
	);
	expect(result).toMatchObject({ ok: false, kind: "uncached" });
	expect(modelRequests).toEqual([]);
});

test("after a download the stored model loads with no network at all", async ({
	page,
}) => {
	test.skip(!requireModel, "needs the model files");
	const first = await runSmoke(page, "/emoji-smoke.html");
	expect(first.result.ok, JSON.stringify(first.result)).toBe(true);
	// Same browser context, so the Cache API still holds the six files.
	const again = await page.context().newPage();
	const second = await runSmoke(again, "/emoji-smoke.html?network=0");
	expect(second.result.ok, JSON.stringify(second.result)).toBe(true);
	expect(second.modelRequests).toEqual([]);
});

test("the production build emits no ONNX Runtime wasm of its own", () => {
	test.skip(
		test.info().project.name.startsWith("dev"),
		"checks the build output",
	);
	const assets = join(import.meta.dirname, "../dist-smoke/assets");
	const files = readdirSync(assets, { withFileTypes: true }).filter((entry) =>
		entry.isFile(),
	);
	expect(files.filter((file) => file.name.endsWith(".wasm"))).toEqual([]);
	const total = files.reduce(
		(sum, file) => sum + statSync(join(assets, file.name)).size,
		0,
	);
	// The worker bundle is about 0.5 MB and the index about 0.8 MB; a 27 MB wasm would blow this budget.
	expect(total).toBeLessThan(2_500_000);
});
