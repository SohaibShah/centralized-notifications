# Notification Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hidden, admin-gated, non-production notification generator (`POST /admin/simulate` + an in-app admin "Generator" panel) so the team can push custom / preset / burst / drip notifications through the real ingest pipeline without the internal intake token.

**Architecture:** A new non-prod-only Fastify plugin (`simulateRoutes`) accepts a zod discriminated union (`custom` | `preset` | `burst`), server-assigns notification ids, and runs each notification through the existing `ingest()` pipeline (dedupe, policy/suppression, SSE all fire for real), returning `{ published, suppressed }`. The frontend adds a `GeneratorPanel` to the existing `/admin` sub-nav (gated on dev build + admin), reusing the shared `FormRenderer` — which we extend with the one missing field type (`select`) and the never-implemented `showIf` visibility. Drip is client-side (a `setInterval` that repeats a burst); the backend stays stateless.

**Tech Stack:** Backend — Fastify 5, zod, `pg`, existing `ingest()`/`simulate()`/policy. Frontend — Vue 3 `<script setup>`, Pinia, Tailwind v4, the shared `FormRenderer`. Tests — Vitest (backend + frontend), Playwright (e2e).

## Global Constraints

- **Endpoint:** `POST /admin/simulate`, `preHandler: requireAdmin`, **registered only when `getEnv().NODE_ENV !== "production"`** — the route is genuinely absent in prod, not merely hidden.
- **Server owns ids:** custom/preset get `sim-<ts>-<i>-<rand>`; burst uses `simulate()`'s own unique ids. Any client-supplied `id` is ignored (custom body is validated against `notificationSchema.omit({ id: true })`).
- **Real pipeline only:** every generated notification goes through the existing `ingest()`. **No pipeline changes.** Do not add a parallel publish path.
- **Never expose `x-internal-token` to the browser.** This endpoint exists precisely so the FE never holds that secret.
- **Forms go through the shared `FormRenderer`** (json-form-conventions) — never hand-roll an input. New field type = new field component + a branch in `FormRenderer` + a branch in `validation.ts`.
- **Validate at the boundary with zod** before touching the pipeline. TypeScript strict; `any` requires an inline justification comment.
- **Burst has no low cap** (stress testing is a goal). It is bounded only by a high, env-configurable ceiling `SIMULATE_MAX_BURST` (default `10000`) and ingested in **chunks of 500**.
- **Triple gate on the FE Generator:** `import.meta.env.DEV` (absent from prod builds) **and** `session.isAdmin` **and** the non-prod server route.
- `pnpm lint` and `pnpm typecheck` must be clean before any task is "done."
- **Commits:** Conventional Commits (`feat:`/`test:`/`docs:`). **Never** add "Generated with AI" / "Co-Authored-By: AI" or any AI-attribution trailer.
- **API docs:** `docs/api/admin.md` must document `POST /admin/simulate` (api-documentation rule).
- Branch: `feat/notification-generator`.

---

## File Structure

**Backend**

- Create `backend/src/sim/presets.ts` — preset registry (`PRESET_IDS`, `PRESETS`, `buildPreset`) + `SAMPLE_ACTIONS` + `sampleActions(n)`. Pure, reuses the `Notification` contract.
- Create `backend/src/http/admin/simulate.ts` — `simulateSchema` (discriminated union + ceiling refine), `simulateRoutes(app)` plugin, `buildBatch`, `ingestAll`, `makeSimId`.
- Modify `backend/src/config/env.ts` — add `SIMULATE_MAX_BURST`.
- Modify `backend/src/server.ts` — export `isSimulatorEnabled(env)`; register `simulateRoutes` only when enabled.

**Frontend — form system**

- Create `frontend/src/forms/fields/SelectField.vue` — native `<select>` field component.
- Modify `frontend/src/forms/types.ts` — `showIf` gains `notEquals`.
- Modify `frontend/src/forms/FormRenderer.vue` — `select` branch + `showIf` visibility filtering.
- Modify `frontend/src/forms/validation.ts` — `select` validates as one-of-`options`.
- Modify `frontend/src/forms/fields/TextField.vue` — render a `<datalist>` when a text field carries `options`.

**Frontend — generator**

- Modify `frontend/src/features/admin/adminApi.ts` — `simulate(spec)` + request/response types + `fetchModuleKeys()`.
- Create `frontend/src/forms/generator.form.ts` — `generatorForm(modules)` factory + pure `toCustomSpec(values)` mapper.
- Create `frontend/src/forms/burst.form.ts` and `frontend/src/forms/drip.form.ts`.
- Create `frontend/src/features/admin/GeneratorPanel.vue` — mode switcher (Custom · Presets · Burst · Drip) + result/error line.
- Modify `frontend/src/features/admin/AdminView.vue` — add the dev-only "Generator" sub-nav item + section.

**Tests / docs**

- Create `backend/test/presets.test.ts`, `backend/test/simulate.test.ts`.
- Create `frontend/src/forms/SelectField.spec.ts`, `frontend/src/forms/FormRenderer.spec.ts`, `frontend/src/features/admin/GeneratorPanel.spec.ts`, `frontend/src/forms/generator.form.spec.ts`.
- Create `frontend/e2e/generator.spec.ts`.
- Modify `docs/api/admin.md`.

---

### Task 1: Preset registry + sample actions (backend, pure)

**Files:**

- Create: `backend/src/sim/presets.ts`
- Test: `backend/test/presets.test.ts`

**Interfaces:**

- Consumes: `Notification`, `NotificationAction` from `@notifications/shared`.
- Produces:
  - `PRESET_IDS: readonly ["critical-dsr","high-access","normal-finding","low-assessment","long-body"]`
  - `type PresetId = (typeof PRESET_IDS)[number]`
  - `PRESETS: Record<PresetId, { label: string; blurb: string; build: () => Omit<Notification,"id"> }>`
  - `buildPreset(id: PresetId): Omit<Notification,"id">`
  - `SAMPLE_ACTIONS: NotificationAction[]` (length 3)
  - `sampleActions(n: number): NotificationAction[]` — `SAMPLE_ACTIONS.slice(0, n)`

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/presets.test.ts
import { describe, expect, it } from "vitest";
import { notificationSchema } from "@notifications/shared";
import {
  PRESET_IDS,
  PRESETS,
  buildPreset,
  SAMPLE_ACTIONS,
  sampleActions,
} from "../src/sim/presets";

describe("presets", () => {
  it("every preset builds a body that is contract-valid once an id is attached", () => {
    for (const id of PRESET_IDS) {
      const body = buildPreset(id);
      const parsed = notificationSchema.safeParse({ ...body, id: `t-${id}` });
      expect(
        parsed.success,
        `${id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    }
  });

  it("exposes a label + blurb for each preset id", () => {
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].label.length).toBeGreaterThan(0);
      expect(PRESETS[id].blurb.length).toBeGreaterThan(0);
    }
  });

  it("high-access preset carries sample actions; long-body preset has a long description", () => {
    expect(buildPreset("high-access").actions?.length).toBeGreaterThan(0);
    expect(buildPreset("long-body").description.length).toBeGreaterThan(500);
  });

  it("sampleActions slices the canned list to n (0..3)", () => {
    expect(SAMPLE_ACTIONS).toHaveLength(3);
    expect(sampleActions(0)).toHaveLength(0);
    expect(sampleActions(2)).toHaveLength(2);
    expect(sampleActions(3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @notifications/backend test presets`
Expected: FAIL — cannot find module `../src/sim/presets`.

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/sim/presets.ts
import type { Notification, NotificationAction } from "@notifications/shared";

/**
 * Named one-click templates for the dev/QA generator (backend/src/http/admin/simulate.ts).
 * Each `build()` returns a contract-valid notification body WITHOUT an id — the route
 * assigns a server-controlled id so repeated generation never dedupes against itself.
 * Deterministic (no RNG): a preset always produces the same body, which keeps the panel
 * predictable and the tests stable.
 */

export const PRESET_IDS = [
  "critical-dsr",
  "high-access",
  "normal-finding",
  "low-assessment",
  "long-body",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

/** Canned actions the generator can attach (custom mode's `sampleActions`, and presets). */
export const SAMPLE_ACTIONS: NotificationAction[] = [
  { label: "Review", method: "GET", url: "https://app.example.com/review", icon: "external-link" },
  { label: "Approve", method: "POST", url: "https://app.example.com/approve", icon: "check" },
  { label: "Dismiss", method: "POST", url: "https://app.example.com/dismiss", icon: "x" },
];

/** First `n` canned actions (n clamped to the available list). */
export function sampleActions(n: number): NotificationAction[] {
  return SAMPLE_ACTIONS.slice(0, Math.max(0, n));
}

const LONG_BODY = Array.from(
  { length: 12 },
  () =>
    "This is a deliberately long notification body used to exercise multi-line rendering, truncation, and the expand affordance in the feed and toast.",
).join(" ");

export const PRESETS: Record<
  PresetId,
  { label: string; blurb: string; build: () => Omit<Notification, "id"> }
> = {
  "critical-dsr": {
    label: "Critical DSR",
    blurb: "A data-subject request about to breach SLA.",
    build: () => ({
      module: "dsr",
      title: "DSR approaching SLA breach",
      description: "A data-subject request is within 24 hours of its statutory deadline.",
      priority: "critical",
      snoozable: false,
      category: "sla",
      audience: { scope: "global" },
      actions: [
        {
          label: "Open DSR",
          method: "GET",
          url: "https://app.example.com/dsr/1",
          icon: "folder-open",
        },
      ],
    }),
  },
  "high-access": {
    label: "High · access request",
    blurb: "Access approval with Approve/Deny/Review actions.",
    build: () => ({
      module: "access-governance",
      title: "Access request awaiting your approval",
      description: "A user requested elevated access to a data catalog.",
      priority: "high",
      snoozable: false,
      category: "approvals",
      audience: { scope: "global" },
      actions: sampleActions(3),
    }),
  },
  "normal-finding": {
    label: "Normal · data finding",
    blurb: "A routine scan classification result.",
    build: () => ({
      module: "data-mapping",
      title: "Sensitive data found in new data stores",
      description: "The latest scan classified sensitive data in 3 stores.",
      priority: "normal",
      snoozable: true,
      audience: { scope: "global" },
    }),
  },
  "low-assessment": {
    label: "Low · assessment reminder",
    blurb: "A low-priority reminder with a single link.",
    build: () => ({
      module: "assessments",
      title: "Assessments due this week",
      description: "4 assessments assigned to you are still in draft.",
      priority: "low",
      snoozable: true,
      category: "reminders",
      audience: { scope: "global" },
      actions: [
        {
          label: "View assessments",
          method: "GET",
          url: "https://app.example.com/assessments",
          icon: "clipboard-list",
        },
      ],
    }),
  },
  "long-body": {
    label: "Long body",
    blurb: "A very long description to test truncation/expand.",
    build: () => ({
      module: "data-mapping",
      title: "Detailed scan report with an unusually long summary",
      description: LONG_BODY,
      priority: "normal",
      snoozable: true,
      audience: { scope: "global" },
    }),
  },
};

export function buildPreset(id: PresetId): Omit<Notification, "id"> {
  return PRESETS[id].build();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @notifications/backend test presets`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @notifications/backend typecheck`
Expected: clean.

```bash
git add backend/src/sim/presets.ts backend/test/presets.test.ts
git commit -m "feat(sim): preset registry + sample actions for the generator"
```

---

### Task 2: `POST /admin/simulate` endpoint + non-prod registration (backend)

**Files:**

- Create: `backend/src/http/admin/simulate.ts`
- Modify: `backend/src/config/env.ts` (add `SIMULATE_MAX_BURST`)
- Modify: `backend/src/server.ts` (export `isSimulatorEnabled`, conditionally register)
- Test: `backend/test/simulate.test.ts`

**Interfaces:**

- Consumes: `requireAdmin` from `../../auth/guards`; `ingest` from `../../pipeline/ingest`; `isModuleEnabled` from `../../pipeline/policy`; `simulate` from `../../sim/simulator`; `PRESET_IDS`/`buildPreset`/`sampleActions` from `../../sim/presets`; `getEnv` from `../../config/env`; `notificationSchema`/`Notification` from `@notifications/shared`.
- Produces:
  - `simulateRoutes(app: FastifyInstance): Promise<void>` — registers `POST /admin/simulate`.
  - `isSimulatorEnabled(env?: Env): boolean` (exported from `server.ts`).
  - Response body: `{ published: number; suppressed: number }`.

- [ ] **Step 1: Add `SIMULATE_MAX_BURST` to the env schema**

In `backend/src/config/env.ts`, add to the `envSchema` object (after `PORT`):

```ts
  // Runaway ceiling for the dev/QA generator's burst mode (backend/src/http/admin/simulate.ts).
  // Not a product limit — stress testing is a goal — just a guard so one request can't loop
  // unbounded and hang. Only consulted when the (non-prod) simulate route is registered.
  SIMULATE_MAX_BURST: z.coerce.number().int().positive().default(10000),
```

- [ ] **Step 2: Write the failing test**

```ts
// backend/test/simulate.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../src/auth/password";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";
import { invalidatePolicyCache } from "../src/pipeline/policy";
import { buildServer, isSimulatorEnabled } from "../src/server";
import { loadEnv } from "../src/config/env";

const PW = "sim-test-pass";

describe("isSimulatorEnabled", () => {
  const base = {
    DATABASE_URL: "postgres://x",
    SESSION_SECRET: "a".repeat(64),
    INTERNAL_INTAKE_TOKEN: "0123456789abcdef",
  };
  it("is false in production, true otherwise", () => {
    expect(isSimulatorEnabled(loadEnv({ ...base, NODE_ENV: "production" }))).toBe(false);
    expect(isSimulatorEnabled(loadEnv({ ...base, NODE_ENV: "development" }))).toBe(true);
    expect(isSimulatorEnabled(loadEnv({ ...base, NODE_ENV: "test" }))).toBe(true);
  });
});

describe("POST /admin/simulate", () => {
  let app: FastifyInstance;

  async function login(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password: PW },
    });
    expect(res.statusCode).toBe(200);
    const raw = res.headers["set-cookie"];
    const c = Array.isArray(raw) ? raw[0] : raw;
    return (c ?? "").split(";")[0] ?? "";
  }

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM notifications WHERE id LIKE 'sim-%' OR module = 'sim-disabled'");
    await query("DELETE FROM modules WHERE key = 'sim-disabled'");
    await query("DELETE FROM users WHERE username IN ('sim_admin', 'sim_plain')");
    await query(
      "INSERT INTO roles (key, label) VALUES ('admin', 'Administrator') ON CONFLICT (key) DO NOTHING",
    );
    const hash = await hashPassword(PW);
    const admin = await query<{ id: string }>(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('sim_admin', 'Sim Admin', $1) RETURNING id",
      [hash],
    );
    await query("INSERT INTO user_roles (user_id, role_key) VALUES ($1, 'admin')", [
      admin.rows[0]!.id,
    ]);
    await query(
      "INSERT INTO users (username, display_name, password_hash) VALUES ('sim_plain', 'Sim Plain', $1)",
      [hash],
    );
    // A disabled module so a custom publish to it comes back suppressed.
    await query(
      "INSERT INTO modules (key, label, enabled) VALUES ('sim-disabled', 'Sim Disabled', false)",
    );
    invalidatePolicyCache();
    app = await buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("401 without a session, 403 for a non-admin", async () => {
    const anon = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      payload: { mode: "preset", preset: "normal-finding" },
    });
    expect(anon.statusCode).toBe(401);
    const plain = await login("sim_plain");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie: plain },
      payload: { mode: "preset", preset: "normal-finding" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("custom mode publishes one, with a server-assigned sim- id, and returns published:1", async () => {
    const cookie = await login("sim_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: {
        mode: "custom",
        sampleActions: 2,
        notification: {
          id: "CLIENT-SHOULD-BE-IGNORED",
          module: "sim-custom",
          title: "Custom one",
          description: "",
          priority: "high",
          snoozable: true,
          audience: { scope: "global" },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ published: 1, suppressed: 0 });
    const list = await app.inject({
      method: "GET",
      url: "/notifications?limit=50",
      headers: { cookie },
    });
    const items = list.json().items as { id: string; module: string; actions?: unknown[] }[];
    const mine = items.find((n) => n.module === "sim-custom");
    expect(mine?.id.startsWith("sim-")).toBe(true);
    expect(mine?.actions).toHaveLength(2);
  });

  it("a custom publish to a disabled module is suppressed and absent from the feed", async () => {
    const cookie = await login("sim_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: {
        mode: "custom",
        notification: {
          module: "sim-disabled",
          title: "Nope",
          description: "",
          priority: "low",
          snoozable: true,
          audience: { scope: "global" },
        },
      },
    });
    expect(res.json()).toEqual({ published: 0, suppressed: 1 });
    const list = await app.inject({
      method: "GET",
      url: "/notifications?limit=100",
      headers: { cookie },
    });
    const items = list.json().items as { module: string }[];
    expect(items.some((n) => n.module === "sim-disabled")).toBe(false);
  });

  it("burst mode publishes N (published + suppressed == N)", async () => {
    const cookie = await login("sim_admin");
    const res = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "burst", count: 12, seed: 7 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { published: number; suppressed: number };
    expect(body.published + body.suppressed).toBe(12);
  });

  it("rejects a bad body, a non-positive count, and an over-ceiling count with 400", async () => {
    const cookie = await login("sim_admin");
    const bad = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "custom", notification: { title: "no module" } },
    });
    expect(bad.statusCode).toBe(400);
    const zero = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "burst", count: 0 },
    });
    expect(zero.statusCode).toBe(400);
    const huge = await app.inject({
      method: "POST",
      url: "/admin/simulate",
      headers: { cookie },
      payload: { mode: "burst", count: 10_000_000 },
    });
    expect(huge.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @notifications/backend test simulate`
Expected: FAIL — `isSimulatorEnabled` / route not found.

- [ ] **Step 4: Write the route plugin**

```ts
// backend/src/http/admin/simulate.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Notification, notificationSchema } from "@notifications/shared";
import { requireAdmin } from "../../auth/guards";
import { getEnv } from "../../config/env";
import { ingest } from "../../pipeline/ingest";
import { isModuleEnabled } from "../../pipeline/policy";
import { simulate } from "../../sim/simulator";
import { PRESET_IDS, buildPreset, sampleActions } from "../../sim/presets";

/**
 * The dev/QA notification generator (POST /admin/simulate). Registered only in
 * non-production (see server.ts `isSimulatorEnabled`) so the route is absent in prod.
 * Every mode server-assigns notification ids and runs each notification through the
 * real `ingest()` pipeline, so dedupe, policy/suppression, and SSE all fire authentically.
 */

const customSchema = z.object({
  mode: z.literal("custom"),
  // Client id is ignored — omit it from the accepted shape so the server always assigns one.
  notification: notificationSchema.omit({ id: true }),
  sampleActions: z.number().int().min(0).max(3).optional(),
});
const presetSchema = z.object({ mode: z.literal("preset"), preset: z.enum(PRESET_IDS) });
const burstSchema = z.object({
  mode: z.literal("burst"),
  count: z.number().int().positive(),
  seed: z.number().int().optional(),
});

// The ceiling is env-configurable, so it can't be a static `.max()` on the member; a
// discriminated-union member also can't be a ZodEffects. Enforce it on the whole union.
const simulateSchema = z
  .discriminatedUnion("mode", [customSchema, presetSchema, burstSchema])
  .superRefine((val, ctx) => {
    if (val.mode === "burst") {
      const max = getEnv().SIMULATE_MAX_BURST;
      if (val.count > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "number",
          maximum: max,
          inclusive: true,
          path: ["count"],
          message: `count exceeds SIMULATE_MAX_BURST (${max})`,
        });
      }
    }
  });

type SimulateInput = z.infer<typeof simulateSchema>;

interface SimulateResult {
  published: number;
  suppressed: number;
}

let simCounter = 0;
function makeSimId(): string {
  // ts + monotonic counter + random keeps ids unique even within a tight burst loop.
  return `sim-${Date.now().toString(36)}-${(simCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBatch(spec: SimulateInput): Notification[] {
  switch (spec.mode) {
    case "custom": {
      const actions =
        spec.sampleActions && spec.sampleActions > 0 && !spec.notification.actions
          ? sampleActions(spec.sampleActions)
          : spec.notification.actions;
      return [{ ...spec.notification, id: makeSimId(), ...(actions ? { actions } : {}) }];
    }
    case "preset":
      return [{ ...buildPreset(spec.preset), id: makeSimId() }];
    case "burst":
      // simulate() assigns its own unique per-burst ids — already server-controlled.
      return simulate({ count: spec.count, seed: spec.seed });
  }
}

const CHUNK = 500;

/**
 * Ingest a batch, chunked, tallying published vs policy-suppressed. Since the pipeline's
 * IngestResult doesn't expose the delivered/suppressed flag, we re-derive it per module
 * via isModuleEnabled (cheap, cached in the policy layer and locally memoized here).
 */
async function ingestAll(batch: Notification[]): Promise<SimulateResult> {
  let published = 0;
  let suppressed = 0;
  const enabledByModule = new Map<string, boolean>();
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (n) => {
        const res = await ingest(n);
        if (res.status !== "accepted") return; // duplicate/invalid: not counted (ids are unique)
        let enabled = enabledByModule.get(n.module);
        if (enabled === undefined) {
          enabled = await isModuleEnabled(n.module);
          enabledByModule.set(n.module, enabled);
        }
        if (enabled) published++;
        else suppressed++;
      }),
    );
  }
  return { published, suppressed };
}

export async function simulateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/simulate", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
    const result = await ingestAll(buildBatch(parsed.data));
    return reply.code(200).send(result);
  });
}
```

- [ ] **Step 5: Wire it into `server.ts` (non-prod only)**

In `backend/src/server.ts`, add imports near the others:

```ts
import { getEnv, type Env } from "./config/env";
import { simulateRoutes } from "./http/admin/simulate";
```

Add the exported guard above `buildServer`:

```ts
/**
 * The dev/QA notification generator is a non-production tool: its route (POST /admin/simulate)
 * is registered only outside production, so it is genuinely absent — not merely hidden — in prod.
 */
export function isSimulatorEnabled(env: Env = getEnv()): boolean {
  return env.NODE_ENV !== "production";
}
```

Register it right after `adminRoutes`:

```ts
await app.register(adminRoutes);
if (isSimulatorEnabled()) await app.register(simulateRoutes);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @notifications/backend test simulate`
Expected: PASS (7 tests). Then `pnpm --filter @notifications/backend test` — full backend suite green.

- [ ] **Step 7: Typecheck + lint + commit**

Run: `pnpm --filter @notifications/backend typecheck && pnpm lint`
Expected: clean.

```bash
git add backend/src/http/admin/simulate.ts backend/src/config/env.ts backend/src/server.ts backend/test/simulate.test.ts
git commit -m "feat(admin): non-prod POST /admin/simulate generator endpoint"
```

---

### Task 3: FormRenderer `select` field + `showIf` visibility (frontend)

**Files:**

- Create: `frontend/src/forms/fields/SelectField.vue`
- Modify: `frontend/src/forms/types.ts`
- Modify: `frontend/src/forms/FormRenderer.vue`
- Modify: `frontend/src/forms/validation.ts`
- Modify: `frontend/src/forms/fields/TextField.vue`
- Test: `frontend/src/forms/SelectField.spec.ts`, `frontend/src/forms/FormRenderer.spec.ts`

**Interfaces:**

- Consumes: `FormField`, `FieldValue`, `FormSchema` from `./types`.
- Produces: a rendered `<select>` for `type: "select"`; `showIf: { field, equals?, notEquals? }` hides/shows fields reactively; `select` validates as one-of-`options`; a text field with `options` renders a `<datalist>`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/forms/SelectField.spec.ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SelectField from "./fields/SelectField.vue";

const field = {
  name: "priority",
  label: "Priority",
  type: "select" as const,
  options: [
    { value: "low", label: "low" },
    { value: "high", label: "high" },
  ],
};

describe("SelectField", () => {
  it("renders one option per config entry", () => {
    const w = mount(SelectField, { props: { field, modelValue: "low" } });
    expect(w.findAll("option")).toHaveLength(2);
  });

  it("emits the selected value", async () => {
    const w = mount(SelectField, { props: { field, modelValue: "low" } });
    await w.get("select").setValue("high");
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["high"]);
  });
});
```

```ts
// frontend/src/forms/FormRenderer.spec.ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FormRenderer from "./FormRenderer.vue";
import type { FormSchema } from "./types";

const schema: FormSchema = {
  id: "t",
  fields: [
    {
      name: "scope",
      label: "Scope",
      type: "select",
      required: true,
      default: "global",
      options: [
        { value: "global", label: "global" },
        { value: "team", label: "team" },
      ],
    },
    {
      name: "id",
      label: "Audience id",
      type: "text",
      showIf: { field: "scope", notEquals: "global" },
    },
  ],
};

describe("FormRenderer select + showIf", () => {
  it("renders a select field", () => {
    const w = mount(FormRenderer, { props: { schema } });
    expect(w.find('select[name="scope"]').exists()).toBe(true);
  });

  it("hides a showIf field until its condition is met", async () => {
    const w = mount(FormRenderer, { props: { schema } });
    expect(w.find('[name="id"]').exists()).toBe(false); // scope defaults to global
    await w.get('select[name="scope"]').setValue("team");
    expect(w.find('[name="id"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @notifications/frontend test forms`
Expected: FAIL — no `SelectField`; `select`/`showIf` not handled.

- [ ] **Step 3: Extend `showIf` in `types.ts`**

Replace the `showIf` line in `FormField`:

```ts
  /** Show this field only when another field's current value matches (equals) / differs from (notEquals). */
  showIf?: { field: string; equals?: string | number | boolean; notEquals?: string | number | boolean };
```

- [ ] **Step 4: Create `SelectField.vue`**

```vue
<!-- frontend/src/forms/fields/SelectField.vue -->
<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";

const props = defineProps<{ field: FormField; error?: string }>();
const model = defineModel<FieldValue>();

// A select always binds a string value from its options.
const value = computed<string>({
  get: () =>
    model.value === undefined || typeof model.value === "boolean" ? "" : String(model.value),
  set: (v) => {
    model.value = v;
  },
});

const fieldId = computed(() => `field-${props.field.name}`);
const errorId = computed(() => `${fieldId.value}-error`);

const controlClass =
  "w-full rounded-md border bg-surface px-3 py-2 text-[16px] text-text " +
  "transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent";
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" class="text-[13px] font-medium text-text">
      {{ field.label }}
      <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
    </label>
    <select
      :id="fieldId"
      v-model="value"
      :name="field.name"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      :class="[controlClass, error ? 'border-danger' : 'border-line-strong']"
    >
      <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <p v-if="error" :id="errorId" role="alert" class="text-[12px] text-danger">{{ error }}</p>
  </div>
</template>
```

- [ ] **Step 5: Add the `select` branch + `showIf` filtering to `FormRenderer.vue`**

Add `computed` to the vue import and import the new field:

```ts
import { computed, reactive, ref } from "vue";
import SelectField from "./fields/SelectField.vue";
```

Add a visibility helper + visible-fields computed (after the `values`/`errors` declarations):

```ts
// showIf: a field is shown only when its referenced field currently matches the condition.
function isVisible(field: FormSchema["fields"][number]): boolean {
  const cond = field.showIf;
  if (!cond) return true;
  const current = values[cond.field];
  if (cond.equals !== undefined) return current === cond.equals;
  if (cond.notEquals !== undefined) return current !== cond.notEquals;
  return true;
}
const visibleFields = computed(() => props.schema.fields.filter(isVisible));
```

Change the template loop to iterate `visibleFields` and add the select branch:

```html
<template v-for="field in visibleFields" :key="field.name">
  <SwitchField
    v-if="field.type === 'switch'"
    v-model="values[field.name]"
    :field="field"
    :error="errors[field.name]"
  />
  <SelectField
    v-else-if="field.type === 'select'"
    v-model="values[field.name]"
    :field="field"
    :error="errors[field.name]"
  />
  <TextField v-else v-model="values[field.name]" :field="field" :error="errors[field.name]" />
</template>
```

Note: `showIf` fields must be optional (a hidden field's value stays in `values` and is still validated on submit) — the generator's only `showIf` field, `audienceId`, is optional, so this is safe.

- [ ] **Step 6: Add `select` validation in `validation.ts`**

In `fieldSchema`, before the `let base = z.string();` block, add:

```ts
if (field.type === "select" && field.options?.length) {
  const optionValues = field.options.map((o) => o.value) as [string, ...string[]];
  const base = z.enum(optionValues);
  return field.required ? base : base.optional();
}
```

- [ ] **Step 7: Add datalist support to `TextField.vue`**

On the `<input>` element add a `:list` binding, and after the input add a `<datalist>`:

```html
:list="field.options?.length ? `${fieldId}-list` : undefined"
```

```html
<datalist v-if="field.options?.length" :id="`${fieldId}-list`">
  <option v-for="opt in field.options" :key="opt.value" :value="opt.value" />
</datalist>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test forms`
Expected: PASS (SelectField 2, FormRenderer 2). Then `pnpm --filter @notifications/frontend test` — existing form/panel suites still green.

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck`
Expected: clean.

```bash
git add frontend/src/forms/fields/SelectField.vue frontend/src/forms/types.ts frontend/src/forms/FormRenderer.vue frontend/src/forms/validation.ts frontend/src/forms/fields/TextField.vue frontend/src/forms/SelectField.spec.ts frontend/src/forms/FormRenderer.spec.ts
git commit -m "feat(forms): select field type + showIf visibility for FormRenderer"
```

---

### Task 4: Generator API client + form schemas + mapper (frontend)

**Files:**

- Modify: `frontend/src/features/admin/adminApi.ts`
- Create: `frontend/src/forms/generator.form.ts`
- Create: `frontend/src/forms/burst.form.ts`
- Create: `frontend/src/forms/drip.form.ts`
- Test: `frontend/src/forms/generator.form.spec.ts`

**Interfaces:**

- Consumes: `api` from `@/api/client`; `Notification`, `NotificationPriority`, `AudienceScope`, `NOTIFICATION_PRIORITIES`, `AUDIENCE_SCOPES` from `@notifications/shared`; `FormSchema`, `FormValues` from `@/forms/types`; `AdminModule`/`fetchModules` already in `adminApi`.
- Produces:
  - `type SimulateSpec` (`CustomSpec | PresetSpec | BurstSpec`), `interface SimulateResult { published: number; suppressed: number }`.
  - `simulate(spec: SimulateSpec): Promise<SimulateResult>` and `fetchModuleKeys(): Promise<string[]>` in `adminApi.ts`.
  - `generatorForm(modules: string[]): FormSchema`, `toCustomSpec(values: FormValues): CustomSpec`.
  - `burstForm: FormSchema`, `dripForm: FormSchema`.

- [ ] **Step 1: Write the failing test for the mapper**

```ts
// frontend/src/forms/generator.form.spec.ts
import { describe, expect, it } from "vitest";
import { generatorForm, toCustomSpec } from "./generator.form";

describe("generatorForm", () => {
  it("offers discovered modules as datalist options on the module field", () => {
    const module = generatorForm(["dsr", "assessments"]).fields.find((f) => f.name === "module");
    expect(module?.options?.map((o) => o.value)).toEqual(["dsr", "assessments"]);
  });
});

describe("toCustomSpec", () => {
  it("maps flat form values into the nested custom spec, global audience without id", () => {
    const spec = toCustomSpec({
      module: "dsr",
      title: "Hi",
      description: "",
      priority: "high",
      snoozable: true,
      category: "",
      audienceScope: "global",
      audienceId: "",
      sampleActions: 0,
    });
    expect(spec).toEqual({
      mode: "custom",
      notification: {
        module: "dsr",
        title: "Hi",
        description: "",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
  });

  it("includes audience.id for non-global scope, category when set, and sampleActions when > 0", () => {
    const spec = toCustomSpec({
      module: "dsr",
      title: "Hi",
      description: "body",
      priority: "low",
      snoozable: false,
      category: "sla",
      audienceScope: "team",
      audienceId: "privacy-ops",
      sampleActions: 2,
    });
    expect(spec.notification.audience).toEqual({ scope: "team", id: "privacy-ops" });
    expect(spec.notification.category).toBe("sla");
    expect(spec.sampleActions).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test generator.form`
Expected: FAIL — module `./generator.form` not found.

- [ ] **Step 3: Add `simulate` + `fetchModuleKeys` to `adminApi.ts`**

Append to `frontend/src/features/admin/adminApi.ts`:

```ts
import type { Notification } from "@notifications/shared";

export interface CustomSpec {
  mode: "custom";
  notification: Omit<Notification, "id">;
  sampleActions?: number;
}
export interface PresetSpec {
  mode: "preset";
  preset: string;
}
export interface BurstSpec {
  mode: "burst";
  count: number;
  seed?: number;
}
export type SimulateSpec = CustomSpec | PresetSpec | BurstSpec;

export interface SimulateResult {
  published: number;
  suppressed: number;
}

/** POST /admin/simulate — the non-prod dev/QA generator endpoint. */
export function simulate(spec: SimulateSpec): Promise<SimulateResult> {
  return api.post<SimulateResult>("/admin/simulate", spec);
}

/** Discovered module keys, for the custom form's module datalist. */
export async function fetchModuleKeys(): Promise<string[]> {
  return (await fetchModules()).map((m) => m.key);
}
```

(Keep the existing `import { api }` / `NotificationPriority` import at the top; add the `Notification` type import there rather than mid-file if the linter prefers — the block above shows it for completeness.)

- [ ] **Step 4: Create `generator.form.ts`**

```ts
// frontend/src/forms/generator.form.ts
import { AUDIENCE_SCOPES, NOTIFICATION_PRIORITIES } from "@notifications/shared";
import type { AudienceScope, NotificationPriority } from "@notifications/shared";
import type { CustomSpec } from "@/features/admin/adminApi";
import type { FormSchema, FormValues } from "./types";

/** The custom-notification form. `modules` become datalist suggestions on the free-text module field. */
export function generatorForm(modules: string[]): FormSchema {
  return {
    id: "generator",
    fields: [
      {
        name: "module",
        label: "Module",
        type: "text",
        required: true,
        maxLength: 100,
        placeholder: "e.g. dsr",
        options: modules.map((m) => ({ value: m, label: m })),
      },
      { name: "title", label: "Title", type: "text", required: true, maxLength: 500 },
      { name: "description", label: "Description", type: "textarea", maxLength: 5000 },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        required: true,
        default: "normal",
        options: NOTIFICATION_PRIORITIES.map((p) => ({ value: p, label: p })),
      },
      {
        name: "category",
        label: "Category",
        type: "text",
        maxLength: 100,
        placeholder: "optional",
      },
      { name: "snoozable", label: "Snoozable", type: "switch" },
      {
        name: "audienceScope",
        label: "Audience scope",
        type: "select",
        required: true,
        default: "global",
        options: AUDIENCE_SCOPES.map((s) => ({ value: s, label: s })),
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "text",
        maxLength: 200,
        placeholder: "team / role / user id",
        showIf: { field: "audienceScope", notEquals: "global" },
      },
      { name: "sampleActions", label: "Sample actions (0–3)", type: "number", default: 0 },
    ],
    submitLabel: "Publish notification",
    submittingLabel: "Publishing…",
  };
}

/** Map the flat form values into the nested POST /admin/simulate custom spec. */
export function toCustomSpec(values: FormValues): CustomSpec {
  const scope = String(values.audienceScope) as AudienceScope;
  const audience =
    scope === "global"
      ? { scope: "global" as const }
      : { scope, id: String(values.audienceId ?? "") };
  const n = Number(values.sampleActions ?? 0);
  return {
    mode: "custom",
    notification: {
      module: String(values.module),
      title: String(values.title),
      description: String(values.description ?? ""),
      priority: String(values.priority) as NotificationPriority,
      snoozable: values.snoozable === true,
      audience,
      ...(values.category ? { category: String(values.category) } : {}),
    },
    ...(n > 0 ? { sampleActions: n } : {}),
  };
}
```

- [ ] **Step 5: Create `burst.form.ts` and `drip.form.ts`**

```ts
// frontend/src/forms/burst.form.ts
import type { FormSchema } from "./types";

/** Burst control: N varied notifications, optionally seeded for reproducibility. */
export const burstForm: FormSchema = {
  id: "burst",
  fields: [
    { name: "count", label: "Count", type: "number", required: true, default: 25 },
    { name: "seed", label: "Seed (optional)", type: "number", placeholder: "reproducible output" },
  ],
  submitLabel: "Publish burst",
  submittingLabel: "Publishing…",
};
```

```ts
// frontend/src/forms/drip.form.ts
import type { FormSchema } from "./types";

/** Drip control: repeat a burst every N seconds. totalTicks 0 = until Stop. */
export const dripForm: FormSchema = {
  id: "drip",
  fields: [
    { name: "count", label: "Per tick", type: "number", required: true, default: 5 },
    {
      name: "intervalSeconds",
      label: "Every (seconds)",
      type: "number",
      required: true,
      default: 3,
    },
    { name: "totalTicks", label: "Total ticks (0 = until Stop)", type: "number", default: 0 },
  ],
  submitLabel: "Start drip",
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test generator.form`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck`
Expected: clean.

```bash
git add frontend/src/features/admin/adminApi.ts frontend/src/forms/generator.form.ts frontend/src/forms/burst.form.ts frontend/src/forms/drip.form.ts frontend/src/forms/generator.form.spec.ts
git commit -m "feat(admin): generator API client, form schemas, and value mapper"
```

---

### Task 5: GeneratorPanel + AdminView sub-nav (frontend)

**Files:**

- Create: `frontend/src/features/admin/GeneratorPanel.vue`
- Modify: `frontend/src/features/admin/AdminView.vue`
- Test: `frontend/src/features/admin/GeneratorPanel.spec.ts`

**Interfaces:**

- Consumes: `simulate`, `fetchModuleKeys`, `SimulateResult` from `./adminApi`; `generatorForm`, `toCustomSpec` from `@/forms/generator.form`; `burstForm` from `@/forms/burst.form`; `dripForm` from `@/forms/drip.form`; `FormRenderer`; `PRESET_IDS`-equivalent local list; `FormValues`.
- Produces: a `GeneratorPanel` component with modes Custom/Presets/Burst/Drip; AdminView renders it at `section === "generator"`, and shows the nav item only when `import.meta.env.DEV`.

- [ ] **Step 1: Write the failing component test**

```ts
// frontend/src/features/admin/GeneratorPanel.spec.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const { simulateMock, modulesMock } = vi.hoisted(() => ({
  simulateMock: vi.fn(),
  modulesMock: vi.fn(),
}));
vi.mock("./adminApi", () => ({ simulate: simulateMock, fetchModuleKeys: modulesMock }));
const { default: GeneratorPanel } = await import("./GeneratorPanel.vue");

describe("GeneratorPanel", () => {
  beforeEach(() => {
    simulateMock.mockReset();
    modulesMock.mockReset();
    simulateMock.mockResolvedValue({ published: 1, suppressed: 0 });
    modulesMock.mockResolvedValue(["dsr", "assessments"]);
  });

  it("custom submit calls simulate with the mapped custom spec", async () => {
    const w = mount(GeneratorPanel);
    await flushPromises();
    await w.get('input[name="module"]').setValue("dsr");
    await w.get('input[name="title"]').setValue("Hello");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "custom",
        notification: expect.objectContaining({ module: "dsr", title: "Hello" }),
      }),
    );
    expect(w.text()).toContain("Published 1");
  });

  it("a preset click calls simulate with that preset id", async () => {
    const w = mount(GeneratorPanel);
    await flushPromises();
    await w.get('[data-test="mode-preset"]').trigger("click");
    await w.get('[data-test="preset-critical-dsr"]').trigger("click");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith({ mode: "preset", preset: "critical-dsr" });
  });

  it("burst submit calls simulate with count and seed", async () => {
    const w = mount(GeneratorPanel);
    await flushPromises();
    await w.get('[data-test="mode-burst"]').trigger("click");
    await w.get('input[name="count"]').setValue("8");
    await w.get('input[name="seed"]').setValue("3");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(simulateMock).toHaveBeenCalledWith({ mode: "burst", count: 8, seed: 3 });
  });

  it("drip start publishes on each tick and stop clears the timer", async () => {
    vi.useFakeTimers();
    const w = mount(GeneratorPanel);
    await flushPromises();
    await w.get('[data-test="mode-drip"]').trigger("click");
    await w.get('input[name="count"]').setValue("2");
    await w.get('input[name="intervalSeconds"]').setValue("1");
    await w.get("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(simulateMock).toHaveBeenCalledWith({ mode: "burst", count: 2 });
    const callsAfterOneTick = simulateMock.mock.calls.length;
    await w.get('[data-test="drip-stop"]').trigger("click");
    await vi.advanceTimersByTimeAsync(3000);
    expect(simulateMock.mock.calls.length).toBe(callsAfterOneTick);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test GeneratorPanel`
Expected: FAIL — `GeneratorPanel.vue` does not exist.

- [ ] **Step 3: Create `GeneratorPanel.vue`**

```vue
<!-- frontend/src/features/admin/GeneratorPanel.vue -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { FlaskConical } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Icon from "@/components/ui/Icon.vue";
import FormRenderer from "@/forms/FormRenderer.vue";
import { burstForm } from "@/forms/burst.form";
import { dripForm } from "@/forms/drip.form";
import { generatorForm, toCustomSpec } from "@/forms/generator.form";
import type { FormSchema, FormValues } from "@/forms/types";
import { fetchModuleKeys, simulate, type SimulateResult, type SimulateSpec } from "./adminApi";

type Mode = "custom" | "preset" | "burst" | "drip";
const modes: { id: Mode; label: string }[] = [
  { id: "custom", label: "Custom" },
  { id: "preset", label: "Presets" },
  { id: "burst", label: "Burst" },
  { id: "drip", label: "Drip" },
];

// Preset ids/labels mirror backend/src/sim/presets.ts PRESET_IDS.
const presets: { id: string; label: string; blurb: string }[] = [
  { id: "critical-dsr", label: "Critical DSR", blurb: "SLA-breaching data-subject request." },
  { id: "high-access", label: "High · access request", blurb: "Approval with action buttons." },
  { id: "normal-finding", label: "Normal · data finding", blurb: "Routine scan classification." },
  { id: "low-assessment", label: "Low · assessment reminder", blurb: "Low-priority reminder." },
  { id: "long-body", label: "Long body", blurb: "Very long description." },
];

const mode = ref<Mode>("custom");
const submitting = ref(false);
const error = ref<string | null>(null);
const result = ref<SimulateResult | null>(null);

const customSchema = ref<FormSchema>(generatorForm([]));
onMounted(async () => {
  try {
    customSchema.value = generatorForm(await fetchModuleKeys());
  } catch {
    // Datalist is a convenience; a fetch failure just means no suggestions.
  }
});

async function run(spec: SimulateSpec): Promise<void> {
  submitting.value = true;
  error.value = null;
  try {
    result.value = await simulate(spec);
  } catch {
    error.value = "Couldn't publish. Check you're signed in as an admin and try again.";
    throw new Error("simulate failed"); // let drip stop on error
  } finally {
    submitting.value = false;
  }
}

function onCustom(values: FormValues): void {
  void run(toCustomSpec(values)).catch(() => {});
}
function onPreset(id: string): void {
  void run({ mode: "preset", preset: id }).catch(() => {});
}
function onBurst(values: FormValues): void {
  const seed = values.seed === "" || values.seed === undefined ? undefined : Number(values.seed);
  void run({
    mode: "burst",
    count: Number(values.count),
    ...(seed !== undefined ? { seed } : {}),
  }).catch(() => {});
}

// Drip: repeat a burst every interval, up to totalTicks (0 = until Stop). Client-side only.
const dripping = ref(false);
let dripTimer: ReturnType<typeof setInterval> | undefined;
let ticksDone = 0;

function stopDrip(): void {
  if (dripTimer) clearInterval(dripTimer);
  dripTimer = undefined;
  dripping.value = false;
}
function onDrip(values: FormValues): void {
  stopDrip();
  const count = Number(values.count);
  const intervalMs = Math.max(1, Number(values.intervalSeconds)) * 1000;
  const total = Number(values.totalTicks ?? 0);
  ticksDone = 0;
  dripping.value = true;
  dripTimer = setInterval(() => {
    void run({ mode: "burst", count })
      .then(() => {
        ticksDone++;
        if (total > 0 && ticksDone >= total) stopDrip();
      })
      .catch(() => stopDrip());
  }, intervalMs);
}

onBeforeUnmount(stopDrip);
</script>

<template>
  <section>
    <div class="flex items-center gap-2">
      <Icon :icon="FlaskConical" :size="16" class="text-accent" />
      <h2 class="font-display text-[16px] font-medium text-text">Generator</h2>
    </div>
    <p class="mb-3 mt-0.5 text-[12px] text-muted">
      Dev/QA only — publishes through the real pipeline. Not available in production.
    </p>

    <div class="mb-4 flex gap-1.5" role="tablist" aria-label="Generator mode">
      <button
        v-for="m in modes"
        :key="m.id"
        type="button"
        role="tab"
        :data-test="`mode-${m.id}`"
        :aria-selected="mode === m.id"
        class="rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-100"
        :class="
          mode === m.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-sunken hover:text-text'
        "
        @click="mode = m.id"
      >
        {{ m.label }}
      </button>
    </div>

    <FormRenderer
      v-if="mode === 'custom'"
      :schema="customSchema"
      :submitting="submitting"
      @submit="onCustom"
    />

    <div v-else-if="mode === 'preset'" class="grid gap-2 sm:grid-cols-2">
      <button
        v-for="p in presets"
        :key="p.id"
        type="button"
        :data-test="`preset-${p.id}`"
        :disabled="submitting"
        class="rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-sunken disabled:opacity-60"
        @click="onPreset(p.id)"
      >
        <div class="text-[13px] font-semibold text-text">{{ p.label }}</div>
        <div class="mt-0.5 text-[11px] text-faint">{{ p.blurb }}</div>
      </button>
    </div>

    <FormRenderer
      v-else-if="mode === 'burst'"
      :schema="burstForm"
      :submitting="submitting"
      @submit="onBurst"
    />

    <div v-else>
      <FormRenderer :schema="dripForm" :submitting="submitting && !dripping" @submit="onDrip" />
      <Button
        v-if="dripping"
        variant="secondary"
        size="sm"
        class="mt-3"
        data-test="drip-stop"
        @click="stopDrip"
      >
        Stop drip
      </Button>
    </div>

    <p v-if="result" role="status" aria-live="polite" class="mt-4 font-mono text-[12px] text-muted">
      Published {{ result.published
      }}<span v-if="result.suppressed"> · {{ result.suppressed }} suppressed</span>
    </p>
    <p v-if="error" role="alert" class="mt-4 text-[13px] text-danger">{{ error }}</p>
  </section>
</template>
```

- [ ] **Step 4: Add the dev-only Generator item to `AdminView.vue`**

Update the script: extend the `Section` type, import `FlaskConical` and `GeneratorPanel`, and build `items` with the dev-only entry:

```ts
import { FlaskConical } from "@lucide/vue"; // add to the existing @lucide/vue import
import GeneratorPanel from "./GeneratorPanel.vue";

type Section = "modules" | "features" | "generator";
const section = ref<Section>("modules");
const items: { id: Section; label: string; icon: typeof Boxes }[] = [
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "features", label: "Features", icon: ToggleRight },
  // Dev/QA only: the generator route (POST /admin/simulate) is absent in production.
  ...(import.meta.env.DEV
    ? [{ id: "generator" as const, label: "Generator", icon: FlaskConical }]
    : []),
];
```

Update the content area to render it:

```html
<div class="min-w-0 flex-1 overflow-y-auto p-6">
  <ModulesPanel v-if="section === 'modules'" />
  <GeneratorPanel v-else-if="section === 'generator'" />
  <FeaturesPanel v-else />
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @notifications/frontend test GeneratorPanel`
Expected: PASS (4 tests). Then `pnpm --filter @notifications/frontend test` — all frontend units green.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `pnpm --filter @notifications/frontend typecheck && pnpm lint`
Expected: clean.

```bash
git add frontend/src/features/admin/GeneratorPanel.vue frontend/src/features/admin/AdminView.vue frontend/src/features/admin/GeneratorPanel.spec.ts
git commit -m "feat(admin): GeneratorPanel with custom/preset/burst/drip modes"
```

---

### Task 6: e2e + API docs + verification

**Files:**

- Create: `frontend/e2e/generator.spec.ts`
- Modify: `docs/api/admin.md`

**Interfaces:**

- Consumes: the running app (`pnpm dev`) with the seeded `admin` account (`backend/src/auth/seed.ts`, password `notify-dev-2026`).
- Produces: an e2e proving an admin can publish a critical notification from the Generator and see the toast; API docs for `POST /admin/simulate`.

- [ ] **Step 1: Write the e2e spec**

```ts
// frontend/e2e/generator.spec.ts
import { expect, test } from "@playwright/test";

const DEV_PASSWORD = "notify-dev-2026";

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("notification generator", () => {
  test("an admin publishes a critical preset and sees the toast", async ({ page }) => {
    await login(page, "admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto("/admin");
    await page.getByRole("tab", { name: "Generator" }).click();
    await page.locator('[data-test="mode-preset"]').click();
    await page.locator('[data-test="preset-critical-dsr"]').click();

    // The critical toast fires bottom-right on delivery.
    await expect(page.getByText("DSR approaching SLA breach")).toBeVisible();
    await expect(page.getByText(/Published 1/)).toBeVisible();
  });
});
```

Note: the "Generator" tab uses `role="tab"` inside AdminView's admin section; the nav to `/admin` (page route) already requires the admin role (`meta.requiresAdmin`) and existing `admin.spec.ts` proves a non-admin is bounced — no need to duplicate that here.

- [ ] **Step 2: Run the e2e (app must be running)**

Run (in one shell): `pnpm dev`
Run (in another): `pnpm --filter @notifications/frontend test:e2e generator`
Expected: PASS. If the toast selector doesn't match, adjust to the ToastHost's actual title text (verify with the browser-tester subagent).

- [ ] **Step 3: Update the API docs**

Dispatch the **docs-writer** subagent to update `docs/api/admin.md` with a `POST /admin/simulate` section: non-prod-only registration, `requireAdmin`, the three request modes (`custom` with `notification` = the notification contract minus `id` plus `sampleActions: 0..3`; `preset` with the preset id enum; `burst` with `count` bounded by `SIMULATE_MAX_BURST` + optional `seed`), the `{ published, suppressed }` response, server-assigned `sim-` ids, and that it drives the real `ingest()` (so suppression/SSE apply). Note it publishes notifications (side effect) but never exposes the intake token.

- [ ] **Step 4: Full green + commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean; all unit suites green.

```bash
git add frontend/e2e/generator.spec.ts docs/api/admin.md
git commit -m "test(e2e): generator publishes a critical notification; docs(api): /admin/simulate"
```

- [ ] **Step 5: Review gates**

- `browser-tester` — confirm the Generator panel renders and each mode publishes (design-system ivory look, toast appears).
- `frontend-design-reviewer` — the panel against the design system.
- `code-reviewer` — the whole branch.
- `security-reviewer` — the new authed write + the non-prod registration guard (confirm the route is genuinely absent in production and ids/counts are server-controlled; the intake token is never sent to the client).

---

## Verification (end-to-end)

1. `docker compose up -d`; `pnpm --filter @notifications/backend migrate` (SIMULATE_MAX_BURST default applies; no new migration).
2. `pnpm dev` → log in as `admin` → open `/admin` → **Generator** tab is present (dev build).
3. Custom: fill module/title, pick priority `critical`, Publish → toast appears, "Published 1". Set audience scope ≠ global → the Audience ID field appears (showIf).
4. Presets: click each card → publishes; disabled-module custom publish shows "· 1 suppressed" and does not appear in the feed.
5. Burst: count 50 → 50 published/suppressed; Drip: 2 every 1s → new notifications keep arriving, Stop halts them; navigate away → no leaked timer.
6. Confirm `curl -s localhost:3000/admin/simulate` shape only works with an admin cookie (401 otherwise); confirm the browser bundle never contains the intake token.
7. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all green.

## Notes / deliberate scope

- **Drip repeats a burst** (the stress/soak use case) rather than an arbitrary Custom payload — the spec allows "Custom or Burst"; Custom-payload drip is a small follow-up if wanted.
- **Custom actions** are 0–3 canned samples only (no per-action editor) and **no metadata JSON field** — both deferred per the spec (highest effort / highest bug risk).
- **No new migration** and **no pipeline change** — the endpoint reuses `ingest()`, `simulate()`, and the policy cache as-is.
- `showIf` fields must remain optional in their schema (a hidden field's value is still validated); the only such field here, `audienceId`, is optional and the server's `audienceSchema` enforces the non-global id requirement.
