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
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(
      intakeTokenValue,
      "INTERNAL_INTAKE_TOKEN must be set (config loads it from the monorepo-root .env)",
    ).not.toBe("");

    // Register the SSE-connection gate BEFORE login: the feed's EventSource opens on
    // dashboard mount (after a successful login) and the delivery hub is live-only (no
    // replay), so we must not publish until this page's subscription exists. The old
    // visible "Live" indicator was removed in the panel redesign, so we gate on the
    // GET /sse response (received == headers, ~EventSource onopen) instead.
    const sseConnected = page
      .waitForResponse((r) => r.url().includes("/sse"), { timeout: 20_000 })
      .catch(() => null);

    await login(page, DEV_USER, DEV_PASSWORD);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    await sseConnected;

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

    // Appears live in the "Needs action" group as a card. Its title renders as a button
    // whose accessible name is exactly the title (the keyboard-reachable open control).
    const card = page.getByRole("button", { name: title, exact: true });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Clicking the card marks it read (FR-6) — the frontend POSTs to the read endpoint → 204.
    const [readResponse] = await Promise.all([
      page.waitForResponse(
        (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST",
      ),
      card.click(),
    ]);
    expect(readResponse.status()).toBe(204);

    // Open-and-seen / sticky read: the card STAYS in "Needs action" so you can read it, now
    // showing the "Mark as unread" control — it does NOT relocate to "Earlier" on the click.
    await expect(page.getByRole("button", { name: "Mark as unread" })).toBeVisible();
    await expect(card).toBeVisible();

    // Close and reopen the panel → NotificationPopover remounts and flushSessionReads() settles
    // this-session reads into "Earlier".
    await page.getByRole("button", { name: "Close notifications" }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeHidden();
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    // Now it's in the collapsed "Earlier" group; expanding reveals it as a read row.
    await expect(card).toHaveCount(0);
    const showEarlier = page.getByRole("button", { name: /Show \d+ earlier/ });
    await expect(showEarlier).toBeVisible();
    await showEarlier.click();
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  });

  test("shows a bottom-right toast for a critical notification and View opens the panel", async ({
    page,
    request,
  }) => {
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(intakeTokenValue).not.toBe("");

    const sseConnected = page
      .waitForResponse((r) => r.url().includes("/sse"), { timeout: 20_000 })
      .catch(() => null);

    await login(page, DEV_USER, DEV_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Keep the bell panel CLOSED (a toast is suppressed while it's open). Gate on the SSE
    // connection before publishing so the live-only hub fans the critical out to this page.
    await sseConnected;

    const stamp = Date.now();
    const title = `E2E critical ${stamp}`;
    const publish = await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": intakeTokenValue, "content-type": "application/json" },
      data: {
        id: `e2e-crit-${stamp}`,
        module: "e2e",
        title,
        description: "critical via SSE",
        priority: "critical",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
    expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

    // A toast (role="alert") for this critical appears bottom-right.
    const toast = page.getByRole("alert").filter({ hasText: title });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // View opens the bell panel.
    await toast.getByRole("button", { name: "View" }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  });

  test("shows an inline error for a wrong password", async ({ page }) => {
    await login(page, DEV_USER, "definitely-the-wrong-password");
    await expect(page.getByRole("alert")).toContainText(/isn.t right/i);
    await expect(page).toHaveURL(/\/login/);
  });
});
