import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

async function signUp(page: Page, origin: string, name: string) {
	const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
	const response = await page.request.post("/api/auth/sign-up/email", {
		headers: { origin },
		data: { name, email, password: PASSWORD },
	});
	expect(response.ok()).toBe(true);
}

test("one member suggests a task, the other accepts it, and both see it", async ({
	page: sam,
	browser,
}, testInfo) => {
	test.setTimeout(60_000);
	const origin = testInfo.project.use.baseURL as string;
	const joContext = await browser.newContext({
		baseURL: origin,
		viewport: { width: 375, height: 812 },
		serviceWorkers: "block",
	});
	const jo = await joContext.newPage();
	try {
		await sam.setViewportSize({ width: 375, height: 812 });
		await signUp(sam, origin, "Sam");
		await signUp(jo, origin, "Jo");
		const created = await sam.request.post("/api/groups", {
			data: { name: "E2E suggestions" },
		});
		const { group } = (await created.json()) as { group: { id: string } };
		const invite = await sam.request.post(`/api/groups/${group.id}/invites`);
		const { code } = (await invite.json()) as { code: string };
		const redeemed = await jo.request.post("/api/invites/redeem", {
			data: { code },
		});
		expect(redeemed.ok()).toBe(true);

		// Sam suggests a task to Jo from the New task sheet.
		await sam.goto("/");
		await expect(
			sam.getByRole("button", { name: /E2E suggestions/ }),
		).toBeVisible();
		await sam.getByRole("button", { name: "Add task" }).first().click();
		const sheet = sam.getByRole("dialog", { name: "New task", exact: true });
		await sheet.getByRole("textbox", { name: "Task" }).fill("Wash dishes");
		await sheet.getByRole("button", { name: /^For/ }).click();
		const forSelect = sheet.getByLabel("For", { exact: true });
		await forSelect.selectOption({ label: "Jo" });
		await expect(forSelect.locator("option:checked")).toHaveText("Jo");
		await sam.screenshot({ path: testInfo.outputPath("sam-suggest.png") });
		await sheet.getByRole("button", { name: "Suggest to Jo" }).click();
		// Sam's Today shows a strip; the sheet it opens says who the suggestion waits on.
		const samStrip = sam.getByRole("button", { name: /Sent by you/ });
		await expect(samStrip).toContainText("1 waiting");
		await samStrip.click();
		const samSheet = sam.getByRole("dialog", { name: "Suggestions" });
		await expect(samSheet.getByText("Waiting for Jo")).toBeVisible();
		await sam.screenshot({ path: testInfo.outputPath("sam-sheet.png") });
		await samSheet.getByRole("button", { name: "Close" }).click();
		await expect(samSheet).toHaveCount(0);
		await expect(sam.getByText(/queued|Syncing/)).toHaveCount(0);

		// Jo sees the strip, opens the sheet, accepts, and the task lands on Jo's Today.
		await jo.goto("/");
		const joStrip = jo.getByRole("button", { name: /1 suggestion for you/ });
		await expect(joStrip).toBeVisible({ timeout: 15_000 });
		await jo.screenshot({ path: testInfo.outputPath("jo-strip.png") });
		await joStrip.click();
		const joSheet = jo.getByRole("dialog", { name: "Suggestions" });
		await expect(joSheet.getByText("Sam suggests")).toBeVisible();
		await expect(joSheet.getByText("Wash dishes")).toBeVisible();
		await jo.screenshot({ path: testInfo.outputPath("jo-card.png") });
		await joSheet.getByRole("button", { name: "Accept Wash dishes" }).click();
		await expect(joSheet).toHaveCount(0);
		await expect(
			jo.getByRole("button", { name: "Complete Wash dishes" }),
		).toBeVisible();
		await expect(jo.getByText("Sam suggests")).toHaveCount(0);
		await expect(jo.getByText(/queued|Syncing/)).toHaveCount(0);

		// Sam's strip disappears; both histories say who took it on and who suggested it.
		await expect(samStrip).toHaveCount(0, { timeout: 15_000 });
		await sam.getByRole("link", { name: "History" }).click();
		await expect(sam.getByText("Jo took on Wash dishes.")).toBeVisible();
		await expect(sam.getByText("Suggested by you")).toBeVisible();

		await jo.getByRole("link", { name: "History" }).click();
		await expect(jo.getByText("You took on Wash dishes.")).toBeVisible();
		await expect(jo.getByText("Suggested by Sam")).toBeVisible();
	} finally {
		await joContext.close();
	}
});
