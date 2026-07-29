# Action Dispatch — design spec

**Date:** 2026-07-24
**Status:** approved-pending-review (mentor sign-off required on the §3/§4 contract before merge)
**Week / requirement:** Week 4 "interaction — actions" slice, scoped standalone (per-user
audience/preference enforcement deferred to the later audiences/prefs chunk).

---

## 1. Goal

Turn notification action buttons into a **real server-mediated round-trip** between a running
module and the notification hub, replacing the current `dispatch` stub
(`packages/vue/src/state/actions.ts`, which only logs "coming soon").

The notification system acts as a **uniform dispatcher**: it never interprets an action's meaning.
It forwards `{ notification, action, metadata, actor }` to the owning module and relays whatever the
module responds. All business meaning lives in the module and its response. This is the shape a
notification system needs to be "droppable into any enterprise system with several modules running."

## 2. Round-trip architecture

```
module-sim (running dev service, own port)
   │  ① emits notification w/ dispatch action  → POST /internal/publish (intake token)
   ▼
notification hub  (packages/core + packages/server-fastify + reference backend/)
   │  ② user clicks button → POST /notifications/:id/actions/:ref/dispatch  (session auth)
   │  ③ hub checks: actionsEnabled flag ON, owning module enabled, notification visible to actor
   │  ④ hub records action_dispatches row (status=pending), then calls the ActionDispatcher adapter
   ▼
ActionDispatcher  (interface in core; HTTP impl injected by reference backend/)
   │  ⑤ core composes {module.base_url (DB registry) + action.path}; injected impl POSTs body
   │     with the MODULE_DISPATCH_TOKEN header (env)
   ▼
module-sim handler  → ⑥ mutates its own state, responds { ok, message?, resolve?, actions? }
   ▲
hub  ⑦ validates response (zod), updates the row (status=ok|failed), applies effects
   │       (resolve → markRead), returns the result to the client
   ▲
card ⑧ shows message / drops the card / swaps its action row; on error re-enables the button
```

**Core stays env-free and identity-free** (the `boundary.test.ts` invariant holds). Core defines the
`ActionDispatcher` _interface_, resolves the target URL from the DB registry, and owns the dispatch
_logic_; the reference `backend/` injects the concrete HTTP impl (fetch + `MODULE_DISPATCH_TOKEN` from
env) — the same injection pattern already used for `intakeAuth` and the AI provider. Base URL is
registry data (DB); the token is env (host).

## 3. Contract — action schema (MENTOR-GATED)

`actionSchema` in `packages/shared/src/notification.ts` becomes a discriminated union on `kind`:

```ts
// kind: "link"  — client-only; opens the url in a new tab. Unchanged behavior.
{ label: string(1..100), kind: "link", url: string.url().http(s), icon?: string }

// kind: "dispatch" — server round-trip.
{ label: string(1..100), kind: "dispatch",
  method: "GET" | "POST",           // how the hub calls the module (POST body / GET query)
  path:   string,                   // RELATIVE path, must start with "/", no scheme/host/".."
  metadata?: Json,                  // arbitrary, module-defined at publish time, ≤ 4 KB serialized
  icon?: string }
```

- **`path` is relative** and resolved against the owning module's registered base URL. The payload
  never chooses the host → SSRF is structurally impossible.
- **`metadata`** is opaque to the hub. It is set by the module when it publishes the notification —
  **never** user-supplied in this slice.
- **Back-compat:** the union must still parse legacy flat actions (a bare `url` with no `kind`, or
  `kind:"link"`) as `link`, because `feed.ts` re-parses persisted `actions` with `actionSchema`.
  A persisted `dispatch` action missing `path` is a data error → drop the action, log, don't crash.

## 4. Contract — module response (MENTOR-GATED)

The module replies with a bounded shape, validated by zod on the hub before any effect is applied:

```ts
{ ok: boolean,
  message?: string(≤500),            // user-facing outcome (success OR failure text)
  resolve?: boolean,                 // true → hub marks the notification read/resolved
  actions?: NotificationAction[] }   // ≤10, replaces the card's action row (e.g. after Approve)
```

- A non-2xx HTTP response, a timeout, or a response that fails validation → recorded as `failed`,
  surfaced to the user as a generic "action failed" message; the button re-enables.
- Effects are applied **only** on `ok:true` and only after the durable row is updated.

## 5. Registry + egress safety

- **Base-URL registry lives in the `modules` table and is admin-editable.** A nullable
  `base_url` column is added to `modules` (migration §6). The admin Modules panel edits it; a module
  with a null/blank `base_url` cannot receive dispatches (its `dispatch` actions are rejected → the
  card surfaces "action unavailable", `link` actions still work). This is registry **data**, not env,
  so **core reads it from the DB** (core already owns the DB — reading a config column is not env
  access and doesn't break the `boundary.test.ts` invariant). Dev defaults are seeded to the
  module-sim origins (`http://localhost:4000/dsr`, …) so it works out of the box; a real deployment
  edits each module's real base URL in the admin.
- **Egress composition (core):** `dispatchAction` loads the owning module's `base_url`, **rejects**
  any action `path` that is not a clean relative path (must start `/`, no scheme/host/`..`), then
  composes `base_url + path`. Because the host is the admin-registered value and the path can't
  contain a host, the payload can never redirect egress → SSRF is structurally impossible.
- **Hub → module auth (host-injected):** core hands the composed URL + method + body to the injected
  `ActionDispatcher`; the reference backend's HTTP impl attaches a single `MODULE_DISPATCH_TOKEN`
  header (env, validated at startup) and performs the fetch (with a timeout, no redirects). The module
  validates the token. Same pattern as the existing `INTERNAL_INTAKE_TOKEN`; not per-module (deferred).
  Token stays env/host-side; base URL stays registry/DB-side.

## 6. Durability + idempotency (notifications-domain rules)

Two new migrations. `backend/migrations/013_modules_base_url.sql` adds the registry column and seeds
dev defaults:

```
ALTER TABLE modules ADD COLUMN base_url text;   -- nullable; null → module can't receive dispatches
UPDATE modules SET base_url = 'http://localhost:4000/' || key WHERE base_url IS NULL;  -- dev default
```

`backend/migrations/014_action_dispatches.sql`:

```
action_dispatches(
  id              uuid pk default gen_random_uuid(),
  user_id         uuid  not null references users(id) on delete cascade,
  notification_id text  not null references notifications(id) on delete cascade,
  action_ref      text  not null,               -- the action's array index, e.g. "0"
  idempotency_key text  not null,               -- client-supplied per click
  status          text  not null default 'pending',   -- pending | ok | failed
  result_message  text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  unique (user_id, notification_id, action_ref, idempotency_key)
)
```

- Delivery status is its **own durable fact**, separate from the notification.
- **Idempotent replay:** a POST whose `(user, notification, action_ref, idempotency_key)` already
  exists returns the recorded result instead of re-calling the module — safe under at-least-once
  retries. A distinct idempotency key is a distinct dispatch.
- **PII-safe logging:** log outcome only (status, module key, action label). Never log the `metadata`
  blob or the module's response body in full (they may carry account details).

## 7. `packages/module-sim` — running modules + control center (NEW, dev-only)

A standalone Fastify app on its own port, refusing to run under `NODE_ENV=production` (like the
existing sim tools). It **replaces** the admin generator entirely (see §8).

**Responsibilities**

1. **Emit** realistic, action-bearing notifications to the hub's `/internal/publish` (intake token
   from env), through the same ingest pipeline (dedupe/policy/SSE all fire authentically).
2. **Handle** dispatches at `POST|GET /{moduleKey}/actions/{name}`: validate `MODULE_DISPATCH_TOKEN`,
   mutate a tiny in-memory per-module state, respond per §4. Examples:
   - DSR _Approve_ → `{ ok:true, message:"DSR approved", resolve:true }`; second click on the same
     request → `{ ok:false, message:"Already processed" }`.
   - Access Governance _Revoke access_ → `{ ok:true, message:"Access revoked", resolve:true }`.
   - Assessments _Snooze 7d_ → `{ ok:true, message:"Snoozed until <date>" }` (no resolve).
3. **Serve the control center** (§8) as a self-contained static page.

Each module exposes an **action catalog** (the actions its handlers actually support) so the control
center's "custom" mode only offers actions that will really round-trip.

## 8. Control center (replaces the admin generator)

**Removed:** the admin `POST /admin/simulate` route (`backend/src/http/admin/simulate.ts`), the
`GeneratorPanel.vue`, and `generator.form.ts` / `burst.form.ts` / `drip.form.ts`. The
`backend/src/sim/*` generation logic (simulator, presets, sampleActions) moves into `module-sim`
(adapted to produce actionable notifications). The admin panel keeps Modules / Features / Maintenance
/ DevLabs.

**Added:** module-sim serves a control-center web page at its own origin (a self-contained static
HTML/CSS/JS page — no Vue/Tailwind build; YAGNI for a dev tool). It preserves the same three tasks,
now actionable:

- **Custom** — craft one notification: pick module, title/description/priority, and attach one or more
  dispatch actions chosen from that module's action catalog.
- **Preset** — named per-module scenarios (each carries appropriate dispatch actions).
- **Burst** — N random actionable notifications across modules (a `SIMULATE_MAX_BURST`-style ceiling
  preserved).

All three POST to module-sim's own JSON API, which publishes to the hub's `/internal/publish`.

**Launch:** `pnpm dev` starts reference app (`:5173`) + hub backend (`:3000`) + module-sim +
control center (`:4000`) together.

## 9. Frontend changes

- `packages/vue/src/state/actions.ts` `runAction`: for `kind:"dispatch"`, generate an idempotency key
  (uuid) and `transport.post("/notifications/:id/actions/:ref/dispatch", { idempotencyKey })`. Button
  goes **idle → pending (spinner, disabled) → result**. `link` unchanged (opens tab).
- Apply the §4 response: `message` → surface via the existing toast state (and/or an inline card
  line); `resolve` → mark read + drop from the Needs-action group; `actions` → replace the card's
  action row. On error, re-enable and show the message.
- The card renders `dispatch` buttons only when `settings.flags.actionsEnabled` is on (the server
  enforces it independently — UI is affordance, not the boundary). The `actionsEnabled` hint loses
  "coming soon".

## 10. Testing

- **core** (`dispatchAction`, fake `ActionDispatcher`, no network): actionsEnabled off → 403; module
  disabled → 403; notification not visible to actor → 404/403; happy path records `ok`; idempotent
  replay returns the recorded result without re-calling; `resolve:true` applies markRead; dispatcher
  throw/timeout recorded `failed`.
- **server-fastify** route: 401 unauth, 400 bad body, 403 gated, 404 unknown notification/ref, 200
  success; response-shape validation.
- **module-sim**: token check rejects missing/wrong token; approve→resolve; double-click→error;
  malformed dispatch payload rejected without crashing the process.
- **frontend** unit: the three response effects (message/resolve/actions) each drive the right store
  change; error path re-enables.
- **e2e:** `generator.spec.ts` is **replaced** by control-center coverage (emit an actionable
  notification → it appears in the feed) plus a dispatch happy path (click Approve → card resolves +
  toast) and one failure (module error → button re-enables). The other five e2e specs (feed, ai-chat,
  ai-summary, admin, qol) are **unchanged** — they publish via `/internal/publish` directly, which
  module-sim also uses.

## 11. Security & standing constraints

- zod at every boundary (dispatch request, module response); parameterized SQL only.
- **Ownership check:** the notification must be visible to the clicking principal (reuse the existing
  audience-match visibility used by `list`) before dispatch — a logged-in user cannot dispatch an
  action on a notification they can't see.
- Secrets (`MODULE_DISPATCH_TOKEN`, `INTERNAL_INTAKE_TOKEN`) come from env, validated at startup;
  never committed. Non-secret config (module-sim port, seed base URLs) is also env/migration, not code.
  PII-safe logging per §6.
- Core remains identity/env-free (`boundary.test.ts` green). `security-reviewer` before merge (new
  endpoint + service-to-service egress + token handling); `code-reviewer` after non-trivial changes;
  `frontend-design-reviewer` after the card/UI work; API docs updated under `docs/api/`.
- **Mentor sign-off** on the §3 action contract and §4 response contract before merge.

## 12. Out of scope (deliberate)

- Per-user audience/preference **enforcement** on dispatch (only visibility ownership here) — the
  later audiences/prefs chunk. Per-recipient/per-category rate-limiting likewise.
- User-supplied action metadata (metadata is module-defined).
- Per-module dispatch secrets (one shared `MODULE_DISPATCH_TOKEN`); retry/back-off queues or a
  dead-letter path for failed dispatches (single synchronous attempt, recorded).
- Real (non-simulated) modules.

## 13. Build units (for the plan)

**A** shared contract (union `actionSchema` + response schema + back-compat) → **B** registry
(migration 013 `modules.base_url` + admin read/edit: `ModulePolicyView.baseUrl`,
`PATCH /admin/modules/:key` accepts `baseUrl`, admin Modules panel field) → **C** core
(`ActionDispatcher` iface, `dispatchAction` resolving `base_url` + composing/validating egress,
migration 014 `action_dispatches`, tests) → **D** server-fastify dispatch route → **E** reference
backend HTTP dispatcher + env wiring + register route → **F** `module-sim` package (handlers + emit
API + moved sim/presets) → **G** control center page + remove admin generator + `pnpm dev` wiring →
**H** frontend `runAction` + effects + card gating → **I** whole-repo verify
(lint/typecheck/build/tests), e2e swap, reviews, docs.
