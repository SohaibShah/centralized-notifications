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

test.describe("AI chat", () => {
  test("asking a question streams a grounded AI answer", async ({ page, request }) => {
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(intakeTokenValue, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Seed something to ground on.
    const publish = await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": intakeTokenValue, "content-type": "application/json" },
      data: {
        id: `ai-chat-${Date.now()}`,
        module: "dsr",
        title: `Chat seed ${Date.now()}`,
        description: "seed for the AI chat e2e",
        priority: "critical",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
    expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    // Switch to the Ask-AI tab and ask a question.
    await page.getByRole("tab", { name: /Ask AI/ }).click();
    await page.locator('[data-test="ai-input"]').fill("What is most urgent?");
    await page.locator('[data-test="ai-send"]').click();

    // Provider-agnostic: an AI answer bubble appears and fills with non-empty text within the
    // model-call budget (fake stream in CI, real Ollama in dev).
    const answer = page.locator('[data-test="ai-answer"]');
    await expect(answer.first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await answer.first().innerText()).trim().length, { timeout: 20_000 })
      .toBeGreaterThan(0);
  });
});
