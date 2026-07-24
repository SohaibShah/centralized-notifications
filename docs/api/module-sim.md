---
title: Module-sim API
tags: [api, module-sim, dev-tool]
---

# Module-sim

**Dev/local-only. Not a production API.** `packages/module-sim` emulates the four
notification-producing modules (`dsr`, `access-governance`, `data-mapping`, `assessments`)
so the hub's action-dispatch flow can be exercised without real module backends, and can
itself generate and publish realistic notifications into the hub (`POST /emit`) so that
flow can be exercised end-to-end without a real module ever producing anything. It
**refuses to start** when `NODE_ENV=production`
([`src/index.ts`](../../packages/module-sim/src/index.ts) exits with an error before even
loading config) — it must never be confused with, or run alongside, the real backend's
endpoints documented on the other pages in this section.

Source of truth: [`src/app.ts`](../../packages/module-sim/src/app.ts) (route registration),
[`src/routes/actions.ts`](../../packages/module-sim/src/routes/actions.ts) (the dispatch
endpoint), [`src/routes/emit.ts`](../../packages/module-sim/src/routes/emit.ts) and
[`src/generate.ts`](../../packages/module-sim/src/generate.ts) (the emit-to-hub endpoint and
its notification generation), [`src/modules/registry.ts`](../../packages/module-sim/src/modules/registry.ts)
and the four files under [`src/modules/`](../../packages/module-sim/src/modules/) (per-module
action catalogs and handlers), [`src/config.ts`](../../packages/module-sim/src/config.ts)
(env validation).

This is the service the hub calls when a user clicks a `kind: "dispatch"`
[notification action](./notifications.md) — module-sim stands in for the real module and
returns a canned response matching [`moduleActionResponseSchema`](../../packages/shared/src/notification.ts).

## GET /health

**Auth:** none.

Trivial liveness check.

### Response `200`

```json
{ "status": "ok" }
```

### Side effects

None.

## POST /emit

**Auth:** none on this endpoint itself — same trust model as the rest of module-sim (dev
tool, not exposed in production). It does authenticate _itself_ **to the hub**: the
outbound call it makes carries the shared `INTERNAL_INTAKE_TOKEN` as `x-internal-token`
(see [Side effects](#side-effects-1) below).

Generates a batch of actionable, contract-valid notifications
([`src/generate.ts`](../../packages/module-sim/src/generate.ts)) and publishes them to the
hub's `POST /internal/publish` (already documented under [notifications](./notifications.md) —
this section only covers what `/emit` itself does). Every generated notification carries at
least one real `kind: "dispatch"` action drawn from its module's catalog (see
[Action reference](#action-reference)) and is validated against `notificationSchema` before
being sent, so `/emit` never hands the hub a shape that wouldn't pass the publish contract.

### Request

Body is a zod discriminated union on `mode` — one of three shapes.

**`mode: "burst"`** — generates `count` notifications at random, spread across the four
modules (audience scope is also round-robined across the batch, so every scope is
represented once `count >= 4`).

| Field   | Type      | Required | Notes                                                                                                        |
| ------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `mode`  | `"burst"` | yes      |                                                                                                              |
| `count` | number    | yes      | Integer, min 1. Above `MAX_BURST` (currently `50`, exported from `routes/emit.ts`) → `400`.                  |
| `seed`  | number    | no       | Integer. Same `seed` + `count` → the same batch (mulberry32 PRNG). Omitted → time-seeded, non-deterministic. |

```json
{ "mode": "burst", "count": 10, "seed": 42 }
```

**`mode: "preset"`** — one named, deterministic single-notification scenario (no RNG; a
given preset always produces the same body).

| Field    | Type       | Required | Notes                                                                   |
| -------- | ---------- | -------- | ----------------------------------------------------------------------- |
| `mode`   | `"preset"` | yes      |                                                                         |
| `preset` | string     | yes      | One of the ids below (exported as `PRESET_IDS` from `src/generate.ts`). |

| Preset id                  | Module              | Priority | Snoozable | Category    | Actions             |
| -------------------------- | ------------------- | -------- | --------- | ----------- | ------------------- |
| `critical-dsr`             | `dsr`               | critical | yes       | `sla`       | `approve`, `reject` |
| `high-access-approval`     | `access-governance` | high     | no        | `approvals` | `revoke`            |
| `normal-data-mapping-scan` | `data-mapping`      | normal   | yes       | —           | `rescan`            |
| `low-assessment-reminder`  | `assessments`       | low      | yes       | `reminders` | `snooze`            |

Every preset is emitted with `audience: { scope: "global" }`.

```json
{ "mode": "preset", "preset": "critical-dsr" }
```

**`mode: "custom"`** — one hand-built notification.

| Field         | Type       | Required | Notes                                                                                                           |
| ------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `mode`        | `"custom"` | yes      |                                                                                                                 |
| `module`      | string     | yes      | Must be one of the four registered modules (see [Action reference](#action-reference)). Unknown module → `400`. |
| `title`       | string     | yes      | Min length 1.                                                                                                   |
| `description` | string     | yes      |                                                                                                                 |
| `priority`    | string     | yes      | One of `low`, `normal`, `high`, `critical`.                                                                     |
| `actions`     | string[]   | yes      | 1–5 action names, resolved against `module`'s catalog. Any name not in that module's catalog → `400`.           |

Emitted with `snoozable: true` and `audience: { scope: "global" }` (fixed — not
caller-configurable in this mode).

```json
{
  "mode": "custom",
  "module": "dsr",
  "title": "Manual test notification",
  "description": "Ad-hoc notification for QA",
  "priority": "high",
  "actions": ["approve"]
}
```

### Response `200`

```json
{ "published": 10 }
```

`published` is the number of notifications actually sent to the hub — equal to `count` for
`burst`, always `1` for `preset`/`custom`.

### Errors

| Status | Body                                                                        | Reason                                                                                                                                               |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `{ "error": "invalid request body", "issues": [...] }`                      | Body failed the `mode` discriminated-union schema (zod issues included as-is).                                                                       |
| 400    | `{ "error": "count exceeds max burst of 50" }`                              | `burst.count > MAX_BURST`.                                                                                                                           |
| 400    | `{ "error": "<message>" }`                                                  | Burst or preset generation threw internally (e.g. a preset referencing an unregistered module) — surfaced as `400` rather than crashing the request. |
| 400    | `{ "error": "unknown module: \"<module>\"" }`                               | Custom mode: `module` isn't one of the four registered modules.                                                                                      |
| 400    | `{ "error": "module \"<module>\" has no catalog action named \"<name>\"" }` | Custom mode: an `actions` entry isn't in that module's catalog.                                                                                      |
| 502    | `{ "error": "hub unreachable" }`                                            | The outbound call to the hub threw (network error, hub not running, etc).                                                                            |
| 502    | `{ "error": "hub rejected publish", "status": <n> }`                        | The hub responded with a non-2xx status.                                                                                                             |

### Side effects

Makes an outbound `POST ${HUB_URL}/internal/publish` with the generated batch as the JSON
body and an `x-internal-token` header set to the configured `INTERNAL_INTAKE_TOKEN` value
(the same shared secret the backend itself validates intake requests against). The hub then
persists the notifications
and fans them out live over SSE to connected clients — that's the hub's own concern,
documented on its own page; `/emit`'s job ends once the hub responds `2xx`. Nothing is
persisted by module-sim itself.

## POST /:module/actions/:name

## GET /:module/actions/:name

Same handler registered for both HTTP methods (see
[`registerActionRoutes`](../../packages/module-sim/src/routes/actions.ts)) — a dispatch
action's own `method` (`GET` or `POST`) picks which one the hub actually calls. All four
modules' actions use `POST`, because the hub's dispatcher only attaches the request body
(carrying `notificationId`) on `POST`; a `GET` dispatch would arrive with no
`notificationId` and be rejected. The `GET` route is still registered for completeness.

**Auth:** shared dispatch token (service-to-service), **not** a user session.

Simulates the module's server-side handling of a dispatch action click — the round-trip
the hub makes when a user clicks a `kind: "dispatch"` button on a notification card.

### Auth

Send the shared secret in the **`x-module-dispatch-token`** header. It is compared in
**constant time** ([`dispatchTokenMatches`](../../packages/module-sim/src/routes/actions.ts),
length-mismatch short-circuits before `timingSafeEqual` is called) against this service's
`MODULE_DISPATCH_TOKEN` env var (validated at startup, minimum 16 chars — same secret the
backend holds as `MODULE_DISPATCH_TOKEN`). A missing or wrong token returns `401` before
the module/action is even looked up.

### Path parameters

| Param    | Type   | Notes                                                                                                                                        |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `module` | string | One of `dsr`, `access-governance`, `data-mapping`, `assessments` — see the [action reference](#action-reference) below. Unknown key → `404`. |
| `name`   | string | An action name from that module's catalog (e.g. `approve` for `dsr`). Unknown name for a known module → `404`.                               |

### Request

Fields, sent as the **JSON body on `POST`** or as **query-string params on `GET`** (this
route has no body on `GET`). If both are somehow present the merge is query-first,
**body wins** (see `actions.ts`'s `merged` object).

| Field            | Type    | Required | Notes                                                            |
| ---------------- | ------- | -------- | ---------------------------------------------------------------- |
| `notificationId` | string  | yes      | Min length 1. Used as (part of) the idempotency key — see below. |
| `metadata`       | unknown | no       | Opaque; module handlers here don't read it.                      |

The schema is `.passthrough()` — extra fields the hub actually sends alongside these two
(`actionRef`, `actor`) are accepted and silently ignored, not rejected.

```json
{ "notificationId": "dsr-1234-sla-warning-72h" }
```

### Response `200`

Body matches [`moduleActionResponseSchema`](../../packages/shared/src/notification.ts):

| Field     | Type    | Notes                                                                                                                                                                             |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`      | boolean | Whether the simulated action succeeded.                                                                                                                                           |
| `message` | string  | Optional short status, max 500 chars.                                                                                                                                             |
| `resolve` | boolean | Optional. When `true`, tells the feed to mark the source notification resolved. Omitted (not `false`) for actions that don't resolve anything.                                    |
| `actions` | array   | Optional replacement action set (e.g. an "Undo" button); max 10, same shape as [notification actions](./notifications.md#schema). None of the four modules currently return this. |

```json
{ "ok": true, "message": "DSR approved", "resolve": true }
```

### Errors

| Status | Body                                                 | Reason                                                                                                                                       |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `{ "ok": false, "message": "invalid request body" }` | Merged query+body failed schema validation (e.g. `notificationId` missing or not a string).                                                  |
| 400    | `{ "ok": false, "message": "Action failed" }`        | The module's `handle()` threw, **or** its return value failed `moduleActionResponseSchema` validation. The process never crashes either way. |
| 401    | `{ "error": "unauthorized" }`                        | `x-module-dispatch-token` missing or didn't match `MODULE_DISPATCH_TOKEN`.                                                                   |
| 404    | `{ "error": "unknown module" }`                      | `:module` isn't one of the four registered keys.                                                                                             |
| 404    | `{ "error": "unknown action" }`                      | `:module` is known but `:name` isn't in its catalog.                                                                                         |

### Idempotency

Every module handler tracks `${name}:${notificationId}` in an **in-memory `Set`**
(`processed`, one per module file). A second call with the same action name and
notification id returns `{ ok: false, message: "Already processed" }` instead of
re-running the effect. This set is **process-local and non-durable** — it resets on
restart. Fine for module-sim's dev-only purpose; do not read anything into it beyond "the
same click twice, in the same process lifetime, is a no-op."

### Side effects

None externally — everything is in-memory (the `processed` set per module). Nothing is
persisted to a database and nothing is emitted to Redis/SSE from this service; module-sim
only returns a response, it does not call back into the hub.

## Action reference

Per-module catalog: the `:module` key, the `:name` values it accepts, the HTTP method the
generated notification action actually uses, and what a fresh (non-repeat) call returns.

| Module              | Action name | Method | Response on success                                      | Resolves notification?                          |
| ------------------- | ----------- | ------ | -------------------------------------------------------- | ----------------------------------------------- |
| `dsr`               | `approve`   | POST   | `{ ok: true, message: "DSR approved", resolve: true }`   | yes                                             |
| `dsr`               | `reject`    | POST   | `{ ok: true, message: "DSR rejected", resolve: true }`   | yes                                             |
| `access-governance` | `revoke`    | POST   | `{ ok: true, message: "Access revoked", resolve: true }` | yes                                             |
| `data-mapping`      | `rescan`    | POST   | `{ ok: true, message: "Rescan queued" }`                 | no (a new scan is queued, not a final decision) |
| `assessments`       | `snooze`    | POST   | `{ ok: true, message: "Snoozed 7 days" }`                | no (notification reappears later)               |

Any other `:name` under a known module, or any `:module` outside this table, is a `404`
(see [Errors](#errors) above).
