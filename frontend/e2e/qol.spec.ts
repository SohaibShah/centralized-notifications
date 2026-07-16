import { expect, test } from "@playwright/test";

const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("QoL", () => {
  test("a read notification is re-readable in Earlier and can be marked unread", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(token, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    const sseConnected = page
      .waitForResponse((r) => r.url().includes("/sse"), { timeout: 20_000 })
      .catch(() => null);

    await login(page, "admin");
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await sseConnected;

    const stamp = Date.now();
    const title = `Re-read me ${stamp}`;
    const publish = await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": token, "content-type": "application/json" },
      data: {
        id: `qol-${stamp}`,
        module: "qol",
        title,
        description: "z".repeat(200), // long enough to be expandable
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
    expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

    // Live in Needs action. Read it (click the title button) → it moves to Earlier.
    const card = page.getByRole("button", { name: title, exact: true });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await Promise.all([
      page.waitForResponse(
        (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST",
      ),
      card.click(),
    ]);

    // Open Earlier — the item is now a full card (title still a button), re-readable.
    await page.getByRole("button", { name: /Show \d+ earlier/ }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();

    // Mark as unread → DELETE 204 → it returns to Needs action.
    const [del] = await Promise.all([
      page.waitForResponse(
        (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "DELETE",
      ),
      page.getByRole("button", { name: "Mark as unread" }).first().click(),
    ]);
    expect(del.status()).toBe(204);
  });

  test("Dev Labs maintenance delete-all is guarded and reports a count", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin");
    await page.getByRole("button", { name: "Dev Labs" }).click();
    await page.locator('[data-test="devlabs-maintenance"]').click();

    await page.locator('[data-test="op-delete-all"]').click();
    // Confirm is disabled until the exact word is typed.
    await expect(page.locator('[data-test="op-delete-all-confirm"]')).toBeDisabled();
    await page.locator('[data-test="op-delete-all-input"]').fill("DELETE");
    await page.locator('[data-test="op-delete-all-confirm"]').click();
    await expect(page.getByText(/Deleted/)).toBeVisible();
  });
});
