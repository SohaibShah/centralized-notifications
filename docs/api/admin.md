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
> **unchanged** by the extraction. (The [`/admin/maintenance/*`](#maintenance-devqa) dev/QA
> routes are **not** part of the library — they remain reference-app routes in `backend/`. The
> old `POST /admin/simulate` dev/QA generator has been removed — generating test notifications
> now goes through `packages/module-sim`'s control center, not a reference-app route.)
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
| `baseUrl`             | string \| null    | The module's registered API base URL (admin-editable via `PATCH`). `null` = not dispatchable.       |
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
    "baseUrl": "https://dsr.internal.example.com",
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

Enables/disables a module and/or sets its registered API base URL. Labels come from the seed
catalog and are **not** editable.

### Request

Path parameter:

| Param | Type                 | Required | Notes                    |
| ----- | -------------------- | -------- | ------------------------ |
| `key` | string (1–100 chars) | yes      | The module's identifier. |

Body — any subset of the two fields below; at least one is required:

| Field     | Type           | Required | Notes                                                                                                                                                                                                                                                                                 |
| --------- | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled` | boolean        | no*      | Enable/disable the module.                                                                                                                                                                                                                                                            |
| `baseUrl` | string \| null | no*      | The module's registered API base URL, used by the (upcoming) action dispatcher. Must be a non-empty `http(s)://` URL (case-insensitive scheme, max 2048 chars), or explicit `null` to clear it. Anything else — a `javascript:` URL, a malformed string, etc. — is rejected as `400`. |

\* An empty body (neither field present) is rejected as `400`. Both fields may be sent together
in the same request; each present field is applied independently.

A module with `baseUrl: null` (the default) is **not dispatchable** — the action dispatcher
rejects dispatch actions for it until an admin sets a `baseUrl`.

The current value is readable via [`GET /admin/modules`](#get-adminmodules), which includes
each module's `baseUrl` in its response.

```json
{ "enabled": false }
```

```json
{ "baseUrl": "https://dsr.internal.example.com" }
```

### Response `204`

`204 No Content` — no body.

### Errors

| Status | Body                                     | Reason                                                                                                                                                               |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid module key" }`      | `key` path parameter is empty or over 100 chars.                                                                                                                     |
| `400`  | `{ "error": "invalid request body" }`    | Body fails validation — neither `enabled` nor `baseUrl` present, `enabled` is not a boolean, or `baseUrl` isn't a valid `http(s)` URL (or `null`) within 2048 chars. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                                                                                             |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but not an admin.                                                                                                                                         |
| `404`  | `{ "error": "module not found" }`        | No module with that `key` exists in the seeded catalog.                                                                                                              |

### Side effects

Updates the `modules` row's `enabled` and/or `base_url` columns, depending on which fields were
present in the body. **Invalidates the in-memory policy cache** (the service's
[`PolicyStore`](../../packages/core/src/policy/store.ts) invalidates its cache on any write) — an
`enabled` change takes effect starting with the module's **next ingest**; a `baseUrl` change
takes effect on the dispatcher's next dispatch attempt. Neither is retroactive on
already-persisted notifications.

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

Updates one or more of the global feature flags (and the AI-summary generation time).

### Request

Body — any subset of the fields below; at least one is required:

| Field              | Type    | Required | Notes                                                                                                                       |
| ------------------ | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `aiSummaryEnabled` | boolean | no*      |                                                                                                                             |
| `chatbotEnabled`   | boolean | no*      |                                                                                                                             |
| `groupingEnabled`  | boolean | no*      |                                                                                                                             |
| `actionsEnabled`   | boolean | no*      |                                                                                                                             |
| `summaryTime`      | string  | no*      | Daily AI-summary generation time-of-day, applied in **each user's own timezone**. `'HH:MM'` 24-hour, validated by `^([01]\d | 2[0-3]):[0-5]\d$`— a malformed value →`400`. |

\* An empty body (no fields present) is rejected as `400`.

```json
{ "aiSummaryEnabled": false, "summaryTime": "06:00" }
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
  "actionsEnabled": true,
  "summaryTime": "06:00"
}
```

See the field table under [`GET /admin/settings`](#get-adminsettings) — the four flags share that shape; `summaryTime` is the `'HH:MM'` daily AI-summary generation time (applied in each user's own timezone).

### Errors

| Status | Body                                     | Reason                   |
| ------ | ---------------------------------------- | ------------------------ |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie. |

### Side effects

None — read-only.

## Maintenance (dev/QA)

The `/admin/maintenance/*` routes are dev/QA database-reset helpers, all
`POST` and mostly **destructive** (the exception is
[`modules/reset`](#post-adminmaintenancemodulesreset), which now only re-enables the seeded
catalog rather than deleting it). They are registered **only when `NODE_ENV !== "production"`**
([`isSimulatorEnabled`](../../backend/src/server.ts) guard). In production every route on this
page below is genuinely **absent**: a request hits Fastify's not-found handler and returns
`404`, it is not merely hidden behind the admin gate.

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
