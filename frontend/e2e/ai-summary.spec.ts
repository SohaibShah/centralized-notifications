import { expect, test } from "@playwright/test";

// Seeded dev account (backend/src/auth/seed.ts).
const DEV_USER = "admin";
const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("AI summary", () => {
  test("reload generates the stored summary (with a timestamp) from the unread set", async ({
    page,
    request,
  }) => {
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(intakeTokenValue, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Seed a non-empty unread set so the reload produces a real digest (basedOn > 0), not caught-up.
    const publish = await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": intakeTokenValue, "content-type": "application/json" },
      data: {
        id: `ai-summary-${Date.now()}`,
        module: "dsr",
        title: `Summary seed ${Date.now()}`,
        description: "seed for the AI summary e2e",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
    expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    // Expand the AI-summary disclosure. It now shows the STORED summary (pre-generated on schedule) —
    // no auto-generation on expand — so a reload control is present (empty state or a prior summary).
    await page.locator('button[aria-controls="ai-summary-detail"]').click();
    await expect(page.locator("#ai-summary-detail")).toBeVisible();

    // Reload → POST /notifications/summary/refresh regenerates from the unread set and persists.
    await page.locator('[data-test="ai-summary-reload"]').first().click();

    // With AI_PROVIDER=fake (webServer env) and a seeded unread item, it resolves to a real digest
    // with a generated-at timestamp — never stuck loading/refreshing.
    await expect(page.locator('[data-test="ai-summary-text"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-test="ai-summary-timestamp"]')).toContainText(/Generated/);
    await expect(page.locator('[data-test="ai-summary-loading"]')).toHaveCount(0);
  });
});
