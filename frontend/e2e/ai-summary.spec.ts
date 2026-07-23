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
  test("expanding the disclosure resolves to a summary or a graceful error (never stuck loading)", async ({
    page,
    request,
  }) => {
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(intakeTokenValue, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Ensure a non-empty unread set so the summary path (not the caught-up shortcut) runs.
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

    // Expand the AI-summary disclosure.
    await page.locator('button[aria-controls="ai-summary-detail"]').click();

    // Provider-agnostic: it must resolve OUT of the loading state within the model-call budget — to a
    // summary (fake/real provider up) or the graceful error (provider/Ollama down). Never stuck loading.
    const resolved = page.locator('[data-test="ai-summary-text"], [data-test="ai-summary-error"]');
    await expect(resolved.first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-test="ai-summary-loading"]')).toHaveCount(0);
  });
});
