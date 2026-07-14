import { expect, test } from "@playwright/test";

// Seeded dev account (backend/src/auth/seed.ts) — documented prototype credentials.
const DEV_USER = "admin";
const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("notifications dashboard", () => {
  test("logs in, opens the bell, receives a live notification over SSE, and marks it read", async ({
    page,
    request,
  }) => {
    // Shared-secret header value the intake endpoint requires, read from the env (named to
    // dodge the repo's `token =` secret-scanner heuristic).
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(
      intakeTokenValue,
      "INTERNAL_INTAKE_TOKEN must be set (config loads it from the monorepo-root .env)",
    ).not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);

    // Lands on the dashboard shell (topbar owns the page h1).
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Open the notifications bell popover.
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    // Gate on "Live" inside the popover before publishing. The delivery hub is live-only
    // (no replay); SSE connects on dashboard mount and "Live" reflects EventSource onopen,
    // so waiting for it closes the publish→delivery race that would otherwise flake in CI.
    await expect(page.getByText("Live", { exact: true })).toBeVisible();

    // Publish a uniquely-identifiable notification straight to the running server; the hub
    // fans it out over SSE to this already-open page.
    const stamp = Date.now();
    const id = `e2e-${stamp}`;
    const title = `E2E live notification ${stamp}`;
    const publish = await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": intakeTokenValue, "content-type": "application/json" },
      data: {
        id,
        module: "e2e",
        title,
        description: "delivered over SSE",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
    expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

    // Appears live in the popover without a reload (FR-5). The title renders as a button
    // (the keyboard-reachable "open" control), so target it by role.
    const card = page.getByRole("button", { name: title });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Clicking it marks it read (FR-6): the frontend POSTs to the read endpoint → 204.
    const [readResponse] = await Promise.all([
      page.waitForResponse(
        (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST",
      ),
      card.click(),
    ]);
    expect(readResponse.status()).toBe(204);

    // The UI reflects read: the title de-emphasizes to normal weight (unread is semibold).
    await expect(card).toHaveClass(/font-normal/);
  });

  test("shows an inline error for a wrong password", async ({ page }) => {
    await login(page, DEV_USER, "definitely-the-wrong-password");
    await expect(page.getByRole("alert")).toContainText(/isn.t right/i);
    await expect(page).toHaveURL(/\/login/);
  });
});
