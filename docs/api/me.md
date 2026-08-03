---
title: Me / Profile API
tags: [api, profile, self-service]
---

# Me / Profile

Self-service profile endpoints owned by the **host**, not the notification library. Identity
attributes (username, roles, teams, timezone) live in the host's own users table — they are
deliberately **not** part of the [notification preference contract](./notifications.md#per-user-preferences--snoozemute-rules),
which covers only notification-domain settings (snooze/mute, grouping, summary opt-out, toast
control). This split is intentional: the library never reads or writes host identity.

Every endpoint here is **scoped to the session user** — a user can only ever change their own
profile.

Source of truth: [`backend/src/auth/me.ts`](../../backend/src/auth/me.ts) (the routes),
[`backend/src/auth/guards.ts`](../../backend/src/auth/guards.ts) (the `requireUser` guard).

## PATCH /me/timezone

**Auth:** required (valid `session` cookie). Guarded by `requireUser`.

Sets the caller's own **IANA timezone**. This is what the summary scheduler reads to generate
each user's digest in **their** local morning (a per-user-local generation job), so the value
must be a real IANA zone the runtime recognizes.

### Request

Body validated with zod:

| Field      | Type   | Required | Notes                                                                                          |
| ---------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `timezone` | string | yes      | 1–100 chars. Must be a valid IANA zone (e.g. `"America/New_York"`, `"Asia/Kolkata"`, `"UTC"`). |

```json
{ "timezone": "America/New_York" }
```

**Validation.** The zone is checked by attempting to construct an `Intl.DateTimeFormat` for it
(constructing one throws `RangeError` for an unknown zone) — a lib-version-independent check
that does not rely on `Intl.supportedValuesOf`. An unrecognized zone → `400`.

### Response `200`

The stored timezone, echoed back:

```json
{ "timezone": "America/New_York" }
```

### Errors

| Status | Body                                     | Reason                                                        |
| ------ | ---------------------------------------- | ------------------------------------------------------------- |
| 400    | `{ "error": "invalid request body" }`    | Body failed zod validation (missing/blank/over-length field). |
| 400    | `{ "error": "unknown timezone" }`        | `timezone` is a string but not a valid IANA zone.             |
| 401    | `{ "error": "authentication required" }` | No valid session cookie (not logged in).                      |

### Side effects

One `UPDATE users SET timezone = … WHERE id = <session user>` — the caller's row only. No events
published.
