import { expect, test } from "@playwright/test";

// Seeded dev account (backend/src/auth/seed.ts) — documented prototype credentials.
const DEV_USER = "admin";
const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";
const MODULE_SIM = "http://localhost:4000";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
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

test.describe("action dispatch", () => {
  test("control-center emit publishes an actionable notification into the feed", async ({
    page,
    request,
  }) => {
    const sseConnected = page
      .waitForResponse((r) => r.url().includes("/sse"), { timeout: 20_000 })
      .catch(() => null);

    await login(page, DEV_USER, DEV_PASSWORD);
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await sseConnected;

    // module-sim's own control-center API: a burst of 1 always lands audience {scope:"global"}
    // (generate.ts round-robins AUDIENCE_SCOPES by index, and index 0 is "global"), so it's
    // guaranteed visible to any logged-in user regardless of the (otherwise random) module pick.
    // Every burst template is inherently actionable (module-sim only ever emits notifications
    // carrying a real dispatch action from the module's catalog).
    const emit = await request.post(`${MODULE_SIM}/emit`, {
      data: { mode: "burst", count: 1 },
    });
    expect(emit.ok(), `emit failed: ${emit.status()}`).toBeTruthy();

    // One of the four fixed burst-template titles (dsr / access-governance / data-mapping /
    // assessments) — whichever module the burst's internal RNG picked.
    const burstTitle =
      /DSR approaching SLA breach|Access request awaiting your approval|Sensitive data found in new data stores|Assessments due this week/;
    const card = page.getByRole("button", { name: burstTitle }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // It's actionable: expanding it reveals at least one dispatch action button.
    await card.click();
    const cardArticle = page.locator("article").filter({ has: card });
    await expect(cardArticle.locator('[data-test="action"]').first()).toBeVisible();
  });

  test("dispatch happy path: Approve round-trips through module-sim and resolves the card", async ({
    page,
    request,
  }) => {
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(intakeTokenValue, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    const sseConnected = page
      .waitForResponse((r) => r.url().includes("/sse"), { timeout: 20_000 })
      .catch(() => null);

    await login(page, DEV_USER, DEV_PASSWORD);
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await sseConnected;

    const stamp = Date.now();
    const id = `e2e-dispatch-${stamp}`;
    const title = `E2E dispatch ${stamp}`;
    await publish(request, intakeTokenValue, {
      id,
      module: "dsr", // real seeded module — module-sim's registered base_url is localhost:4000/dsr
      title,
      description: "approve me",
      priority: "high",
      snoozable: false,
      audience: { scope: "global" },
      actions: [{ label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" }],
    });

    const card = page.getByRole("button", { name: title, exact: true });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Actions only render once the card is expanded — clicking the title button both expands
    // it (canExpand is true: it has actions) and marks it read (open-and-seen).
    await card.click();
    const cardArticle = page.locator("article").filter({ has: card });
    const approveButton = cardArticle.getByRole("button", { name: "Approve" });
    await expect(approveButton).toBeVisible();

    // Click Approve → the hub proxies to module-sim's dsr.approve handler, which replies
    // {ok:true, message:"DSR approved", resolve:true} on its first call.
    const [dispatchResponse] = await Promise.all([
      page.waitForResponse(
        (r) => /\/notifications\/.+\/actions\/\d+\/dispatch$/.test(r.url()) && r.status() === 200,
      ),
      approveButton.click(),
    ]);
    const body = (await dispatchResponse.json()) as {
      ok: boolean;
      message?: string;
      resolve?: boolean;
    };
    expect(body).toMatchObject({ ok: true, message: "DSR approved", resolve: true });

    // Inline result surfaces on the card immediately.
    await expect(cardArticle.locator('[data-test="action-result"]')).toHaveText("DSR approved");
    // The button re-enables (not stuck pending) once the round-trip settles.
    await expect(approveButton).toBeEnabled();

    // resolve:true marks it read — sticky-read keeps it in "Needs action" (shown read) for this
    // session, so confirm the durable read state via the toggle rather than an immediate group jump.
    await expect(cardArticle.getByRole("button", { name: "Mark as unread" })).toBeVisible();

    // Close and reopen the panel: flushSessionReads() settles the read card into "Earlier",
    // proving the dispatch's resolve actually persisted server-side (not just an optimistic flag).
    await page.getByRole("button", { name: "Close notifications" }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeHidden();
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    const earlierList = page.locator('[data-test="earlier-list"]');
    await expect(earlierList.getByRole("button", { name: title, exact: true })).toBeVisible();
  });

  test("dispatch failure: an unreachable module fails the round-trip and re-enables the button", async ({
    page,
    request,
  }) => {
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(intakeTokenValue, "INTERNAL_INTAKE_TOKEN must be set").not.toBe("");

    // access-governance isn't used by any other spec (feed/qol use dsr, admin.spec uses
    // assessments) — clearing its base_url here can't race another test's assumptions about it.
    const mod = "access-governance";
    const restoredBaseUrl = `${MODULE_SIM}/${mod}`;

    const sseConnected = page
      .waitForResponse((r) => r.url().includes("/sse"), { timeout: 20_000 })
      .catch(() => null);

    await login(page, DEV_USER, DEV_PASSWORD);
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await sseConnected;

    const stamp = Date.now();
    const id = `e2e-dispatch-fail-${stamp}`;
    const title = `E2E dispatch failure ${stamp}`;
    await publish(request, intakeTokenValue, {
      id,
      module: mod,
      title,
      description: "this module will be made unreachable before the click",
      priority: "high",
      snoozable: false,
      audience: { scope: "global" },
      actions: [{ label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" }],
    });

    const card = page.getByRole("button", { name: title, exact: true });
    await expect(card).toBeVisible({ timeout: 10_000 });

    try {
      // Clear the module's registered base_url via the admin UI → the hub's dispatch route now
      // 409s ("module unavailable") for ANY dispatch to this module, deterministically, before
      // ever reaching module-sim.
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
      const baseUrlInput = page.locator(`[data-test="base-url-${mod}"]`);
      await expect(baseUrlInput).toBeVisible({ timeout: 10_000 });
      await baseUrlInput.fill("");
      const saveButton = page.locator(`[data-test="base-url-save-${mod}"]`);
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes(`/admin/modules/${mod}`) && r.request().method() === "PATCH",
        ),
        saveButton.click(),
      ]);
      await expect(baseUrlInput).toHaveValue("");

      // Back to the dashboard, expand the card, and click Approve.
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      await page.getByRole("button", { name: /Notifications/ }).click();
      await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

      await card.click();
      const cardArticle = page.locator("article").filter({ has: card });
      const approveButton = cardArticle.getByRole("button", { name: "Approve" });
      await expect(approveButton).toBeVisible();

      const [dispatchResponse] = await Promise.all([
        page.waitForResponse((r) => /\/notifications\/.+\/actions\/\d+\/dispatch$/.test(r.url())),
        approveButton.click(),
      ]);
      expect(dispatchResponse.status()).toBe(409); // ModuleUnavailableError

      // The card surfaces the failure and the button is usable again — not stuck disabled/pending.
      await expect(cardArticle.locator('[data-test="action-result"]')).toHaveText("Action failed");
      await expect(approveButton).toBeEnabled();
      await expect(approveButton).not.toHaveAttribute("aria-busy", "true");
    } finally {
      // Restore the module's base_url so it isn't left broken for other runs/specs.
      await page.goto("/admin");
      const restoreInput = page.locator(`[data-test="base-url-${mod}"]`);
      await expect(restoreInput).toBeVisible({ timeout: 10_000 });
      await restoreInput.fill(restoredBaseUrl);
      const restoreSave = page.locator(`[data-test="base-url-save-${mod}"]`);
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes(`/admin/modules/${mod}`) && r.request().method() === "PATCH",
        ),
        restoreSave.click(),
      ]);
      await expect(restoreInput).toHaveValue(restoredBaseUrl);
    }
  });
});
