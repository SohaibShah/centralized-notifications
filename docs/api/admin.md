---
title: Admin API
tags: [api, admin, governance]
---

# Admin

The Week-2 admin governance endpoints: per-module enable/disable and global feature
kill-switches. Every route on this page except [`GET /settings/features`](#get-settingsfeatures)
requires the `admin` role, and the [Auth model](./auth.md#auth-model). A module that is
disabled here has its notifications **recorded but suppressed** — they are persisted (so
history isn't lost) but never delivered to recipients; see the `suppressed` flag below and
the note on [`GET /notifications`](./notifications.md#get-notifications).

> **`/admin/modules*`, `/admin/settings`, and `/settings/features` are served by
> `@notifications/server-fastify`.** They are no longer hand-written `backend/` routes — they
> are mounted by the `notificationFastifyPlugin` (see the [BE library integration
> guide](../architecture/be-library-integration.md)). The request/response shapes below are
> **unchanged** by the extraction. (The [`POST /admin/simulate`](#post-adminsimulate) and
> [`/admin/maintenance/*`](#maintenance-devqa) dev/QA routes are **not** part of the library —
> they remain reference-app routes in `backend/`.)
>
> **Identity and the admin gate come from the host.** There is no owned session or users
> table in the library. The plugin's `requireAdmin` preHandler calls the host's `auth(req)`
> adapter to resolve a `Principal` (`{ userKey, roles, teamKeys }`), returns `401` if it is
> `null`, and `403` unless the `Principal`'s `roles` include the service's configured
> **`adminRole`** (`NotificationServiceConfig.adminRole`, default `"admin"`). `GET
/settings/features` uses `requirePrincipal` only (any resolved `Principal`). In the
> reference app the adapter maps the `session`-cookie user to a `Principal`.
>
> **Module labels are host config; module state and settings are library-owned.** The module
> `key`/`label` list is the host-supplied catalog passed to `createNotificationService`
> ([`backend/src/reference/catalog.ts`](../../backend/src/reference/catalog.ts)); only the
> per-module `enabled`/`last_seen` state and the global `Settings` live in the library's DB.

Source of truth (plugin routes):
[`packages/server-fastify/src/routes/admin.ts`](../../packages/server-fastify/src/routes/admin.ts)
(the routes) and [`packages/core/src/policy/store.ts`](../../packages/core/src/policy/store.ts)
(module/settings state).

## GET /admin/modules

**Auth:** required, admin only ([`requireAdmin`](../../backend/src/auth/guards.ts) — `401` if
not logged in, `403` if logged in but not an admin).

Lists every module in the **fixed, seeded catalog** (`dsr`, `access-governance`,
`data-mapping`, `assessments` — see [migration 007](../../backend/migrations/007_seed_modules.sql)
and the [notification contract](./notifications.md)) with its enabled state and aggregate
notification counts, ordered by last-seen **descending**.

### Request

No parameters.

### Response `200`

An array of module summaries:

| Field                 | Type              | Notes                                                                                               |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `key`                 | string            | The module's identifier, as sent in the notification's `module` field.                              |
| `label`               | string            | Display label, from the seed catalog (e.g. `"Data Mapping"`). **Not editable** — see `PATCH` below. |
| `enabled`             | boolean           | Whether the module is currently allowed to deliver notifications.                                   |
| `lastSeenAt`          | string (ISO 8601) | Timestamp of the module's most recent publish.                                                      |
| `total`               | number            | Count of **all** notifications ever recorded for this module (suppressed or not).                   |
| `suppressed`          | number            | Of `total`, how many were recorded but not delivered (published while the module was disabled).     |
| `byPriority.critical` | number            | Count of this module's notifications at `critical` priority.                                        |
| `byPriority.high`     | number            | Count at `high` priority.                                                                           |
| `byPriority.normal`   | number            | Count at `normal` priority.                                                                         |
| `byPriority.low`      | number            | Count at `low` priority.                                                                            |

```json
[
  {
    "key": "dsr",
    "label": "Dsr",
    "enabled": true,
    "lastSeenAt": "2026-07-10T09:15:22.481Z",
    "total": 42,
    "suppressed": 3,
    "byPriority": { "critical": 5, "high": 12, "normal": 20, "low": 5 }
  }
]
```

### Errors

| Status | Body                                     | Reason                                                  |
| ------ | ---------------------------------------- | ------------------------------------------------------- |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but the session user lacks the `admin` role. |

### Side effects

None — read-only.

## PATCH /admin/modules/:key

**Auth:** required, admin only ([`requireAdmin`](../../backend/src/auth/guards.ts) — `401`/`403` as above).

Enables/disables a module. This is the only mutable field — labels come from the seed catalog
and are **not** editable.

### Request

Path parameter:

| Param | Type                 | Required | Notes                    |
| ----- | -------------------- | -------- | ------------------------ |
| `key` | string (1–100 chars) | yes      | The module's identifier. |

Body — only `enabled` is accepted, and it is **required**:

| Field     | Type    | Required | Notes                      |
| --------- | ------- | -------- | -------------------------- |
| `enabled` | boolean | yes      | Enable/disable the module. |

A body without `enabled` (including an empty body, or one carrying only a now-unsupported
`label`) is rejected as `400`.

```json
{ "enabled": false }
```

### Response `204`

`204 No Content` — no body.

### Errors

| Status | Body                                     | Reason                                                         |
| ------ | ---------------------------------------- | -------------------------------------------------------------- |
| `400`  | `{ "error": "invalid module key" }`      | `key` path parameter is empty or over 100 chars.               |
| `400`  | `{ "error": "invalid request body" }`    | Body fails validation — `enabled` is missing or not a boolean. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                       |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but not an admin.                                   |
| `404`  | `{ "error": "module not found" }`        | No module with that `key` exists in the seeded catalog.        |

### Side effects

Updates the `modules` row's `enabled` column. **Invalidates the in-memory policy
cache** (the service's [`PolicyStore`](../../packages/core/src/policy/store.ts) invalidates its cache on any write) — a disable/enable
takes effect starting with the module's **next ingest**, not retroactively on already-persisted
notifications.

## GET /admin/settings

**Auth:** required, admin only ([`requireAdmin`](../../backend/src/auth/guards.ts) — `401`/`403` as above).

Returns the global feature flags (kill-switches for cross-cutting UI/behavior).

### Request

No parameters.

### Response `200`

```json
{
  "aiSummaryEnabled": true,
  "chatbotEnabled": true,
  "groupingEnabled": true,
  "actionsEnabled": true
}
```

| Field              | Type    | Notes                                                   |
| ------------------ | ------- | ------------------------------------------------------- |
| `aiSummaryEnabled` | boolean | Global kill-switch for the AI-summary band.             |
| `chatbotEnabled`   | boolean | Global kill-switch for the chatbot.                     |
| `groupingEnabled`  | boolean | Global kill-switch for notification grouping/threading. |
| `actionsEnabled`   | boolean | Global kill-switch for notification action buttons.     |

### Errors

| Status | Body                                     | Reason                       |
| ------ | ---------------------------------------- | ---------------------------- |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.     |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but not an admin. |

### Side effects

None — read-only.

## PATCH /admin/settings

**Auth:** required, admin only ([`requireAdmin`](../../backend/src/auth/guards.ts) — `401`/`403` as above).

Updates one or more of the global feature flags.

### Request

Body — any subset of the four boolean flags; at least one is required:

| Field              | Type    | Required | Notes |
| ------------------ | ------- | -------- | ----- |
| `aiSummaryEnabled` | boolean | no*      |       |
| `chatbotEnabled`   | boolean | no*      |       |
| `groupingEnabled`  | boolean | no*      |       |
| `actionsEnabled`   | boolean | no*      |       |

\* An empty body (no fields present) is rejected as `400`.

```json
{ "aiSummaryEnabled": false }
```

### Response `204`

`204 No Content` — no body.

### Errors

| Status | Body                                     | Reason                                                          |
| ------ | ---------------------------------------- | --------------------------------------------------------------- |
| `400`  | `{ "error": "invalid request body" }`    | Body fails validation — no recognized flag present in the body. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                        |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but not an admin.                                    |

### Side effects

Updates the singleton `global_settings` row (only the columns for fields present in the
body) and its `updated_at`. **Invalidates the in-memory policy cache**
(the service's [`PolicyStore`](../../packages/core/src/policy/store.ts) invalidates its cache on any write) — the new flag values take
effect on the next read.

## GET /settings/features

**Auth:** required, **any authenticated user** ([`requireUser`](../../backend/src/auth/guards.ts) —
`401` if not logged in). Not admin-gated — this is the read path the frontend uses to gate
UI (e.g. hiding the AI-summary band) for every user, not an admin-only view.

Returns the same feature-flags object as [`GET /admin/settings`](#get-adminsettings).

### Request

No parameters.

### Response `200`

```json
{
  "aiSummaryEnabled": true,
  "chatbotEnabled": true,
  "groupingEnabled": true,
  "actionsEnabled": true
}
```

See the field table under [`GET /admin/settings`](#get-adminsettings) — identical shape.

### Errors

| Status | Body                                     | Reason                   |
| ------ | ---------------------------------------- | ------------------------ |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie. |

### Side effects

None — read-only.

## POST /admin/simulate

**Auth:** required, admin only ([`requireAdmin`](../../backend/src/auth/guards.ts) — `401` if
not logged in, `403` if logged in but not an admin).

**Non-production only.** The route is registered **only when `NODE_ENV !== "production"`**
(see [`isSimulatorEnabled`](../../backend/src/server.ts)). In production it is genuinely
**absent** — a request hits Fastify's not-found handler and returns `404`, it is not merely
hidden behind the admin gate.

> **Operational requirement:** `NODE_ENV` defaults to `"development"`, so this gate fails
> **open** — any production deployment **must set `NODE_ENV=production` explicitly**. An unset
> value leaves this endpoint registered.

The dev/QA notification generator. It fabricates notifications and pushes each one through the
**real** pipeline via `service.ingest()`
([`packages/core/src/pipeline/ingest.ts`](../../packages/core/src/pipeline/ingest.ts)), so
dedupe, module policy/suppression, and SSE delivery all behave exactly as they do for a genuine
publish. This
endpoint exists so the browser can generate test traffic **without ever holding the
service-to-service `x-internal-token`** used by [`POST /internal/publish`](./notifications.md) —
that token is never exposed to the client.

Source: [`backend/src/http/admin/simulate.ts`](../../backend/src/http/admin/simulate.ts),
presets in [`backend/src/sim/presets.ts`](../../backend/src/sim/presets.ts).

### Request

Body is a **discriminated union on `mode`** — exactly one of the three shapes below. Any
invalid body (bad `priority`, missing `title`, unknown `preset`, out-of-range `count`, etc.)
is rejected as `400` **before any pipeline work runs**.

#### `mode: "custom"`

| Field           | Type    | Required | Notes                                                                                                                                          |
| --------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`          | string  | yes      | Literal `"custom"`.                                                                                                                            |
| `notification`  | object  | yes      | The shared [notification contract](./notifications.md) **minus `id`**. Any client-supplied `id` is not accepted — the server assigns its own.  |
| `sampleActions` | integer | no       | `0`–`3`. When the notification carries no `actions` of its own, the server attaches this many canned sample actions. Ignored if `actions` set. |

The server always assigns its own id of the form `sim-<ts>-<counter>-<rand>`, so repeated
generation of the same body never dedupes against itself.

```json
{
  "mode": "custom",
  "notification": {
    "module": "dsr",
    "title": "DSR approaching SLA breach",
    "description": "A data-subject request is within 24 hours of its statutory deadline.",
    "priority": "critical",
    "snoozable": false,
    "category": "sla",
    "audience": { "scope": "global" }
  },
  "sampleActions": 2
}
```

#### `mode: "preset"`

| Field    | Type   | Required | Notes                                     |
| -------- | ------ | -------- | ----------------------------------------- |
| `mode`   | string | yes      | Literal `"preset"`.                       |
| `preset` | string | yes      | One of the fixed preset ids listed below. |

Presets are deterministic (no RNG) — a given preset always produces the same body:

| `preset`         | Label                     | Description                                        |
| ---------------- | ------------------------- | -------------------------------------------------- |
| `critical-dsr`   | Critical DSR              | A data-subject request about to breach SLA.        |
| `high-access`    | High · access request     | Access approval with Approve/Deny/Review actions.  |
| `normal-finding` | Normal · data finding     | A routine scan classification result.              |
| `low-assessment` | Low · assessment reminder | A low-priority reminder with a single link.        |
| `long-body`      | Long body                 | A very long description to test truncation/expand. |

```json
{ "mode": "preset", "preset": "critical-dsr" }
```

#### `mode: "burst"`

| Field   | Type    | Required | Notes                                                                                                           |
| ------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `mode`  | string  | yes      | Literal `"burst"`.                                                                                              |
| `count` | integer | yes      | Positive, and `≤ SIMULATE_MAX_BURST` (env var, default `10000`). Over-ceiling or non-positive counts are `400`. |
| `seed`  | integer | no       | Makes the generated batch reproducible — same seed produces the same batch of bodies.                           |

Large bursts are ingested in **chunks of 500**. The generated notifications get their own
unique per-burst ids (server-controlled).

```json
{ "mode": "burst", "count": 250, "seed": 42 }
```

### Response `200`

| Field        | Type   | Notes                                                                                                                                    |
| ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `published`  | number | How many generated notifications were accepted **and** belong to an enabled module (delivered).                                          |
| `suppressed` | number | How many were accepted but belong to an **admin-disabled** module — recorded/policy-suppressed, not delivered and not shown in the feed. |

```json
{ "published": 250, "suppressed": 0 }
```

### Errors

| Status | Body                                     | Reason                                                                                                                          |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid request body" }`    | Body fails validation — bad/missing notification fields, unknown `preset`, or `count` non-positive / over `SIMULATE_MAX_BURST`. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                                                        |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but not an admin.                                                                                                    |
| `404`  | (Fastify not-found)                      | The route is not registered at all in production (`NODE_ENV === "production"`).                                                 |

### Side effects

Runs every generated notification through the real pipeline via `service.ingest()`
([`packages/core/src/pipeline/ingest.ts`](../../packages/core/src/pipeline/ingest.ts)):
each is persisted, deduped on its server-assigned id, checked against module policy,
and — for enabled modules — delivered live over SSE, exactly as a real publish. A notification
generated for a **disabled** module is counted in `suppressed` and does **not** appear in the
feed. No `x-internal-token` is used or exposed.

## Maintenance (dev/QA)

The `/admin/maintenance/*` routes are dev/QA database-reset helpers, all
`POST` and mostly **destructive** (the exception is
[`modules/reset`](#post-adminmaintenancemodulesreset), which now only re-enables the seeded
catalog rather than deleting it). Like [`POST /admin/simulate`](#post-adminsimulate), they
are registered **only when `NODE_ENV !== "production"`** (same
[`isSimulatorEnabled`](../../backend/src/server.ts) guard — registered together with the
simulator). In production every route on this page below is genuinely **absent**: a request
hits Fastify's not-found handler and returns `404`, it is not merely hidden behind the admin
gate.

> **Operational requirement:** `NODE_ENV` defaults to `"development"`, so this gate fails
> **open** — any production deployment **must set `NODE_ENV=production` explicitly**. An unset
> value leaves these endpoints registered.

Every route requires the `admin` role ([`requireAdmin`](../../backend/src/auth/guards.ts) —
`401` if not logged in, `403` if logged in but not an admin) and runs **immediately** against
the real database — there is no confirmation step, dry-run, or undo. SQL is parameterized
throughout.

Source: [`backend/src/http/admin/maintenance.ts`](../../backend/src/http/admin/maintenance.ts).

The shared error responses for all five routes:

| Status | Body                                     | Reason                                                                          |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                        |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but the session user lacks the `admin` role.                         |
| `404`  | (Fastify not-found)                      | The route is not registered at all in production (`NODE_ENV === "production"`). |

### POST /admin/maintenance/notifications/delete-all

Deletes **every row** in the `notifications` table. Each row's `notification_reads` rows
cascade away with it (`ON DELETE CASCADE`, migration 003).

#### Request

No parameters.

#### Response `200`

```json
{ "deleted": 42 }
```

| Field     | Type   | Notes                                  |
| --------- | ------ | -------------------------------------- |
| `deleted` | number | Count of `notifications` rows deleted. |

#### Side effects

Deletes all `notifications` rows; their `notification_reads` cascade away. Does **not** touch
`modules` or `global_settings`, and does not invalidate the policy cache.

### POST /admin/maintenance/notifications/delete-read

Deletes every notification whose id appears in `notification_reads` — i.e. every notification
read by **anyone**. Under the current global-broadcast semantic (a single `notification_reads`
row marks a notification read), this is an interim "clear everything someone has read" helper,
not a per-recipient operation.

#### Request

No parameters.

#### Response `200`

```json
{ "deleted": 17 }
```

| Field     | Type   | Notes                                                   |
| --------- | ------ | ------------------------------------------------------- |
| `deleted` | number | Count of `notifications` rows deleted (read by anyone). |

#### Side effects

Deletes matching `notifications` rows; their `notification_reads` cascade away. No policy-cache
invalidation.

### POST /admin/maintenance/notifications/delete-older-than

Deletes notifications whose `created_at` is older than `days` days ago (via
`now() - make_interval(days => $1)`).

#### Request

| Field  | Type    | Required | Notes                                                               |
| ------ | ------- | -------- | ------------------------------------------------------------------- |
| `days` | integer | yes      | Positive. A non-positive or non-integer value is rejected as `400`. |

```json
{ "days": 30 }
```

#### Response `200`

```json
{ "deleted": 8 }
```

| Field     | Type   | Notes                                  |
| --------- | ------ | -------------------------------------- |
| `deleted` | number | Count of `notifications` rows deleted. |

#### Errors

In addition to the shared `401`/`403`/`404` above:

| Status | Body                                  | Reason                                           |
| ------ | ------------------------------------- | ------------------------------------------------ |
| `400`  | `{ "error": "invalid request body" }` | `days` is missing, non-integer, or not positive. |

#### Side effects

Deletes matching `notifications` rows; their `notification_reads` cascade away. No policy-cache
invalidation.

### POST /admin/maintenance/modules/reset

**Re-enables all modules** in the seeded catalog (`UPDATE modules SET enabled = true WHERE
enabled = false`). It no longer deletes the catalog — the fixed rows and their seed labels
stay in place; only any admin disable is cleared.

#### Request

No parameters.

#### Response `200`

```json
{ "updated": 2 }
```

| Field     | Type   | Notes                                                                   |
| --------- | ------ | ----------------------------------------------------------------------- |
| `updated` | number | Count of `modules` rows flipped back to `enabled` (i.e. were disabled). |

#### Side effects

Sets every disabled module back to `enabled` and **invalidates the in-memory policy cache**
(the service's [`PolicyStore`](../../packages/core/src/policy/store.ts) invalidates its cache on any write) — the re-enabled modules
deliver again starting on their next ingest.

### POST /admin/maintenance/settings/reset

Restores the singleton `global_settings` row to defaults: all four feature flags
(`ai_summary_enabled`, `chatbot_enabled`, `grouping_enabled`, `actions_enabled`) back to
`true` and `retention_days` back to `30`, and bumps `updated_at`.

#### Request

No parameters.

#### Response `200`

```json
{ "ok": true }
```

| Field | Type    | Notes                     |
| ----- | ------- | ------------------------- |
| `ok`  | boolean | Always `true` on success. |

#### Side effects

Resets the `global_settings` feature flags and `retention_days`, and **invalidates the
in-memory policy cache** (the service's [`PolicyStore`](../../packages/core/src/policy/store.ts) invalidates its cache on any write) — the
restored flag values take effect on the next read.
