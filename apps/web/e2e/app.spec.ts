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

	await page.getByRole("button", { name: "Complete Brush teeth" }).click();
	await expect(
		page.getByRole("button", { name: "Undo Brush teeth" }),
	).toBeVisible();
	await expect(page.getByText("Offline · 1 queued")).toBeVisible();

	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect(page.getByText(/queued|Syncing/)).toHaveCount(0);

	// A fresh server-backed load shows the offline completion was saved.
	await page.reload();
	await expect(page.getByText("All done for today")).toBeVisible();
});
