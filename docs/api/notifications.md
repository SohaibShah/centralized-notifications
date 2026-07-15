---
title: Notifications API
tags: [api, notifications, contract]
---

# Notifications

The notification contract — the single shape every module publishes and the frontend
renders. It is the **stable boundary of the domain-agnostic backend**: the system acts
only on the top-level fields (dedupes on `id`, resolves `audience`, applies policy on
`priority`/`category`) and treats `metadata` as opaque. New per-module needs are met by
extending `metadata`, **not** by changing this shape — that is what lets modules be added
without touching the core.

Source of truth: [`packages/shared/src/notification.ts`](../../packages/shared/src/notification.ts).
The zod schema there is shared and validated on **both** the frontend and the backend, so
there is exactly one definition of "a valid notification."

> This page documents the **contract**. The HTTP publish endpoint that enforces it —
> `POST /internal/publish` — is documented separately on the [Intake page](./intake.md)
> (auth, batching, dedupe, response shape, side effects).

## Schema

Because this schema is the **input-validation boundary**, every free-text field and the
`actions` array is length-bounded — the bounds keep a buggy or hostile publisher from sending
abusive payloads. Overall request body size is additionally capped at the HTTP intake layer
(Task 5).

| Field         | Type                                        | Required | Notes                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string (1–200 chars, non-blank)             | yes      | Caller-supplied. **Also the dedupe / idempotency key** — re-publishing the same `id` is a dedupe (the later publish is skipped), not an update. Must be non-empty and non-blank; whitespace-only values are rejected (they'd otherwise split into distinct notifications). |
| `module`      | string (1–100 chars)                        | yes      | Originating module. Auto-discovered on first publish — a module does not need to be pre-registered.                                                                                                                                                                        |
| `title`       | string (1–500 chars)                        | yes      | Short heading shown on the card.                                                                                                                                                                                                                                           |
| `description` | string (≤ 5000 chars)                       | yes      | Body text. May be empty (`""`) but the field must be present.                                                                                                                                                                                                              |
| `priority`    | `'low' \| 'normal' \| 'high' \| 'critical'` | yes      | Drives policy and ordering.                                                                                                                                                                                                                                                |
| `snoozable`   | boolean                                     | yes      | Whether this notification may be snoozed. Required so every publisher makes the choice explicitly (no implicit default).                                                                                                                                                   |
| `actions`     | array of [Action](#action) (≤ 10 items)     | no       | Module-owned callbacks surfaced as buttons on the card. At most 10 entries.                                                                                                                                                                                                |
| `audience`    | [Audience](#audience)                       | yes      | Who the notification is for.                                                                                                                                                                                                                                               |
| `category`    | string (1–100 chars)                        | no       | If omitted, derived from the module/domain.                                                                                                                                                                                                                                |
| `timestamp`   | string (ISO 8601)                           | no       | ISO 8601 datetime; a timezone offset is allowed (e.g. `2026-07-03T12:00:00Z` or `2026-07-03T17:30:00+05:30`). If omitted, set on intake.                                                                                                                                   |
| `metadata`    | object                                      | no       | Opaque module-owned data — stored and passed through, [never interpreted by the system](#the-metadata-field).                                                                                                                                                              |

### Action

Each entry in `actions`:

| Field    | Type                                              | Required | Notes                                                                                                                                                                                                     |
| -------- | ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`  | string (1–100 chars)                              | yes      | Button text.                                                                                                                                                                                              |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | yes      | HTTP method the button invokes.                                                                                                                                                                           |
| `url`    | string (http(s) URL, ≤ 2048 chars)                | yes      | Target the action calls. **Restricted to `http`/`https`** — `javascript:`, `data:`, `file:`, and `ftp:` are rejected as an XSS/SSRF safeguard, since the URL is rendered as a clickable/fetchable target. |
| `icon`   | string (1–100 chars)                              | no       | An icon **name** from the design-system icon set (e.g. `"check"`, `"external-link"`), **not** a URL or image. Extensible later (e.g. variant, confirm).                                                   |

### Audience

| Field   | Type                                     | Required    | Notes                                                                                                                                                                         |
| ------- | ---------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope` | `'global' \| 'team' \| 'role' \| 'user'` | yes         | Who the notification targets.                                                                                                                                                 |
| `id`    | string (non-empty)                       | conditional | Identifies the team/role/user. **Required for `team`, `role`, `user`; absent for `global`** (everyone). Enforced by the schema — a non-global scope without `id` is rejected. |

## GET /notifications

**Auth:** required (session cookie — [`requireUser`](../../backend/src/http/notifications/routes.ts); `401` if not logged in). The cookie is same-origin, so a browser `fetch`/`EventSource` sends it automatically through the dev proxy.

The feed **read** path: returns the caller's notifications newest-first as one keyset-paginated page. Read-only — no side effects. Notifications from a module an admin has disabled (`suppressed = true` — see the [Admin API](./admin.md)) are excluded from the returned list; they are still recorded, just never surfaced here.

Source of truth: [`backend/src/http/notifications/routes.ts`](../../backend/src/http/notifications/routes.ts).

> **Week-1 limitation.** Every authenticated user currently receives **every** notification — there is no audience resolution yet (that lands in Week 4). This is intentional for the prototype; do not mistake it for the final per-audience feed.

### Request

Query parameters:

| Param    | Type            | Required | Notes                                                                                                                                          |
| -------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`  | integer         | no       | Page size. Default `25`, min `1`, max `100`. Coerced from the query string; out-of-range or non-numeric → `400`.                               |
| `cursor` | string (opaque) | no       | The `nextCursor` from a previous page. **Opaque** — only ever pass back a value the server handed out; a malformed/undecodable cursor → `400`. |

**Ordering & pagination.** Newest-first, keyset on `(created_at DESC, id DESC)` — there is **no `OFFSET`** (NFR-2), so a deep page costs the same as the first. `cursor` is an opaque base64url token encoding the last returned row's `(created_at, id)`; clients must treat it as opaque. There is deliberately **no total count** — keyset paging never scans to one.

### Response `200`

A [`NotificationPage`](../../packages/shared/src/notification.ts): a page of `items` plus a `nextCursor`. `nextCursor` is the token to pass back as `?cursor=` for the next (older) page, and is `null` once the oldest row has been reached.

```json
{
  "items": [
    {
      "id": "dsr-1234-sla-warning-72h",
      "module": "dsr",
      "title": "DSR #1234 is 3 days from SLA breach",
      "description": "A data-subject deletion request for a CA resident is due 2026-07-06.",
      "priority": "critical",
      "snoozable": true,
      "audience": { "scope": "team", "id": "privacy-ops" },
      "category": "sla",
      "actions": [
        {
          "label": "Open DSR",
          "method": "GET",
          "url": "https://app/dsr/1234",
          "icon": "folder-open"
        }
      ],
      "metadata": {
        "dsrId": "1234",
        "slaDueAt": "2026-07-06T00:00:00Z",
        "subjectRegion": "us-ca",
        "type": "erasure"
      },
      "createdAt": "2026-07-03T09:15:22.481Z",
      "read": false
    }
  ],
  "nextCursor": "eyJ0cyI6IjIwMjYtMDc…In0"
}
```

> The item above mirrors example B from [Examples](#examples) as the read path returns it — the same publish-contract shape, with `createdAt` and `read` added. `nextCursor` is shown truncated because the token is opaque; treat it as a value you only ever hand straight back as `?cursor=`.

#### `FeedNotification`

Each item is the full [notification contract](#schema) above **plus** two server-derived, per-viewer fields. These are **not** part of the publish contract — producers never send them, and they don't exist until a notification has been persisted and viewed:

| Field       | Type              | Notes                                                                                                                                                                                            |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createdAt` | string (ISO 8601) | Server **receive** time (`notifications.created_at`), distinct from the module's own optional [`timestamp`](#schema). This is the feed's ordering key.                                           |
| `read`      | boolean           | Whether **the requesting user** has read this notification (`LEFT JOIN` against `notification_reads`). Per-user: the same notification can be `read: true` for one user and `false` for another. |

Read state lives in its own table — `notification_reads(user_id, notification_id, read_at, PRIMARY KEY(user_id, notification_id))`, both foreign keys `ON DELETE CASCADE` (see [`backend/migrations/003_notification_reads.sql`](../../backend/migrations/003_notification_reads.sql)). A row exists **iff** that user has read that notification; absence of a row means unread. The write endpoint that marks a notification read is [`POST /notifications/:id/read`](#post-notificationsidread), documented below.

### Errors

| Status | Body                                      | Reason                                                  |
| ------ | ----------------------------------------- | ------------------------------------------------------- |
| `400`  | `{ "error": "invalid query parameters" }` | `limit` out of range (`< 1` or `> 100`) or non-numeric. |
| `400`  | `{ "error": "invalid cursor" }`           | `cursor` is malformed or not a token the server issued. |
| `401`  | `{ "error": "authentication required" }`  | No valid session cookie.                                |

### Side effects

None — read-only.

## POST /notifications/:id/read

**Auth:** required (session cookie — [`requireUser`](../../backend/src/http/notifications/routes.ts); `401` if not logged in).

Marks a notification **read for the current user** (FR-6). Read state is per-user, so this only ever affects the caller's own `notification_reads` row — one user marking a notification read never changes another user's state.

Source of truth: [`backend/src/http/notifications/routes.ts`](../../backend/src/http/notifications/routes.ts).

### Request

Path parameter:

| Param | Type                 | Required | Notes                                                                                              |
| ----- | -------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `id`  | string (1–200 chars) | yes      | The notification's contract [`id`](#schema). An id outside that shape (empty or too long) → `400`. |

**No request body.** The client sends no body and no content-type.

**Idempotent.** The mark is an `INSERT … ON CONFLICT (user_id, notification_id) DO NOTHING`, so repeating the call is a no-op — a double-click or an at-least-once retry never errors and never creates a duplicate row.

### Response `204`

`204 No Content` — no body. A subsequent [`GET /notifications`](#get-notifications) then returns `read: true` for this notification **for this user** (the list's `LEFT JOIN` against `notification_reads`).

### Errors

| Status | Body                                     | Reason                                                                                   |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid notification id" }` | `id` is empty or longer than 200 chars.                                                  |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                 |
| `404`  | `{ "error": "notification not found" }`  | No notification with that `id` exists — a client can't seed read rows for arbitrary ids. |

### Side effects

One upsert into `notification_reads` (`(user_id, notification_id)`, keyed by the authenticated user). No events published.

## POST /notifications/read

**Auth:** required (session cookie — [`requireUser`](../../backend/src/http/notifications/routes.ts); `401` if not logged in).

Bulk mark-read for the current user — what the panel's "mark all read" calls. Marks each
id in the batch read **for the caller**; read state is per-user, so this only ever affects
the caller's own `notification_reads` rows, same as the single-id endpoint above.

Source of truth: [`backend/src/http/notifications/routes.ts`](../../backend/src/http/notifications/routes.ts).

### Request

Body:

| Field | Type       | Required | Notes                                                                                                                    |
| ----- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ids` | `string[]` | yes      | 1–500 ids per request (batch capped so one call can't ask to write an unbounded set). Each id is 1–200 chars, non-empty. |

```json
{ "ids": ["dsr-1234-sla-warning-72h", "scan-run-556-sensitive-found"] }
```

**Unknown ids are silently ignored.** Unlike the single-id endpoint (which 404s for an id
that doesn't exist), the bulk endpoint filters the batch down to ids that exist
(`WHERE n.id = ANY($2::text[])`) and marks only those read — an id that isn't a real
notification simply contributes no row, so a client doesn't need to pre-filter its batch
and one stale id can't fail the whole request.

**Idempotent.** Same mechanism as the single-id endpoint — `INSERT … ON CONFLICT
(user_id, notification_id) DO NOTHING` — so repeating a batch (or overlapping it with a
previous one) is a no-op; a retry or a double-click on "mark all read" never errors and
never creates duplicate rows.

### Response `204`

`204 No Content` — no body. A subsequent [`GET /notifications`](#get-notifications) then
returns `read: true` for every id in the batch that existed, for this user.

### Errors

| Status | Body                                     | Reason                                                                                                        |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `400`  | `{ "error": "invalid request body" }`    | `ids` is missing, empty, has more than 500 entries, or contains an id that is empty or longer than 200 chars. |
| `401`  | `{ "error": "authentication required" }` | No valid session cookie.                                                                                      |

### Side effects

Zero or more inserts into `notification_reads` — one per id in the batch that corresponds
to an existing notification (keyed by the authenticated user). No events published.

## Design decisions

These are baked into the contract deliberately (contract checkpoint, see
`docs/implementation-plan.md` "Task 2"):

- **Unknown top-level fields are stripped, not rejected.** The schema is forwards-compatible:
  a publisher on a newer contract version can send extra top-level fields and older intake
  will silently drop them rather than fail validation. If you need the system to _act_ on a
  new field, it must be added to the schema — an unknown field is never load-bearing.
- **`id` doubles as the idempotency key.** There is no separate dedupe key. The caller owns
  the `id` and is responsible for making it stable and unique per logical event, so a retry
  (or an at-least-once redelivery once intake moves to Redis Streams in Week 5) dedupes to a
  single notification.
- **`snoozable` is required.** Every publisher states explicitly whether a notification can
  be snoozed rather than inheriting a default that might be wrong for the domain.
- **Global-vs-per-user precedence (delivery, not the contract).** A global admin disable or
  snooze always wins; per-user preferences may only _further restrict_ delivery, never
  re-enable something an admin turned off. This affects the delivery pipeline, not the shape
  of the message — noted here so publishers understand a valid, well-formed notification can
  still be legitimately withheld from a recipient.

## The `metadata` field

`metadata` is the module's **escape hatch** for domain-specific data the core never
interprets. The backend stores it and passes it through verbatim; it never branches on its
contents. This is what keeps the backend domain-agnostic.

The frontend uses `metadata` **generically** — never with per-module `if` branches:

- **Details section (a).** The card can expand into a "Details" key/value section rendered
  straight from the `metadata` object.
- **Grouping / threading (b, FR-18).** A correlation value in `metadata` (e.g. a shared
  `dsrId` or `scanId`) is used as a grouping key to thread related notifications together.
- **Filter / search (c, FR-11).** `metadata` values are searchable/filterable alongside the
  top-level fields.
- **"Go to source" deep-link fallback (d, FR-21).** When no explicit `action` points at the
  originating record, a URL-like value in `metadata` can back a "go to source" link.

The rule of thumb:

> If the **system** must act on a piece of data (dedupe, audience, policy) → promote it to a
> top-level field. If only the **module or the UI** cares about it → it belongs in
> `metadata`.

## Examples

All four validate against the schema. They are illustrative Securiti-module notifications.

### A — Access Governance approval

User-scoped, high priority, actions with icons.

```json
{
  "id": "accessreq-8842-approval",
  "module": "access-governance",
  "title": "Access request awaiting your approval",
  "description": "Priya Nair requested Admin access to the \"Prod-EU\" data catalog.",
  "priority": "high",
  "snoozable": false,
  "audience": { "scope": "user", "id": "u_212" },
  "category": "approvals",
  "actions": [
    {
      "label": "Approve",
      "method": "POST",
      "url": "https://app/api/access/8842/approve",
      "icon": "check"
    },
    { "label": "Deny", "method": "POST", "url": "https://app/api/access/8842/deny", "icon": "x" },
    {
      "label": "Review",
      "method": "GET",
      "url": "https://app/access/8842",
      "icon": "external-link"
    }
  ],
  "metadata": {
    "requestId": "8842",
    "requester": "u_309",
    "resource": "catalog:prod-eu",
    "riskScore": 72
  }
}
```

### B — DSR SLA warning

Team-scoped, critical priority.

```json
{
  "id": "dsr-1234-sla-warning-72h",
  "module": "dsr",
  "title": "DSR #1234 is 3 days from SLA breach",
  "description": "A data-subject deletion request for a CA resident is due 2026-07-06.",
  "priority": "critical",
  "snoozable": true,
  "audience": { "scope": "team", "id": "privacy-ops" },
  "category": "sla",
  "actions": [
    { "label": "Open DSR", "method": "GET", "url": "https://app/dsr/1234", "icon": "folder-open" }
  ],
  "metadata": {
    "dsrId": "1234",
    "slaDueAt": "2026-07-06T00:00:00Z",
    "subjectRegion": "us-ca",
    "type": "erasure"
  }
}
```

### C — Data mapping discovery

Global-scoped, normal priority, no actions, `timestamp` and `category` omitted (derived on
intake).

```json
{
  "id": "scan-run-556-sensitive-found",
  "module": "data-mapping",
  "title": "Sensitive data found in 2 new data stores",
  "description": "The nightly scan classified SSN and credit-card data in newly connected stores.",
  "priority": "normal",
  "snoozable": true,
  "audience": { "scope": "global" },
  "metadata": { "scanId": "556", "storeCount": 2, "classifications": ["ssn", "credit-card"] }
}
```

### D — Assessments reminder

Role-scoped, low priority.

```json
{
  "id": "assessment-q3-reminder-security",
  "module": "assessments",
  "title": "Q3 vendor risk assessments due this week",
  "description": "4 assessments assigned to your role are still in draft.",
  "priority": "low",
  "snoozable": true,
  "audience": { "scope": "role", "id": "security-reviewer" },
  "category": "reminders",
  "actions": [
    {
      "label": "View assessments",
      "method": "GET",
      "url": "https://app/assessments?state=draft",
      "icon": "clipboard-list"
    }
  ],
  "metadata": { "quarter": "2026-Q3", "draftCount": 4 }
}
```

## Publish API

The contract above is validated at **`POST /internal/publish`** — the service-to-service
intake endpoint where backend modules publish notifications. Its auth (shared internal
token), batch behavior, dedupe/idempotency semantics, response shape, status codes, and
side effects are documented on the [Intake page](./intake.md).
