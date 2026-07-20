---
title: Intake API
tags: [api, intake, publish]
---

# Intake

The service-to-service intake boundary — how backend modules publish notifications into
the system. This is the transport in front of the ingestion pipeline (validate → dedupe →
persist); the [notification contract](./notifications.md) is the shape it accepts.

It is **not** a user-facing, session-authenticated endpoint: producers are other backend
modules/services, and they authenticate with a shared internal token, not a login cookie.
The transport is deliberately thin — it adapts the HTTP request to `unknown[]` and calls
the pipeline once per item — so the same pipeline can sit behind a Redis Stream consumer
later (Week 5) with no rewrite.

Source of truth:
[`backend/src/intake/http-intake.ts`](../../backend/src/intake/http-intake.ts) (route +
auth + batching),
[`backend/src/intake/boundary.ts`](../../backend/src/intake/boundary.ts) (result shape),
[`backend/src/pipeline/ingest.ts`](../../backend/src/pipeline/ingest.ts) (per-item
validate → dedupe → persist).

---

## POST /internal/publish

**Auth:** internal token (service-to-service), **not** a user session.

Publishes one notification, or a batch of them, into the ingestion pipeline. Each item is
validated against the [notification contract](./notifications.md), deduped on its `id`, and
persisted independently.

### Auth

Send the shared secret in the **`x-internal-token`** request header. It is compared in
**constant time** against the server's `INTERNAL_INTAKE_TOKEN` env var (validated at
startup, minimum 16 chars). A missing or wrong token returns `401` — the whole request is
rejected before any item is processed.

This authenticates a **calling module/service**, not an end user. There is no `req.user`
and no session cookie involved here.

### Request

`Content-Type: application/json`. The body is **either**:

- a single [Notification](./notifications.md#schema) object, **or**
- an **array** of Notification objects (a batch).

The notification shape (`id`, `module`, `title`, `description`, `priority`, `snoozable`,
`audience`, and optional `actions` / `category` / `timestamp` / `metadata`) is defined once
in [`packages/shared/src/notification.ts`](../../packages/shared/src/notification.ts) and
documented in full on the [Notifications page](./notifications.md#schema) — it is not
redefined here.

#### Batch limits

| Rule            | Behavior                                                            |
| --------------- | ------------------------------------------------------------------- |
| Max batch size  | An array may contain at most **500** items; a larger array → `400`. |
| Empty array     | `[]` → `400` (`empty batch`).                                       |
| Wrong body type | A non-object/non-array body (string, number, `null`) → `400`.       |

#### Per-item processing

Every item runs through the pipeline **independently**. A single malformed item in a batch
is reported as `invalid` in the results and does **not** fail the batch or change the HTTP
status — a batch of 500 with one bad item still returns `200`. Contract-invalid input is
logged and skipped, never thrown.

An item whose `module` is not in the **fixed, seeded module catalog** (`dsr`,
`access-governance`, `data-mapping`, `assessments`) is likewise reported `invalid` — it is
logged server-side (`[intake] rejected notification from unknown module "<key>"`) and is
**not** persisted or delivered. Modules are no longer auto-discovered on first publish; a
notification from an unknown module is treated the same as a malformed payload.

Only genuine infrastructure failures (e.g. the database is down) propagate as a `5xx`;
because persistence is idempotent on `id`, the producer can safely retry the whole request.

#### Dedupe / idempotency

Persistence dedupes on the notification **`id`** (the idempotency key). Re-publishing an
`id` that already exists is a safe no-op: it is reported as `duplicate`, and the original
stored row is **not** overwritten. This matters because upstream delivery is at-least-once
(Redis Streams, Week 5) — the same publish can legitimately arrive twice.

### Response `200`

A summary plus a per-item `results` array **in request order**. `id` is present for
`accepted` and `duplicate` items, and **absent** for `invalid` ones.

| Field       | Type                                                                     | Notes                                                                                   |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `accepted`  | number                                                                   | Count of newly persisted notifications.                                                 |
| `duplicate` | number                                                                   | Count deduped against an existing `id`.                                                 |
| `invalid`   | number                                                                   | Count that failed contract validation **or** named a module outside the seeded catalog. |
| `results`   | Array<{ status: `"accepted" \| "duplicate" \| "invalid"`, id?: string }> | Per-item outcome, in request order.                                                     |

### Examples

#### 1 — Single valid notification → `200`

Request (body is a single object):

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

Response:

```json
{
  "accepted": 1,
  "duplicate": 0,
  "invalid": 0,
  "results": [{ "status": "accepted", "id": "scan-run-556-sensitive-found" }]
}
```

#### 2 — Batch of [valid, duplicate, malformed] → `200`

Request (a 3-item array): a new notification, a re-publish of an `id` already stored, and a
malformed item (here missing the required `priority` field):

```json
[
  {
    "id": "dsr-1234-sla-warning-72h",
    "module": "dsr",
    "title": "DSR #1234 is 3 days from SLA breach",
    "description": "A data-subject deletion request for a CA resident is due 2026-07-06.",
    "priority": "critical",
    "snoozable": true,
    "audience": { "scope": "team", "id": "privacy-ops" }
  },
  {
    "id": "scan-run-556-sensitive-found",
    "module": "data-mapping",
    "title": "Sensitive data found in 2 new data stores",
    "description": "The nightly scan classified SSN and credit-card data in newly connected stores.",
    "priority": "normal",
    "snoozable": true,
    "audience": { "scope": "global" }
  },
  {
    "id": "assessment-q3-reminder-security",
    "module": "assessments",
    "title": "Q3 vendor risk assessments due this week",
    "description": "4 assessments assigned to your role are still in draft.",
    "snoozable": true,
    "audience": { "scope": "role", "id": "security-reviewer" }
  }
]
```

Response — the malformed item is reported `invalid` (no `id`) without failing the batch:

```json
{
  "accepted": 1,
  "duplicate": 1,
  "invalid": 1,
  "results": [
    { "status": "accepted", "id": "dsr-1234-sla-warning-72h" },
    { "status": "duplicate", "id": "scan-run-556-sensitive-found" },
    { "status": "invalid" }
  ]
}
```

#### 3 — Missing/invalid token → `401`

Request without a valid `x-internal-token` header:

```json
{ "error": "invalid or missing internal token" }
```

### Errors

| Status | Body                                                            | Reason                                                                      |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 400    | `{ "error": "body must be a notification object or an array" }` | Body was neither an object nor an array (e.g. a string, number, or `null`). |
| 400    | `{ "error": "empty batch" }`                                    | Body was an empty array.                                                    |
| 400    | `{ "error": "batch exceeds max of 500" }`                       | Array contained more than 500 items.                                        |
| 401    | `{ "error": "invalid or missing internal token" }`              | `x-internal-token` header absent or did not match `INTERNAL_INTAKE_TOKEN`.  |
| 429    | (rate-limit body from `@fastify/rate-limit`)                    | Per-IP rate limit exceeded (see [Rate limiting](#rate-limiting)).           |

Note: a **contract-invalid notification — or one from an unknown module — is not a `4xx`** —
it comes back inside a `200` response as an `invalid` result. The `400`s above are about the
request envelope (shape and batch size), not about individual notification validity.

### Rate limiting

Per-IP, **~120 requests/minute** (`@fastify/rate-limit`); exceeding it returns `429`.
Publishing is a burst endpoint, so this ceiling is higher than login's. Under `NODE_ENV=test`
the limit is relaxed (10000/min) so the test suite's rapid injects aren't throttled.

### Side effects

Accepted notifications are **persisted to the `notifications` table** (Postgres). Duplicates
and invalid items (including unknown-module rejections) write nothing. **No delivery / fan-out
happens yet** — no Redis Stream event is published at this stage; that lands in a later task.
