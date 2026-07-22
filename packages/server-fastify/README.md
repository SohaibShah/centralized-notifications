# @notifications/server-fastify

A thin Fastify plugin that mounts the notification HTTP + SSE routes onto your server, wiring your
app's identity to `@notifications/core`. The plugin owns no login/session/users — you supply identity
through two adapters.

## Install

```
pnpm add @notifications/server-fastify @notifications/core fastify pg
```

## Wire it up

```ts
import Fastify from "fastify";
import pg from "pg";
import { createNotificationService, migrate } from "@notifications/core";
import { notificationFastifyPlugin } from "@notifications/server-fastify";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool);

const service = createNotificationService({
  pool,
  config: { modules: [{ id: "dsr", label: "DSR" }], adminRole: "admin" },
});
await service.ready();

// A notification id can be up to 200 chars; Fastify's default maxParamLength (100) would 414 a valid
// long id, so set it >= 256.
const app = Fastify({ maxParamLength: 256 });

await app.register(notificationFastifyPlugin, {
  service,
  // Resolve YOUR identity to a Principal. Return null for an unauthenticated request (=> 401).
  auth: async (req) => {
    const user = await myGetSessionUser(req); // however your app authenticates
    return user ? { userKey: user.id, roles: user.roles, teamKeys: user.teams } : null;
  },
  // Gate the internal publish endpoint (service-to-service). Return false => 401.
  intakeAuth: (req) => req.headers["x-internal-token"] === process.env.INTERNAL_INTAKE_TOKEN,
});
```

## Options

| Option       | Type                                       | Purpose                                            |
| ------------ | ------------------------------------------ | -------------------------------------------------- |
| `service`    | `NotificationService`                      | From `createNotificationService`.                  |
| `auth`       | `(req) => Principal \| null \| Promise<…>` | Resolve the request's identity. `null` → 401.      |
| `intakeAuth` | `(req) => boolean \| Promise<boolean>`     | Authorize `POST /internal/publish`. `false` → 401. |

Admin routes are gated on `principal.roles.includes(service.adminRole)` (403 otherwise).

## Mounted routes

| Method + path                    | Auth         | Purpose                                 |
| -------------------------------- | ------------ | --------------------------------------- |
| `GET /notifications`             | `auth`       | Audience-scoped keyset feed page.       |
| `GET /notifications/counts`      | `auth`       | Unread counts (whole visible dataset).  |
| `POST /notifications/:id/read`   | `auth`       | Mark read (out-of-audience id → 404).   |
| `DELETE /notifications/:id/read` | `auth`       | Mark unread.                            |
| `POST /notifications/read`       | `auth`       | Bulk mark read (≤ 500 ids).             |
| `GET /sse`                       | `auth`       | Live delivery (Server-Sent Events).     |
| `POST /internal/publish`         | `intakeAuth` | Producer intake (one item or an array). |
| `GET /admin/modules`             | admin role   | Module catalog ⨝ state ⨝ counts.        |
| `PATCH /admin/modules/:key`      | admin role   | Enable/disable a module.                |
| `GET`/`PATCH /admin/settings`    | admin role   | Feature flags + retention.              |
| `GET /settings/features`         | `auth`       | Feature flags (for the UI to read).     |

## Not the plugin's job

Rate-limiting, CORS, sessions, and login are **host concerns** — add them on your own server around
these routes. (The reference app in this repo, `backend/`, shows one complete wiring.)
