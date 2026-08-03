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

function publish(request: APIRequestContext, token: string, title: string): Promise<unknown> {
  return request.post(`${BACKEND}/internal/publish`, {
    headers: { "x-internal-token": token, "content-type": "application/json" },
    data: {
      id: `grouping-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      module: "dsr",
      title,
      description: "grouping e2e",
      priority: "high",
      snoozable: true,
      audience: { scope: "global" },
    },
  });
}

/** Ensure the per-user grouping switch is ON (a prior run may have left it off), then save. */
async function ensureGroupingOn(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  const sw = page.locator('[data-test="switch-groupingEnabled"]');
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute("aria-checked")) === "false") {
    await sw.click();
    await page.getByRole("button", { name: "Save preferences" }).click();
  }
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe("notification grouping", () => {
  test("same-subject notifications collapse into a stack; expand → see all → exit; toggle off → flat", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(token, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);
    await ensureGroupingOn(page);

    // Three notifications about one subject (shared #<uid>) → one instance stack, plus one unrelated.
    const uid = `${Date.now()}`.slice(-6);
    const subject = `SubjectMe #${uid}`;
    for (const step of ["received", "verified", "overdue"]) {
      expect((await publish(request, token, `${subject} ${step}`)).ok()).toBeTruthy();
    }
    const loneTitle = `LoneWolf ${uid} — nothing related`;
    expect((await publish(request, token, loneTitle)).ok()).toBeTruthy();

    // Open the panel — the three collapse into a stack labelled with the subject, showing total 3.
    await page.getByRole("button", { name: /Notifications/ }).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    const stack = dialog.locator('[data-test="stack-header"]', { hasText: subject });
    await expect(stack).toBeVisible();
    await expect(stack).toContainText("3");

    // Expand the stack → the inline peek appears with a "See all" affordance.
    await stack.click();
    await expect(dialog.locator('[data-test="stack-peek"]')).toBeVisible();

    // See all → the feed filters to just this group with a banner + exit; all three members show.
    await dialog.locator('[data-test="stack-see-all"]').first().click();
    await expect(dialog.locator('[data-test="group-view-banner"]')).toBeVisible();
    await expect(dialog.getByText(`${subject} received`)).toBeVisible();
    await expect(dialog.getByText(`${subject} overdue`)).toBeVisible();
    await expect(dialog.getByText(loneTitle)).toHaveCount(0); // unrelated notif is not in the group

    // Exit → back to the stacks view.
    await dialog.locator('[data-test="feed-banner-exit"]').click();
    await expect(dialog.locator('[data-test="stack-header"]', { hasText: subject })).toBeVisible();
    await page.keyboard.press("Escape");

    // Turn grouping OFF in settings → the panel renders a flat feed (no stacks), no reload needed.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.locator('[data-test="switch-groupingEnabled"]').click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(dialog.locator('[data-test="stack-header"]')).toHaveCount(0);
    await expect(dialog.getByText(`${subject} overdue`)).toBeVisible(); // shown as a flat card now
  });

  test("Mark all read clears an unread stack from Needs action into an Earlier stack", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(token, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);
    await ensureGroupingOn(page);

    // Three unread notifications about one subject → a single unread stack (total 3) in Needs action.
    const uid = `${Date.now()}`.slice(-6);
    const subject = `MarkAll #${uid}`;
    for (const step of ["received", "verified", "overdue"]) {
      expect((await publish(request, token, `${subject} ${step}`)).ok()).toBeTruthy();
    }

    await page.getByRole("button", { name: /Notifications/ }).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    const stack = dialog.locator('[data-test="stack-header"]', { hasText: subject });
    await expect(stack).toBeVisible();
    await expect(stack).toContainText("3");

    // Expand and mark the whole group read.
    await stack.click();
    await dialog.locator('[data-test="stack-mark-all"]').first().click();

    // The unread stack collapses out of Needs action and the same subject reappears, still counted 3,
    // as a read stack in the Earlier section (the read-split in action).
    const earlierStack = dialog.locator('[data-test="earlier-list"] [data-test="stack-header"]', {
      hasText: subject,
    });
    await expect(earlierStack).toBeVisible();
    await expect(earlierStack).toContainText("3");
    await page.keyboard.press("Escape");
  });
});
