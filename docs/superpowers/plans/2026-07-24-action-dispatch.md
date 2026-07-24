# Action Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn notification action buttons into a real server-mediated round-trip between a running module (`module-sim`) and the notification hub, replacing the stubbed `dispatch` path.

**Architecture:** The hub is a _uniform dispatcher_ — it never interprets an action. On click it forwards `{notification, action, metadata, actor}` to the owning module (resolved via the module's admin-registered `base_url` + the action's relative `path`) and relays the module's `{ok, message?, resolve?, actions?}` response, applying the effects. `packages/core` owns the dispatch logic and the DB registry read but stays env/identity-free; the reference `backend/` injects the concrete HTTP dispatcher (fetch + `MODULE_DISPATCH_TOKEN`). A new dev-only `packages/module-sim` runs the modules and serves a control center that replaces the admin generator.

**Tech Stack:** TypeScript (strict), Vue 3 + Vite (`packages/vue`), Fastify (`packages/server-fastify`, `backend`, `packages/module-sim`), PostgreSQL (`pg`), zod, Vitest, Playwright, pnpm workspaces.

## Global Constraints

- TypeScript strict everywhere; `any` requires an inline comment explaining why.
- Every task adds/updates a Vitest unit test; `pnpm lint`, `pnpm typecheck`, `pnpm build` must be clean before a task is "done."
- zod at every boundary (dispatch request, module response, emit API); parameterized SQL only.
- `packages/core` stays identity/env-free — `packages/core/src/pipeline/boundary.test.ts` MUST stay green. `base_url` is DB data (core may read it); the dispatch token is host-injected, never read in core.
- No secrets in code: `MODULE_DISPATCH_TOKEN`, `INTERNAL_INTAKE_TOKEN` come from env, validated at process startup; never committed. Non-secret config (module-sim port, seed base URLs) is env/migration, not code.
- PII-safe logging: never log the action `metadata` blob or the module's response body in full — log outcome only (status, module key, action label).
- SSRF is structurally prevented: action `path` is a clean relative path (starts `/`, no scheme/host/`..`); the host always comes from the DB registry, never the payload.
- `module-sim` + control center refuse to run under `NODE_ENV=production`.
- The 5 non-generator e2e specs (`feed`, `ai-chat`, `ai-summary`, `admin`, `qol`) MUST pass UNCHANGED. Only `generator.spec.ts` is replaced.
- Commits: Conventional Commits. **NEVER** add "Generated with AI" / "Co-Authored-By: AI" trailers.
- Prefer editing existing files/patterns over introducing new ones.
- New/changed API endpoints require a `docs/api/` update (delegate to `docs-writer`).
- **Mentor sign-off** on the §3 action contract and §4 response contract (spec) is required before merge. Do NOT open a PR or merge without it.

**Test commands (per package):**

- core: `pnpm --filter @notifications/core test`
- server-fastify: `pnpm --filter @notifications/server-fastify test`
- shared: `pnpm --filter @notifications/shared test`
- vue: `pnpm --filter @notifications/vue test`
- module-sim: `pnpm --filter @notifications/module-sim test`
- migrations: `pnpm --filter @notifications/backend migrate` (needs `docker compose up -d`)
- e2e: `pnpm test:e2e`

---

## File Structure

**Created**

- `backend/migrations/013_modules_base_url.sql` — add `modules.base_url` + dev seed.
- `backend/migrations/014_action_dispatches.sql` — durable dispatch records.
- `packages/core/src/action/store.ts` — idempotent `action_dispatches` repository.
- `packages/core/src/action/dispatch.ts` — `dispatchAction` orchestration + `ActionDispatcher` interface.
- `backend/src/reference/http-dispatcher.ts` — the injected HTTP `ActionDispatcher`.
- `packages/module-sim/*` — new dev-only Fastify app: modules, action handlers, emit API, control center static page.
- `frontend/e2e/dispatch.spec.ts` — control-center + dispatch e2e (replaces `generator.spec.ts`).

**Modified**

- `packages/shared/src/notification.ts` — `actionSchema` union + `moduleActionResponseSchema`.
- `packages/core/src/read/feed.ts` — tolerant action parsing (drop invalid, don't throw).
- `packages/core/src/types.ts` — `ModulePolicyView.baseUrl`, `ActionDispatchResult`.
- `packages/core/src/policy/store.ts` — `setModuleBaseUrl`, `base_url` in `listModules`.
- `packages/core/src/service.ts` — `setModuleBaseUrl`, `dispatchAction` on the service.
- `packages/server-fastify/src/routes/admin.ts` — `PATCH /admin/modules/:key` accepts `baseUrl`.
- `packages/server-fastify/src/routes/notifications.ts` — `POST /notifications/:id/actions/:ref/dispatch`.
- `packages/vue/src/admin/ModulesPanel.vue` — editable `base_url` field.
- `packages/vue/src/state/actions.ts` — dispatch round-trip + effects.
- `packages/vue/src/components/renderers/NotificationCardRenderer.vue` — dispatch buttons, gating, pending state.
- `packages/vue/src/components/panel/InboxTab.vue` — await async `runAction`.
- `packages/vue/src/forms/features.form.ts` — drop "coming soon" from `actionsEnabled`.
- `backend/src/config/env.ts` + `backend/src/server.ts` + `backend/src/reference/service.ts` — env var + wire dispatcher.
- `package.json` (root) — `dev` script launches module-sim.
- `docs/api/*` — dispatch endpoint + admin baseUrl.

**Deleted (Task 14)**

- `backend/src/http/admin/simulate.ts`, `packages/vue/src/admin/GeneratorPanel.vue`, `packages/vue/src/forms/{generator,burst,drip}.form.ts`, `frontend/e2e/generator.spec.ts`. (`backend/src/sim/*` moves into module-sim in Task 12.)

---

## Unit A — Shared contract + read resilience

### Task 1: `actionSchema` discriminated union + module response schema

**Files:**

- Modify: `packages/shared/src/notification.ts`
- Test: `packages/shared/src/notification.spec.ts` (create if absent; else append)

**Interfaces:**

- Produces: `actionSchema` (discriminated union on `kind`), `NotificationAction` (union type), `moduleActionResponseSchema`, `ModuleActionResponse`, `ACTION_DISPATCH_METHODS = ["GET","POST"]`.

- [ ] **Step 1: Write failing tests**

Append to `packages/shared/src/notification.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actionSchema, moduleActionResponseSchema } from "./notification";

describe("actionSchema (union)", () => {
  it("parses a link action and defaults a bare legacy action (no kind) to link", () => {
    expect(
      actionSchema.parse({ label: "View", kind: "link", method: "GET", url: "https://x.test/a" })
        .kind,
    ).toBe("link");
    // legacy persisted action: no `kind` -> link
    const legacy = actionSchema.parse({ label: "Open", method: "GET", url: "https://x.test/a" });
    expect(legacy.kind).toBe("link");
  });

  it("parses a dispatch action with a relative path + metadata", () => {
    const a = actionSchema.parse({
      label: "Approve",
      kind: "dispatch",
      method: "POST",
      path: "/actions/approve",
      metadata: { requestId: "r1" },
    });
    expect(a).toMatchObject({ kind: "dispatch", path: "/actions/approve" });
  });

  it("rejects a dispatch action whose path is absolute, protocol-relative, or has ..", () => {
    for (const path of ["http://evil/x", "//evil/x", "/a/../b", "actions/approve"]) {
      expect(
        actionSchema.safeParse({ label: "X", kind: "dispatch", method: "POST", path }).success,
      ).toBe(false);
    }
  });

  it("rejects a dispatch action with oversized metadata (>4KB)", () => {
    const metadata = { blob: "x".repeat(4097) };
    expect(
      actionSchema.safeParse({ label: "X", kind: "dispatch", method: "POST", path: "/a", metadata })
        .success,
    ).toBe(false);
  });

  it("rejects a dispatch method other than GET/POST", () => {
    expect(
      actionSchema.safeParse({ label: "X", kind: "dispatch", method: "DELETE", path: "/a" })
        .success,
    ).toBe(false);
  });
});

describe("moduleActionResponseSchema", () => {
  it("parses a full response and rejects a too-long message / too-many actions", () => {
    expect(
      moduleActionResponseSchema.parse({ ok: true, message: "Done", resolve: true, actions: [] }),
    ).toMatchObject({ ok: true });
    expect(
      moduleActionResponseSchema.safeParse({ ok: true, message: "x".repeat(501) }).success,
    ).toBe(false);
    const actions = Array.from({ length: 11 }, () => ({
      label: "L",
      kind: "link",
      method: "GET",
      url: "https://x.test/a",
    }));
    expect(moduleActionResponseSchema.safeParse({ ok: true, actions }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @notifications/shared test`
Expected: FAIL (`path`/`moduleActionResponseSchema` not defined).

- [ ] **Step 3: Implement the union in `packages/shared/src/notification.ts`**

Replace the existing `actionSchema` block (the `z.object({ label, kind, method, url, icon })`) with:

```ts
export const ACTION_DISPATCH_METHODS = ["GET", "POST"] as const;

const MAX_METADATA_BYTES = 4096;

// A relative path only: one leading slash (not protocol-relative `//`), no scheme, no `..` segment.
// This is the egress-safety guarantee — the module host comes from the registry, never the payload.
const dispatchPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((p) => p.startsWith("/") && !p.startsWith("//"), {
    message: "path must start with a single /",
  })
  .refine((p) => !/^[a-z][a-z0-9+.-]*:/i.test(p), { message: "path must not contain a scheme" })
  .refine((p) => !p.split("/").includes(".."), { message: "path must not contain .." });

const linkActionSchema = z.object({
  label: z.string().min(1).max(100),
  kind: z.literal("link"),
  // `method`/`url` retained for links (opened client-side); method is tolerated but unused for links.
  method: z.enum(ACTION_METHODS).optional(),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), { message: "url must use http(s)" }),
  icon: z.string().min(1).max(100).optional(),
});

const dispatchActionSchema = z.object({
  label: z.string().min(1).max(100),
  kind: z.literal("dispatch"),
  method: z.enum(ACTION_DISPATCH_METHODS),
  path: dispatchPathSchema,
  // Opaque, module-defined at publish time; the hub never interprets it. Size-bounded like every
  // other free field so a buggy/hostile publisher can't send an abusive payload.
  metadata: z
    .unknown()
    .optional()
    .refine((m) => m === undefined || JSON.stringify(m).length <= MAX_METADATA_BYTES, {
      message: `metadata must be <= ${MAX_METADATA_BYTES} bytes serialized`,
    }),
  icon: z.string().min(1).max(100).optional(),
});

// Legacy persisted/published actions may omit `kind` (the old schema defaulted it to "link"). Inject
// it so the discriminated union can parse them as links — keeps feed reads back-compatible.
export const actionSchema = z.preprocess(
  (v) =>
    v && typeof v === "object" && !Array.isArray(v) && !("kind" in v)
      ? { ...(v as object), kind: "link" }
      : v,
  z.discriminatedUnion("kind", [linkActionSchema, dispatchActionSchema]),
);
```

Then update the response schema + type exports (place after `notificationSchema` exports; `NotificationAction` already re-exported via `z.infer<typeof actionSchema>`):

```ts
export const moduleActionResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().max(500).optional(),
  resolve: z.boolean().optional(),
  actions: z.array(actionSchema).max(10).optional(),
});
export type ModuleActionResponse = z.infer<typeof moduleActionResponseSchema>;
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @notifications/shared test` → PASS. Then `pnpm --filter @notifications/shared typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/notification.ts packages/shared/src/notification.spec.ts
git commit -m "feat(shared): action schema discriminated union (link|dispatch) + module response schema"
```

### Task 2: tolerant action parsing on feed read

**Files:**

- Modify: `packages/core/src/read/feed.ts` (the `actions: row.actions.map((a) => actionSchema.parse(a))` mapping, ~line 88)
- Test: `packages/core/src/read/feed.spec.ts` (append) — or a focused new `feed-actions.spec.ts` if the existing spec needs a DB.

**Interfaces:**

- Consumes: `actionSchema` (Task 1).
- Produces: `parseActions(raw: unknown[]): NotificationAction[]` (exported helper) that drops invalid entries.

- [ ] **Step 1: Write failing test** (`packages/core/src/read/feed-actions.spec.ts`)

```ts
import { describe, expect, it } from "vitest";
import { parseActions } from "./feed";

describe("parseActions", () => {
  it("keeps valid actions and drops invalid ones without throwing", () => {
    const raw = [
      { label: "View", kind: "link", method: "GET", url: "https://x.test/a" },
      { label: "Broken", kind: "dispatch", method: "POST" }, // missing path -> dropped
      { label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" },
    ];
    const parsed = parseActions(raw);
    expect(parsed.map((a) => a.label)).toEqual(["View", "Approve"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @notifications/core test feed-actions` → FAIL (`parseActions` not exported).

- [ ] **Step 3: Implement**

In `packages/core/src/read/feed.ts`, add an exported helper and use it. Replace the mapping line:

```ts
// before: actions: row.actions.map((a) => actionSchema.parse(a))
```

with a call to:

```ts
/** Parse a persisted actions array, dropping any entry that no longer matches the contract (e.g. a
 *  dispatch action stored before `path` existed) so one bad row can never crash a feed read. */
export function parseActions(raw: unknown[]): NotificationAction[] {
  const out: NotificationAction[] = [];
  for (const a of raw) {
    const parsed = actionSchema.safeParse(a);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
```

Update the row mapping to `...(row.actions != null ? { actions: parseActions(row.actions) } : {})`. Import `NotificationAction` from `@notifications/shared` if not already.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @notifications/core test feed-actions` → PASS. Then `pnpm --filter @notifications/core test` (whole package incl. `boundary.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/read/feed.ts packages/core/src/read/feed-actions.spec.ts
git commit -m "feat(core): tolerant feed action parsing (drop invalid persisted actions)"
```

---

## Unit B — Module base_url registry (admin-editable)

### Task 3: `modules.base_url` migration + core registry read/write

**Files:**

- Create: `backend/migrations/013_modules_base_url.sql`
- Modify: `packages/core/src/types.ts` (`ModulePolicyView.baseUrl`), `packages/core/src/policy/store.ts` (`setModuleBaseUrl`, `base_url` in `listModules`, expose `getModuleBaseUrl`), `packages/core/src/service.ts` (`setModuleBaseUrl`)
- Test: `packages/core/src/policy/store.spec.ts` (append) or `packages/core/test/*` mirroring existing policy tests.

**Interfaces:**

- Produces: `ModulePolicyView.baseUrl: string | null`; `PolicyStore.setModuleBaseUrl(id: string, baseUrl: string | null): Promise<void>`; `PolicyStore.getModuleBaseUrl(id: string): Promise<string | null>`; `NotificationService.setModuleBaseUrl(id, baseUrl)`.

- [ ] **Step 1: Write the migration**

`backend/migrations/013_modules_base_url.sql`:

```sql
-- Where each module's running API lives. Registry data (admin-editable), not env: the action
-- dispatcher composes base_url + the action's relative path. Nullable — a null base_url means the
-- module can't receive dispatches (its dispatch actions are rejected; link actions still work).
ALTER TABLE modules ADD COLUMN IF NOT EXISTS base_url text;

-- Dev default: the module-sim service (one origin, /{key} prefix). A real deployment edits these
-- to each module's real base URL in the admin. Only sets rows that don't already have a value.
UPDATE modules SET base_url = 'http://localhost:4000/' || key WHERE base_url IS NULL;
```

- [ ] **Step 2: Write failing core tests** (append to the existing policy-store test file; match its harness for spinning a test pool)

```ts
it("listModules exposes base_url and setModuleBaseUrl updates it", async () => {
  await store.setModuleBaseUrl("dsr", "http://localhost:4000/dsr");
  const mods = await store.listModules();
  expect(mods.find((m) => m.id === "dsr")?.baseUrl).toBe("http://localhost:4000/dsr");
  expect(await store.getModuleBaseUrl("dsr")).toBe("http://localhost:4000/dsr");
  await store.setModuleBaseUrl("dsr", null);
  expect(await store.getModuleBaseUrl("dsr")).toBeNull();
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `docker compose up -d && pnpm --filter @notifications/backend migrate && pnpm --filter @notifications/core test policy` → FAIL.

- [ ] **Step 4: Implement**

`packages/core/src/types.ts` — add to `ModulePolicyView`:

```ts
baseUrl: string | null;
```

`packages/core/src/policy/store.ts`:

- In `listModules`, add `m.base_url` to the SELECT (and `GROUP BY m.key, m.enabled, m.last_seen_at, m.base_url`), the row type (`base_url: string | null`), and map `baseUrl: r.base_url`.
- Add methods:

```ts
/** Read a module's registered API base URL (null = not dispatchable). */
async getModuleBaseUrl(id: string): Promise<string | null> {
  const res = await this.query<{ base_url: string | null }>(
    "SELECT base_url FROM modules WHERE key = $1",
    [id],
  );
  return res.rows[0]?.base_url ?? null;
}

/** Set (or clear) a module's registered API base URL. No-op for an unknown key. */
async setModuleBaseUrl(id: string, baseUrl: string | null): Promise<void> {
  await this.query("UPDATE modules SET base_url = $2 WHERE key = $1", [id, baseUrl]);
  this.invalidate?.(); // if the store caches; match how setModuleEnabled invalidates
}
```

(Mirror `setModuleEnabled`'s cache-invalidation exactly — check the method body and copy its pattern.)

`packages/core/src/service.ts` — add to the `NotificationService` interface and the returned object:

```ts
setModuleBaseUrl(id: string, baseUrl: string | null): Promise<void>;
// ...
setModuleBaseUrl: (id, baseUrl) => policy.setModuleBaseUrl(id, baseUrl),
```

- [ ] **Step 5: Run tests, verify pass; commit**

Run: `pnpm --filter @notifications/core test policy` → PASS; `pnpm --filter @notifications/core typecheck`.

```bash
git add backend/migrations/013_modules_base_url.sql packages/core/src
git commit -m "feat(core): admin-editable modules.base_url registry"
```

### Task 4: `PATCH /admin/modules/:key` accepts `baseUrl`

**Files:**

- Modify: `packages/server-fastify/src/routes/admin.ts` (the existing module PATCH handler)
- Test: `packages/server-fastify/src/routes/admin.spec.ts` (or the existing admin route test file)

**Interfaces:**

- Consumes: `service.setModuleBaseUrl` (Task 3), `service.setModuleEnabled`.
- Produces: `PATCH /admin/modules/:key` body accepts `{ enabled?: boolean; baseUrl?: string | null }` (at least one required); `baseUrl` validated as a non-empty http(s) URL or `null`.

- [ ] **Step 1: Write failing test** — mirror the existing enable/disable admin test; add:

```ts
it("PATCH /admin/modules/:key sets base_url", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: adminHeaders,
    payload: { baseUrl: "http://localhost:4000/dsr" },
  });
  expect(res.statusCode).toBe(204);
  expect(setModuleBaseUrl).toHaveBeenCalledWith("dsr", "http://localhost:4000/dsr");
});

it("rejects a base_url that is not http(s) or null", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/admin/modules/dsr",
    headers: adminHeaders,
    payload: { baseUrl: "javascript:alert(1)" },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @notifications/server-fastify test admin` → FAIL.

- [ ] **Step 3: Implement** — update the module PATCH body schema (find the existing `z.object({ enabled: z.boolean() })`):

```ts
const moduleBaseUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), { message: "baseUrl must use http(s)" });

const modulePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: moduleBaseUrlSchema.nullable().optional(),
  })
  .refine((b) => b.enabled !== undefined || b.baseUrl !== undefined, {
    message: "no fields to update",
  });
```

In the handler, after `safeParse`, apply whichever fields are present:

```ts
if (parsed.data.enabled !== undefined) await service.setModuleEnabled(key, parsed.data.enabled);
if (parsed.data.baseUrl !== undefined) await service.setModuleBaseUrl(key, parsed.data.baseUrl);
return reply.code(204).send();
```

(Preserve the existing 404-for-unknown-module behavior if the current handler has it.)

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
git add packages/server-fastify/src/routes/admin.ts packages/server-fastify/src/routes/admin.spec.ts
git commit -m "feat(server-fastify): admin PATCH /admin/modules/:key accepts baseUrl"
```

### Task 5: admin Modules panel — editable `base_url` field

**Files:**

- Modify: `packages/vue/src/admin/ModulesPanel.vue`, and the admin API caller it uses (grep the panel for the `patch("/admin/modules/…`) call).
- Test: `packages/vue/src/admin/ModulesPanel.spec.ts` (append or create, mirroring existing admin panel specs).

**Interfaces:**

- Consumes: `PATCH /admin/modules/:key { baseUrl }` (Task 4); module list now carries `baseUrl`.

- [ ] **Step 1: Write failing test** — mount `ModulesPanel` with a fake transport, assert a base-URL input renders per module and that editing + saving calls `transport.patch("/admin/modules/dsr", { baseUrl: "http://localhost:4000/dsr" })`. Match the existing panel spec's mount harness.

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @notifications/vue test ModulesPanel` → FAIL.

- [ ] **Step 3: Implement** — add a text input bound to each module's `baseUrl` with a Save affordance that calls the admin patch; show a validation hint if blank/invalid; reflect the returned value. Follow the panel's existing token classes and the `design-system` skill (no raw Tailwind defaults). Keep the enable/disable toggle untouched.

- [ ] **Step 4: Run tests, verify pass; verify visually** — `pnpm --filter @notifications/vue test`; then `/verify` or `browser-tester` on the admin Modules panel (renders + saves).

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/admin
git commit -m "feat(vue): editable module base_url in the admin Modules panel"
```

---

## Unit C — Core dispatch

### Task 6: `action_dispatches` migration + idempotent store

**Files:**

- Create: `backend/migrations/014_action_dispatches.sql`, `packages/core/src/action/store.ts`
- Test: `packages/core/src/action/store.spec.ts`

**Interfaces:**

- Produces:

  ```ts
  type DispatchStatus = "pending" | "ok" | "failed";
  interface DispatchRow { id: string; status: DispatchStatus; resultMessage: string | null; }
  // Insert-or-get by the idempotency tuple. Returns { created:true, row } for a fresh row, or
  // { created:false, row } when the tuple already exists (idempotent replay).
  createActionStore(query): {
    begin(args: { userKey; notificationId; actionRef; idempotencyKey }): Promise<{ created: boolean; row: DispatchRow }>;
    complete(id: string, status: "ok"|"failed", resultMessage: string | null): Promise<void>;
  }
  ```

  Note: `user_id` FK is by the DB user id. The store is passed the resolved user id; if the library keys read-state by `user_key` (check `011_notification_reads_userkey.sql`), key `action_dispatches.user_id` the SAME way `notification_reads` is keyed and mirror its column/type. **Match the existing read-state keying exactly.**

- [ ] **Step 1: Write the migration** (`backend/migrations/014_action_dispatches.sql`) — mirror `notification_reads` FK/keying:

```sql
CREATE TABLE IF NOT EXISTS action_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key        text NOT NULL,                          -- match notification_reads keying
  notification_id text NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  action_ref      text NOT NULL,                          -- the action's array index, e.g. "0"
  idempotency_key text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',        -- pending | ok | failed
  result_message  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (user_key, notification_id, action_ref, idempotency_key)
);
```

(If `notification_reads` keys by a `user_id uuid` FK to `users`, use that instead — copy its exact column + FK. The core library is identity-free; whichever key read-state uses, use the same so core stays consistent.)

- [ ] **Step 2: Write failing tests** (`store.spec.ts`, against a test pool like the policy-store tests)

```ts
it("begin inserts a pending row once, then returns the same row idempotently", async () => {
  const a = await store.begin({
    userKey: "u1",
    notificationId: "n1",
    actionRef: "0",
    idempotencyKey: "k1",
  });
  expect(a.created).toBe(true);
  expect(a.row.status).toBe("pending");
  const b = await store.begin({
    userKey: "u1",
    notificationId: "n1",
    actionRef: "0",
    idempotencyKey: "k1",
  });
  expect(b.created).toBe(false);
  expect(b.row.id).toBe(a.row.id);
});

it("complete records terminal status + message", async () => {
  const { row } = await store.begin({
    userKey: "u1",
    notificationId: "n1",
    actionRef: "0",
    idempotencyKey: "k2",
  });
  await store.complete(row.id, "ok", "Approved");
  const again = await store.begin({
    userKey: "u1",
    notificationId: "n1",
    actionRef: "0",
    idempotencyKey: "k2",
  });
  expect(again.row).toMatchObject({ status: "ok", resultMessage: "Approved" });
});
```

- [ ] **Step 3: Run tests, verify they fail** — `docker compose up -d && pnpm --filter @notifications/backend migrate && pnpm --filter @notifications/core test action/store` → FAIL.

- [ ] **Step 4: Implement `packages/core/src/action/store.ts`**

```ts
import type { Query } from "../db"; // match the query type used across read/*, policy/store

export type DispatchStatus = "pending" | "ok" | "failed";
export interface DispatchRow {
  id: string;
  status: DispatchStatus;
  resultMessage: string | null;
}

export function createActionStore(query: Query) {
  return {
    async begin(a: {
      userKey: string;
      notificationId: string;
      actionRef: string;
      idempotencyKey: string;
    }) {
      // ON CONFLICT DO NOTHING then SELECT: an existing tuple returns created:false with its row.
      const ins = await query<{
        id: string;
        status: DispatchStatus;
        result_message: string | null;
      }>(
        `INSERT INTO action_dispatches (user_key, notification_id, action_ref, idempotency_key)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_key, notification_id, action_ref, idempotency_key) DO NOTHING
         RETURNING id, status, result_message`,
        [a.userKey, a.notificationId, a.actionRef, a.idempotencyKey],
      );
      if (ins.rows[0]) return { created: true, row: toRow(ins.rows[0]) };
      const sel = await query<{
        id: string;
        status: DispatchStatus;
        result_message: string | null;
      }>(
        `SELECT id, status, result_message FROM action_dispatches
         WHERE user_key=$1 AND notification_id=$2 AND action_ref=$3 AND idempotency_key=$4`,
        [a.userKey, a.notificationId, a.actionRef, a.idempotencyKey],
      );
      return { created: false, row: toRow(sel.rows[0]!) };
    },
    async complete(id: string, status: "ok" | "failed", resultMessage: string | null) {
      await query(
        `UPDATE action_dispatches SET status=$2, result_message=$3, completed_at=now() WHERE id=$1`,
        [id, status, resultMessage],
      );
    },
  };
}

function toRow(r: {
  id: string;
  status: DispatchStatus;
  result_message: string | null;
}): DispatchRow {
  return { id: r.id, status: r.status, resultMessage: r.result_message };
}
```

- [ ] **Step 5: Run tests, verify pass; commit**

```bash
git add backend/migrations/014_action_dispatches.sql packages/core/src/action/store.ts packages/core/src/action/store.spec.ts
git commit -m "feat(core): action_dispatches durable store (idempotent begin/complete)"
```

### Task 7: `ActionDispatcher` interface + `dispatchAction` service method

**Files:**

- Create: `packages/core/src/action/dispatch.ts`
- Modify: `packages/core/src/types.ts` (`ActionDispatcher`, `ActionDispatchResult`), `packages/core/src/service.ts` (accept `actionDispatcher` in config; expose `dispatchAction`; new error classes)
- Test: `packages/core/src/action/dispatch.spec.ts`

**Interfaces:**

- Consumes: `createActionStore` (Task 6); `moduleActionResponseSchema` (Task 1); `PolicyStore.getSettings/resolveModule/getModuleBaseUrl`; feed visibility helper (reuse how `markRead`/`list` establish the notification is in the principal's audience — see `read/read-state.ts` `markRead` which returns `not found` when outside audience).
- Produces:

  ```ts
  interface ActionDispatcher {
    // Host-injected. Core composes the absolute url from base_url + path; the impl performs the
    // outbound call and returns the parsed JSON body + HTTP status. Core validates the body.
    dispatch(input: {
      url: string;
      method: "GET" | "POST";
      body: unknown;
    }): Promise<{ status: number; body: unknown }>;
  }
  interface ActionDispatchResult {
    ok: boolean;
    message?: string;
    resolve?: boolean;
    actions?: NotificationAction[];
  }
  // service.dispatchAction(args): Promise<ActionDispatchResult>
  // Error classes: ActionsDisabledError, ModuleUnavailableError (base_url null / module disabled),
  //   NotFoundError (notification not visible / bad actionRef / not a dispatch action).
  ```

- [ ] **Step 1: Write failing tests** (`dispatch.spec.ts`) — use a fake `ActionDispatcher` and a seeded notification with a dispatch action; cover the branches:

```ts
// Pseudocode structure — build a service (or a dispatchAction unit) over a test pool with a seeded
// notification n1 (module "dsr", actions:[{kind:"dispatch",method:"POST",path:"/actions/approve"}]),
// dsr base_url set, actionsEnabled=true. principal = the notification's audience.

it("actionsEnabled off -> ActionsDisabledError, no dispatcher call", async () => { /* set actions_enabled=false */ });
it("module disabled -> ModuleUnavailableError", async () => { /* setModuleEnabled('dsr', false) */ });
it("base_url null -> ModuleUnavailableError", async () => { /* setModuleBaseUrl('dsr', null) */ });
it("notification not visible to principal -> NotFoundError", async () => { /* different principal */ });
it("bad actionRef / link action -> NotFoundError", async () => { /* actionRef '5' or a link action */ });
it("happy path: records ok, applies resolve->markRead, returns message", async () => {
  const dispatcher = { dispatch: vi.fn().mockResolvedValue({ status: 200, body: { ok: true, message: "Approved", resolve: true } }) };
  const res = await service.dispatchAction({ principal, notificationId: "n1", actionRef: "0", idempotencyKey: "k1" });
  expect(dispatcher.dispatch).toHaveBeenCalledWith({ url: "http://localhost:4000/dsr/actions/approve", method: "POST", body: expect.objectContaining({ notificationId: "n1" }) });
  expect(res).toMatchObject({ ok: true, message: "Approved", resolve: true });
  // n1 is now read (resolve applied)
});
it("idempotent replay returns the recorded result WITHOUT calling the dispatcher again", async () => {
  await service.dispatchAction({ principal, notificationId: "n1", actionRef: "0", idempotencyKey: "k2" });
  dispatcher.dispatch.mockClear();
  const again = await service.dispatchAction({ principal, notificationId: "n1", actionRef: "0", idempotencyKey: "k2" });
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
  expect(again.ok).toBe(true);
});
it("dispatcher throws/timeout -> row failed, result ok:false", async () => {
  dispatcher.dispatch.mockRejectedValue(new Error("timeout"));
  const res = await service.dispatchAction({ ... idempotencyKey: "k3" });
  expect(res.ok).toBe(false);
});
it("module response fails validation -> failed", async () => {
  dispatcher.dispatch.mockResolvedValue({ status: 200, body: { nope: true } });
  const res = await service.dispatchAction({ ... idempotencyKey: "k4" });
  expect(res.ok).toBe(false);
});
```

- [ ] **Step 2: Run tests, verify they fail** — `pnpm --filter @notifications/core test action/dispatch` → FAIL.

- [ ] **Step 3: Implement `packages/core/src/action/dispatch.ts`**

```ts
import { moduleActionResponseSchema, type NotificationAction } from "@notifications/shared";
import type { Query } from "../db";
import type { PolicyStore } from "../policy/store";
import type { Principal, ActionDispatcher, ActionDispatchResult } from "../types";
import { createActionStore } from "./store";
import { markRead } from "../read/read-state";

export class ActionsDisabledError extends Error {
  constructor() {
    super("actions disabled");
    this.name = "ActionsDisabledError";
  }
}
export class ModuleUnavailableError extends Error {
  constructor() {
    super("module unavailable");
    this.name = "ModuleUnavailableError";
  }
}
// Reuse the existing NotFoundError from service.ts for "not visible / bad ref / not a dispatch action".

interface DispatchDeps {
  query: Query;
  policy: PolicyStore;
  dispatcher?: ActionDispatcher;
}

export async function dispatchAction(
  deps: DispatchDeps,
  args: { principal: Principal; notificationId: string; actionRef: string; idempotencyKey: string },
): Promise<ActionDispatchResult> {
  const { query, policy, dispatcher } = deps;
  if (!dispatcher) throw new ModuleUnavailableError(); // no host dispatcher injected

  const settings = await policy.getSettings();
  if (!settings.actionsEnabled) throw new ActionsDisabledError();

  // Load the notification IF it is visible to this principal (mirror the audience filter used by
  // read-state.markRead — a notification the caller can't see is indistinguishable from missing).
  const row = await loadVisibleNotification(query, args.principal, args.notificationId); // NotFoundError if none
  const action = row.actions[Number(args.actionRef)];
  if (!action || action.kind !== "dispatch") throw new NotFoundError();

  const mod = await policy.resolveModule(row.module);
  const baseUrl = await policy.getModuleBaseUrl(row.module);
  if (!mod.known || !mod.enabled || !baseUrl) throw new ModuleUnavailableError();

  const store = createActionStore(query);
  const begun = await store.begin({
    userKey: args.principal.userKey,
    notificationId: args.notificationId,
    actionRef: args.actionRef,
    idempotencyKey: args.idempotencyKey,
  });
  // Idempotent replay: a completed row is returned as-is; a still-pending duplicate also short-circuits.
  if (!begun.created) return replay(begun.row);

  const url = joinUrl(baseUrl, action.path); // base_url already validated; path is a safe relative path
  let result: ActionDispatchResult;
  try {
    const res = await dispatcher.dispatch({
      url,
      method: action.method,
      body: {
        notificationId: args.notificationId,
        actionRef: args.actionRef,
        metadata: action.metadata ?? null,
        actor: { userKey: args.principal.userKey },
      },
    });
    const parsed = moduleActionResponseSchema.safeParse(res.body);
    if (res.status < 200 || res.status >= 300 || !parsed.success) {
      await store.complete(begun.row.id, "failed", null);
      result = { ok: false, message: "Action failed" };
    } else {
      const body = parsed.data;
      await store.complete(begun.row.id, body.ok ? "ok" : "failed", body.message ?? null);
      if (body.ok && body.resolve)
        await markRead(query, { principal: args.principal, id: args.notificationId });
      result = {
        ok: body.ok,
        ...(body.message ? { message: body.message } : {}),
        ...(body.resolve ? { resolve: true } : {}),
        ...(body.actions ? { actions: body.actions } : {}),
      };
    }
  } catch {
    await store.complete(begun.row.id, "failed", null);
    result = { ok: false, message: "Action failed" };
  }
  // PII-safe: log outcome only — never metadata or the response body.
  return result;
}

function replay(r: { status: string; resultMessage: string | null }): ActionDispatchResult {
  const ok = r.status === "ok";
  return { ok, ...(r.resultMessage ? { message: r.resultMessage } : {}) };
}

// One leading slash on path is guaranteed by the schema; strip a trailing slash on base to avoid //.
function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, "") + path;
}
```

Add a `loadVisibleNotification(query, principal, id)` helper — reuse/extend the audience-scoped SELECT that `read/feed.ts`/`read/read-state.ts` already use (it must return `module` + parsed `actions`); throw the shared `NotFoundError` when no row matches the principal's audience. **Do not write a new audience predicate — factor the one `read-state.markRead` already relies on.**

`packages/core/src/types.ts` — add:

```ts
export interface ActionDispatcher {
  dispatch(input: {
    url: string;
    method: "GET" | "POST";
    body: unknown;
  }): Promise<{ status: number; body: unknown }>;
}
export interface ActionDispatchResult {
  ok: boolean;
  message?: string;
  resolve?: boolean;
  actions?: import("@notifications/shared").NotificationAction[];
}
```

Extend `NotificationServiceConfig` with `actionDispatcher?: ActionDispatcher;`.

`packages/core/src/service.ts` — thread `opts.config.actionDispatcher` into `deps`, add to the interface + returned object:

```ts
dispatchAction(args: { principal: Principal; notificationId: string; actionRef: string; idempotencyKey: string }): Promise<ActionDispatchResult>;
// ...
dispatchAction: (args) => dispatchAction({ query, policy, dispatcher: opts.config.actionDispatcher }, args),
```

Export `ActionsDisabledError`, `ModuleUnavailableError` from the package index.

- [ ] **Step 4: Run tests, verify pass** — `pnpm --filter @notifications/core test` (whole package incl. `boundary.test.ts` — it MUST stay green; core reads no env here). `pnpm --filter @notifications/core typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src backend/migrations
git commit -m "feat(core): dispatchAction — uniform action dispatch over an injected ActionDispatcher"
```

---

## Unit D — Dispatch HTTP route

### Task 8: `POST /notifications/:id/actions/:ref/dispatch`

**Files:**

- Modify: `packages/server-fastify/src/routes/notifications.ts`
- Test: `packages/server-fastify/src/routes/notifications.spec.ts` (append; mirror the existing `/notifications/:id/read` route tests)

**Interfaces:**

- Consumes: `service.dispatchAction`; error classes `ActionsDisabledError`, `ModuleUnavailableError`, `NotFoundError`.
- Produces: `POST /notifications/:id/actions/:ref/dispatch`, body `{ idempotencyKey: string }`, returns `200 { ok, message?, resolve?, actions? }`.

- [ ] **Step 1: Write failing tests** — mirror existing route tests using a stubbed `service`:

```ts
it("401 without a principal", ...);       // no requirePrincipal principal
it("400 on a missing/invalid idempotencyKey", ...);
it("403 when actionsEnabled is off", ...); // service throws ActionsDisabledError
it("404 for an unknown notification / bad ref", ...); // NotFoundError
it("200 returns the dispatch result", async () => {
  dispatchAction.mockResolvedValue({ ok: true, message: "Approved", resolve: true });
  const res = await app.inject({ method: "POST", url: "/notifications/n1/actions/0/dispatch", headers: userHeaders, payload: { idempotencyKey: "k1" } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ ok: true, message: "Approved", resolve: true });
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @notifications/server-fastify test notifications` → FAIL.

- [ ] **Step 3: Implement** — add to `notificationReadRoutes` (same file/pattern as `/notifications/:id/read`):

```ts
import { ActionsDisabledError, ModuleUnavailableError } from "@notifications/core";

const dispatchParamsSchema = z.object({
  id: z.string().min(1).max(200),
  ref: z.string().regex(/^\d+$/),
});
const dispatchBodySchema = z.object({ idempotencyKey: z.string().min(1).max(200) });

app.post(
  "/notifications/:id/actions/:ref/dispatch",
  { preHandler: requirePrincipal },
  async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const p = dispatchParamsSchema.safeParse(req.params);
    const b = dispatchBodySchema.safeParse(req.body);
    if (!p.success || !b.success) return reply.code(400).send({ error: "invalid request" });
    try {
      const result = await service.dispatchAction({
        principal,
        notificationId: p.data.id,
        actionRef: p.data.ref,
        idempotencyKey: b.data.idempotencyKey,
      });
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ActionsDisabledError)
        return reply.code(403).send({ error: "actions disabled" });
      if (err instanceof ModuleUnavailableError)
        return reply.code(409).send({ error: "module unavailable" });
      if (err instanceof NotFoundError)
        return reply.code(404).send({ error: "notification or action not found" });
      throw err;
    }
  },
);
```

(`409` for a genuinely unavailable module reads better than `403`; keep `403` strictly for the kill-switch. Confirm the test expectations match.)

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
git add packages/server-fastify/src/routes/notifications.ts packages/server-fastify/src/routes/notifications.spec.ts
git commit -m "feat(server-fastify): POST /notifications/:id/actions/:ref/dispatch"
```

---

## Unit E — Reference backend HTTP dispatcher

### Task 9: HTTP `ActionDispatcher` + env + wiring

**Files:**

- Create: `backend/src/reference/http-dispatcher.ts`
- Modify: `backend/src/config/env.ts` (add `MODULE_DISPATCH_TOKEN`), `backend/src/reference/service.ts` (pass `actionDispatcher` into `createNotificationService`), `backend/src/server.ts` (nothing new if service.ts owns it — else pass through)
- Test: `backend/test/http-dispatcher.test.ts` (or `backend/src/reference/http-dispatcher.spec.ts`)

**Interfaces:**

- Produces: `createHttpActionDispatcher(opts: { token: string; timeoutMs?: number }): ActionDispatcher`.

- [ ] **Step 1: Write failing test** — inject a fake `fetch` (pass it in for testability):

```ts
it("POSTs the composed url with the dispatch token header and parses JSON", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  const d = createHttpActionDispatcher({ token: "secret", fetchImpl });
  const out = await d.dispatch({
    url: "http://localhost:4000/dsr/actions/approve",
    method: "POST",
    body: { a: 1 },
  });
  expect(out).toEqual({ status: 200, body: { ok: true } });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe("http://localhost:4000/dsr/actions/approve");
  expect(init.headers["x-module-dispatch-token"]).toBe("secret");
  expect(init.redirect).toBe("manual");
});

it("returns a non-2xx status without throwing", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
  const out = await createHttpActionDispatcher({ token: "s", fetchImpl }).dispatch({
    url: "http://x/y",
    method: "POST",
    body: {},
  });
  expect(out.status).toBe(500);
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @notifications/backend test http-dispatcher` → FAIL.

- [ ] **Step 3: Implement `backend/src/reference/http-dispatcher.ts`**

```ts
import type { ActionDispatcher } from "@notifications/core";

/** The host-side HTTP action dispatcher. Core hands us a composed absolute url (host from the DB
 *  registry, path a validated relative path) — we attach the service-to-service token and fetch it.
 *  No redirect following (a module must not bounce the call elsewhere); bounded timeout. */
export function createHttpActionDispatcher(opts: {
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ActionDispatcher {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return {
    async dispatch({ url, method, body }) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await doFetch(url, {
          method,
          redirect: "manual",
          signal: ac.signal,
          headers: { "content-type": "application/json", "x-module-dispatch-token": opts.token },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        });
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { status: res.status, body: parsed };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
```

`backend/src/config/env.ts` — add `MODULE_DISPATCH_TOKEN: z.string().min(1)` to the env schema (validated at startup, like `INTERNAL_INTAKE_TOKEN`). Add it to `.env.example`.

`backend/src/reference/service.ts` — build the dispatcher and pass it in:

```ts
import { createHttpActionDispatcher } from "./http-dispatcher";
// ...
actionDispatcher: createHttpActionDispatcher({ token: env.MODULE_DISPATCH_TOKEN }),
```

- [ ] **Step 4: Run tests, verify pass; typecheck; commit**

```bash
git add backend/src/reference/http-dispatcher.ts backend/src/config/env.ts backend/src/reference/service.ts backend/.env.example backend/test
git commit -m "feat(backend): HTTP ActionDispatcher + MODULE_DISPATCH_TOKEN wiring"
```

---

## Unit F — `packages/module-sim` (running modules)

### Task 10: scaffold `packages/module-sim` (dev-only Fastify app)

**Files:**

- Create: `packages/module-sim/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/app.ts`, `src/index.ts`, `src/app.spec.ts`

**Interfaces:**

- Produces: `buildApp(config): FastifyInstance` with `GET /health`; refuses to run under `NODE_ENV=production` at process entry.

- [ ] **Step 1: Write failing test** (`src/app.spec.ts`)

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
it("serves /health", async () => {
  const app = buildApp({
    hubUrl: "http://localhost:3000",
    intakeToken: "t",
    dispatchToken: "d",
    port: 4000,
  });
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @notifications/module-sim test` → FAIL (package/app missing).

- [ ] **Step 3: Implement scaffold** — `package.json` (name `@notifications/module-sim`, `type:module`, private, scripts `dev`/`build`/`typecheck`/`test`, deps: `fastify`, `zod`, `@notifications/shared`; `pnpm-workspace.yaml` already globs `packages/*`). `src/config.ts` reads `MODULE_SIM_PORT`, `HUB_URL`, `INTERNAL_INTAKE_TOKEN`, `MODULE_DISPATCH_TOKEN` from env (validated with zod). `src/app.ts` `buildApp(config)` registers routes (health now; handlers + emit next tasks). `src/index.ts`:

```ts
if (process.env.NODE_ENV === "production") {
  console.error("module-sim is a dev tool and refuses to run with NODE_ENV=production");
  process.exit(1);
}
```

then build + listen. Mirror `backend`'s tsconfig/vitest config.

- [ ] **Step 4: Run test, verify pass; typecheck; commit**

```bash
git add packages/module-sim pnpm-workspace.yaml
git commit -m "chore(module-sim): scaffold dev-only module-sim Fastify app"
```

### Task 11: module action handlers + in-memory state + catalog

**Files:**

- Create: `packages/module-sim/src/modules/` (one file per module: `dsr.ts`, `access-governance.ts`, `data-mapping.ts`, `assessments.ts`, plus `registry.ts`), `packages/module-sim/src/routes/actions.ts`
- Modify: `packages/module-sim/src/app.ts` (register the action routes)
- Test: `packages/module-sim/src/routes/actions.spec.ts`

**Interfaces:**

- Produces: `POST|GET /:module/actions/:name` — validates `x-module-dispatch-token`, invokes the module's handler, returns `ModuleActionResponse`. Each module exposes `{ key, catalog: ActionCatalogEntry[], handle(name, body): ModuleActionResponse }` where a catalog entry is `{ name, label, method, makeAction(): NotificationAction }`.

- [ ] **Step 1: Write failing tests** (`actions.spec.ts`)

```ts
it("rejects a dispatch without the correct token (401)", async () => { /* no/invalid x-module-dispatch-token */ });
it("dsr approve resolves the first time, errors the second", async () => {
  const app = buildApp({ ...cfg, dispatchToken: "d" });
  const headers = { "x-module-dispatch-token": "d", "content-type": "application/json" };
  const first = await app.inject({ method: "POST", url: "/dsr/actions/approve", headers, payload: { notificationId: "n1", metadata: { requestId: "r1" } } });
  expect(first.json()).toMatchObject({ ok: true, resolve: true });
  const second = await app.inject({ method: "POST", url: "/dsr/actions/approve", headers, payload: { notificationId: "n1", metadata: { requestId: "r1" } } });
  expect(second.json()).toMatchObject({ ok: false });
});
it("unknown module/action -> 404", ...);
it("malformed body does not crash the process (400/ok:false)", ...);
```

- [ ] **Step 2: Run tests, verify they fail** — FAIL.

- [ ] **Step 3: Implement** — `registry.ts` maps module key → module object. Each module keeps a small `Map` of processed ids for idempotent-ish "already processed" behavior. `routes/actions.ts` validates the token (constant-time compare like the intake/`server.ts` token check), resolves the module + handler, wraps `handle` in try/catch → on throw respond `{ ok:false, message:"error" }` (never crash). Example DSR handler:

```ts
const processed = new Set<string>();
export const dsr = {
  key: "dsr",
  catalog: [
    {
      name: "approve",
      label: "Approve",
      method: "POST",
      makeAction: () => ({
        label: "Approve",
        kind: "dispatch",
        method: "POST",
        path: "/actions/approve",
        metadata: { requestId: rid() },
      }),
    },
    {
      name: "reject",
      label: "Reject",
      method: "POST",
      makeAction: () => ({
        label: "Reject",
        kind: "dispatch",
        method: "POST",
        path: "/actions/reject",
        metadata: { requestId: rid() },
      }),
    },
  ],
  handle(name: string, body: { notificationId: string; metadata?: unknown }): ModuleActionResponse {
    const key = `${name}:${body.notificationId}`;
    if (processed.has(key)) return { ok: false, message: "Already processed" };
    processed.add(key);
    if (name === "approve") return { ok: true, message: "DSR approved", resolve: true };
    if (name === "reject") return { ok: true, message: "DSR rejected", resolve: true };
    return { ok: false, message: "Unknown action" };
  },
};
```

Provide analogous handlers for the other three modules (Access Governance _revoke_, Data Mapping _rescan_, Assessments _snooze_ — snooze returns `{ ok:true, message:"Snoozed 7d" }` with no `resolve`).

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
git add packages/module-sim/src
git commit -m "feat(module-sim): token-guarded module action handlers + catalog"
```

### Task 12: move generation + emit API

**Files:**

- Create: `packages/module-sim/src/generate.ts` (adapted from `backend/src/sim/*`), `packages/module-sim/src/routes/emit.ts`
- Modify: `packages/module-sim/src/app.ts`
- Test: `packages/module-sim/src/routes/emit.spec.ts`

**Interfaces:**

- Produces: `POST /emit` with body `{ mode: "custom"|"preset"|"burst", ... }` → builds actionable notifications (dispatch actions drawn from the target module's catalog, paths pointing at that module) and POSTs them to `${hubUrl}/internal/publish` with `x-internal-token`. Returns `{ published: number }`. A `SIMULATE_MAX_BURST`-style ceiling on `burst.count`.

- [ ] **Step 1: Write failing test** (`emit.spec.ts`) — inject a fake fetch, assert `POST /emit {mode:"burst",count:3}` calls `${hubUrl}/internal/publish` once with 3 notifications each carrying at least one `kind:"dispatch"` action whose `path` matches its module's catalog, and the intake token header.

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — move the simulator/preset content generation from `backend/src/sim/simulator.ts` + `backend/src/sim/presets.ts` into `generate.ts`, adapted so each generated notification for module M attaches one/more `makeAction()` entries from M's catalog. `routes/emit.ts` validates the body (zod discriminated union like the old `simulateSchema`), builds the batch, POSTs to the hub. (The old `backend/src/sim/*` files are deleted in Task 14 once nothing imports them; if `sim-publish*.ts` scripts still import them, update or drop those scripts here.)

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
git add packages/module-sim/src
git commit -m "feat(module-sim): actionable notification generation + /emit publish API"
```

---

## Unit G — Control center + remove admin generator

### Task 13: control-center static page

**Files:**

- Create: `packages/module-sim/public/index.html` (self-contained: inline CSS + JS, no build), served by Fastify static or a route
- Modify: `packages/module-sim/src/app.ts` (serve the page at `/`), `packages/module-sim/package.json` (add `@fastify/static` if used)
- Test: `packages/module-sim/src/app.spec.ts` (assert `GET /` returns 200 HTML)

- [ ] **Step 1: Write failing test** — `GET /` returns `200` with `content-type: text/html` containing "Control Center".

- [ ] **Step 2: Run test, verify it fails** — FAIL.

- [ ] **Step 3: Implement** — a single self-contained page with three panels (Custom / Preset / Burst) that `fetch` module-sim's own `/emit` and a `GET /catalog` (add a tiny catalog route returning each module's catalog so "Custom" only offers real actions). Plain HTML/CSS/JS — no Vue/Tailwind. Keep it clean and legible (this is a dev tool; follow the `artifact-design` "utilitarian" bar — real hierarchy, not unstyled defaults).

- [ ] **Step 4: Run test, verify pass; browser-check the page loads and emits; commit**

```bash
git add packages/module-sim/public packages/module-sim/src packages/module-sim/package.json
git commit -m "feat(module-sim): control center page (custom/preset/burst, actionable)"
```

### Task 14: remove the admin generator

**Files:**

- Delete: `backend/src/http/admin/simulate.ts`, `packages/vue/src/admin/GeneratorPanel.vue`, `packages/vue/src/forms/generator.form.ts`, `packages/vue/src/forms/burst.form.ts`, `packages/vue/src/forms/drip.form.ts`, `backend/src/sim/*` (now moved), `frontend/e2e/generator.spec.ts` (replaced in Task 18)
- Modify: `backend/src/server.ts` (drop the `simulateRoutes` registration + import), `packages/vue/src/admin/NotificationAdmin.vue` (drop the Generator tab/import), any `sim-publish*.ts` scripts + `backend/package.json` scripts that referenced `sim/*`, `packages/vue` spec files referencing the generator.

- [ ] **Step 1: Delete the files and remove references**

```bash
git rm backend/src/http/admin/simulate.ts packages/vue/src/admin/GeneratorPanel.vue \
  packages/vue/src/forms/generator.form.ts packages/vue/src/forms/burst.form.ts packages/vue/src/forms/drip.form.ts
git rm -r backend/src/sim
```

Then edit `backend/src/server.ts` to remove the `simulateRoutes` import + `app.register(... simulateRoutes ...)` line, and `NotificationAdmin.vue` to remove the Generator tab. Update/remove `backend/package.json` `sim:publish`/`sim:publish:http` scripts (the `/emit` API + control center replace them) and delete `backend/src/scripts/sim-publish*.ts` if they only drove the old sim.

- [ ] **Step 2: Run the whole suite** — `pnpm typecheck && pnpm lint && pnpm --filter @notifications/vue test && pnpm --filter @notifications/backend test`. Fix any dangling imports/specs (delete generator-specific unit specs). Expected: green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove admin generator (superseded by module-sim control center)"
```

### Task 15: `pnpm dev` launches module-sim

**Files:**

- Modify: `package.json` (root `dev` script), `packages/module-sim/package.json` (`dev` script via `tsx watch src/index.ts`), `.env.example`/docs for the new env vars.

- [ ] **Step 1: Implement** — extend the root `concurrently` `dev` script to add a `module-sim` process:

```json
"dev": "concurrently -n vue-css,backend,module-sim,frontend -c yellow,blue,magenta,green \"pnpm --filter @notifications/vue dev:css\" \"pnpm --filter @notifications/backend dev\" \"pnpm --filter @notifications/module-sim dev\" \"pnpm --filter @notifications/frontend dev\""
```

Ensure the backend + module-sim share `INTERNAL_INTAKE_TOKEN` and `MODULE_DISPATCH_TOKEN` from the same `.env`. Document the module-sim control center URL (`http://localhost:4000`) in `CLAUDE.md` "Build & run".

- [ ] **Step 2: Verify** — `docker compose up -d && pnpm --filter @notifications/backend migrate && pnpm dev`, confirm all four processes start, the control center loads at `:4000`, and an emitted burst appears in the reference feed at `:5173`. (Manual/browser-tester check — no unit test.)

- [ ] **Step 3: Commit**

```bash
git add package.json packages/module-sim/package.json CLAUDE.md .env.example
git commit -m "chore: pnpm dev launches module-sim + control center"
```

---

## Unit H — Frontend dispatch

### Task 16: actions state — dispatch round-trip + effects

**Files:**

- Modify: `packages/vue/src/state/actions.ts`, `packages/vue/src/provider/NotificationProvider.vue` (pass `transport`, `settings`, `toast` into `createNotificationActions`)
- Test: `packages/vue/src/state/actions.spec.ts` (extend the existing spec)

**Interfaces:**

- Consumes: `Transport.post`, `feed.markRead` + a feed way to drop/replace a card's actions, `toast` (message surface), `POST /notifications/:id/actions/:ref/dispatch`.
- Produces: `runAction(action, target: { id: string; ref: number })` now async for dispatch; state exposes per-action pending status (`isPending(id, ref)`), applies `{message, resolve, actions}`.

- [ ] **Step 1: Write failing tests** (extend `actions.spec.ts` — the existing suite already fakes `feed`):

```ts
it("dispatch: posts with an idempotency key and applies resolve -> markRead", async () => {
  const transport = { post: vi.fn().mockResolvedValue({ ok: true, message: "Approved", resolve: true }) };
  const feed = fakeFeed(); const toast = fakeToast();
  const { runAction } = createNotificationActions({ feed, transport, settings: fakeSettings(true), toast });
  await runAction({ label: "Approve", kind: "dispatch", method: "POST", path: "/actions/approve" }, { id: "n1", ref: 0 });
  expect(transport.post).toHaveBeenCalledWith("/notifications/n1/actions/0/dispatch", expect.objectContaining({ idempotencyKey: expect.any(String) }));
  expect(feed.markRead).toHaveBeenCalledWith("n1");
  expect(toast.pushMessage ?? toast.pushCritical).toHaveBeenCalled(); // message surfaced
});
it("dispatch: replaces the card's actions when the response carries actions", ...);
it("dispatch: on ok:false surfaces the message and does NOT mark read", ...);
it("link: still opens a new tab and marks read (unchanged)", ...);
```

- [ ] **Step 2: Run tests, verify they fail** — `pnpm --filter @notifications/vue test actions` → FAIL.

- [ ] **Step 3: Implement** — extend `createNotificationActions` to take `{ feed, transport, settings, toast }` and split link/dispatch:

```ts
import { reactive } from "vue";
import type { NotificationAction } from "@notifications/shared";

export function createNotificationActions(deps: { feed; transport: Transport; settings; toast }) {
  const pending = reactive(new Set<string>()); // `${id}:${ref}`
  const isPending = (id: string, ref: number) => pending.has(`${id}:${ref}`);

  async function runAction(
    action: NotificationAction,
    target: { id: string; ref: number },
  ): Promise<void> {
    if (action.kind === "dispatch") {
      if (!deps.settings.flags.actionsEnabled) return; // server enforces too
      const key = `${target.id}:${target.ref}`;
      if (pending.has(key)) return;
      pending.add(key);
      try {
        const res = await deps.transport.post<ModuleActionResponse>(
          `/notifications/${encodeURIComponent(target.id)}/actions/${target.ref}/dispatch`,
          { idempotencyKey: crypto.randomUUID() },
        );
        if (res.message) deps.toast.pushMessage?.(res.message, res.ok ? "info" : "error");
        if (res.ok && res.resolve) deps.feed.markRead(target.id);
        if (res.ok && res.actions) deps.feed.setActions?.(target.id, res.actions);
      } catch {
        deps.toast.pushMessage?.("Action failed", "error");
      } finally {
        pending.delete(key);
      }
      return;
    }
    // link (or legacy): open + mark read — unchanged.
    deps.feed.markRead(target.id);
    window.open(action.url, "_blank", "noopener,noreferrer");
  }
  return reactive({ runAction, isPending });
}
```

Add the small `feed.setActions(id, actions)` mutator and a `toast.pushMessage(text, level)` (a lightweight non-critical message channel) if they don't exist — extend `state/feed.ts` and `state/toast.ts` minimally with their own unit tests. Wire the new deps in `NotificationProvider.vue`: `createNotificationActions({ feed, transport, settings, toast })`.

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
git add packages/vue/src/state packages/vue/src/provider/NotificationProvider.vue
git commit -m "feat(vue): action dispatch round-trip + message/resolve/actions effects"
```

### Task 17: card renderer dispatch buttons + gating + wiring

**Files:**

- Modify: `packages/vue/src/components/renderers/NotificationCardRenderer.vue`, `packages/vue/src/components/panel/InboxTab.vue` (await async runAction; pass action index as `ref`), `packages/vue/src/forms/features.form.ts` (drop "coming soon")
- Test: `packages/vue/src/components/renderers/NotificationCardRenderer.spec.ts`

**Interfaces:**

- Consumes: `useActions().isPending`, `settings.flags.actionsEnabled`.

- [ ] **Step 1: Write failing tests** — extend the card spec:

```ts
it("renders dispatch buttons only when actionsEnabled is on", ...);
it("emits action with the action AND its index", async () => {
  // click the 2nd action -> emit('action', action, item, 1)
});
it("shows a disabled/pending state while a dispatch is in flight", ...);
it("still renders link actions regardless of actionsEnabled", ...);
```

- [ ] **Step 2: Run tests, verify they fail** — FAIL.

- [ ] **Step 3: Implement** — in the `v-for="(action, i) in item.actions"` loop: change `:key` to `action.label + i` (dispatch actions have no `url`); for `kind:"dispatch"`, render only when `settings.flags.actionsEnabled`, disable + show a spinner when `actions.isPending(item.id, i)`, and emit the index. Update the `action` emit signature to `[action, notification, index]`. In `InboxTab.vue`, change the handler to `await useActions().runAction(action, { id: notification.id, ref: index })`. In `features.form.ts`, change the `actionsEnabled` hint to `"Allow module action buttons on notification cards."` (drop "coming soon").

- [ ] **Step 4: Run tests, verify pass; verify visually** — `pnpm --filter @notifications/vue test`; then `/verify`/`browser-tester`: emit a DSR notification from the control center, click Approve, confirm the card resolves + a message shows; toggle `actionsEnabled` off and confirm dispatch buttons disappear.

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/components packages/vue/src/forms/features.form.ts
git commit -m "feat(vue): dispatch action buttons on notification cards (gated + pending state)"
```

---

## Unit I — Verify, e2e, reviews, docs

### Task 18: e2e swap

**Files:**

- Create: `frontend/e2e/dispatch.spec.ts`
- Deleted already (Task 14): `frontend/e2e/generator.spec.ts`

**Interfaces:**

- Consumes: the running stack (reference app + backend + module-sim). The spec publishes via module-sim `/emit` (or directly via `/internal/publish` with a dispatch action) and drives the dispatch button.

- [ ] **Step 1: Write the e2e**

Cover: (1) **control center / emit → feed** — trigger an actionable emit, assert the card appears; (2) **dispatch happy path** — click Approve, assert the card resolves + a success message; (3) **dispatch failure** — force a module error (e.g. click twice / an action the module rejects), assert the button re-enables and shows the error. Follow the existing e2e setup (login helper, `BACKEND` publish pattern) from `feed.spec.ts`/`admin.spec.ts`.

- [ ] **Step 2: Run e2e**

Run: `pnpm test:e2e`
Expected: the 5 unchanged specs (`feed`, `ai-chat`, `ai-summary`, `admin`, `qol`) PASS untouched; the new `dispatch.spec.ts` PASSES. If any of the 5 changed behavior, that's a regression — fix the code, not the spec.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/dispatch.spec.ts
git commit -m "test(e2e): control-center emit + action dispatch (replaces generator spec)"
```

### Task 19: whole-repo verify + reviews + docs

- [ ] **Step 1: Full green** — `pnpm lint && pnpm typecheck && pnpm build && pnpm test` all clean. `pnpm --filter @notifications/core test` confirms `boundary.test.ts` green (core still env/identity-free).

- [ ] **Step 2: API docs** — dispatch `docs-writer` to update `docs/api/notifications.md` (`POST /notifications/:id/actions/:ref/dispatch`: request `{idempotencyKey}`, `200 {ok,message?,resolve?,actions?}`, 400/401/403/404/409, side effect = `action_dispatches` row + possible markRead) and `docs/api/admin.md` (`PATCH /admin/modules/:key` now accepts `baseUrl`). Add a short `docs/api/` note for module-sim's `/emit`, `/catalog`, `/:module/actions/:name` if that file exists for internal endpoints.

- [ ] **Step 3: Reviews** — `code-reviewer` on the branch; `security-reviewer` (new dispatch endpoint, service-to-service egress, token handling, SSRF-by-construction, PII-safe logging, ownership/visibility check); `frontend-design-reviewer` on the card + admin base_url UI. Address Critical/Important findings.

- [ ] **Step 4: Mentor gate** — surface the §3 action contract + §4 response contract for mentor sign-off. **Do not open a PR / merge until signed off.** Then use `/code-review` and `/open-pr` with a real description.

---

## Self-Review (plan vs. spec)

**Spec coverage:** §1 goal → Tasks 6–8,16,17. §2 round-trip → 7,9,11,16. §3 action contract → 1. §4 response contract → 1 (+ applied in 7,16). §5 registry/egress → 3,4,5,7,9. §6 durability/idempotency → 6,7. §7 module-sim → 10,11,12. §8 control center + generator removal → 13,14. §9 frontend → 16,17. §10 testing → every task + 18. §11 security → 7,8,9 + review in 19. §12 out-of-scope → not implemented (correct). §13 build units A–I → Tasks 1–19. No gaps.

**Placeholder scan:** the only intentionally-sketched blocks are test _bodies_ in Tasks 5, 11, 13, 18 where the harness must match an existing spec's setup — each names the exact assertions and the file to mirror. All production code steps carry complete code.

**Type consistency:** `ActionDispatcher.dispatch({url,method,body}) → {status,body}` (Tasks 7, 9) matches. `dispatchAction({principal,notificationId,actionRef,idempotencyKey}) → ActionDispatchResult` consistent across Tasks 7, 8, 16. `moduleActionResponseSchema`/`ModuleActionResponse` (Task 1) used in 7, 9, 16. `ModulePolicyView.baseUrl` (Task 3) used in 4, 5. `action_ref` is the string index throughout (Tasks 6, 7, 8, 16, 17). Store keyed by `user_key`/`userKey` consistently (Task 6) — with the explicit instruction to match `notification_reads`' actual keying.
