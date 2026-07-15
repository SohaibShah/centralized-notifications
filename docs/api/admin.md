---
title: Admin API
tags: [api, admin, governance]
---

# Admin

The Week-2 admin governance endpoints: per-module enable/disable and global feature
kill-switches. Every route on this page except [`GET /settings/features`](#get-settingsfeatures)
requires the `admin` role — see [`requireAdmin`](../../backend/src/auth/guards.ts) and the
[Auth model](./auth.md#auth-model). A module that is disabled here has its notifications
**recorded but suppressed** — they are persisted (so history isn't lost) but never delivered
to recipients; see the `suppressed` flag below and the note on
[`GET /notifications`](./notifications.md#get-notifications).

Source of truth: [`backend/src/http/admin/routes.ts`](../../backend/src/http/admin/routes.ts).

## GET /admin/modules

**Auth:** required, admin only ([`requireAdmin`](../../backend/src/auth/guards.ts) — `401` if
not logged in, `403` if logged in but not an admin).

Lists every known module (auto-discovered on first publish, per the
[notification contract](./notifications.md)) with its enabled state and aggregate
notification counts, ordered by last-seen **descending**.

### Request

No parameters.

### Response `200`

An array of module summaries:

| Field                 | Type              | Notes                                                                                           |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `key`                 | string            | The module's identifier, as sent in the notification's `module` field.                          |
| `label`               | string            | Display label. Auto-derived title-case of `key` unless overridden via the `PATCH` below.        |
| `enabled`             | boolean           | Whether the module is currently allowed to deliver notifications.                               |
| `lastSeenAt`          | string (ISO 8601) | Timestamp of the module's most recent publish.                                                  |
| `total`               | number            | Count of **all** notifications ever recorded for this module (suppressed or not).               |
| `suppressed`          | number            | Of `total`, how many were recorded but not delivered (published while the module was disabled). |
| `byPriority.critical` | number            | Count of this module's notifications at `critical` priority.                                    |
| `byPriority.high`     | number            | Count at `high` priority.                                                                       |
| `byPriority.normal`   | number            | Count at `normal` priority.                                                                     |
| `byPriority.low`      | number            | Count at `low` priority.                                                                        |

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

Enables/disables a module and/or overrides its display label.

### Request

Path parameter:

| Param | Type                 | Required | Notes                    |
| ----- | -------------------- | -------- | ------------------------ |
| `key` | string (1–100 chars) | yes      | The module's identifier. |

Body — at least one of the two fields is required:

| Field     | Type                 | Required | Notes                                                                                                                                                                                 |
| --------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled` | boolean              | no*      | Enable/disable the module.                                                                                                                                                            |
| `label`   | string (≤ 100 chars) | no*      | Override the display label. An empty or whitespace-only value **re-derives** the auto title-case label from `key` (e.g. `"data-mapping"` → `"Data Mapping"`) rather than clearing it. |

\* At least one of `enabled`/`label` must be present — a body with neither is rejected as `400`.

```json
{ "enabled": false }
```

### Response `204`

`204 No Content` — no body.

### Errors

| Status | Body                                     | Reason                                                                                    |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid module key" }`      | `key` path parameter is empty or over 100 chars.                                          |
| `400`  | `{ "error": "invalid request body" }`    | Body fails validation — neither `enabled` nor `label` present, or `label` over 100 chars. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                  |
| `403`  | `{ "error": "admin role required" }`     | Logged in, but not an admin.                                                              |
| `404`  | `{ "error": "module not found" }`        | No module with that `key` exists (it has never published a notification).                 |

### Side effects

Updates the `modules` row (`enabled` and/or `label`). **Invalidates the in-memory policy
cache** ([`invalidatePolicyCache`](../../backend/src/pipeline/policy.ts)) — a disable/enable
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
([`invalidatePolicyCache`](../../backend/src/pipeline/policy.ts)) — the new flag values take
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
