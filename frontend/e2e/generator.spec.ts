import { expect, test } from "@playwright/test";

const DEV_PASSWORD = "notify-dev-2026";

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("notification generator", () => {
  test("an admin publishes a critical preset and sees the toast", async ({ page }) => {
    await login(page, "admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto("/admin");
    // The admin sidebar entry is now "Dev Labs"; the generator is its default "Generate" tab.
    await page.getByRole("button", { name: "Dev Labs" }).click();
    await page.locator('[data-test="mode-preset"]').click();
    await page.locator('[data-test="preset-critical-dsr"]').click();

    // The critical toast fires bottom-right on delivery.
    await expect(page.getByText("DSR approaching SLA breach")).toBeVisible();
    await expect(page.getByText(/Published 1/)).toBeVisible();
  });
});
