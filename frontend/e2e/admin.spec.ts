import { expect, test } from "@playwright/test";

// Seeded dev accounts (backend/src/auth/seed.ts). `admin` holds the admin role; `priya`
// does not — used to prove the /admin guard.
const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function publish(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  data: Record<string, unknown>,
) {
  const res = await request.post(`${BACKEND}/internal/publish`, {
    headers: { "x-internal-token": token, "content-type": "application/json" },
    data,
  });
  expect(res.ok(), `publish failed: ${res.status()}`).toBeTruthy();
}

test.describe("admin", () => {
  test("a disabled module's notifications stop appearing in the feed", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(token, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    // A throwaway module unique to this run — leaving it disabled afterwards is harmless.
    const mod = `e2e-admin-${Date.now()}`;

    await login(page, "admin", DEV_PASSWORD);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Publish once so the module is auto-discovered, then open the admin console.
    await publish(request, token, {
      id: `${mod}-seed`,
      module: mod,
      title: "seed",
      description: "",
      priority: "high",
      snoozable: true,
      audience: { scope: "global" },
    });

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();

    // The seed publish auto-discovered the module; disable it.
    const toggle = page.locator(`[data-test="toggle-${mod}"]`);
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Publish again from the now-disabled module → it must be suppressed (never delivered).
    const hiddenTitle = `Hidden ${Date.now()}`;
    await publish(request, token, {
      id: `${mod}-hidden`,
      module: mod,
      title: hiddenTitle,
      description: "",
      priority: "high",
      snoozable: true,
      audience: { scope: "global" },
    });

    // Open the bell; the suppressed title never arrives over SSE.
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: hiddenTitle })).toHaveCount(0);
  });

  test("a non-admin cannot reach /admin", async ({ page }) => {
    await login(page, "priya", DEV_PASSWORD); // seeded non-admin (privacy-analyst)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.goto("/admin");
    // The router guard redirects an authenticated non-admin back to the dashboard.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Admin" })).toHaveCount(0);
  });
});
