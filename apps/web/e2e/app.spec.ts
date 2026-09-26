import { expect, test } from "@playwright/test";

test("sign up, create a group, add and complete tasks, keep working offline", async ({
	page,
	context,
}) => {
	const email = `e2e-${Date.now()}@example.com`;

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
	await page.getByRole("textbox", { name: "Task" }).fill("Brush teeth");
	await page.getByRole("button", { name: "Daily" }).click();
	await page.getByRole("button", { name: "Add task" }).last().click();
	await expect(
		page.getByRole("button", { name: "Complete Brush teeth" }),
	).toBeVisible();

	// Wait for server sync, then prove the saved app and data work offline.
	await expect(page.getByText(/Syncing|Offline/)).toHaveCount(0);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole("button", { name: /E2E family/ })).toBeVisible();

	const completeButton = page.getByRole("button", {
		name: "Complete Brush teeth",
	});
	await completeButton.click();
	await expect(completeButton).toBeVisible();
	const completeBox = await completeButton.boundingBox();
	if (!completeBox) throw new Error("Completion button has no visible bounds");
	await page.mouse.move(
		completeBox.x + completeBox.width / 2,
		completeBox.y + completeBox.height / 2,
	);
	await page.mouse.down();
	await page.waitForTimeout(700);
	const wave = completeButton
		.locator("xpath=ancestor::li")
		.locator("[data-wave-edge]");
	const firstWave = await wave.getAttribute("d");
	await page.waitForTimeout(120);
	expect(await wave.getAttribute("d")).not.toBe(firstWave);
	await page.waitForTimeout(1300);
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
	await page.waitForTimeout(2500);
	await expect(undoButton).toBeVisible();
	await page.waitForTimeout(2600);
	await page.mouse.up();
	await expect(completeButton).toBeVisible();
	await expect(page.getByText("Offline · 2 queued")).toBeVisible();

	const completeAgainBox = await completeButton.boundingBox();
	if (!completeAgainBox)
		throw new Error("Completion button has no visible bounds");
	await page.mouse.move(
		completeAgainBox.x + completeAgainBox.width / 2,
		completeAgainBox.y + completeAgainBox.height / 2,
	);
	await page.mouse.down();
	await page.waitForTimeout(2100);
	await page.mouse.up();
	await expect(page.getByText("Offline · 3 queued")).toBeVisible();

	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect(page.getByText(/queued|Syncing/)).toHaveCount(0);

	// A fresh server-backed load shows the offline completion was saved.
	await page.reload();
	await expect(page.getByText("All done for today")).toBeVisible();
});
