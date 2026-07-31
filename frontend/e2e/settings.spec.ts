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

    // Mute the DSR module from the settings page.
    await page.goto("/settings");
    const dsrRow = page.locator('[data-target="module:dsr"]');
    await expect(dsrRow).toBeVisible();
    await dsrRow.locator('[data-test="mute-toggle"]').click();
    await expect(dsrRow.locator('[data-test="mute-status"]')).toHaveText("Muted");

    // Reconnect the live stream with the mute applied, then publish notifications.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const mutedTitle = `Muted DSR ${Date.now()}`;
    const critTitle = `Critical DSR ${Date.now()}`;
    expect((await publish(request, token, mutedTitle, { snoozable: true })).ok()).toBeTruthy();
    expect(
      (await publish(request, token, critTitle, { snoozable: false, priority: "critical" })).ok(),
    ).toBeTruthy();

    // Open the panel. The critical (non-snoozable) notif proves the feed is loaded + live; the muted
    // snoozable one is filtered out.
    await page.getByRole("button", { name: /Notifications/ }).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(critTitle)).toBeVisible();
    await expect(dialog.getByText(mutedTitle)).toHaveCount(0);

    // Unmute → a new snoozable DSR notif appears again.
    await page.goto("/settings");
    const row = page.locator('[data-target="module:dsr"]');
    await row.locator('[data-test="mute-toggle"]').click(); // "Muted" → resume
    await expect(row.locator('[data-test="mute-status"]')).toHaveText("Active");

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const restoredTitle = `Restored DSR ${Date.now()}`;
    expect((await publish(request, token, restoredTitle, { snoozable: true })).ok()).toBeTruthy();

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Notifications" }).getByText(restoredTitle),
    ).toBeVisible();
  });

  test("an invalid timezone surfaces an inline error", async ({ page }) => {
    await login(page, DEV_USER, DEV_PASSWORD);
    await page.goto("/settings");
    await page.locator('input[name="timezone"]').fill("Not/AZone");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.getByText("unknown timezone")).toBeVisible();
  });
});
