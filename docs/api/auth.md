---
title: Auth API
tags: [api, auth, session]
---

# Auth

Prototype username/password authentication with encrypted cookie sessions. This is a
**deliberate seam**: production replaces it with the host application's identity system.
The rest of the backend depends only on the resolved [session user](#session-user-shape)
shape (`req.user`), so swapping the identity source later does not touch the modules that
read roles/teams for authorization and audience resolution.

Source of truth:
[`backend/src/auth/routes.ts`](../../backend/src/auth/routes.ts) (endpoints),
[`backend/src/auth/guards.ts`](../../backend/src/auth/guards.ts) (auth guards),
[`backend/src/auth/session.ts`](../../backend/src/auth/session.ts) (cookie behavior),
[`backend/src/auth/repository.ts`](../../backend/src/auth/repository.ts) (user shape).

## Auth model

- **Credentials.** Username + password. Passwords are hashed with **argon2id**
  (`@node-rs/argon2`, its default variant) — no plaintext is stored.
- **Sessions are stateless encrypted cookies** via
  [`@fastify/secure-session`](https://github.com/fastify/fastify-secure-session). The
  cookie carries **only the user id**, encrypted + signed with `SESSION_SECRET`. Every
  request re-resolves roles/teams from the database off that id.
- **Admin is the `admin` role.** A `requireAdmin` guard protects admin-only endpoints; it
  returns `401` if not logged in, or `403 { error: "admin role required" }` if the session
  user does not hold the `admin` role.

### Session cookie

| Property   | Value                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| Name       | `session`                                                               |
| `httpOnly` | `true` (not readable from JS)                                           |
| `sameSite` | `Lax`                                                                   |
| `path`     | `/`                                                                     |
| `secure`   | `true` when `NODE_ENV === "production"`, otherwise `false` (local HTTP) |
| Payload    | user id only, encrypted with `SESSION_SECRET`                           |

### Session user shape

The shape every authenticated endpoint sees as `req.user`, and the body returned by
`/auth/login` and `/auth/me`. Defined as `SessionUser` in
[`repository.ts`](../../backend/src/auth/repository.ts).

| Field         | Type     | Notes                                                |
| ------------- | -------- | ---------------------------------------------------- |
| `id`          | string   | User id (DB primary key).                            |
| `username`    | string   | Login handle.                                        |
| `displayName` | string   | Human-readable name for display.                     |
| `roles`       | string[] | Role keys (e.g. `["admin"]`); drives authorization.  |
| `teamIds`     | string[] | Team keys (e.g. `["privacy-ops"]`); drives audience. |

### Dev users

The prototype ships seeded dev users — `admin`, `priya`, `sam`, `alex`, `jordan` — who all
share one known dev password. It is documented in the seed file, not a secret; see
[`backend/src/auth/seed.ts`](../../backend/src/auth/seed.ts) (`DEV_PASSWORD`) for the value,
role, and team assignments. Seed them with:

```sh
pnpm --filter @notifications/backend seed
```

The seed is idempotent (upserts users/roles/teams and resets memberships), so it is safe to
re-run.

---

## POST /auth/login

**Auth:** none required.

Verifies credentials and, on success, sets the `session` cookie.

### Request

Body validated with zod ([`loginSchema`](../../backend/src/auth/routes.ts)):

| Field      | Type   | Required | Notes        |
| ---------- | ------ | -------- | ------------ |
| `username` | string | yes      | 1–100 chars. |
| `password` | string | yes      | 1–200 chars. |

### Response `200`

Sets the `session` cookie (see [Session cookie](#session-cookie)) and returns the resolved
[session user](#session-user-shape):

```json
{
  "user": {
    "id": "018f3a2b-...",
    "username": "priya",
    "displayName": "Priya Nair",
    "roles": ["privacy-analyst"],
    "teamIds": ["privacy-ops"]
  }
}
```

### Errors

| Status | Body                                  | Reason                                                        |
| ------ | ------------------------------------- | ------------------------------------------------------------- |
| 400    | `{ "error": "invalid request body" }` | Body failed zod validation (missing/blank/over-length field). |
| 401    | `{ "error": "invalid credentials" }`  | Unknown username **or** wrong password.                       |

**No user enumeration.** The `401` response is identical whether the username is unknown or
the password is wrong. Login is also **timing-normalized**: it always performs exactly one
argon2 verify — against the real hash when the user exists, or a throwaway placeholder hash
when it does not — so a missing username cannot be distinguished from a wrong password by
response time.

### Side effects

Sets the encrypted `session` cookie on the response. No events published, no other writes.

---

## POST /auth/logout

**Auth:** none required (clearing an absent cookie is a no-op).

Clears the client's `session` cookie.

### Response `204`

No content.

### Side effects

Deletes the `session` cookie from the client.

> **Prototype limitation — no server-side revocation.** Sessions are stateless encrypted
> cookies; logout only clears the cookie held by that client. There is no server-side
> session store to invalidate, so a copy of the cookie captured before logout stays valid
> until it expires. Production's real identity system is expected to provide proper session
> revocation.

---

## GET /auth/me

**Auth:** required (valid `session` cookie). Guarded by `requireUser`.

Returns the currently authenticated user.

### Response `200`

The resolved [session user](#session-user-shape), same shape as `/auth/login`:

```json
{
  "user": {
    "id": "018f3a2b-...",
    "username": "priya",
    "displayName": "Priya Nair",
    "roles": ["privacy-analyst"],
    "teamIds": ["privacy-ops"]
  }
}
```

### Errors

| Status | Body                                     | Reason                                   |
| ------ | ---------------------------------------- | ---------------------------------------- |
| 401    | `{ "error": "authentication required" }` | No valid session cookie (not logged in). |

### Side effects

None (read-only).
