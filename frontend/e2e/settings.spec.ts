import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// Seeded dev account (backend/src/auth/seed.ts).
const DEV_USER = "admin";
const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

function publish(
  request: APIRequestContext,
  token: string,
  title: string,
  opts: { snoozable: boolean; priority?: string },
) {
  return request.post(`${BACKEND}/internal/publish`, {
    headers: { "x-internal-token": token, "content-type": "application/json" },
    data: {
      id: `settings-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      module: "dsr",
      title,
      description: "settings e2e",
      priority: opts.priority ?? "high",
      snoozable: opts.snoozable,
      audience: { scope: "global" },
    },
  });
}

test.describe("per-user settings", () => {
  test("muting a module hides its snoozable notifications; critical still passes; unmuting restores", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(token, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);

    // Normalize state: a prior run (or an earlier failure) may have left DSR muted for this user.
    // Ensure it's Active before we begin so the seed notifications aren't filtered from the start.
    await page.getByRole("link", { name: "Settings" }).click();
    const dsrRow = page.locator('[data-target="module:dsr"]');
    await expect(dsrRow).toBeVisible();
    const resume = dsrRow.locator('[data-test="mute-clear"]');
    if (await resume.count()) await resume.click();
    await expect(dsrRow.locator('[data-test="mute-status"]')).toHaveText("Active");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Seed two DSR notifications while on the dashboard — they arrive live over SSE.
    const snoozTitle = `Snoozable DSR ${Date.now()}`;
    const critTitle = `Critical DSR ${Date.now()}`;
    expect((await publish(request, token, snoozTitle, { snoozable: true })).ok()).toBeTruthy();
    expect(
      (await publish(request, token, critTitle, { snoozable: false, priority: "critical" })).ok(),
    ).toBeTruthy();

    // Both are visible in the feed to start.
    await page.getByRole("button", { name: /Notifications/ }).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog.getByText(snoozTitle)).toBeVisible();
    await expect(dialog.getByText(critTitle)).toBeVisible();
    await page.keyboard.press("Escape"); // close the panel

    // Mute DSR from the settings page — navigate IN-APP (no full page reload).
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(dsrRow).toBeVisible();
    await dsrRow.locator('[data-test="mute-toggle"]').click();
    await expect(dsrRow.locator('[data-test="mute-status"]')).toHaveText("Muted");

    // Back to the dashboard via in-app nav; the feed already reflects the mute (no reload) — the
    // snoozable notif is gone, the critical (non-snoozable) one remains.
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(dialog.getByText(critTitle)).toBeVisible();
    await expect(dialog.getByText(snoozTitle)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Un-mute (in-app) → the snoozable notif reappears in the feed without a reload.
    await page.getByRole("link", { name: "Settings" }).click();
    await dsrRow.locator('[data-test="mute-toggle"]').click(); // "Muted" → resume
    await expect(dsrRow.locator('[data-test="mute-status"]')).toHaveText("Active");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(dialog.getByText(snoozTitle)).toBeVisible();
  });

  test("an invalid timezone surfaces an inline error", async ({ page }) => {
    await login(page, DEV_USER, DEV_PASSWORD);
    await page.goto("/settings");
    await page.locator('input[name="timezone"]').fill("Not/AZone");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.getByText("unknown timezone")).toBeVisible();
  });
});
