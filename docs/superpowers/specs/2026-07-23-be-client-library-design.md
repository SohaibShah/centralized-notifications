# BE client library extraction — design

**Date:** 2026-07-23
**Branch:** `feat/be-client-library` (to be created off `main`)
**Status:** approved (design converged in discussion); **public API pending mentor sign-off before the plan is locked**

## Goal

Turn the current backend (Fastify / TS / pg / zod — the ingest → resolve-module → persist →
deliver pipeline plus the audience-scoped read path) into an **importable Node.js library** any host
app can drop in, either by calling functions directly or by mounting its HTTP + SSE routes onto the
host's own server. The current dashboard's backend becomes the **reference consumer** — it re-wires
itself through the same public API a third party would use (dogfooding), so the boundary stays honest.

This is sub-project **#1 of 4** in the agreed sequence: **BE lib → AI summarizer → UI lib → AI Q/A**.
The BE lib is first because everything else sits on it; building the summarizer as the first real
consumer _through_ this library validates the API before it is frozen.

## Locked decisions

- **Full identity decouple (a genuine library).** `packages/core` references **zero** host identity
  tables. The read filter is already decoupled; this pass finishes read-state and live delivery.
- **Module catalog = host config; enable/disable state = library.** The host declares its catalog;
  the library persists per-module enabled/disabled state and exposes `listModules()` /
  `setModuleEnabled()`. Runtime muting is preserved; the catalog becomes host-owned.
- **Fastify adapter ships this pass** (HTTP + SSE), so the existing HTTP-talking frontend keeps
  working and the dogfooding is end-to-end real.
- **In-process delivery hub stays** (single-instance); a distributed pub/sub transport is a named
  seam, not built here (it is the Week-5 Redis work).

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before any task is "done".
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only; no identity-table joins in `packages/core`.
- No secrets in code; `packages/core` reads **no** `process.env` — all config injected. The reference
  app validates env at startup (as today) and passes values in.
- No AI-attribution commit trailers. Conventional Commits.
- `docs/api/*` kept in sync via **docs-writer** where request/response/side-effect shapes move
  (`api-documentation.md`).

## Package layout

Three logical homes; `@notifications/shared` (existing) remains the public contract.

- **`packages/core`** — `@notifications/core`. Framework-agnostic domain: pipeline (validate →
  resolve module → persist → deliver), audience matching, keyset read + counts, read-state, module
  policy, the in-process delivery hub. No Fastify, no `process.env`, no identity tables. Exports
  `createNotificationService({ pool, config })` and `migrate(pool)`.
- **`packages/server-fastify`** — `@notifications/server-fastify`. Thin Fastify plugin mounting the
  HTTP + SSE routes and wiring the host's auth adapter to the core.
- **`backend/`** — becomes the **reference app**. Keeps identity (users/roles/teams/sessions),
  login/logout, password hashing, the intake-token check, config-from-env, the dev simulator/seed,
  and `server.ts`. Consumes the two packages exactly as a third party would.

For the boundary to be real (own `package.json`/`tsconfig`, no imports back into `backend/`), the
domain code physically moves into `packages/core`. That churn is the cost of a real package.

## Core service API

Every read takes an already-resolved `Principal` (the Fastify layer produces it via the host's auth
adapter). `Principal` is the library's identity contract, exported from core:

```ts
interface Principal {
  userKey: string;   // opaque host user key (= username in the reference app); matches audience.id for scope="user"
  roles: string[];   // matched for scope="role"
  teamKeys: string[]; // matched for scope="team"
}

const svc = createNotificationService({ pool, config });

svc.ingest(raw: unknown): Promise<IngestResult>            // producer side — no principal
svc.list({ principal, cursor?, limit?, sort? }): Promise<NotificationPage>
svc.counts({ principal }): Promise<NotificationCounts>
svc.markRead({ principal, id }): Promise<void>             // out-of-audience id 404-equivs (no oracle)
svc.markReadBulk({ principal, ids }): Promise<...>         // skips out-of-audience ids silently
svc.markUnread({ principal, id }): Promise<void>
svc.listModules(): Promise<ModulePolicyView[]>             // catalog ⨝ enabled/disabled state
svc.setModuleEnabled(id: string, enabled: boolean): Promise<void>
svc.delivery                                               // hub: subscribe(principal) → stream
```

`ingest` has no principal — it is the intake/producer side, gated by the host's `intakeAuth` at the
transport. `list`/`counts`/`markRead*`/`markUnread` take a Principal.

## Identity decoupling — what "full decouple" concretely means

The read filter (`audienceWhere`) is already decoupled (bound-param match, no join). This pass
finishes the two remaining coupling points, and removes env reads from core.

1. **Read-state re-key.** `notification_reads.user_id uuid REFERENCES users(id)` →
   `user_key text` (no FK). New PK `(user_key, notification_id)`. A one-time forward migration maps
   existing rows uuid → username (join `users` once, in the reference app's migration ordering — the
   library migration adds the column; the reference app backfills from its own identity table, since
   only the host knows the uuid→userKey mapping). After backfill the uuid column and FK are dropped.
   The feed's per-row read flag becomes a LEFT JOIN on `(notification_id, user_key)`.

2. **Retire `resolveRecipients`.** Instead of querying `users`/`user_teams`/`user_roles` to expand a
   team/role audience into internal ids, the delivery hub matches each published notification's
   audience against **each connected subscriber's Principal** — the same boolean as `audienceWhere`,
   evaluated in memory (the hub captured the Principal at subscribe time). Global → all subscribers.
   This removes a coupling point rather than injecting a new adapter.

   **Delivery semantics (unchanged in effect):** the hub is live push only. Durability + eventual
   delivery is Postgres — every accepted notification is persisted with its audience regardless of
   who is connected, and an offline member sees it on next `list()` (audience-filtered against their
   freshly-resolved Principal). The hub change only alters _how the connected set is computed_, not
   _who ultimately receives_ a notification.

   **One documented nuance:** live matching uses the Principal captured at SSE-connect time. A
   mid-session team/role change takes effect on the member's next reconnect, not instantly — the same
   "takes effect on next request" semantics the read side documents (for SSE, the connection _is_ the
   request).

3. **No env reads in core.** All config injected. The reference app reads/validates env and passes
   values into `createNotificationService` and the plugin.

Net result: `packages/core` references zero identity tables — enforced by a boundary test.

## Injected config

```ts
createNotificationService({
  pool,                        // host's pg.Pool
  config: {
    modules: ModuleCatalog,    // host-declared catalog: [{ id, label, … }]
    adminRole?: string,        // default "admin" — role that gates setModuleEnabled / policy routes
    // ai?: LlmProviderConfig   // RESERVED for the summarizer sub-project — NOT built in this pass
  },
})
```

The `ai` slot is only _named_, not built. Shaping the config object as an extensible bag is what lets
the summarizer add a provider adapter later without changing the `createNotificationService`
signature. YAGNI until then.

## Fastify adapter

```ts
app.register(notificationFastifyPlugin, {
  service,
  auth: (req) => Promise<Principal | null>, // host resolves identity; null → 401
  intakeAuth: (req) => boolean | Promise<boolean>, // gates POST /internal/publish
});
```

- Mounts: `GET /notifications`, `GET /notifications/counts`, `POST /notifications/:id/read`, bulk
  `POST /notifications/read`, `DELETE /notifications/:id/read`, `GET /sse`, `POST /internal/publish`,
  and the module-policy admin routes.
- **Admin gating is a role check.** The plugin guards module-policy routes on
  `principal.roles.includes(config.adminRole)`. Login, sessions, password hashing, the users table
  are **not** in the library — the host's `auth` adapter is the sole identity source. The reference
  app keeps its session→Principal mapping and its login flow.
- `maxParamLength` (256, for the ≤200-char notification id path param) is set by the plugin so a valid
  long id does not 414 before the handler runs.

## Module catalog / policy

- Host passes the `modules` catalog config.
- The library persists enabled/disabled **state** in a `module_policy` table, reconciled on startup:
  each configured module gets a row defaulting **enabled** if absent.
- `listModules()` returns catalog ⨝ state; `setModuleEnabled(id, enabled)` writes state.
- Intake rejects a module not in the host catalog (unchanged behavior — unknown module = caller bug,
  logged, never persisted/delivered).

## DB / migration ownership

- The library ships its migration set (`notifications`, the re-keyed `notification_reads`,
  `module_policy`, and the existing feed/counts indexes) and exports `migrate(pool)`; the **host**
  decides when to run it. The reference app runs it in its migrate script alongside the identity
  migrations.
- Table names stay as-is, **documented as the library's reserved/owned set**. A configurable table
  prefix is a named extension point, not built (YAGNI until a real collision).
- The identity tables (`users`/`user_teams`/`user_roles`/session store) and their migrations stay
  entirely with the reference app.

## Testing strategy

The existing 124 backend tests split by home:

- **core** — domain tests driven directly against the service with a test pool + fabricated
  Principals; no HTTP, no session (ingest/validate/policy/persist/list/counts/read/audience matching/
  hub matching).
- **server-fastify** — route/SSE tests via `app.inject` with a **fake auth adapter**, proving the
  plugin works for _any_ host identity, plus `intakeAuth` gating.
- **backend (reference)** — auth/session/login and the SessionUser→Principal adapter mapping.

Three new tests prove the extraction is honest:

1. **Boundary test** — `packages/core` source references none of `users`/`user_teams`/`user_roles`/
   session (static check; fails the build if coupling creeps back).
2. **Foreign-host test** — drive the service with an auth adapter returning arbitrary Principals (a
   different identity model) and assert scoping/counts/read/live-delivery are all correct. This is the
   real dogfooding proof that identity is injected, not owned.
3. **Data-migration test** — seed old uuid-keyed `notification_reads` rows, run the migration, assert
   they re-key to `user_key` and read-state still resolves.

e2e (Playwright) is unchanged — it drives the reassembled reference app end-to-end as the integration
proof that the split system still works.

## Out of scope (deliberate)

- The Vue component library (task 1) and the AI features (tasks 2/4 — only the `ai` config seam is
  _named_ here).
- Redis-distributed / multi-instance live delivery — the in-process hub stays single-instance with a
  documented pub/sub seam (Week-5 Redis work).
- Non-Fastify (Express) adapter — Fastify only; the boundary is named.
- Registry publishing — packages are publishable-_shaped_ (exports/types/files) but stay private,
  like `@notifications/shared` today.
- Configurable table prefix and per-tenant physical partitioning — named extension points, not built.

## Mentor sign-off gate

The public surface is the hard-to-reverse decision (the contract other teams build against). Confirm
with the mentor **before the implementation plan is locked**:

- `createNotificationService({ pool, config })` shape and the `config` object (including the reserved
  `ai` slot).
- The Fastify plugin options: `auth` (returns `Principal | null`), `intakeAuth`, `adminRole`.
- The `Principal` contract (`userKey` / `roles` / `teamKeys`, opaque `userKey`).
- `migrate(pool)` and the library's reserved table set.

## Self-review

- **Placeholders:** none.
- **Consistency:** the read filter (`audienceWhere`) and live delivery (Principal match in the hub)
  encode the same audience boolean, so what a user sees == what they receive live; both key
  user-scope on the opaque `userKey`. Read-state re-key aligns `notification_reads` with the same
  `userKey`.
- **Scope:** one cohesive extraction (packages + service API + identity decouple + Fastify adapter +
  reference rewiring). Large but single-plan-sized; the AI/UI/Redis pieces are explicitly deferred.
- **Ambiguity resolved:** full decouple; catalog = host config with library-owned state; admin =
  role check on the injected Principal; hub matches connected subscribers' Principals; core reads no
  env; table names reserved (no prefix yet).
