import {
	expect,
	type Locator,
	type Page,
	type TestInfo,
	test,
} from "@playwright/test";
import {
	emojiAssetsPath,
	emojiModelPath,
	emojiModelPresent,
} from "./emoji-helpers";

const DEFAULT_GLYPH = "\u{1F4CB}";
const PLANTS = [
	"\u{1FAB4}",
	"\u{1F331}",
	"\u{1F4A7}",
	"\u{1F33F}",
	"\u{1F6BF}",
];
const DOGS = ["\u{1F415}", "\u{1F436}", "\u{1F9AE}", "\u{1F415}‍\u{1F9BA}"];
const CATS = ["\u{1F408}", "\u{1F431}", "\u{1F63A}", "\u{1F408}‍⬛"];
const MODEL_TIMEOUT = 90_000;
const ONNX = "onnx/model_quantized.onnx";

const bare = (emoji: string) => emoji.replaceAll("️", "").trim();
const isOneOf = (glyph: string, allowed: string[]) =>
	allowed.map(bare).includes(bare(glyph));

async function signUpAndCreateGroup(page: Page, testInfo: TestInfo) {
	const origin = testInfo.project.use.baseURL as string;
	const signUp = await page.request.post("/api/auth/sign-up/email", {
		headers: { origin },
		data: {
			name: "Sam",
			email: `emoji-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
			password: "correct-horse-battery",
		},
	});
	expect(signUp.ok()).toBe(true);
	const created = await page.request.post("/api/groups", {
		data: { name: "E2E emoji" },
	});
	expect(created.ok()).toBe(true);
}

/** Records every request for a model or runtime file, from the page and from its workers. */
function watchModelRequests(page: Page): string[] {
	const seen: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/assets/emoji/"))
			seen.push(request.url());
	});
	return seen;
}

/**
 * Counts the Web Workers the page starts (a device that has not downloaded the model must start
 * none) and puts the clock under test control, so waits for "nothing happens" are exact.
 */
async function watchWorkersAndClock(page: Page) {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker;
		const w = window as unknown as { __workers: number };
		w.__workers = 0;
		window.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				w.__workers += 1;
			}
		};
	});
	await page.clock.install();
}

const workersStarted = (page: Page) =>
	page.evaluate(() => (window as unknown as { __workers: number }).__workers);

/**
 * Runs every timer the app could have set (the 300 ms debounce, the 5 s warm-up after the first
 * sync) a few times over, yielding to the page in between so what they start has run.
 */
async function letTimersRun(page: Page) {
	for (let round = 0; round < 3; round += 1) {
		await page.clock.fastForward(6_000);
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
	}
}

async function openNewTask(page: Page) {
	await page.getByRole("button", { name: "Add task" }).first().click();
	return page.getByRole("dialog", { name: "New task", exact: true });
}

/** The glyph shown on the sheet's emoji button. */
const sheetGlyph = (sheet: Locator) =>
	sheet.locator('[data-slot="task-emoji"]').first().innerText();

async function expectSheetGlyphIn(sheet: Locator, allowed: string[]) {
	await expect
		.poll(async () => isOneOf(await sheetGlyph(sheet), allowed), {
			timeout: MODEL_TIMEOUT,
		})
		.toBe(true);
}

const tileGlyph = (page: Page, title: string) =>
	page
		.getByRole("button", { name: `Complete ${title}` })
		.locator("xpath=ancestor::li")
		.locator('[data-slot="task-emoji"]');

const goToMe = (page: Page) => page.getByRole("link", { name: "Me" }).click();
const goToToday = (page: Page) =>
	page.getByRole("link", { name: "Today", exact: true }).click();
const downloadButton = (page: Page) =>
	page.getByRole("button", { name: "Download", exact: true });

/** Presses Download on Me and waits until suggestions are on. */
async function downloadFromMe(page: Page) {
	await goToMe(page);
	await downloadButton(page).click();
	await expect(page.getByText("Emoji suggestions are on")).toBeVisible({
		timeout: MODEL_TIMEOUT,
	});
}

/** How many files of the model the Cache API holds under a URL prefix. */
const storedModelFiles = (page: Page, prefix: string) =>
	page.evaluate(async (base) => {
		const cache = await caches.open("transformers-cache");
		return (await cache.keys()).filter((request) =>
			new URL(request.url).pathname.startsWith(base),
		).length;
	}, prefix);

test("a device that has not downloaded anything never asks for the model, and behaves as before", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	const modelRequests = watchModelRequests(page);
	await watchWorkersAndClock(page);
	await signUpAndCreateGroup(page, testInfo);
	const firstSync = page.waitForResponse(
		(response) =>
			response.url().includes("/api/sync/pull") && response.status() === 200,
	);
	await page.goto("/");
	await firstSync;

	const sheet = await openNewTask(page);
	await sheet.getByRole("textbox", { name: "Task" }).fill("Water the plants");
	// Past the debounce and the background warm-up that follows the first sync.
	await letTimersRun(page);
	await expect(
		sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
	).toBeVisible();
	await sheet.getByRole("button", { name: /^Emoji:/ }).click();
	const picker = page.getByRole("dialog", { name: "Choose emoji" });
	await expect(
		picker.getByRole("searchbox", { name: "Search emoji" }),
	).toBeVisible();
	await expect(picker.getByRole("heading", { name: "Suggested" })).toHaveCount(
		0,
	);
	await picker.getByRole("button", { name: "Use default" }).click();
	await sheet.getByRole("button", { name: "Create", exact: true }).click();
	await expect(tileGlyph(page, "Water the plants")).toHaveText(DEFAULT_GLYPH);

	await goToMe(page);
	await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
	await expect(downloadButton(page)).toBeVisible();
	await letTimersRun(page);
	expect(await page.evaluate(() => caches.keys())).not.toContain(
		"transformers-cache",
	);
	expect(await workersStarted(page)).toBe(0);
	expect(modelRequests).toEqual([]);
});

test.describe("with the model files", () => {
	test.skip(
		!emojiModelPresent() && !process.env.CI,
		"the emoji model files are not fetched",
	);

	test("Download on Me, then suggestions follow the title, also from the stored copy after a reload", async ({
		page,
		context,
		browserName,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);
		await page.goto("/");
		await downloadFromMe(page);
		await expect(
			page.getByRole("button", { name: "Remove download" }),
		).toBeVisible();

		await goToToday(page);
		let sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Water the plants");
		await expectSheetGlyphIn(sheet, PLANTS);
		await sheet.getByRole("button", { name: "Create", exact: true }).click();
		await expect
			.poll(async () =>
				isOneOf(await tileGlyph(page, "Water the plants").innerText(), PLANTS),
			)
			.toBe(true);

		// The model is stored on the device. A reload starts a fresh page (nothing in memory
		// survives) with the network blocked for the model files: Me still says on, the sheet still
		// suggests, and not one request for a model file is attempted.
		expect(await storedModelFiles(page, emojiAssetsPath())).toBe(6);
		let blockedRequests = 0;
		await page.route("**/assets/emoji/**", (route) => {
			blockedRequests += 1;
			return route.abort();
		});
		await page.evaluate(() => {
			(window as unknown as { __beforeReload: boolean }).__beforeReload = true;
		});
		await page.reload();
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { __beforeReload?: boolean }).__beforeReload,
			),
		).toBeUndefined();
		await goToMe(page);
		await expect(page.getByText("Emoji suggestions are on")).toBeVisible();
		await goToToday(page);
		sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Walk the dog");
		await expectSheetGlyphIn(sheet, DOGS);
		expect(blockedRequests).toBe(0);
		expect(await storedModelFiles(page, emojiAssetsPath())).toBe(6);

		// Chromium can also reload the app with the whole network off (Playwright's WebKit cannot
		// reload a service-worker page while offline; app.spec.ts has the same limit).
		if (browserName === "chromium") {
			await sheet.getByRole("button", { name: "Close" }).click();
			await page.evaluate(() => navigator.serviceWorker.ready);
			await context.setOffline(true);
			await page.reload();
			sheet = await openNewTask(page);
			await sheet.getByRole("textbox", { name: "Task" }).fill("Feed the cat");
			await expectSheetGlyphIn(sheet, CATS);
			await context.setOffline(false);
		}
	});

	test("Remove download deletes the stored model and returns to the default", async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);
		await page.goto("/");
		await downloadFromMe(page);
		expect(await storedModelFiles(page, "/assets/emoji/")).toBe(6);

		await page.getByRole("button", { name: "Remove download" }).click();
		await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
		await expect.poll(() => storedModelFiles(page, "/assets/emoji/")).toBe(0);

		await goToToday(page);
		const sheet = await openNewTask(page);
		await page.clock.install();
		await sheet.getByRole("textbox", { name: "Task" }).fill("Walk the dog");
		await letTimersRun(page);
		await expect(
			sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
		).toBeVisible();
		await sheet.getByRole("button", { name: "Close" }).click();
		await page.reload();
		await goToMe(page);
		await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
		expect(await storedModelFiles(page, "/assets/emoji/")).toBe(0);
	});

	test("a task saved while the model is still downloading gets an emoji afterwards, and the emoji reaches the server", async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);

		// Hold the model download until the task has been saved.
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(`**${emojiModelPath(ONNX)}`, async (route) => {
			await gate;
			await route.continue();
		});

		await page.goto("/");
		await goToMe(page);
		await downloadButton(page).click();
		await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
		await goToToday(page);
		const sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Walk the dog");
		await sheet.getByRole("button", { name: "Create", exact: true }).click();
		await expect(tileGlyph(page, "Walk the dog")).toHaveText(DEFAULT_GLYPH);

		release();
		await expect
			.poll(
				async () =>
					isOneOf(await tileGlyph(page, "Walk the dog").innerText(), DOGS),
				{ timeout: MODEL_TIMEOUT },
			)
			.toBe(true);

		// The late pick is an ordinary update: the server stores the emoji and leaves the colour alone.
		await expect
			.poll(
				async () => {
					const pull = await page.request.get("/api/sync/pull?cursor=0");
					const body = (await pull.json()) as {
						tasks: {
							title: string;
							emoji: string | null;
							color: string | null;
						}[];
					};
					const task = body.tasks.find((item) => item.title === "Walk the dog");
					return (
						task !== undefined &&
						isOneOf(task.emoji ?? "", DOGS) &&
						task.color === "blue"
					);
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
	});

	test("Cancel stops a download and leaves nothing behind", async ({
		page,
	}, testInfo) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);
		await page.route(`**${emojiModelPath(ONNX)}`, () => {
			// Never answered: the download stays in progress until it is cancelled.
		});
		await page.goto("/");
		await goToMe(page);
		await downloadButton(page).click();
		await expect(page.getByText(/^Downloading…/)).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
		await expect.poll(() => storedModelFiles(page, "/assets/emoji/")).toBe(0);
	});

	test("an update is offered on Me only, and nothing is downloaded until Download is pressed", async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		// This device downloaded an older version earlier.
		await page.addInitScript(() => {
			localStorage.setItem("tagteam.emoji.optedIn", "true");
			localStorage.setItem("tagteam.emoji.installed", "an-older-version");
		});
		const modelRequests = watchModelRequests(page);
		await watchWorkersAndClock(page);
		await signUpAndCreateGroup(page, testInfo);
		const firstSync = page.waitForResponse(
			(response) =>
				response.url().includes("/api/sync/pull") && response.status() === 200,
		);
		await page.goto("/");
		await firstSync;

		const sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Water the plants");
		await letTimersRun(page);
		await expect(
			sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
		).toBeVisible();
		// Nothing outside Me mentions an update.
		await expect(page.getByText(/update/i)).toHaveCount(0);
		await sheet.getByRole("button", { name: "Close" }).click();
		expect(modelRequests).toEqual([]);
		expect(await workersStarted(page)).toBe(0);

		await goToMe(page);
		await expect(page.getByText("An update is available.")).toBeVisible();
		await downloadButton(page).click();
		await expect(page.getByText("Emoji suggestions are on")).toBeVisible({
			timeout: MODEL_TIMEOUT,
		});
		expect(modelRequests.length).toBeGreaterThan(0);
	});
});
