import { expect, test } from "@playwright/test";

const PLANT = "\u{1FAB4}";

declare global {
	interface Window {
		__persistCalls: number;
	}
}

test("pick an emoji and a color, see them on Today and task detail, edit the color", async ({
	page,
	browser,
}, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	// Count calls to navigator.storage.persist() without changing what the browser answers.
	// The spy replaces StorageManager.prototype: Playwright WebKit does not keep instance-level
	// overrides on navigator.storage.
	await page.addInitScript(() => {
		window.__persistCalls = 0;
		if (typeof StorageManager !== "undefined") {
			StorageManager.prototype.persisted = async () => false;
			StorageManager.prototype.persist = async () => {
				window.__persistCalls += 1;
				return true;
			};
		}
	});

	const origin = testInfo.project.use.baseURL as string;
	const signUp = await page.request.post("/api/auth/sign-up/email", {
		headers: { origin },
		data: {
			name: "Sam",
			email: `look-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
			password: "correct-horse-battery",
		},
	});
	expect(signUp.ok()).toBe(true);
	const created = await page.request.post("/api/groups", {
		data: { name: "E2E look" },
	});
	expect(created.ok()).toBe(true);

	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Add task" }).first(),
	).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.__persistCalls)).toBe(1);

	// New task: default emoji, blue, then pick an emoji by hand and a color.
	await page.getByRole("button", { name: "Add task" }).first().click();
	const sheet = page.getByRole("dialog", { name: "New task", exact: true });
	await expect(sheet).toHaveAttribute("data-task-color", "blue");
	await expect(
		sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
	).toBeVisible();
	await sheet.getByRole("textbox", { name: "Task" }).fill("Water plants");
	await sheet.getByRole("button", { name: /^Emoji:/ }).click();
	const picker = page.getByRole("dialog", { name: "Choose emoji" });
	await picker
		.getByRole("searchbox", { name: "Search emoji" })
		.fill("potted plant");
	await picker.getByRole("button", { name: "potted plant" }).click();
	await expect(picker).toHaveCount(0);
	await expect(
		sheet.getByRole("button", { name: "Emoji: potted plant, change" }),
	).toBeVisible();
	await sheet.locator('label[data-task-color="teal"]').click();
	await expect(sheet).toHaveAttribute("data-task-color", "teal");
	await sheet.getByRole("button", { name: "Create", exact: true }).click();

	await expect(sheet).toHaveCount(0);

	// Today: the task is a tinted tile with its bare emoji on the left and the check on the right.
	const complete = page.getByRole("button", { name: "Complete Water plants" });
	await expect(complete).toBeVisible();
	const tile = complete.locator("xpath=ancestor::li");
	await expect(tile).toHaveAttribute("data-task-color", "teal");
	await expect(tile.locator('[data-slot="task-emoji"]')).toHaveText(PLANT);
	await page.screenshot({ path: testInfo.outputPath("today.png") });

	// Task detail wears the color; editing it re-tints.
	await page.getByRole("link", { name: /Water plants/ }).click();
	const detail = page.locator('[data-slot="task-detail"]');
	await expect(detail).toHaveAttribute("data-task-color", "teal");
	await expect(detail.locator('[data-slot="task-emoji"]')).toHaveText(PLANT);
	await page.screenshot({ path: testInfo.outputPath("detail.png") });
	await page.getByRole("button", { name: "Task actions" }).click();
	await page.getByRole("menuitem", { name: "Edit task" }).click();
	const edit = page.getByRole("dialog", { name: "Edit task", exact: true });
	await expect(edit).toHaveAttribute("data-task-color", "teal");
	await edit.locator('label[data-task-color="pink"]').click();
	await edit.getByRole("button", { name: "Save", exact: true }).click();
	await expect(detail).toHaveAttribute("data-task-color", "pink");
	await expect(page.getByText(/queued|Syncing/)).toHaveCount(0);

	// A second device (fresh context: same sign-in, empty IndexedDB, no service worker) can only
	// learn the emoji and the edited color from the server.
	const taskUrl = page.url();
	const storageState = await page.context().storageState();
	const fresh = await browser.newContext({
		baseURL: origin,
		viewport: { width: 375, height: 812 },
		serviceWorkers: "block",
		storageState,
	});
	try {
		const other = await fresh.newPage();
		await other.goto(taskUrl);
		const otherDetail = other.locator('[data-slot="task-detail"]');
		await expect(otherDetail).toHaveAttribute("data-task-color", "pink", {
			timeout: 15_000,
		});
		await expect(otherDetail.locator('[data-slot="task-emoji"]')).toHaveText(
			PLANT,
		);
	} finally {
		await fresh.close();
	}
});
