import { expect, type Locator, test } from "@playwright/test";

function contrast(first: string, second: string) {
	const luminance = (color: string) => {
		const channels =
			color
				.match(/[\d.]+/g)
				?.slice(0, 3)
				.map(Number) ?? [];
		const linear = channels.map((channel) => {
			const value = channel / 255;
			return value <= 0.04045
				? value / 12.92
				: ((value + 0.055) / 1.055) ** 2.4;
		});
		return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
	};
	const a = luminance(first);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function expectOpaqueReadableFill(row: Locator, color: string) {
	const fill = row.locator("[data-swipe-action]").first();
	await expect(fill).toHaveCSS("background-color", color);
	await expect(fill).toHaveCSS("opacity", "1");
	for (const text of await fill.locator("span").all()) {
		const textColor = await text.evaluate(
			(element) => getComputedStyle(element).color,
		);
		expect(contrast(color, textColor)).toBeGreaterThanOrEqual(4.5);
	}
}

test("sign up, create a group, add and complete tasks, keep working offline", async ({
	page,
	context,
	browserName,
}, testInfo) => {
	const email = `e2e-${Date.now()}@example.com`;

	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Sign in to TagTeam" }),
	).toBeVisible();
	await page.getByRole("link", { name: "Create an account" }).click();
	await page.getByLabel("Name").fill("Sam");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill("correct-horse-battery");
	await page.getByRole("button", { name: "Create account" }).click();

	await expect(
		page.getByRole("heading", { name: "Sign in faster next time" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Not now" }).click();

	await expect(
		page.getByRole("heading", { name: "Start a group or join one" }),
	).toBeVisible();
	await page.getByLabel("Group name").fill("E2E family");
	await page.getByRole("button", { name: "Create group" }).click();

	await expect(page.getByRole("button", { name: /E2E family/ })).toBeVisible();
	await expect(page.getByText("Add your first task")).toBeVisible();

	await page.getByRole("button", { name: "Add task" }).first().click();
	const sheet = page.getByRole("dialog", { name: "New task", exact: true });
	await expect(page.getByRole("textbox", { name: "Task" })).toBeFocused();
	await page.getByRole("textbox", { name: "Task" }).fill("Brush teeth");
	await expect(sheet).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
	await page.screenshot({
		path: testInfo.outputPath("new-task.png"),
		scale: "css",
		animations: "disabled",
	});
	// Simulate the visual viewport shrinking independently of the layout viewport,
	// as with an iOS keyboard. This does not emulate the native keyboard itself.
	await page.evaluate(() => {
		const viewport = window.visualViewport;
		if (!viewport) throw new Error("Visual viewport unavailable");
		Object.defineProperty(viewport, "height", {
			configurable: true,
			get: () => window.innerHeight - 346,
		});
		viewport.dispatchEvent(new Event("resize"));
	});
	const submit = sheet.getByRole("button", { name: "Add task", exact: true });
	await expect
		.poll(async () => {
			const box = await submit.boundingBox();
			return box ? box.y + box.height : Infinity;
		})
		.toBeLessThanOrEqual(812 - 346);
	await expect(sheet).toHaveCSS("bottom", "346px");
	await expect(sheet.locator('[data-slot="sheet-body"]')).toHaveCSS(
		"padding-bottom",
		"4px",
	);
	await page.screenshot({
		path: testInfo.outputPath("new-task-keyboard.png"),
		scale: "css",
		animations: "disabled",
	});
	await sheet.getByRole("button", { name: /Schedule/ }).click();
	await sheet.getByRole("button", { name: "Custom" }).click();
	await sheet.getByLabel("Every", { exact: true }).focus();
	await expect(sheet).toHaveCSS("bottom", "346px");
	await expect
		.poll(async () => {
			const box = await submit.boundingBox();
			return box ? box.y + box.height : Infinity;
		})
		.toBeLessThanOrEqual(466);
	await expect
		.poll(async () => (await sheet.boundingBox())?.y ?? -1)
		.toBeGreaterThanOrEqual(15);
	await page.screenshot({
		path: testInfo.outputPath("schedule-keyboard.png"),
		scale: "css",
		animations: "disabled",
	});
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	await page.screenshot({
		path: testInfo.outputPath("schedule-keyboard-dark.png"),
		scale: "css",
		animations: "disabled",
	});
	await page.emulateMedia({
		colorScheme: "light",
		reducedMotion: "no-preference",
	});
	await page.evaluate(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		Reflect.deleteProperty(viewport, "height");
		viewport.dispatchEvent(new Event("resize"));
	});
	await page.getByRole("button", { name: "Daily" }).click();
	await page.getByRole("button", { name: "Add task" }).last().click();
	await expect(
		page.getByRole("button", { name: "Complete Brush teeth" }),
	).toBeVisible();

	// Wait for server sync, then prove the saved app and data work offline.
	await expect(page.getByText(/Syncing|Offline/)).toHaveCount(0);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await context.setOffline(true);
	// Playwright WebKit cannot reload service-worker pages while forced offline.
	// Chromium covers offline reload; both engines cover offline mutations.
	if (browserName === "chromium") await page.reload();
	await page.emulateMedia({ colorScheme: "light" });
	await expect(page.getByRole("button", { name: /E2E family/ })).toBeVisible();

	const completeButton = page.getByRole("button", {
		name: "Complete Brush teeth",
	});
	await expect(completeButton).toBeVisible();
	const completeBox = await completeButton.boundingBox();
	if (!completeBox) throw new Error("Completion button has no visible bounds");
	await page.mouse.move(
		completeBox.x + completeBox.width / 2,
		completeBox.y + completeBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		completeBox.x + completeBox.width / 2 + 100,
		completeBox.y + completeBox.height / 2,
		{ steps: 10 },
	);
	const completeRow = completeButton.locator("xpath=ancestor::li");
	await expectOpaqueReadableFill(completeRow, "rgb(230, 243, 232)");
	await page.emulateMedia({ colorScheme: "dark" });
	await expectOpaqueReadableFill(completeRow, "rgb(27, 46, 30)");
	await expect(completeRow.locator("[data-swipe-action]")).toHaveAttribute(
		"data-ready",
		"true",
	);
	await page.screenshot({ path: testInfo.outputPath("swipe-complete.png") });
	await page.mouse.up();
	await expect(
		page.getByRole("button", { name: "Undo Brush teeth" }),
	).toBeVisible();
	await expect(page.getByText("Offline · 1 queued")).toBeVisible();

	const undoButton = page.getByRole("button", { name: "Undo Brush teeth" });
	const undoBox = await undoButton.boundingBox();
	if (!undoBox) throw new Error("Undo button has no visible bounds");
	await page.mouse.move(
		undoBox.x + undoBox.width / 2,
		undoBox.y + undoBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		undoBox.x + undoBox.width / 2 + 100,
		undoBox.y + undoBox.height / 2,
		{ steps: 10 },
	);
	const undoRow = undoButton.locator("xpath=ancestor::li");
	await expectOpaqueReadableFill(undoRow, "rgb(28, 42, 69)");
	await page.emulateMedia({ colorScheme: "light" });
	await expectOpaqueReadableFill(undoRow, "rgb(230, 239, 253)");
	await expect(undoButton).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("swipe-undo.png") });
	await page.mouse.up();
	await expect(completeButton).toBeVisible();
	await expect(page.getByText("Offline · 2 queued")).toBeVisible();

	const completeAgainBox = await completeButton.boundingBox();
	if (!completeAgainBox)
		throw new Error("Completion button has no visible bounds");
	if (browserName === "chromium") {
		const touch = await context.newCDPSession(page);
		const x = completeAgainBox.x + completeAgainBox.width / 2;
		const y = completeAgainBox.y + completeAgainBox.height / 2;
		await touch.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x, y }],
		});
		for (const dx of [20, 40, 60, 80, 100]) {
			await touch.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: x + dx, y }],
			});
		}
		await expect(
			completeButton
				.locator("xpath=ancestor::li")
				.locator("[data-swipe-action]"),
		).toHaveAttribute("data-ready", "true");
		await touch.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await touch.detach();
	} else {
		await completeButton.tap();
	}

	await expect(page.getByText("Offline · 3 queued")).toBeVisible();

	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect(page.getByText(/queued|Syncing/)).toHaveCount(0);

	await page.getByRole("button", { name: "Undo Brush teeth" }).click();
	await expect(completeButton).toBeVisible();
	await completeButton.click();
	await expect(
		page.getByRole("button", { name: "Undo Brush teeth" }),
	).toBeVisible();
	await expect(page.getByText(/queued|Syncing/)).toHaveCount(0);

	// A fresh server-backed load shows the offline completion was saved.
	await page.reload();
	await expect(page.getByText("All done for today")).toBeVisible();
});
