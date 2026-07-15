# Basic Admin Panel + Module Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Week-2 admin console — enable/disable auto-discovered notification modules and toggle global feature kill-switches — with the module toggle actually enforced in the delivery pipeline (a disabled module's notifications are recorded but not delivered).

**Architecture:** One migration adds `modules` + `global_settings` tables and a `suppressed` flag on `notifications`. The ingest pipeline gains module auto-discovery (upsert-on-publish) and a policy step (in-memory cache of disabled modules + feature flags) that marks a disabled module's notifications `suppressed` and skips broadcast; the feed list query excludes suppressed rows. An admin-only REST surface (`/admin/*`) reads/writes modules + settings; a user-readable `GET /settings/features` exposes the flags for UI gating. The frontend adds a guarded `/admin` route with a layout-C sub-nav shell, a Modules panel (filter/sort/inline-rename/toggle) and a Features panel (FormRenderer-driven switches).

**Tech Stack:** Backend Fastify 5 + TypeScript + `pg` + zod; Frontend Vue 3 (`<script setup>`) + TypeScript + Pinia + vue-router + Tailwind v4 + `@lucide/vue`; shared zod contract in `packages/shared`; Vitest + Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-admin-panel-design.md`. Every task inherits it.
- TypeScript strict everywhere; `any` needs an inline justification comment. `pnpm lint` + `pnpm typecheck` clean before a task is done.
- Validate at the boundary with zod; SQL is always parameterized (never string-concatenated with input).
- Every admin endpoint is behind `requireAdmin`; the client-side route guard is defense-in-front only and never the sole check.
- Design system "Editorial Command, ivory": priority = a dot (`priorityDotClass`), flat + hairline (no drop shadows), lucide icons only (never emoji), machine data in JetBrains Mono with `tabular-nums`, motion transform/opacity only honoring `prefers-reduced-motion`. Reuse `components/ui/*` primitives; do not hand-roll.
- Forms go through the shared `FormRenderer` (json-form convention) — read the `json-form-conventions` skill before touching the form system.
- No AI-attribution commit trailers. Conventional Commits. New business logic ships with a test in the same task.
- `NOTIFICATION_PRIORITIES = ["low","normal","high","critical"]` (from `@notifications/shared`).
- Migrations are forward-only files in `backend/migrations/`, applied by `pnpm --filter @notifications/backend migrate`. Never hand-edit applied schema.
- Suppression semantics (locked): a disabled module's notifications are still persisted (`suppressed = true`), NOT broadcast, and excluded from the feed list. Only notifications arriving _after_ a module is disabled are affected. Module discovery defaults a never-seen module to `enabled = true`.

---

## File Structure

**Backend**

- Create `backend/migrations/005_admin.sql` — `modules`, `global_settings`, `notifications.suppressed`.
- Create `backend/src/pipeline/modules.ts` — `upsertModuleSeen(key)` (FR-7 discovery).
- Create `backend/src/pipeline/policy.ts` — in-memory settings cache: `isModuleEnabled`, `getFeatureFlags`, `invalidatePolicyCache`.
- Modify `backend/src/pipeline/persist.ts` — accept + write `suppressed`.
- Modify `backend/src/pipeline/ingest.ts` — discover module, apply policy, persist w/ suppressed, broadcast only if delivered.
- Modify `backend/src/http/notifications/routes.ts` — exclude `suppressed` rows from `GET /notifications`.
- Create `backend/src/http/admin/routes.ts` — `GET/PATCH /admin/modules`, `GET/PATCH /admin/settings`, `GET /settings/features`.
- Modify `backend/src/server.ts` — register `adminRoutes`.
- Create `docs/api/admin.md`; modify `docs/api/notifications.md` (note the suppressed exclusion).
- Tests: `backend/test/policy.test.ts`, `backend/test/admin.test.ts`; extend `backend/test/notifications.test.ts`.

**Frontend**

- Modify `frontend/src/api/client.ts` — add `patch`.
- Create `frontend/src/stores/settings.ts` — feature flags for UI gating.
- Modify `frontend/src/features/dashboard/DashboardLayout.vue` — load settings on mount.
- Modify `frontend/src/features/notifications/panel/InboxTab.vue` — gate AI band on `aiSummaryEnabled`.
- Modify `frontend/src/router/index.ts` — guarded `/admin` route.
- Modify `frontend/src/features/dashboard/components/DashboardSidebar.vue` — wire the Admin entry.
- Create `frontend/src/features/admin/AdminView.vue` — layout-C sub-nav shell.
- Create `frontend/src/features/admin/ModulesPanel.vue`, `frontend/src/features/admin/FeaturesPanel.vue`.
- Create `frontend/src/features/admin/adminApi.ts` — typed admin fetch helpers + `AdminModule` type.
- Modify `frontend/src/forms/types.ts` + `frontend/src/forms/FormRenderer.vue`; create `frontend/src/forms/fields/SwitchField.vue`; create `frontend/src/forms/features.form.ts`.
- Tests: `frontend/src/stores/settings.spec.ts`, `frontend/src/features/admin/ModulesPanel.spec.ts`, `frontend/src/features/admin/FeaturesPanel.spec.ts`; extend `frontend/e2e/feed.spec.ts` (or new `frontend/e2e/admin.spec.ts`).

---

## Task 1: Migration 005 — modules, global_settings, suppressed flag

**Files:**

- Create: `backend/migrations/005_admin.sql`
- Test: `backend/test/admin.test.ts` (schema smoke test; grows in later tasks)

**Interfaces:**

- Produces: table `modules(key text pk, label text, enabled bool, first_seen_at, last_seen_at)`; single-row table `global_settings(id bool pk check(id), ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled bool, updated_at)`; column `notifications.suppressed boolean not null default false`.

- [ ] **Step 1: Write the migration** `backend/migrations/005_admin.sql`:

```sql
-- Week-2 admin foundation (FR-7 / FR-8).
--
-- `modules`: one row per notification source, auto-discovered on first publish. `enabled`
-- is the admin kill-switch; `label` is a human name (defaults to the key, admin-renamable).
-- A never-seen module is enabled by default — discovery inserts it enabled and never flips
-- that back on later publishes, so an admin's disable sticks.
--
-- `global_settings`: exactly one row (the `id = true` primary key + CHECK enforces the
-- singleton) holding global feature kill-switches. Seeded here so a read always finds it.
--
-- `notifications.suppressed`: set true at ingest when the source module is disabled — the
-- row is kept (audit of what would have arrived) but excluded from delivery and the feed.

CREATE TABLE modules (
  key           text NOT NULL PRIMARY KEY,
  label         text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE global_settings (
  id                  boolean NOT NULL PRIMARY KEY DEFAULT true,
  ai_summary_enabled  boolean NOT NULL DEFAULT true,
  chatbot_enabled     boolean NOT NULL DEFAULT true,
  grouping_enabled    boolean NOT NULL DEFAULT true,
  actions_enabled     boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_settings_singleton CHECK (id)
);

INSERT INTO global_settings (id) VALUES (true);

ALTER TABLE notifications ADD COLUMN suppressed boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Write a schema smoke test** `backend/test/admin.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";

describe("admin schema (migration 005)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("creates the modules and global_settings tables and the suppressed column", async () => {
    await query(
      "INSERT INTO modules (key, label) VALUES ('smoke', 'Smoke') ON CONFLICT (key) DO NOTHING",
    );
    const mod = await query<{ enabled: boolean }>(
      "SELECT enabled FROM modules WHERE key = 'smoke'",
    );
    expect(mod.rows[0]?.enabled).toBe(true);

    const settings = await query<{ ai_summary_enabled: boolean }>(
      "SELECT ai_summary_enabled FROM global_settings WHERE id = true",
    );
    expect(settings.rows[0]?.ai_summary_enabled).toBe(true);

    const col = await query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'suppressed'",
    );
    expect(col.rowCount).toBe(1);
  });

  it("enforces the global_settings singleton", async () => {
    await expect(query("INSERT INTO global_settings (id) VALUES (false)")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run migration + test.** `docker compose up -d` then:

Run: `pnpm --filter @notifications/backend migrate && pnpm --filter @notifications/backend test -- admin`
Expected: migration applies `005_admin.sql`; both tests PASS.

- [ ] **Step 4: Typecheck + lint + commit.**

Run: `pnpm typecheck && pnpm lint`

```bash
git add backend/migrations/005_admin.sql backend/test/admin.test.ts
git commit -m "feat(backend): migration for modules, global_settings, suppressed flag"
```

---

## Task 2: Module auto-discovery (FR-7)

**Files:**

- Create: `backend/src/pipeline/modules.ts`
- Modify: `backend/src/pipeline/ingest.ts`
- Test: `backend/test/modules.test.ts`

**Interfaces:**

- Consumes: `query` from `../db/pool`.
- Produces: `upsertModuleSeen(key: string): Promise<void>` — inserts the module enabled with a title-cased label on first sight, only bumps `last_seen_at` thereafter (never touches `enabled`/`label`). Called from `ingest` after a notification is persisted.

- [ ] **Step 1: Write the failing test** `backend/test/modules.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { upsertModuleSeen } from "../src/pipeline/modules";

describe("module auto-discovery", () => {
  beforeAll(async () => migrate());
  afterAll(async () => closePool());
  beforeEach(async () => query("DELETE FROM modules WHERE key LIKE 'disc-%'"));

  it("inserts a never-seen module exactly once, enabled, with a derived label", async () => {
    await upsertModuleSeen("disc-vendor_risk");
    await upsertModuleSeen("disc-vendor_risk");
    const { rows } = await query<{ label: string; enabled: boolean }>(
      "SELECT label, enabled FROM modules WHERE key = 'disc-vendor_risk'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.label).toBe("Vendor Risk");
  });

  it("never re-enables or relabels an existing module on later publishes", async () => {
    await upsertModuleSeen("disc-x");
    await query("UPDATE modules SET enabled = false, label = 'Custom' WHERE key = 'disc-x'");
    await upsertModuleSeen("disc-x");
    const { rows } = await query<{ label: string; enabled: boolean }>(
      "SELECT label, enabled FROM modules WHERE key = 'disc-x'",
    );
    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.label).toBe("Custom");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/backend test -- modules`
      Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `backend/src/pipeline/modules.ts`:

```ts
import { query } from "../db/pool";

/** Title-case a module key for the default human label: `vendor_risk` → `Vendor Risk`. */
function deriveLabel(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Record that `key` published. First sight inserts the module (enabled, auto-labelled);
 * afterwards only `last_seen_at` is bumped — an admin's enabled/label edits are preserved.
 * Idempotent (safe to call on every accepted notification).
 */
export async function upsertModuleSeen(key: string): Promise<void> {
  await query(
    `INSERT INTO modules (key, label) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET last_seen_at = now()`,
    [key, deriveLabel(key)],
  );
}
```

- [ ] **Step 4: Wire into `ingest.ts`** (discovery after persist; unconditional on accepted). Modify `backend/src/pipeline/ingest.ts`:

```ts
import { deliveryHub } from "../delivery/hub";
import type { IngestResult } from "../intake/boundary";
import { upsertModuleSeen } from "./modules";
import { persist } from "./persist";
import { validate } from "./validate";

export async function ingest(raw: unknown): Promise<IngestResult> {
  const result = validate(raw);
  if (!result.ok) {
    console.warn(`[intake] rejected invalid notification (${result.error})`);
    return { status: "invalid" };
  }
  const status = await persist(result.data);
  if (status === "accepted") {
    await upsertModuleSeen(result.data.module);
    deliveryHub.broadcast(result.data);
  }
  return { status, id: result.data.id };
}
```

(Note: the policy/suppression wiring lands in Task 3, which replaces the `if (status === "accepted")` block again — this task keeps `persist`'s current single-arg signature.)

- [ ] **Step 5: Run to verify passing + full pipeline still green.**

Run: `pnpm --filter @notifications/backend test -- modules && pnpm --filter @notifications/backend test`
Expected: PASS (2 new tests); existing intake/notifications tests still green.

- [ ] **Step 6: Typecheck + lint + commit.**

```bash
git add backend/src/pipeline/modules.ts backend/src/pipeline/ingest.ts backend/test/modules.test.ts
git commit -m "feat(backend): module auto-discovery upsert on publish"
```

---

## Task 3: Policy engine + suppression

**Files:**

- Create: `backend/src/pipeline/policy.ts`
- Modify: `backend/src/pipeline/persist.ts`, `backend/src/pipeline/ingest.ts`, `backend/src/http/notifications/routes.ts`, `docs/api/notifications.md`
- Test: `backend/test/policy.test.ts`

**Interfaces:**

- Produces: `isModuleEnabled(key: string): Promise<boolean>` (unknown key → `true`); `getFeatureFlags(): Promise<FeatureFlags>` where `FeatureFlags = { aiSummaryEnabled: boolean; chatbotEnabled: boolean; groupingEnabled: boolean; actionsEnabled: boolean }`; `invalidatePolicyCache(): void`. Backed by a lazily-loaded in-memory cache refreshed on `invalidate`.
- Changes: `persist(n: Notification, suppressed: boolean): Promise<"accepted" | "duplicate">`.

- [ ] **Step 1: Write the failing test** `backend/test/policy.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { getFeatureFlags, invalidatePolicyCache, isModuleEnabled } from "../src/pipeline/policy";

describe("policy cache", () => {
  beforeAll(async () => migrate());
  afterAll(async () => closePool());
  beforeEach(async () => {
    await query("DELETE FROM modules WHERE key LIKE 'pol-%'");
    await query("UPDATE global_settings SET ai_summary_enabled = true WHERE id = true");
    invalidatePolicyCache();
  });

  it("treats a never-seen module as enabled", async () => {
    expect(await isModuleEnabled("pol-unknown")).toBe(true);
  });

  it("reflects a disabled module only after the cache is invalidated", async () => {
    await query("INSERT INTO modules (key, label, enabled) VALUES ('pol-a', 'A', false)");
    // stale cache (loaded when pol-a didn't exist) still says enabled until invalidate
    await isModuleEnabled("pol-a");
    invalidatePolicyCache();
    expect(await isModuleEnabled("pol-a")).toBe(false);
  });

  it("reads feature flags and re-reads them after invalidation", async () => {
    expect((await getFeatureFlags()).aiSummaryEnabled).toBe(true);
    await query("UPDATE global_settings SET ai_summary_enabled = false WHERE id = true");
    invalidatePolicyCache();
    expect((await getFeatureFlags()).aiSummaryEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/backend test -- policy`
      Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `backend/src/pipeline/policy.ts`:

```ts
import { query } from "../db/pool";

export interface FeatureFlags {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
}

interface PolicyState {
  disabledModules: Set<string>;
  flags: FeatureFlags;
}

let cache: PolicyState | null = null;

async function load(): Promise<PolicyState> {
  const disabled = await query<{ key: string }>("SELECT key FROM modules WHERE enabled = false");
  const settings = await query<{
    ai_summary_enabled: boolean;
    chatbot_enabled: boolean;
    grouping_enabled: boolean;
    actions_enabled: boolean;
  }>(
    `SELECT ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled
       FROM global_settings WHERE id = true`,
  );
  const s = settings.rows[0];
  return {
    disabledModules: new Set(disabled.rows.map((r) => r.key)),
    flags: {
      aiSummaryEnabled: s?.ai_summary_enabled ?? true,
      chatbotEnabled: s?.chatbot_enabled ?? true,
      groupingEnabled: s?.grouping_enabled ?? true,
      actionsEnabled: s?.actions_enabled ?? true,
    },
  };
}

async function get(): Promise<PolicyState> {
  if (!cache) cache = await load();
  return cache;
}

/** A module is enabled unless it is explicitly disabled (a never-seen module is enabled). */
export async function isModuleEnabled(key: string): Promise<boolean> {
  const state = await get();
  return !state.disabledModules.has(key);
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  return (await get()).flags;
}

/** Drop the cache; the next read reloads from the DB. Call after any admin write. */
export function invalidatePolicyCache(): void {
  cache = null;
}
```

- [ ] **Step 4: Run to verify passing.** Run: `pnpm --filter @notifications/backend test -- policy`
      Expected: PASS (3 tests).

- [ ] **Step 5: Change `persist` to accept `suppressed`.** Modify `backend/src/pipeline/persist.ts` — add `suppressed` to the signature and the INSERT column list/values. The function currently is `persist(n: Notification)` inserting `(id, module, title, description, priority, snoozable, category, audience_scope, audience_id, actions, metadata, source_ts)`; add a trailing `suppressed` column bound to the new parameter:

```ts
// signature
export async function persist(
  n: Notification,
  suppressed: boolean,
): Promise<"accepted" | "duplicate"> {
  const result = await query<{ id: string }>(
    `INSERT INTO notifications
       (id, module, title, description, priority, snoozable, category,
        audience_scope, audience_id, actions, metadata, source_ts, suppressed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      n.id,
      n.module,
      n.title,
      n.description,
      n.priority,
      n.snoozable,
      n.category ?? null,
      n.audience.scope,
      "id" in n.audience ? (n.audience.id ?? null) : null,
      n.actions ? JSON.stringify(n.actions) : null,
      n.metadata ? JSON.stringify(n.metadata) : null,
      n.timestamp ?? null,
      suppressed,
    ],
  );
  return result.rows.length > 0 ? "accepted" : "duplicate";
}
```

(Preserve the existing exact binding expressions for columns 1–12 as they are in the current file — only add the `suppressed` column + `$13` + the trailing arg. Read the current `persist.ts` and adapt rather than assuming the arg expressions above verbatim.)

- [ ] **Step 6: Wire policy + suppression into `ingest.ts`:**

```ts
import { deliveryHub } from "../delivery/hub";
import type { IngestResult } from "../intake/boundary";
import { upsertModuleSeen } from "./modules";
import { persist } from "./persist";
import { isModuleEnabled } from "./policy";
import { validate } from "./validate";

export async function ingest(raw: unknown): Promise<IngestResult> {
  const result = validate(raw);
  if (!result.ok) {
    console.warn(`[intake] rejected invalid notification (${result.error})`);
    return { status: "invalid" };
  }
  const delivered = await isModuleEnabled(result.data.module);
  const status = await persist(result.data, !delivered);
  if (status === "accepted") {
    await upsertModuleSeen(result.data.module);
    if (delivered) deliveryHub.broadcast(result.data);
  }
  return { status, id: result.data.id };
}
```

- [ ] **Step 7: Exclude suppressed rows from the feed.** In `backend/src/http/notifications/routes.ts` `GET /notifications`, add `n.suppressed = false` to the query. The current code only builds a `WHERE` when a cursor is present; change it to always filter suppressed and append the cursor clause with `AND`:

```ts
const params: unknown[] = [user.id];
let where = "WHERE n.suppressed = false";
if (cursor) {
  params.push(cursor.ts, cursor.id);
  where += " AND (n.created_at, n.id) < ($2::timestamptz, $3::text)";
}
params.push(limit + 1);
const limitPlaceholder = `$${params.length}`;
```

(The rest of the query — SELECT list, JOIN, ORDER BY, LIMIT — is unchanged. The `FeedRow` interface does not need `suppressed`; it's filtered, not selected.)

- [ ] **Step 8: Update the intake/notifications tests for the new `persist` arity + suppression.** In `backend/test/policy.test.ts` add an integration test through `ingest`:

```ts
import { ingest } from "../src/pipeline/ingest";

it("suppresses (persists but does not deliver) a disabled module's notification", async () => {
  await query("INSERT INTO modules (key, label, enabled) VALUES ('pol-off', 'Off', false)");
  invalidatePolicyCache();
  const id = `pol-supp-${Date.now()}`;
  const res = await ingest({
    id,
    module: "pol-off",
    title: "hidden",
    description: "",
    priority: "high",
    snoozable: true,
    audience: { scope: "global" },
  });
  expect(res.status).toBe("accepted");
  const row = await query<{ suppressed: boolean }>(
    "SELECT suppressed FROM notifications WHERE id = $1",
    [id],
  );
  expect(row.rows[0]?.suppressed).toBe(true);
});
```

Also fix any existing call sites/tests that invoke `persist(n)` with one arg — search: `rg "persist\(" backend` and pass `false` where a plain persist is expected.

- [ ] **Step 9: Update docs.** In `docs/api/notifications.md`, under `GET /notifications`, add a line: "Suppressed notifications (from modules an admin has disabled) are excluded from this list." (Delegate to the `docs-writer` subagent per the api-documentation rule.)

- [ ] **Step 10: Full backend suite + lint + commit.**

Run: `pnpm --filter @notifications/backend test && pnpm typecheck && pnpm lint`
Expected: all green/clean.

```bash
git add backend/src/pipeline/policy.ts backend/src/pipeline/persist.ts backend/src/pipeline/ingest.ts backend/src/http/notifications/routes.ts backend/test/policy.test.ts docs/api/notifications.md
git commit -m "feat(backend): module policy engine + suppression in ingest/feed"
```

---

## Task 4: Admin API + user-readable feature flags

**Files:**

- Create: `backend/src/http/admin/routes.ts`
- Modify: `backend/src/server.ts`
- Create: `docs/api/admin.md`
- Test: extend `backend/test/admin.test.ts`

**Interfaces:**

- Produces (all JSON): `GET /admin/modules` → `AdminModule[]`; `PATCH /admin/modules/:key` (body `{ enabled?: boolean; label?: string }`) → 204; `GET /admin/settings` → `FeatureFlags`; `PATCH /admin/settings` (body: partial `FeatureFlags`) → 204; `GET /settings/features` (requireUser) → `FeatureFlags`.
- `AdminModule = { key: string; label: string; enabled: boolean; lastSeenAt: string; total: number; suppressed: number; byPriority: { critical: number; high: number; normal: number; low: number } }`.
- Every `/admin/*` route uses `requireAdmin`; `/settings/features` uses `requireUser`. All writes call `invalidatePolicyCache()`.

- [ ] **Step 1: Write failing tests** — append to `backend/test/admin.test.ts` a describe that builds the server, logs in an admin and a non-admin, and exercises authz + behavior. Reuse the login-cookie harness from `backend/test/notifications.test.ts` (login via `POST /auth/login`, capture `set-cookie`, split on `;`). Seed an admin user (role `admin`) and a plain user.

```ts
import { buildServer } from "../src/server";
// ...within a new describe, after migrate():
// helper (mirror notifications.test.ts):
async function login(app, username, password) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers["set-cookie"];
  const c = Array.isArray(raw) ? raw[0] : raw;
  return (c ?? "").split(";")[0] ?? "";
}

it("blocks non-admins from /admin/modules with 403 and unauth with 401", async () => {
  expect((await app.inject({ method: "GET", url: "/admin/modules" })).statusCode).toBe(401);
  const res = await app.inject({
    method: "GET",
    url: "/admin/modules",
    headers: { cookie: userCookie },
  });
  expect(res.statusCode).toBe(403);
});

it("lists modules with a priority breakdown and totals", async () => {
  // seed a module + notifications of mixed priority + one suppressed
  const res = await app.inject({
    method: "GET",
    url: "/admin/modules",
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  const mods = res.json();
  const m = mods.find((x) => x.key === "admin-dsar");
  expect(m.byPriority.critical).toBe(1);
  expect(m.total).toBeGreaterThanOrEqual(2);
  expect(typeof m.suppressed).toBe("number");
});

it("disables a module (PATCH) and it takes effect on the next ingest", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/admin-dsar",
    headers: { cookie: adminCookie },
    payload: { enabled: false },
  });
  expect(res.statusCode).toBe(204);
  const ing = await ingest({
    id: `after-off-${Date.now()}`,
    module: "admin-dsar",
    title: "x",
    description: "",
    priority: "low",
    snoozable: true,
    audience: { scope: "global" },
  });
  const row = await query("SELECT suppressed FROM notifications WHERE id = $1", [ing.id]);
  expect(row.rows[0].suppressed).toBe(true);
});

it("renames a label and re-derives on empty", async () => {
  await app.inject({
    method: "PATCH",
    url: "/admin/modules/admin-dsar",
    headers: { cookie: adminCookie },
    payload: { label: "DSAR (Requests)" },
  });
  let m = (
    await app.inject({ method: "GET", url: "/admin/modules", headers: { cookie: adminCookie } })
  )
    .json()
    .find((x) => x.key === "admin-dsar");
  expect(m.label).toBe("DSAR (Requests)");
  await app.inject({
    method: "PATCH",
    url: "/admin/modules/admin-dsar",
    headers: { cookie: adminCookie },
    payload: { label: "" },
  });
  m = (await app.inject({ method: "GET", url: "/admin/modules", headers: { cookie: adminCookie } }))
    .json()
    .find((x) => x.key === "admin-dsar");
  expect(m.label).toBe("Admin Dsar");
});

it("reads and writes settings; /settings/features is user-readable", async () => {
  const patch = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: { cookie: adminCookie },
    payload: { aiSummaryEnabled: false },
  });
  expect(patch.statusCode).toBe(204);
  const userView = await app.inject({
    method: "GET",
    url: "/settings/features",
    headers: { cookie: userCookie },
  });
  expect(userView.statusCode).toBe(200);
  expect(userView.json().aiSummaryEnabled).toBe(false);
  expect((await app.inject({ method: "GET", url: "/settings/features" })).statusCode).toBe(401);
});

it("rejects an out-of-range label with 400", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/admin-dsar",
    headers: { cookie: adminCookie },
    payload: { label: "x".repeat(101) },
  });
  expect(res.statusCode).toBe(400);
});
```

(The implementer fills in the `beforeAll` seeding: an `admin`-roled user + a plain user via the identity tables, a `modules` row `admin-dsar`, and notifications — including one `suppressed = true` — for the breakdown. Model role seeding on `001_identity.sql` / the auth repository. Use `deriveLabel`-consistent expectation: `admin-dsar` → `Admin Dsar`.)

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @notifications/backend test -- admin`
      Expected: FAIL (routes missing → 404s).

- [ ] **Step 3: Implement** `backend/src/http/admin/routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "../../auth/guards";
import { query } from "../../db/pool";
import { getFeatureFlags, invalidatePolicyCache } from "../../pipeline/policy";

const moduleParamsSchema = z.object({ key: z.string().min(1).max(100) });
const modulePatchSchema = z
  .object({ enabled: z.boolean().optional(), label: z.string().max(100).optional() })
  .refine((b) => b.enabled !== undefined || b.label !== undefined, "no fields to update");
const settingsPatchSchema = z
  .object({
    aiSummaryEnabled: z.boolean().optional(),
    chatbotEnabled: z.boolean().optional(),
    groupingEnabled: z.boolean().optional(),
    actionsEnabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no fields to update");

function deriveLabel(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface ModuleAggRow {
  key: string;
  label: string;
  enabled: boolean;
  last_seen_iso: string;
  total: string;
  suppressed: string;
  crit: string;
  high: string;
  normal: string;
  low: string;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/modules", { preHandler: requireAdmin }, async (_req, reply) => {
    const { rows } = await query<ModuleAggRow>(
      `SELECT m.key, m.label, m.enabled,
              to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS last_seen_iso,
              count(n.id) AS total,
              count(n.id) FILTER (WHERE n.suppressed) AS suppressed,
              count(n.id) FILTER (WHERE n.priority = 'critical') AS crit,
              count(n.id) FILTER (WHERE n.priority = 'high') AS high,
              count(n.id) FILTER (WHERE n.priority = 'normal') AS normal,
              count(n.id) FILTER (WHERE n.priority = 'low') AS low
         FROM modules m
         LEFT JOIN notifications n ON n.module = m.key
        GROUP BY m.key, m.label, m.enabled, m.last_seen_at
        ORDER BY m.last_seen_at DESC`,
    );
    return reply.code(200).send(
      rows.map((r) => ({
        key: r.key,
        label: r.label,
        enabled: r.enabled,
        lastSeenAt: r.last_seen_iso,
        total: Number(r.total),
        suppressed: Number(r.suppressed),
        byPriority: {
          critical: Number(r.crit),
          high: Number(r.high),
          normal: Number(r.normal),
          low: Number(r.low),
        },
      })),
    );
  });

  app.patch("/admin/modules/:key", { preHandler: requireAdmin }, async (req, reply) => {
    const params = moduleParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid module key" });
    const body = modulePatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });

    const exists = await query("SELECT 1 FROM modules WHERE key = $1", [params.data.key]);
    if (exists.rowCount === 0) return reply.code(404).send({ error: "module not found" });

    if (body.data.enabled !== undefined) {
      await query("UPDATE modules SET enabled = $2 WHERE key = $1", [
        params.data.key,
        body.data.enabled,
      ]);
    }
    if (body.data.label !== undefined) {
      const label =
        body.data.label.trim() === "" ? deriveLabel(params.data.key) : body.data.label.trim();
      await query("UPDATE modules SET label = $2 WHERE key = $1", [params.data.key, label]);
    }
    invalidatePolicyCache();
    return reply.code(204).send();
  });

  app.get("/admin/settings", { preHandler: requireAdmin }, async (_req, reply) => {
    return reply.code(200).send(await getFeatureFlags());
  });

  app.patch("/admin/settings", { preHandler: requireAdmin }, async (req, reply) => {
    const body = settingsPatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });
    const map: Record<string, string> = {
      aiSummaryEnabled: "ai_summary_enabled",
      chatbotEnabled: "chatbot_enabled",
      groupingEnabled: "grouping_enabled",
      actionsEnabled: "actions_enabled",
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      const v = (body.data as Record<string, boolean | undefined>)[k];
      if (v !== undefined) {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    sets.push("updated_at = now()");
    await query(`UPDATE global_settings SET ${sets.join(", ")} WHERE id = true`, vals);
    invalidatePolicyCache();
    return reply.code(204).send();
  });

  app.get("/settings/features", { preHandler: requireUser }, async (_req, reply) => {
    return reply.code(200).send(await getFeatureFlags());
  });
}
```

- [ ] **Step 4: Register in `server.ts`** — add the import and `await app.register(adminRoutes);` alongside the other registrations (where the "later tasks add admin routes here" comment is):

```ts
import { adminRoutes } from "./http/admin/routes";
// ...
await app.register(adminRoutes);
```

- [ ] **Step 5: Run to verify passing.** Run: `pnpm --filter @notifications/backend test -- admin`
      Expected: PASS.

- [ ] **Step 6: Docs.** Create `docs/api/admin.md` documenting all four `/admin/*` endpoints + `GET /settings/features` (method, auth, request/response shapes, 204/400/401/403). Delegate to the `docs-writer` subagent.

- [ ] **Step 7: Full backend suite + lint + security-review prep + commit.**

Run: `pnpm --filter @notifications/backend test && pnpm typecheck && pnpm lint`

```bash
git add backend/src/http/admin/routes.ts backend/src/server.ts backend/test/admin.test.ts docs/api/admin.md
git commit -m "feat(backend): admin modules + settings API and user feature-flag endpoint"
```

---

## Task 5: Frontend — api.patch, settings store, AI-band gating

**Files:**

- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/stores/settings.ts`
- Modify: `frontend/src/features/dashboard/DashboardLayout.vue`, `frontend/src/features/notifications/panel/InboxTab.vue`
- Test: `frontend/src/stores/settings.spec.ts`

**Interfaces:**

- Produces: `api.patch<T>(path, body?)`; `useSettingsStore()` → `{ flags: Ref<FeatureFlags>, loaded: Ref<boolean>, load(): Promise<void> }` with `FeatureFlags = { aiSummaryEnabled; chatbotEnabled; groupingEnabled; actionsEnabled }` (defaults all `true` before load).

- [ ] **Step 1: Add `patch` to `client.ts`.** After the `post` method:

```ts
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
```

- [ ] **Step 2: Write the failing store test** `frontend/src/stores/settings.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: getMock } }));
const { useSettingsStore } = await import("./settings");

describe("settings store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
  });

  it("defaults every flag to true before load", () => {
    const s = useSettingsStore();
    expect(s.flags.aiSummaryEnabled).toBe(true);
    expect(s.loaded).toBe(false);
  });

  it("loads flags from GET /settings/features", async () => {
    getMock.mockResolvedValueOnce({
      aiSummaryEnabled: false,
      chatbotEnabled: true,
      groupingEnabled: true,
      actionsEnabled: true,
    });
    const s = useSettingsStore();
    await s.load();
    expect(getMock).toHaveBeenCalledWith("/settings/features");
    expect(s.flags.aiSummaryEnabled).toBe(false);
    expect(s.loaded).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- settings`
      Expected: FAIL (module missing).

- [ ] **Step 4: Implement** `frontend/src/stores/settings.ts`:

```ts
import { reactive, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "@/api/client";

export interface FeatureFlags {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
}

/**
 * App-wide feature flags for UI gating (read by any user via GET /settings/features).
 * Admin edits them through the admin panel; this store only reads. Flags default to
 * enabled so the UI never hides a feature just because the fetch hasn't returned yet.
 */
export const useSettingsStore = defineStore("settings", () => {
  const flags = reactive<FeatureFlags>({
    aiSummaryEnabled: true,
    chatbotEnabled: true,
    groupingEnabled: true,
    actionsEnabled: true,
  });
  const loaded = ref(false);

  async function load(): Promise<void> {
    const data = await api.get<FeatureFlags>("/settings/features");
    Object.assign(flags, data);
    loaded.value = true;
  }

  return { flags, loaded, load };
});
```

- [ ] **Step 5: Load on dashboard mount.** In `frontend/src/features/dashboard/DashboardLayout.vue` `onMounted`, add alongside the existing feed lifecycle: `void useSettingsStore().load();` (import `useSettingsStore`). It must not block feed setup; fire-and-forget is fine (flags default true).

- [ ] **Step 6: Gate the AI band.** In `frontend/src/features/notifications/panel/InboxTab.vue`, import `useSettingsStore`, add `const settings = useSettingsStore();`, and wrap the AI-summary `<div class="m-3 …">…</div>` in `<template v-if="settings.flags.aiSummaryEnabled">…</template>` (or add `v-if` to the div).

- [ ] **Step 7: Test the gating** — add to `frontend/src/features/notifications/panel/InboxTab.spec.ts` a case mounting with `useSettingsStore().flags.aiSummaryEnabled = false` and asserting the AI-summary button (`aria-controls="ai-summary-detail"`) is absent. (Reuse the file's existing pinia/mount setup.)

- [ ] **Step 8: Run tests + lint + commit.**

Run: `pnpm --filter @notifications/frontend test && pnpm typecheck && pnpm lint`

```bash
git add frontend/src/api/client.ts frontend/src/stores/settings.ts frontend/src/features/dashboard/DashboardLayout.vue frontend/src/features/notifications/panel/InboxTab.vue frontend/src/stores/settings.spec.ts frontend/src/features/notifications/panel/InboxTab.spec.ts
git commit -m "feat(frontend): feature-flag settings store + AI-band gating + api.patch"
```

---

## Task 6: Frontend — /admin route, guard, AdminView shell, sidebar wiring

**Files:**

- Modify: `frontend/src/router/index.ts`, `frontend/src/features/dashboard/components/DashboardSidebar.vue`
- Create: `frontend/src/features/admin/AdminView.vue`
- Test: `frontend/src/features/admin/AdminView.spec.ts` (+ a router-guard assertion)

**Interfaces:**

- Produces: named route `admin` at `/admin` (child of the dashboard layout) with `meta.requiresAdmin`; `AdminView.vue` renders the layout-C sub-nav (`Modules` / `Features` + dimmed `AI config` / `Audit`) and switches the active panel via a local `ref<"modules" | "features">`.

- [ ] **Step 1: Add the guarded route.** In `frontend/src/router/index.ts`, add a child of `/`:

```ts
{ path: "admin", name: "admin", component: () => import("@/features/admin/AdminView.vue"), meta: { requiresAdmin: true } },
```

And extend `router.beforeEach`, after the auth check:

```ts
if (to.meta.requiresAdmin && !session.isAdmin) {
  return { name: "dashboard" };
}
```

- [ ] **Step 2: Wire the sidebar entry.** In `frontend/src/features/dashboard/components/DashboardSidebar.vue`, replace the disabled placeholder `<div v-if="session.isAdmin" … title="Admin console — a separate app, coming later">…</div>` block with a `RouterLink` styled like the `Dashboard` link (active accent state), dropping the "Soon" badge:

```vue
<RouterLink
  v-if="session.isAdmin"
  :to="{ name: 'admin' }"
  class="mt-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
  active-class="bg-accent/10 text-accent"
>
  <Icon :icon="ShieldCheck" :size="16" />
  Admin
</RouterLink>
```

(Match the exact class strings the `Dashboard` `RouterLink` uses in this file for consistency; the above mirrors them.)

- [ ] **Step 3: Implement `AdminView.vue`** (layout-C shell):

```vue
<script setup lang="ts">
import { ref } from "vue";
import Icon from "@/components/ui/Icon.vue";
import { Boxes, ToggleRight, Sparkles, ScrollText } from "@lucide/vue";
import ModulesPanel from "./ModulesPanel.vue";
import FeaturesPanel from "./FeaturesPanel.vue";

type Section = "modules" | "features";
const section = ref<Section>("modules");
const items: { id: Section; label: string; icon: typeof Boxes }[] = [
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "features", label: "Features", icon: ToggleRight },
];
</script>

<template>
  <div class="flex h-full min-h-0">
    <nav class="w-44 shrink-0 border-r border-line p-4" aria-label="Admin sections">
      <h1 class="mb-3 font-display text-[18px] font-medium text-text">Admin</h1>
      <button
        v-for="it in items"
        :key="it.id"
        type="button"
        class="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-100"
        :class="
          section === it.id
            ? 'bg-accent/10 text-accent'
            : 'text-muted hover:bg-sunken hover:text-text'
        "
        :aria-current="section === it.id ? 'page' : undefined"
        @click="section = it.id"
      >
        <Icon :icon="it.icon" :size="15" /> {{ it.label }}
      </button>
      <div class="mt-2 border-t border-line pt-2">
        <div
          class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint"
          title="Coming in a later week"
        >
          <Icon :icon="Sparkles" :size="15" /> AI config
        </div>
        <div
          class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint"
          title="Coming in a later week"
        >
          <Icon :icon="ScrollText" :size="15" /> Audit
        </div>
      </div>
    </nav>
    <div class="min-w-0 flex-1 overflow-y-auto p-6">
      <ModulesPanel v-if="section === 'modules'" />
      <FeaturesPanel v-else />
    </div>
  </div>
</template>
```

- [ ] **Step 4: Write a test** `frontend/src/features/admin/AdminView.spec.ts` — mount `AdminView` (with stubbed child panels via `global.stubs`) and assert clicking "Features" switches `aria-current`; and a router guard unit test asserting a non-admin session is redirected from `admin` to `dashboard` (mount the router or call the guard logic). Keep child panels stubbed to avoid their fetches:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import AdminView from "./AdminView.vue";

describe("AdminView", () => {
  beforeEach(() => setActivePinia(createPinia()));
  it("switches sections", async () => {
    const wrapper = mount(AdminView, {
      global: { stubs: { ModulesPanel: true, FeaturesPanel: true } },
    });
    const buttons = wrapper.findAll("nav button");
    expect(buttons[0]?.attributes("aria-current")).toBe("page");
    await buttons[1]?.trigger("click");
    expect(buttons[1]?.attributes("aria-current")).toBe("page");
  });
});
```

- [ ] **Step 5: Run + lint + commit.**

Run: `pnpm --filter @notifications/frontend test -- AdminView && pnpm typecheck && pnpm lint`

```bash
git add frontend/src/router/index.ts frontend/src/features/dashboard/components/DashboardSidebar.vue frontend/src/features/admin/AdminView.vue frontend/src/features/admin/AdminView.spec.ts
git commit -m "feat(frontend): guarded /admin route + layout-C shell + sidebar entry"
```

(Note: this task references `ModulesPanel`/`FeaturesPanel` which land in Tasks 7–8. Until then the app won't compile the imports — so implement Task 6 and Task 7/8 together, or create empty stub SFCs for the two panels in this task and flesh them out next. Recommended: create minimal placeholder SFCs here that Task 7/8 replace.)

---

## Task 7: Frontend — ModulesPanel (filter, sort, inline rename, toggle)

**Files:**

- Create: `frontend/src/features/admin/adminApi.ts`, `frontend/src/features/admin/ModulesPanel.vue`
- Test: `frontend/src/features/admin/ModulesPanel.spec.ts`

**Interfaces:**

- Consumes: `api.get`/`api.patch`; `priorityDotClass`, `priorityLabel` from `@/design/tokens`; `relativeTime` from `@/lib/time`; `Chip`, `Spinner`, `StatePanel`, `Icon` from `@/components/ui/*`.
- Produces: `AdminModule` type + `fetchModules()`, `patchModule(key, body)` in `adminApi.ts`.

- [ ] **Step 1: Implement `adminApi.ts`:**

```ts
import { api } from "@/api/client";
import type { NotificationPriority } from "@notifications/shared";

export interface AdminModule {
  key: string;
  label: string;
  enabled: boolean;
  lastSeenAt: string;
  total: number;
  suppressed: number;
  byPriority: Record<NotificationPriority, number>;
}

export function fetchModules(): Promise<AdminModule[]> {
  return api.get<AdminModule[]>("/admin/modules");
}

export function patchModule(
  key: string,
  body: { enabled?: boolean; label?: string },
): Promise<void> {
  return api.patch<void>(`/admin/modules/${encodeURIComponent(key)}`, body);
}
```

- [ ] **Step 2: Write the failing test** `frontend/src/features/admin/ModulesPanel.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: getMock, patch: patchMock } }));
const { default: ModulesPanel } = await import("./ModulesPanel.vue");

const mods = [
  {
    key: "dsar",
    label: "Dsar",
    enabled: true,
    lastSeenAt: "2026-07-16T00:00:00.000000Z",
    total: 5,
    suppressed: 0,
    byPriority: { critical: 1, high: 2, normal: 2, low: 0 },
  },
  {
    key: "billing",
    label: "Billing",
    enabled: true,
    lastSeenAt: "2026-07-16T00:00:00.000000Z",
    total: 2,
    suppressed: 0,
    byPriority: { critical: 0, high: 0, normal: 2, low: 0 },
  },
];

describe("ModulesPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue(mods);
    patchMock.mockResolvedValue(undefined);
  });

  it("filters to modules emitting the selected priority", async () => {
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).toContain("Billing");
    await wrapper.get('[data-test="filter-critical"]').trigger("click");
    expect(wrapper.text()).toContain("Dsar");
    expect(wrapper.text()).not.toContain("Billing"); // billing has 0 critical
  });

  it("toggling a module PATCHes enabled optimistically", async () => {
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    await wrapper.get('[data-test="toggle-dsar"]').trigger("click");
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", { enabled: false });
  });

  it("shows an empty state when there are no modules", async () => {
    getMock.mockResolvedValueOnce([]);
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("No modules yet");
  });

  it("renames a label inline on Enter", async () => {
    const wrapper = mount(ModulesPanel);
    await flushPromises();
    await wrapper.get('[data-test="rename-dsar"]').trigger("click");
    const input = wrapper.get('[data-test="rename-input-dsar"]');
    await input.setValue("DSAR (Requests)");
    await input.trigger("keydown.enter");
    expect(patchMock).toHaveBeenCalledWith("/admin/modules/dsar", { label: "DSAR (Requests)" });
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- ModulesPanel`
      Expected: FAIL (component missing).

- [ ] **Step 4: Implement `ModulesPanel.vue`.** Requirements the tests + spec pin down: fetch on mount (loading via `Spinner`, error via `StatePanel` + retry, empty via `StatePanel` "No modules yet — they'll appear here once a source publishes"); a toolbar with priority filter `Chip`s (`data-test="filter-<priority>"`, plus an "All"/clear) and a sort `<select>` (`Critical first` / `Total volume` / `Recently active` / `Name`); a table row per module with the priority dot, label + mono key + relative last-seen, a `byPriority` mini-breakdown (mono, `tabular-nums`), the total, a `suppressed` count on disabled rows, an enable/disable toggle (`data-test="toggle-<key>"`, optimistic `patchModule` with revert-on-failure), and inline rename (`data-test="rename-<key>"` pencil → `data-test="rename-input-<key>"` input, Enter/blur saves via `patchModule({label})`, Esc reverts; empty submit sends `{ label: "" }`). Filtering: `m.byPriority[p] > 0`. Sort as specified in the spec. Use `priorityDotClass`/`priorityLabel`, `relativeTime`. Full component:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { NotificationPriority } from "@notifications/shared";
import { NOTIFICATION_PRIORITIES } from "@notifications/shared";
import Chip from "@/components/ui/Chip.vue";
import Icon from "@/components/ui/Icon.vue";
import Spinner from "@/components/ui/Spinner.vue";
import StatePanel from "@/components/ui/StatePanel.vue";
import { Boxes, Pencil } from "@lucide/vue";
import { priorityDotClass, priorityLabel } from "@/design/tokens";
import { relativeTime } from "@/lib/time";
import { fetchModules, patchModule, type AdminModule } from "./adminApi";

type Sort = "critical" | "total" | "recent" | "name";
const modules = ref<AdminModule[]>([]);
const status = ref<"loading" | "ready" | "error">("loading");
const priorityFilter = ref<NotificationPriority | null>(null);
const sort = ref<Sort>("critical");
const editingKey = ref<string | null>(null);
const draftLabel = ref("");

async function load(): Promise<void> {
  status.value = "loading";
  try {
    modules.value = await fetchModules();
    status.value = "ready";
  } catch {
    status.value = "error";
  }
}
onMounted(load);

const visible = computed(() => {
  let list = modules.value;
  const p = priorityFilter.value;
  if (p) list = list.filter((m) => m.byPriority[p] > 0);
  const by = sort.value;
  return [...list].sort((a, b) => {
    if (by === "critical")
      return b.byPriority.critical - a.byPriority.critical || b.total - a.total;
    if (by === "total") return b.total - a.total;
    if (by === "recent") return b.lastSeenAt.localeCompare(a.lastSeenAt);
    return a.label.localeCompare(b.label);
  });
});
function priorityCount(p: NotificationPriority): number {
  return modules.value.filter((m) => m.byPriority[p] > 0).length;
}

async function toggle(m: AdminModule): Promise<void> {
  const next = !m.enabled;
  m.enabled = next; // optimistic
  try {
    await patchModule(m.key, { enabled: next });
  } catch {
    m.enabled = !next; // revert
  }
}

function startRename(m: AdminModule): void {
  editingKey.value = m.key;
  draftLabel.value = m.label;
}
function cancelRename(): void {
  editingKey.value = null;
}
async function commitRename(m: AdminModule): Promise<void> {
  if (editingKey.value !== m.key) return;
  const prev = m.label;
  const value = draftLabel.value.trim();
  editingKey.value = null;
  m.label = value === "" ? m.key : value; // optimistic (server re-derives on empty)
  try {
    await patchModule(m.key, { label: value });
    if (value === "") await load(); // pull the server-derived label
  } catch {
    m.label = prev;
  }
}
</script>

<template>
  <section>
    <h2 class="font-display text-[16px] font-medium text-text">Modules</h2>
    <p class="mt-0.5 text-[12px] text-muted">
      Sources that have published notifications. Disable one to stop it reaching anyone — existing
      items stay; new ones are recorded but suppressed.
    </p>

    <div v-if="status === 'loading'" class="flex justify-center py-10"><Spinner :size="18" /></div>

    <StatePanel
      v-else-if="status === 'error'"
      :icon="Boxes"
      title="Couldn't load modules"
      description="Something went wrong fetching the module list."
    >
      <button type="button" class="text-[12px] font-semibold text-accent" @click="load">
        Try again
      </button>
    </StatePanel>

    <StatePanel
      v-else-if="modules.length === 0"
      :icon="Boxes"
      title="No modules yet"
      description="They'll appear here once a source publishes a notification."
    />

    <template v-else>
      <div class="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip :active="priorityFilter === null" @click="priorityFilter = null">All</Chip>
        <Chip
          v-for="p in NOTIFICATION_PRIORITIES"
          :key="p"
          :active="priorityFilter === p"
          :data-test="`filter-${p}`"
          @click="priorityFilter = priorityFilter === p ? null : p"
        >
          {{ priorityLabel[p] }}
          <span class="font-mono text-[11px] opacity-70">{{ priorityCount(p) }}</span>
        </Chip>
        <label class="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          Sort
          <select
            v-model="sort"
            class="rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] text-text"
          >
            <option value="critical">Critical first</option>
            <option value="total">Total volume</option>
            <option value="recent">Recently active</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>

      <div
        class="mt-3 flex items-center gap-3 border-b border-line pb-1.5 font-mono text-[9px] uppercase tracking-wide text-faint"
      >
        <span class="flex-1">Module</span><span class="w-40">Priority mix</span
        ><span class="w-12 text-right">Total</span><span class="w-10 text-right">On</span>
      </div>

      <div
        v-for="m in visible"
        :key="m.key"
        class="flex items-center gap-3 border-b border-line py-2.5"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="priorityDotClass[m.enabled ? 'high' : 'low']"
              aria-hidden="true"
            />
            <template v-if="editingKey === m.key">
              <input
                v-model="draftLabel"
                :data-test="`rename-input-${m.key}`"
                class="rounded-md border border-accent bg-surface px-2 py-0.5 text-[13px] font-semibold text-text"
                @keydown.enter="commitRename(m)"
                @keydown.esc="cancelRename"
                @blur="commitRename(m)"
              />
            </template>
            <template v-else>
              <span class="truncate text-[13px] font-semibold text-text">{{ m.label }}</span>
              <button
                type="button"
                :data-test="`rename-${m.key}`"
                class="text-faint transition-colors duration-100 hover:text-text"
                aria-label="Rename module"
                @click="startRename(m)"
              >
                <Icon :icon="Pencil" :size="12" />
              </button>
            </template>
          </div>
          <div class="mt-0.5 font-mono text-[10px] text-faint">
            {{ m.key }} · {{ relativeTime(m.lastSeenAt) }}
          </div>
        </div>
        <div class="w-40 font-mono text-[10px] tabular-nums text-muted">
          <span v-if="m.byPriority.critical" class="mr-2 text-danger"
            >{{ m.byPriority.critical }} crit</span
          >
          <span v-if="m.byPriority.high" class="mr-2 text-warning"
            >{{ m.byPriority.high }} high</span
          >
          <span>{{ m.byPriority.normal + m.byPriority.low }} other</span>
          <span v-if="!m.enabled && m.suppressed" class="ml-2 text-warning"
            >· {{ m.suppressed }} suppressed</span
          >
        </div>
        <div class="w-12 text-right font-mono text-[12px] font-semibold tabular-nums text-text">
          {{ m.total }}
        </div>
        <div class="w-10 text-right">
          <button
            type="button"
            role="switch"
            :aria-checked="m.enabled"
            :aria-label="`${m.enabled ? 'Disable' : 'Enable'} ${m.label}`"
            :data-test="`toggle-${m.key}`"
            class="relative inline-block h-[18px] w-[32px] rounded-full transition-colors duration-100"
            :class="m.enabled ? 'bg-accent' : 'bg-line-strong'"
            @click="toggle(m)"
          >
            <span
              class="absolute top-0.5 size-[14px] rounded-full bg-white transition-all duration-100"
              :class="m.enabled ? 'right-0.5' : 'left-0.5'"
            />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
```

- [ ] **Step 5: Run to verify passing.** Run: `pnpm --filter @notifications/frontend test -- ModulesPanel`
      Expected: PASS (4 tests).

- [ ] **Step 6: Lint + commit.**

```bash
git add frontend/src/features/admin/adminApi.ts frontend/src/features/admin/ModulesPanel.vue frontend/src/features/admin/ModulesPanel.spec.ts
git commit -m "feat(frontend): admin ModulesPanel with priority filter, sort, inline rename, toggle"
```

---

## Task 8: Frontend — FeaturesPanel via FormRenderer (switch field)

**Files:**

- Modify: `frontend/src/forms/types.ts`, `frontend/src/forms/FormRenderer.vue`
- Create: `frontend/src/forms/fields/SwitchField.vue`, `frontend/src/forms/features.form.ts`, `frontend/src/features/admin/FeaturesPanel.vue`
- Test: `frontend/src/features/admin/FeaturesPanel.spec.ts`

**Interfaces:**

- Extends the shared form system with `type: "switch"` and an optional `hint?: string` on `FormField`; `FeaturesPanel` renders `featuresForm` via `FormRenderer`, seeds values from `GET /admin/settings`, and `PATCH`es changed flags. **Read the `json-form-conventions` skill first.**

- [ ] **Step 1: Extend `FormField`.** In `frontend/src/forms/types.ts` add `"switch"` to `FieldType` and add `hint?: string;` to `FormField`.

- [ ] **Step 2: Create `SwitchField.vue`** `frontend/src/forms/fields/SwitchField.vue` — a boolean toggle matching the design system (mirror the switch markup from `ModulesPanel`), with `modelValue: boolean`, emits `update:modelValue`, renders `label` + optional `hint`. Full:

```vue
<script setup lang="ts">
defineProps<{ label: string; hint?: string; modelValue: boolean; name: string }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <div class="flex items-start gap-3 border-b border-line py-3">
    <div class="min-w-0 flex-1">
      <div class="text-[12.5px] font-semibold text-text">{{ label }}</div>
      <div v-if="hint" class="mt-0.5 text-[11px] leading-relaxed text-faint">{{ hint }}</div>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      :data-test="`switch-${name}`"
      class="relative mt-0.5 inline-block h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-100"
      :class="modelValue ? 'bg-accent' : 'bg-line-strong'"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span
        class="absolute top-0.5 size-[14px] rounded-full bg-white transition-all duration-100"
        :class="modelValue ? 'right-0.5' : 'left-0.5'"
      />
    </button>
  </div>
</template>
```

- [ ] **Step 3: Render `switch` in `FormRenderer.vue`.** Add a branch: when `field.type === "switch"`, render `<SwitchField :name :label :hint :model-value="values[field.name] === true" @update:model-value="v => values[field.name] = v" />`. Follow the file's existing field-dispatch pattern (import `SwitchField`). Boolean fields are not validated by the login zod path; ensure `buildSchema` treats a `switch` as `z.boolean()` (or is skipped) so submit isn't blocked.

- [ ] **Step 4: Create `features.form.ts`:**

```ts
import type { FormSchema } from "./types";

export const featuresForm: FormSchema = {
  id: "features",
  fields: [
    {
      name: "aiSummaryEnabled",
      label: "AI summary",
      type: "switch",
      hint: "Show the AI digest band in the notification panel. Live now — off hides it for everyone.",
    },
    {
      name: "chatbotEnabled",
      label: "AI chatbot",
      type: "switch",
      hint: "The Ask-AI assistant tab. Persists now; takes effect when the assistant ships (Week 3).",
    },
    {
      name: "groupingEnabled",
      label: "Grouping",
      type: "switch",
      hint: "Collapse related notifications into one grouped card (Week 4).",
    },
    {
      name: "actionsEnabled",
      label: "Actions",
      type: "switch",
      hint: "Allow module action buttons on notification cards (Week 4).",
    },
  ],
  submitLabel: "Save changes",
};
```

- [ ] **Step 5: Write the failing test** `frontend/src/features/admin/FeaturesPanel.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: getMock, patch: patchMock } }));
const { default: FeaturesPanel } = await import("./FeaturesPanel.vue");

describe("FeaturesPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue({
      aiSummaryEnabled: true,
      chatbotEnabled: false,
      groupingEnabled: true,
      actionsEnabled: true,
    });
    patchMock.mockResolvedValue(undefined);
  });

  it("seeds switches from GET /admin/settings and saves changes via PATCH", async () => {
    const wrapper = mount(FeaturesPanel);
    await flushPromises();
    expect(getMock).toHaveBeenCalledWith("/admin/settings");
    const aiSwitch = wrapper.get('[data-test="switch-aiSummaryEnabled"]');
    expect(aiSwitch.attributes("aria-checked")).toBe("true");
    await aiSwitch.trigger("click");
    await wrapper.get('button[type="submit"]').trigger("click");
    expect(patchMock).toHaveBeenCalledWith(
      "/admin/settings",
      expect.objectContaining({ aiSummaryEnabled: false }),
    );
  });
});
```

- [ ] **Step 6: Run to verify it fails.** Run: `pnpm --filter @notifications/frontend test -- FeaturesPanel`
      Expected: FAIL.

- [ ] **Step 7: Implement `FeaturesPanel.vue`:**

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "@/api/client";
import FormRenderer from "@/forms/FormRenderer.vue";
import type { FormValues } from "@/forms/types";
import { featuresForm } from "@/forms/features.form";
import type { FeatureFlags } from "@/stores/settings";

const initial = ref<FormValues>({});
const ready = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  const flags = await api.get<FeatureFlags>("/admin/settings");
  initial.value = { ...flags };
  ready.value = true;
});

async function onSubmit(values: FormValues): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    await api.patch<void>("/admin/settings", values);
  } catch {
    error.value = "Couldn't save. Try again.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section>
    <h2 class="font-display text-[16px] font-medium text-text">Features</h2>
    <p class="mt-0.5 mb-3 text-[12px] text-muted">Turn platform features on or off for everyone.</p>
    <FormRenderer
      v-if="ready"
      :schema="featuresForm"
      :initial-values="initial"
      :submitting="saving"
      :error="error"
      @submit="onSubmit"
    />
  </section>
</template>
```

(Note: `FormRenderer` may not currently accept `initial-values`; if not, add an `initialValues?: FormValues` prop to `FormRenderer` that seeds its internal `values` ref on mount. Confirm against the current `FormRenderer.vue` and extend minimally.)

- [ ] **Step 8: Run + full suite + lint + commit.**

Run: `pnpm --filter @notifications/frontend test && pnpm typecheck && pnpm lint`

```bash
git add frontend/src/forms/types.ts frontend/src/forms/FormRenderer.vue frontend/src/forms/fields/SwitchField.vue frontend/src/forms/features.form.ts frontend/src/features/admin/FeaturesPanel.vue frontend/src/features/admin/FeaturesPanel.spec.ts
git commit -m "feat(frontend): admin FeaturesPanel via FormRenderer switch field"
```

---

## Task 9: e2e — Week-2 admin demo

**Files:**

- Create: `frontend/e2e/admin.spec.ts`

**Interfaces:**

- Consumes: seeded admin creds (`admin` / `notify-dev-2026`); `POST /internal/publish` (header `x-internal-token`); the `/admin` route, module toggle (`[data-test="toggle-<key>"]`), and the feed.

- [ ] **Step 1: Write the e2e** `frontend/e2e/admin.spec.ts` — mirror the login + publish helpers from `frontend/e2e/feed.spec.ts` (dev creds, `INTERNAL_INTAKE_TOKEN`, `POST /internal/publish`). Tests:

```ts
import { expect, test } from "@playwright/test";
// reuse the login() + BACKEND + token pattern from feed.spec.ts

test.describe("admin", () => {
  test("a disabled module's notifications stop appearing in the feed", async ({
    page,
    request,
  }) => {
    const token = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(token).not.toBe("");
    await login(page, "admin", "notify-dev-2026");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Ensure the module exists (publish once so it's discovered), then disable it.
    const mod = `e2e-admin-${Date.now()}`;
    await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": token, "content-type": "application/json" },
      data: {
        id: `${mod}-seed`,
        module: mod,
        title: "seed",
        description: "",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    // find the module row and disable it (the seed publish auto-discovered it)
    const toggle = page.locator(`[data-test="toggle-${mod}"]`);
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Publish again from the now-disabled module → it must not reach the feed.
    const hiddenTitle = `Hidden ${Date.now()}`;
    await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": token, "content-type": "application/json" },
      data: {
        id: `${mod}-hidden`,
        module: mod,
        title: hiddenTitle,
        description: "",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    // Give SSE a beat; assert the suppressed title never shows.
    await expect(page.getByRole("button", { name: hiddenTitle })).toHaveCount(0);
  });

  test("a non-admin cannot reach /admin", async ({ page }) => {
    await login(page, "priya", "notify-dev-2026"); // a seeded non-admin
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/); // guard redirected to dashboard
  });
});
```

- [ ] **Step 2: Run the e2e.** `docker compose up -d` + dev server running, then:

Run: `pnpm test:e2e -- admin`
Expected: both tests PASS. (If the toggle row isn't found, confirm the seed publish discovered the module — the `GET /admin/modules` list is newest-last-seen first.)

- [ ] **Step 3: Full suites + lint + commit.**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`

```bash
git add frontend/e2e/admin.spec.ts
git commit -m "test(frontend): e2e for admin module disable + non-admin guard"
```

---

## Definition of done / review gates

- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @notifications/frontend build` clean; `pnpm test` (backend + frontend) and `pnpm test:e2e` green.
- `security-reviewer` on the admin surface (admin authz on every `/admin/*` route, the user-readable `/settings/features`, parameterized SQL, no PII in logs).
- `frontend-design-reviewer` on `AdminView`/`ModulesPanel`/`FeaturesPanel`/`SwitchField` against the design system; `browser-tester` drives the disable→suppress demo + the console.
- `code-reviewer` after the change; `docs/api/admin.md` created and `docs/api/notifications.md` updated (api-documentation rule).
- The standing mentor gate still precedes the Week-2 PR; this slice adds a new admin API contract (flag to the mentor) but does not change the audience model.

## Self-review notes (plan vs spec)

- **Spec coverage:** entry point sidebar→/admin (T6) · layout C sub-nav (T6) · auto-discovery FR-7 (T2) · policy suppression option-A (T3) · in-memory cache + invalidation (T3/T4) · modules list w/ priority-mix + suppressed (T4/T7) · priority filter + sort (T7) · inline label rename incl. re-derive on empty (T4/T7) · Features kill-switches via FormRenderer w/ Live/Wk-N hints (T8) · ai_summary wired now for all users (T5, via GET /settings/features) · empty state (T7) · error/optimistic-revert (T5/T7/T8) · admin authz 401/403 (T4/T6/T9) · migration + suppressed exclusion (T1/T3) · docs (T3/T4) · tests + e2e (each task + T9). No audit log, no rate-limit, no per-module overrides (all non-goals).
- **Necessary refinements beyond the spec's literal text (flag to user):** (1) added `GET /settings/features` (`requireUser`) so non-admins can read the flag that gates their UI — the spec named only admin-only settings endpoints; (2) added `api.patch` to the client and a reusable `switch` field type to `FormRenderer` — prerequisites the spec assumed but the codebase lacked.
- **Type consistency:** `FeatureFlags` shape identical across `policy.ts`, `settings.ts`, `adminApi`/`features.form`; `AdminModule.byPriority` is `Record<NotificationPriority, number>` matching the backend aggregate keys (critical/high/normal/low); `patchModule` body `{ enabled?, label? }` matches `modulePatchSchema`; toggle/rename `data-test` hooks match the specs.
- **Sequencing caveat:** T6 imports the T7/T8 panels — implement T6 with minimal placeholder SFCs (noted in T6 Step 6) that T7/T8 replace, so the app compiles at each task boundary.
