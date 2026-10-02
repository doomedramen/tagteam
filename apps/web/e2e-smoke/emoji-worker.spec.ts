import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

interface SmokeResult {
	ok: boolean;
	libraryVersion?: string;
	length?: number;
	norm?: number;
	name?: string;
	message?: string;
}

const requireModel = process.env.EMOJI_SMOKE_REQUIRE_MODEL === "1";

test("transformers.js runs inside the Vite-built module worker with the self-hosted wasm", async ({
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

	// The library was imported, initialised, and asked for the model, with nothing from a CDN.
	expect(foreign).toEqual([]);
	expect(result.libraryVersion).toBe("4.3.0");
	if (requireModel) {
		expect(result).toMatchObject({ ok: true, length: 384 });
		expect(result.norm).toBeCloseTo(1, 3);
	} else if (!result.ok) {
		// Without the model files the only acceptable failure is a missing file: a 404 in the
		// preview server, or index.html served in place of config.json by the dev server.
		expect(["ModelFileNotFoundError", "SyntaxError"]).toContain(result.name);
	}
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
	// The worker bundle is about 0.5 MB; a 27 MB wasm would blow this budget.
	expect(total).toBeLessThan(2_000_000);
});
