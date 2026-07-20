# Module Catalog + Action/Card Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn modules into a fixed seeded catalog (reject unknown at intake), trim the admin ModulesPanel, make notification-action UI behavior key off an explicit `kind` (not HTTP method), and replace the card's priority dot with a read/unread toggle icon plus colored priority text.

**Architecture:** Backend is Fastify + `pg` + zod; the intake pipeline is `validate → resolve module → persist → deliver`. The change swaps auto-discovery for a seeded `modules` table and a policy-cached known-module check. Frontend is Vue 3 `<script setup>` + Pinia + Tailwind v4; the card and admin panel are the only UI touched. The shared zod contract in `packages/shared` gains one field (`kind`).

**Tech Stack:** TypeScript (strict), Fastify, PostgreSQL, zod, Vue 3, Pinia, Vitest, Playwright.

## Global Constraints

- TypeScript strict everywhere; `pnpm lint` and `pnpm typecheck` clean before any task is "done".
- New/changed logic carries a Vitest test in the same task (`testing.md`).
- zod stays the intake boundary; all SQL parameterized (`security.md`).
- No AI-attribution commit trailers (no "Generated with AI" / "Co-Authored-By: AI").
- Conventional Commits (`feat:`/`fix:`/`refactor:`/`docs:`).
- Two contract changes (unknown-module rejection at intake; action `kind`) require a `docs/api` update via the **docs-writer** subagent — Task 10.
- Module seed catalog (exact keys → labels): `dsr → "DSR"`, `access-governance → "Access Governance"`, `data-mapping → "Data Mapping"`, `assessments → "Assessments"`.
- Action `kind` values: `["link", "dispatch"]`, optional, **default `"link"`**. `link` opens a new tab; `dispatch` is stubbed ("coming soon"). Both still mark the notification read.
- Branch: `feat/module-catalog-and-affordances` (already created; spec committed at `docs/superpowers/specs/2026-07-20-module-catalog-and-affordances-design.md`).

**Test prerequisites (backend):** Postgres must be running — `docker compose up -d`. Backend tests call `migrate()` in `beforeAll`, so a new migration is picked up automatically. Single-file runs: `pnpm --filter @notifications/backend exec vitest run <path>`. Frontend single-file: `pnpm --filter @notifications/frontend exec vitest run <path>`.

---

## Unit 2 — Admin ModulesPanel cleanup

### Task 1: Drop `label` from the module PATCH contract (backend)

**Files:**

- Modify: `backend/src/http/admin/routes.ts:5` (drop `deriveLabel` import), `:9-11` (patch schema), `:84-88` (label update block)
- Test: `backend/test/admin.test.ts`

**Interfaces:**

- Produces: `PATCH /admin/modules/:key` now accepts body `{ enabled: boolean }` only; a `label` field is ignored/rejected.

- [ ] **Step 1: Find the admin PATCH-label test and assert the new behavior**

In `backend/test/admin.test.ts`, locate any test that PATCHes a module `label` (search for `label`). Replace its expectation so that a body containing only `label` is a 400 ("no fields to update" / "invalid request body"), and that `{ enabled }` still succeeds (204). If no label-PATCH test exists, add:

```ts
it("ignores a label in a module PATCH (label is no longer editable)", async () => {
  const cookie = await login("a_admin"); // reuse this file's existing admin-login helper + seeded key
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: { cookie },
    payload: { label: "Renamed" },
  });
  expect(res.statusCode).toBe(400); // body has no updatable field
});
```

(Use the file's actual admin-login helper name and a module key it already seeds/uses.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/admin.test.ts`
Expected: FAIL (label PATCH currently returns 204).

- [ ] **Step 3: Remove label handling from the route**

In `backend/src/http/admin/routes.ts`:

- Delete the import on line 5: `import { deriveLabel } from "../../pipeline/modules";`
- Change the patch schema (lines 9-11) to:

```ts
const modulePatchSchema = z.object({ enabled: z.boolean() });
```

- Delete the label update block (lines 84-88):

```ts
if (body.data.label !== undefined) {
  const trimmed = body.data.label.trim();
  const label = trimmed === "" ? deriveLabel(params.data.key) : trimmed;
  await query("UPDATE modules SET label = $2 WHERE key = $1", [params.data.key, label]);
}
```

- The remaining `if (body.data.enabled !== undefined)` guard can become an unconditional update since `enabled` is now required:

```ts
await query("UPDATE modules SET enabled = $2 WHERE key = $1", [params.data.key, body.data.enabled]);
```

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/admin.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/http/admin/routes.ts backend/test/admin.test.ts
git commit -m "refactor(admin): drop module label editing from the PATCH contract"
```

---

### Task 2: Remove the dot + rename flow from ModulesPanel (frontend)

**Files:**

- Modify: `frontend/src/features/admin/adminApi.ts:18-23` (patchModule body type)
- Modify: `frontend/src/features/admin/ModulesPanel.vue` (remove dot, rename state + handlers + template)
- Test: `frontend/src/features/admin/ModulesPanel.spec.ts`

**Interfaces:**

- Consumes: `patchModule(key, { enabled })` (Task 1 backend).
- Produces: ModulesPanel renders label as static text; no `data-test="rename-*"` / `rename-input-*` elements.

- [ ] **Step 1: Update the spec to the trimmed panel**

In `frontend/src/features/admin/ModulesPanel.spec.ts`:

- Delete the `"renames a label inline on Enter"` test entirely.
- Change the empty-state test's expected copy to the new text (see Step 3): `expect(wrapper.text()).toContain("No modules configured")`.
- Add:

```ts
it("renders the module label as static text (no rename control)", async () => {
  const wrapper = mount(ModulesPanel);
  await flushPromises();
  expect(wrapper.text()).toContain("Dsar");
  expect(wrapper.find('[data-test="rename-dsar"]').exists()).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/admin/ModulesPanel.spec.ts`
Expected: FAIL (rename control still present; old empty-state copy).

- [ ] **Step 3: Edit `ModulesPanel.vue`**

- Script: remove `Pencil` from the `@lucide/vue` import; remove the `editingKey`/`draftLabel` refs and the `startRename`/`cancelRename`/`commitRename` functions.
- Template: replace the label block (the `<template v-if="editingKey === m.key">…</template><template v-else>…</template>` around lines 159-181) with just:

```html
<span class="truncate text-[13px] font-semibold text-text">{{ m.label }}</span>
```

- Remove the enabled/disabled dot span (lines 154-158):

```html
<span
  class="size-1.5 shrink-0 rounded-full"
  :class="priorityDotClass[m.enabled ? 'high' : 'low']"
  aria-hidden="true"
/>
```

and drop `priorityDotClass` from the `@/design/tokens` import if it is now unused (keep `priorityLabel`, still used by the priority filter chips).

- Update the panel description (line ~88) and empty state (lines ~104-109) copy to a fixed-catalog framing:
  - Description: `The modules that can send notifications. Disable one to stop it reaching anyone — existing items stay; new ones are recorded but suppressed.`
  - Empty state title: `No modules configured` / description: `Modules are seeded in the database; none were returned.`

- [ ] **Step 4: Update `adminApi.ts`**

Change `patchModule` (lines 18-23) to:

```ts
export function patchModule(key: string, body: { enabled: boolean }): Promise<void> {
  return api.patch<void>(`/admin/modules/${encodeURIComponent(key)}`, body);
}
```

- [ ] **Step 5: Run spec + typecheck + lint**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/admin/ModulesPanel.spec.ts && pnpm --filter @notifications/frontend typecheck`
Expected: PASS, clean. Then check the admin e2e for rename usage: `grep -n "rename" frontend/e2e/admin.spec.ts` — if present, remove that interaction.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/admin/ModulesPanel.vue frontend/src/features/admin/adminApi.ts frontend/src/features/admin/ModulesPanel.spec.ts
git commit -m "refactor(admin): remove module rename flow and enabled dot from ModulesPanel"
```

---

## Unit 1 — Known-module catalog

### Task 3: Seed the catalog + policy known-module resolver

**Files:**

- Create: `backend/migrations/007_seed_modules.sql`
- Modify: `backend/src/pipeline/policy.ts:10-52` (PolicyState, load, add `resolveModule`)
- Test: `backend/test/policy.test.ts`

**Interfaces:**

- Produces: `resolveModule(key: string): Promise<{ known: boolean; enabled: boolean }>` in `policy.ts`. `isModuleEnabled` stays unchanged (still used by `simulate.ts`).

- [ ] **Step 1: Write the migration**

`backend/migrations/007_seed_modules.sql`:

```sql
-- The known module catalog. Modules are a fixed, known set for this internal tool; they are
-- no longer auto-discovered on first publish (see backend/src/pipeline/ingest.ts). A
-- notification whose `module` is not in this table is rejected at intake. Idempotent so
-- re-running the migration, or adding a module later, is safe.
INSERT INTO modules (key, label) VALUES
  ('dsr',               'DSR'),
  ('access-governance', 'Access Governance'),
  ('data-mapping',      'Data Mapping'),
  ('assessments',       'Assessments')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Write the failing policy test**

Append to `backend/test/policy.test.ts` (inside the `describe`):

```ts
it("resolveModule reports a seeded module as known", async () => {
  invalidatePolicyCache();
  expect(await resolveModule("dsr")).toEqual({ known: true, enabled: true });
});

it("resolveModule reports an unknown module as not known", async () => {
  invalidatePolicyCache();
  expect(await resolveModule("pol-nope")).toEqual({ known: false, enabled: true });
});

it("resolveModule reflects a disabled seeded module after invalidation", async () => {
  await query("INSERT INTO modules (key, label, enabled) VALUES ('pol-off2','Off',false)");
  invalidatePolicyCache();
  expect(await resolveModule("pol-off2")).toEqual({ known: true, enabled: false });
});
```

Add `resolveModule` to the import on line 5 and ensure the `beforeEach` cleanup line also clears `pol-off2` (it already deletes `pol-%`).

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/policy.test.ts`
Expected: FAIL ("resolveModule is not a function").

- [ ] **Step 4: Add `knownModules` + `resolveModule` in `policy.ts`**

- Add `knownModules: Set<string>;` to `interface PolicyState` (after line 11).
- In `load()` replace the disabled-only query (line 19) with one pass over the table:

```ts
const mods = await query<{ key: string; enabled: boolean }>("SELECT key, enabled FROM modules");
```

and in the returned object replace `disabledModules: new Set(...)` with:

```ts
    knownModules: new Set(mods.rows.map((r) => r.key)),
    disabledModules: new Set(mods.rows.filter((r) => !r.enabled).map((r) => r.key)),
```

- Add the resolver (after `isModuleEnabled`):

```ts
/** Known + enabled state for a module key, from the policy cache. Modules are a fixed,
 *  seeded catalog (migration 007) — an unknown key is rejected at intake, not auto-created. */
export async function resolveModule(key: string): Promise<{ known: boolean; enabled: boolean }> {
  const state = await get();
  return { known: state.knownModules.has(key), enabled: !state.disabledModules.has(key) };
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/policy.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/007_seed_modules.sql backend/src/pipeline/policy.ts backend/test/policy.test.ts
git commit -m "feat(modules): seed a fixed module catalog and add resolveModule to the policy cache"
```

---

### Task 4: Reject unknown modules at intake (+ fix test fallout)

**Files:**

- Modify: `backend/src/pipeline/ingest.ts` (whole body)
- Modify: `backend/src/pipeline/modules.ts` (replace `upsertModuleSeen`/`deriveLabel` with `touchModule`)
- Create: `backend/test/support.ts` (a `registerModule` fixture helper)
- Modify tests: `backend/test/modules.test.ts` (rewrite), `backend/test/pipeline.test.ts`, `backend/test/sse.test.ts`, `backend/test/maintenance.test.ts`, `backend/test/admin.test.ts`, `backend/test/simulate.test.ts`

**Interfaces:**

- Consumes: `resolveModule` (Task 3).
- Produces: `touchModule(key: string): Promise<void>` in `modules.ts`; `registerModule(key: string, enabled?: boolean): Promise<void>` in `backend/test/support.ts`. `ingest` returns `{ status: "invalid" }` for an unknown module (no persist, no deliver).

- [ ] **Step 1: Write the failing ingest test**

Append to `backend/test/pipeline.test.ts`'s `describe("ingest pipeline", …)`:

```ts
it("rejects a notification from an unknown module without persisting", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const before = await countRows("unknown-1");
  const result = await ingest(makeNotification("unknown-1", { module: "no-such-module" }));
  expect(result.status).toBe("invalid");
  expect(warn).toHaveBeenCalled();
  expect(await countRows("unknown-1")).toBe(before); // nothing persisted
  warn.mockRestore();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/pipeline.test.ts`
Expected: the new test FAILs (today `no-such-module` auto-discovers + persists → `accepted`). Note: other tests in this file also start failing because `test-module` is not seeded — that is expected and fixed in Step 5.

- [ ] **Step 3: Rewrite `modules.ts`**

Replace the entire contents of `backend/src/pipeline/modules.ts` with:

```ts
import { query } from "../db/pool";

/**
 * Bump a known module's `last_seen_at` (feeds the admin "recently active" sort). Update-only:
 * modules are a fixed, seeded catalog (migration 007), never auto-created — an unknown key is
 * a no-op here (0 rows updated) and is rejected upstream at intake.
 */
export async function touchModule(key: string): Promise<void> {
  await query("UPDATE modules SET last_seen_at = now() WHERE key = $1", [key]);
}
```

- [ ] **Step 4: Rewrite `ingest.ts`**

Replace `backend/src/pipeline/ingest.ts` body with:

```ts
import { deliveryHub } from "../delivery/hub";
import type { IngestResult } from "../intake/boundary";
import { touchModule } from "./modules";
import { persist } from "./persist";
import { resolveModule } from "./policy";
import { validate } from "./validate";

/**
 * The pipeline entry every transport calls: validate -> resolve module -> persist for one
 * notification. Malformed input and unknown modules are logged and returned as `invalid` —
 * never thrown — so a bad payload can't crash a batch or a stream consumer (NFR-3). Genuine
 * infrastructure errors propagate so the transport can 5xx / leave a stream message pending;
 * that's safe because persistence is idempotent on `id`.
 */
export async function ingest(raw: unknown): Promise<IngestResult> {
  const result = validate(raw);
  if (!result.ok) {
    console.warn(`[intake] rejected invalid notification (${result.error})`);
    return { status: "invalid" };
  }
  // Modules are a fixed, seeded catalog (migration 007). An unknown key is a bug in the
  // calling module, so reject + log it — never persist, never deliver.
  const { known, enabled } = await resolveModule(result.data.module);
  if (!known) {
    console.warn(`[intake] rejected notification from unknown module "${result.data.module}"`);
    return { status: "invalid" };
  }
  const status = await persist(result.data, !enabled);
  if (status === "accepted") {
    if (enabled) deliveryHub.broadcast(result.data);
    // Best-effort recency bump; a failure here must never abort an already-delivered notification.
    try {
      await touchModule(result.data.module);
    } catch (err) {
      console.error(`[intake] last_seen bump failed for ${result.data.module}`, err);
    }
  }
  return { status, id: result.data.id };
}
```

- [ ] **Step 5: Add the fixture helper and register test modules**

Create `backend/test/support.ts`:

```ts
import { query } from "../src/db/pool";

/**
 * Register a fixture module in the catalog so ingest() accepts it. Modules are a fixed, seeded
 * set (migration 007); a test that ingests a non-seeded module must register it first.
 */
export async function registerModule(key: string, enabled = true): Promise<void> {
  await query(
    "INSERT INTO modules (key, label, enabled) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    [key, key, enabled],
  );
}
```

Then register each non-seeded fixture module in the `beforeAll` of the files that ingest it:

- `backend/test/pipeline.test.ts`: after `await migrate();` add `await registerModule("test-module");` (import from `./support`).
- `backend/test/sse.test.ts`: in its `beforeAll` (near `migrate()`), add `await registerModule("test-module");`.
- `backend/test/maintenance.test.ts`: in `beforeAll` add `await registerModule("maint");`.
- `backend/test/admin.test.ts`: in its setup add `await registerModule("admin-dsar");`.
- `backend/test/simulate.test.ts`: add `await registerModule("sim-custom");` and, for the disabled-suppression case, `await registerModule("sim-disabled", false);` (if the test already inserts `sim-disabled` as disabled, leave that and only add `sim-custom`).

- [ ] **Step 6: Rewrite `modules.test.ts`**

Replace `backend/test/modules.test.ts` with a `touchModule` test:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { touchModule } from "../src/pipeline/modules";

describe("touchModule", () => {
  beforeAll(async () => migrate());
  afterAll(async () => closePool());

  it("bumps last_seen_at for a seeded module without inserting", async () => {
    await query("UPDATE modules SET last_seen_at = '2000-01-01T00:00:00Z' WHERE key = 'dsr'");
    await touchModule("dsr");
    const { rows } = await query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM modules WHERE key = 'dsr'",
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.last_seen_at).getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("is a no-op for an unknown key (inserts nothing)", async () => {
    await touchModule("touch-nonexistent");
    const { rowCount } = await query("SELECT 1 FROM modules WHERE key = 'touch-nonexistent'");
    expect(rowCount).toBe(0);
  });
});
```

- [ ] **Step 7: Run the full backend suite; register any stragglers**

Run: `pnpm --filter @notifications/backend test`
Expected: green. If any test still fails with an unknown-module rejection (an `ingest`/publish that returns `invalid` unexpectedly), add `await registerModule("<that-key>")` to that file's `beforeAll` using the Step-5 pattern, and re-run. Do NOT weaken the ingest check to make a test pass.

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm --filter @notifications/backend typecheck && pnpm lint`
Expected: clean. (If `deriveLabel`/`upsertModuleSeen` are referenced anywhere else, the typecheck will point to it — remove the usage.)

- [ ] **Step 9: Commit**

```bash
git add backend/src/pipeline/ingest.ts backend/src/pipeline/modules.ts backend/test/
git commit -m "feat(intake): reject notifications from unknown modules; replace auto-discovery with last_seen touch"
```

---

### Task 5: Maintenance "reset modules" re-enables instead of wiping

**Files:**

- Modify: `backend/src/http/admin/maintenance.ts:51-59` (reset handler)
- Test: `backend/test/maintenance.test.ts` (the `modules/reset` test, lines ~148-160)

**Interfaces:**

- Produces: `POST /admin/maintenance/modules/reset` re-enables every module (`UPDATE modules SET enabled = true`) and returns `{ updated }`; it no longer deletes rows.

- [ ] **Step 1: Rewrite the reset test**

In `backend/test/maintenance.test.ts`, replace the `modules/reset` half of the `"modules/reset clears discovered modules; settings/reset restores defaults"` test with re-enable semantics:

```ts
// modules/reset re-enables every seeded module (does NOT delete the catalog).
await query("UPDATE modules SET enabled = false WHERE key = 'dsr'");
const before = await query<{ c: string }>("SELECT count(*) AS c FROM modules");
const rm = await app.inject({
  method: "POST",
  url: "/admin/maintenance/modules/reset",
  headers: { cookie },
});
expect(rm.statusCode).toBe(200);
const after = await query<{ c: string }>("SELECT count(*) AS c FROM modules");
expect(Number(after.rows[0]!.c)).toBe(Number(before.rows[0]!.c)); // rows kept
const dsr = await query<{ enabled: boolean }>("SELECT enabled FROM modules WHERE key = 'dsr'");
expect(dsr.rows[0]!.enabled).toBe(true); // re-enabled
```

Rename the test title to `"modules/reset re-enables all modules; settings/reset restores defaults"`. Drop the `INSERT INTO modules ('maint-mod'…)` line and the `SELECT 1 FROM modules … toBe(0)` assertion.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/maintenance.test.ts`
Expected: FAIL (reset currently deletes → `dsr` row gone, count drops).

- [ ] **Step 3: Rewrite the reset handler**

In `backend/src/http/admin/maintenance.ts` replace the `modules/reset` handler body (lines 54-58) with:

```ts
    async (_req, reply) => {
      // Modules are a fixed catalog (migration 007) — "reset" re-enables all of them rather
      // than deleting the rows.
      const res = await query("UPDATE modules SET enabled = true WHERE enabled = false");
      invalidatePolicyCache();
      return reply.code(200).send({ updated: res.rowCount ?? 0 });
    },
```

- [ ] **Step 4: Check the frontend caller copy**

`resetModules()` in `adminApi.ts` types the response as `DeleteResult` (`{ deleted }`); the response is now `{ updated }`. Find its UI usage: `grep -rn "resetModules" frontend/src`. If the MaintenancePanel shows the returned count/label ("deleted"), update the response type to `{ updated: number }` and the label to "re-enabled"/"reset". Update `MaintenancePanel.spec.ts` if it asserts the old copy.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/maintenance.test.ts && pnpm --filter @notifications/frontend typecheck && pnpm --filter @notifications/backend typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/admin/maintenance.ts backend/test/maintenance.test.ts frontend/src/features/admin/
git commit -m "refactor(admin): reset-modules re-enables the seeded catalog instead of deleting it"
```

---

## Unit 3 — Action `kind` discriminator

### Task 6: Add `kind` to the shared action schema

**Files:**

- Modify: `packages/shared/src/notification.ts:24-58` (add `ACTION_KINDS`, `kind` field, type)
- Test: `packages/shared/test/notification.test.ts`

**Interfaces:**

- Produces: `ACTION_KINDS = ["link", "dispatch"] as const`, `type ActionKind`, and `actionSchema` with `kind: z.enum(ACTION_KINDS).default("link")`. Parsing an action without `kind` yields `kind: "link"`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/test/notification.test.ts`:

```ts
import { actionSchema } from "../src/notification";

describe("action kind", () => {
  it("defaults kind to 'link' when omitted", () => {
    const parsed = actionSchema.parse({ label: "Open", method: "GET", url: "https://app/x" });
    expect(parsed.kind).toBe("link");
  });

  it("accepts an explicit dispatch kind", () => {
    const parsed = actionSchema.parse({
      label: "Approve",
      method: "POST",
      url: "https://app/a",
      kind: "dispatch",
    });
    expect(parsed.kind).toBe("dispatch");
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      actionSchema.parse({ label: "X", method: "GET", url: "https://app/x", kind: "explode" }),
    ).toThrow();
  });
});
```

(Reuse the file's existing top-level `describe`/imports; add `actionSchema` to the import if the file already imports from `../src/notification`.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/shared test`
Expected: FAIL (`parsed.kind` is `undefined`).

- [ ] **Step 3: Add `kind` to the schema**

In `packages/shared/src/notification.ts`:

- After line 26 add: `export const ACTION_KINDS = ["link", "dispatch"] as const;`
- In `actionSchema` (lines 49-58) add a `kind` field and update the doc comment to say behavior keys off `kind`, not `method`; `navigate` is a future value:

```ts
export const actionSchema = z.object({
  label: z.string().min(1).max(100),
  // `kind` is the intent discriminator the UI branches on (NOT the HTTP method): "link" opens
  // the url in a new tab; "dispatch" runs a server-side action call (stubbed for now). Defaults
  // to "link" for back-compat. A future "navigate" value would route in-app.
  kind: z.enum(ACTION_KINDS).default("link"),
  method: z.enum(ACTION_METHODS),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), { message: "url must use http(s)" }),
  icon: z.string().min(1).max(100).optional(),
});
```

- After `export type ActionMethod` (line 90) add: `export type ActionKind = (typeof ACTION_KINDS)[number];`

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @notifications/shared test && pnpm --filter @notifications/shared typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/notification.ts packages/shared/test/notification.test.ts
git commit -m "feat(shared): add action kind discriminator (link|dispatch, default link)"
```

---

### Task 7: Tag preset/sample actions with `kind`

**Files:**

- Modify: `backend/src/sim/presets.ts:22-26` (SAMPLE_ACTIONS), `:54-61` (critical-dsr action), `:101-108` (low-assessment action)
- Test: `backend/test/presets.test.ts`

**Interfaces:**

- Consumes: `ActionKind` / the `kind` field (Task 6).
- Produces: every generated action carries an explicit `kind` (`Review`/`Open DSR`/`View assessments` → `link`; `Approve`/`Dismiss` → `dispatch`).

- [ ] **Step 1: Write the failing test**

Append to `backend/test/presets.test.ts`:

```ts
it("tags sample actions with an explicit kind (dispatch for POST-style actions)", () => {
  const byLabel = Object.fromEntries(SAMPLE_ACTIONS.map((a) => [a.label, a.kind]));
  expect(byLabel["Review"]).toBe("link");
  expect(byLabel["Approve"]).toBe("dispatch");
  expect(byLabel["Dismiss"]).toBe("dispatch");
});
```

(Ensure `SAMPLE_ACTIONS` is imported from `../src/sim/presets`.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/backend exec vitest run test/presets.test.ts`
Expected: FAIL (`a.kind` is `undefined` on the literals).

- [ ] **Step 3: Add `kind` to the preset action literals**

In `backend/src/sim/presets.ts`:

- `SAMPLE_ACTIONS` (lines 22-26):

```ts
export const SAMPLE_ACTIONS: NotificationAction[] = [
  {
    label: "Review",
    kind: "link",
    method: "GET",
    url: "https://app.example.com/review",
    icon: "external-link",
  },
  {
    label: "Approve",
    kind: "dispatch",
    method: "POST",
    url: "https://app.example.com/approve",
    icon: "check",
  },
  {
    label: "Dismiss",
    kind: "dispatch",
    method: "POST",
    url: "https://app.example.com/dismiss",
    icon: "x",
  },
];
```

- `critical-dsr` action (lines 54-61): add `kind: "link",` to the `Open DSR` action.
- `low-assessment` action (lines 101-108): add `kind: "link",` to the `View assessments` action.

Note: `NotificationAction` is the _output_ type (post-parse), so `kind` is required on these literals — that's why they must be set explicitly.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @notifications/backend exec vitest run test/presets.test.ts && pnpm --filter @notifications/backend typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sim/presets.ts backend/test/presets.test.ts
git commit -m "feat(sim): tag preset actions with explicit kind (link/dispatch)"
```

---

### Task 8: Branch the card action on `kind`, not HTTP method

**Files:**

- Modify: `frontend/src/features/notifications/panel/InboxTab.vue:35-44` (`onAction`)
- Test: `frontend/src/features/notifications/panel/InboxTab.spec.ts:60-86`

**Interfaces:**

- Consumes: `action.kind` (Task 6).
- Produces: `onAction` opens a tab for `kind: "link"`, logs a "coming soon" stub for `kind: "dispatch"`, and marks read in both cases.

- [ ] **Step 1: Update the tests**

In `frontend/src/features/notifications/panel/InboxTab.spec.ts`:

- Rename the existing test `"opens a new tab for a GET action surfaced on a card"` → `"opens a new tab for a link action"` and give its action an explicit `kind: "link"`:

```ts
        actions: [
          { label: "Open", kind: "link", method: "GET", url: "https://example.com", icon: "external-link" },
        ],
```

(The rest of that test is unchanged — it asserts `window.open` + `postMock("/notifications/a/read")`.)

- Add a dispatch test right after it:

```ts
it("does not open a tab for a dispatch action but still marks read", async () => {
  const feed = useFeedStore();
  feed.items = [
    feedItem({
      id: "a",
      read: false,
      actions: [
        { label: "Approve", kind: "dispatch", method: "POST", url: "https://example.com/a" },
      ],
    }),
  ];
  feed.status = "ready";
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  const wrapper = mount(InboxTab);
  await wrapper.get("h3 button").trigger("click");
  const btn = wrapper.findAll("button").find((b) => b.text().trim() === "Approve");
  await btn!.trigger("click");
  expect(openSpy).not.toHaveBeenCalled();
  expect(postMock).toHaveBeenCalledWith("/notifications/a/read");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/panel/InboxTab.spec.ts`
Expected: the dispatch test FAILs (today a POST logs but the test is new; confirm it fails because `onAction` still branches on `method`, and confirm the renamed link test passes).

- [ ] **Step 3: Rewrite `onAction`**

In `frontend/src/features/notifications/panel/InboxTab.vue` replace `onAction` (lines 35-44) with:

```ts
// A module action's `kind` (not its HTTP method) decides UI behavior. "link" opens the url in a
// new tab; "dispatch" will run through a server-side action proxy (a later cycle) — stubbed now.
// Firing any action also marks the notification read.
function onAction(action: NotificationAction, notification: FeedNotification) {
  feed.markRead(notification.id);
  if (action.kind === "link") {
    window.open(action.url, "_blank", "noopener,noreferrer");
  } else {
    console.info(`[actions] "${action.label}" (dispatch) — coming soon`);
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/panel/InboxTab.spec.ts && pnpm --filter @notifications/frontend typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/notifications/panel/InboxTab.vue frontend/src/features/notifications/panel/InboxTab.spec.ts
git commit -m "feat(feed): branch action behavior on kind instead of HTTP method"
```

---

## Unit 4 — Card read/unread icon + priority text

### Task 9: Replace the priority dot with a read/unread toggle and colored priority label

**Files:**

- Modify: `frontend/src/design/tokens.ts` (add `priorityTextClass`)
- Modify: `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue` (dot → toggle; right meta → priority label)
- Test: `frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts`

**Interfaces:**

- Consumes: `priorityLabel` (existing), new `priorityTextClass`.
- Produces: a `data-test="read-toggle"` button (aria-label `"Mark as read"` when unread, `"Mark as unread"` when read; emits `open` when unread, `unread` when read; never expands), and a `data-test="priority-label"` element colored by priority. Open-and-seen on the card body is unchanged.

- [ ] **Step 1: Add `priorityTextClass` to tokens**

In `frontend/src/design/tokens.ts`, after `priorityDotClass` (line ~17) add:

```ts
/** Priority → semantic text color for the card's priority label. */
export const priorityTextClass: Record<NotificationPriority, string> = {
  critical: "text-danger",
  high: "text-warning",
  normal: "text-muted",
  low: "text-faint",
};
```

- [ ] **Step 2: Update the card spec**

In `NotificationCardRenderer.spec.ts`:

- Delete the priority-dot assertions: any test/asserts referencing `role="img"` / `aria-label` containing "priority".
- Replace the `"offers Mark as unread only on a read card and emits unread"` test with read-toggle coverage:

```ts
it("shows a 'Mark as read' toggle on an unread card that emits open without expanding", async () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: withActions({ id: "a" }) }, // expandable, unread
  });
  const toggle = wrapper.get('[data-test="read-toggle"]');
  expect(toggle.attributes("aria-label")).toBe("Mark as read");
  await toggle.trigger("click");
  expect(wrapper.emitted("open")).toHaveLength(1);
  expect(wrapper.emitted("unread")).toBeUndefined();
  expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // did NOT expand
  expect(wrapper.get("h3 button").attributes("aria-expanded")).toBe("false");
});

it("shows a 'Mark as unread' toggle on a read card that emits unread", async () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "b", read: true }) },
  });
  const toggle = wrapper.get('[data-test="read-toggle"]');
  expect(toggle.attributes("aria-label")).toBe("Mark as unread");
  await toggle.trigger("click");
  expect(wrapper.emitted("unread")).toHaveLength(1);
});

it("renders the priority label in its semantic color", () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "a", priority: "critical" }) },
  });
  const label = wrapper.get('[data-test="priority-label"]');
  expect(label.text()).toBe("Critical");
  expect(label.classes()).toContain("text-danger");
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/renderers/NotificationCardRenderer.spec.ts`
Expected: FAIL (no `read-toggle` / `priority-label` yet).

- [ ] **Step 4: Edit the card**

In `NotificationCardRenderer.vue`:

- Script: import `Circle, CircleCheck` from `@lucide/vue` (alongside `ChevronDown`); import `priorityTextClass` from `@/design/tokens` (and drop `priorityDotClass` if unused now). Replace `markUnread` with:

```ts
function toggleRead() {
  // Explicit read-state toggle: marks read WITHOUT expanding (open-and-seen still lives on the
  // card body). Reuses the open/unread emits the parent maps to feed.markRead / feed.markUnread.
  if (item.value.read) emit("unread", item.value);
  else emit("open", item.value);
}
```

- Template: replace the priority dot span (lines 53-58) with the toggle button:

```html
<button
  type="button"
  data-test="read-toggle"
  class="mt-0.5 shrink-0 rounded-full transition-colors duration-100"
  :aria-label="item.read ? 'Mark as unread' : 'Mark as read'"
  @click.stop="toggleRead"
>
  <Icon
    :icon="item.read ? CircleCheck : Circle"
    :size="16"
    :class="item.read ? 'text-faint hover:text-muted' : 'fill-accent/20 text-accent'"
  />
</button>
```

- Template: in the meta row (lines 111-126) delete the `click to open` hint span and the `Mark as unread` button, and add the priority label as the right-hand element:

```html
<span
  data-test="priority-label"
  class="shrink-0 font-mono text-[11px] uppercase tracking-wide"
  :class="priorityTextClass[item.priority]"
>
  {{ priorityLabel[item.priority] }}
</span>
```

Keep the `<div class="flex min-w-0 flex-1 …">` module/category group to its left. Import `priorityLabel` from `@/design/tokens` (already imported).

- [ ] **Step 5: Run spec + typecheck + lint**

Run: `pnpm --filter @notifications/frontend exec vitest run src/features/notifications/renderers/NotificationCardRenderer.spec.ts && pnpm --filter @notifications/frontend typecheck && pnpm lint`
Expected: PASS, clean. Then run the whole frontend suite to catch neighbors that assumed the dot or the old mark-unread button: `pnpm --filter @notifications/frontend test` — fix any InboxTab/FeedList spec that referenced the removed `[data-test="mark-unread"]` by switching to `[data-test="read-toggle"]`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design/tokens.ts frontend/src/features/notifications/renderers/NotificationCardRenderer.vue frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts
git commit -m "feat(feed): replace card priority dot with a read/unread toggle and colored priority label"
```

- [ ] **Step 7: Browser verification**

Launch the app and confirm the card visually: the read/unread toggle reads as clickable and reflects state; the priority label is legible in its color. **Verify the `high` amber label clears WCAG AA at 11px on the ivory surface** (same check as the AI-label AA fix); if it dips below ~4.5:1, darken the `warning` usage for this label (a `text-[--darker-amber]` token) and note it. Use `/verify` or the `browser-tester` subagent.

---

## Docs

### Task 10: Update `docs/api` for the two contract changes

**Files:**

- Modify: `docs/api/` — the notifications/intake doc (unknown-module rejection) and the action shape (`kind`).

- [ ] **Step 1: Dispatch the docs-writer subagent**

Per `api-documentation.md`, delegate to the **docs-writer** subagent. Brief it with: (a) intake (`POST /internal/publish` and the `ingest` contract) now rejects a notification whose `module` is not in the seeded catalog (`dsr`, `access-governance`, `data-mapping`, `assessments`) — counted as `invalid` in the batch result, logged, not persisted; (b) the action object gained `kind: "link" | "dispatch"` (optional, defaults `link`) which drives client behavior instead of the HTTP method; (c) the admin module PATCH no longer accepts `label`; (d) `POST /admin/maintenance/modules/reset` now re-enables all modules and returns `{ updated }` instead of `{ deleted }`. Have it update the existing resource docs, not create per-endpoint files.

- [ ] **Step 2: Commit**

```bash
git add docs/api/
git commit -m "docs(api): module catalog rejection, action kind, admin module contract changes"
```

---

## Final verification (before finishing the branch)

1. Postgres up; `pnpm --filter @notifications/backend test`, `pnpm --filter @notifications/frontend test`, `pnpm --filter @notifications/shared test` all green.
2. `pnpm lint && pnpm typecheck` clean across the workspace.
3. `pnpm --filter @notifications/frontend exec playwright test` (admin + feed e2e) — fix any rename/dot/mark-unread selector fallout.
4. Reviews: `code-reviewer` (backend Units 1 + 3-shared), `security-reviewer` (Unit 1 — new intake rejection path on the publish contract), `frontend-design-reviewer` + `browser-tester` (Unit 4, glance at Unit 2).
5. Then `superpowers:finishing-a-development-branch` (mentor gate still applies to any push — nothing pushed yet).

## Self-review notes (coverage check)

- Spec Unit 1 → Tasks 3, 4, 5 (seed, reject+log, reset). ✅
- Spec Unit 2 → Tasks 1, 2 (PATCH label, panel dot+rename). ✅
- Spec Unit 3 → Tasks 6, 7, 8 (shared kind, presets, InboxTab). ✅
- Spec Unit 4 → Task 9 (toggle + priority text + tokens). ✅
- Contract-doc requirement → Task 10. ✅
- Type consistency: `resolveModule` returns `{ known, enabled }` (Task 3) and is consumed identically in Task 4; `touchModule` defined in Task 4's `modules.ts` and imported by `ingest.ts`; `kind`/`ActionKind` defined in Task 6 and consumed in Tasks 7 (`NotificationAction` literals) and 8 (`action.kind`); `priorityTextClass` defined and consumed in Task 9.
