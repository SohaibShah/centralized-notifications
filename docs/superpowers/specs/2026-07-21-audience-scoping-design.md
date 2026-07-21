# Audience scoping — design

**Date:** 2026-07-21
**Branch:** `feat/audience-scoping` (off `main`)
**Status:** approved (design converged in discussion)

## Goal

A user should only **see, count, and receive** notifications addressed to their audience — not
every notification in the system. This closes the cross-tenant / PII exposure that gated the
earlier work (previously every authenticated user saw everything). Audience is matched against the
current user's identity (their teams, roles, and own user key) plus `global`.

Crucially, identity is resolved through an **injectable seam** rather than by reaching into the
internal identity tables, so that when the system is later turned into an importable library (with
the current dashboard becoming its reference consumer), the audience logic doesn't get rewritten —
the host just supplies the principal.

## Locked decisions

- **Build the injectable identity seam now** (backed by the current session + DB, swappable later).
- **`user`-scope `audience.id` = username, modeled as an opaque `userKey`.** Consistent with the
  existing `team_key` / `role_key` string keys; a host repoints `userKey` at extraction with no
  schema change.
- **`global` = every authenticated user. No admin bypass** — the feed is audience-scoped for
  everyone; admin power lives in the admin panel, not omniscient feed visibility.
- A user with no roles/teams still sees `global` + their own `user`-scoped notifications.

## Global constraints

- TS strict; `pnpm lint` + `pnpm typecheck` clean before any task is "done".
- New logic carries a Vitest test in the same task (`testing.md`).
- Parameterized SQL only. The read filter uses the principal's arrays as **bound params** — it must
  NOT join the internal identity tables (that coupling is what the seam exists to avoid).
- `docs/api/notifications.md` updated via **docs-writer** (the read contract now filters by audience;
  the Week-1 "everyone sees everything" caveat is removed).
- No AI-attribution commit trailers. Conventional Commits.
- No new migration required: `notifications(audience_scope, audience_id)` and its index already exist
  (migration 002, `notifications_audience_idx`).

## The seam (`backend/src/audience/`)

New module, the single boundary library-ification will repoint:

```ts
// principal.ts — WHO is asking (read side). Thin adapter over the session user today.
export interface Principal {
  userKey: string; // matches audience.id for scope="user" (= username now)
  roles: string[]; // role_keys — match audience.id for scope="role"
  teamKeys: string[]; // team_keys — match audience.id for scope="team"
}
export function resolvePrincipal(user: SessionUser): Principal {
  // SessionUser.teamIds already holds team_keys; roles holds role_keys.
  return { userKey: user.username, roles: user.roles, teamKeys: user.teamIds };
}
```

```ts
// recipients.ts — WHO a notification reaches (live-delivery side). Returns the ids the hub keys
// subscribers by (Subscriber.userId = internal user id today), or "all" for global.
export async function resolveRecipients(audience: Audience): Promise<string[] | "all"> {
  switch (audience.scope) {
    case "global":
      return "all";
    case "user":
      return ids(`SELECT id FROM users WHERE username = $1`, audience.id);
    case "team":
      return ids(`SELECT user_id FROM user_teams WHERE team_key = $1`, audience.id);
    case "role":
      return ids(`SELECT user_id FROM user_roles WHERE role_key = $1`, audience.id);
  }
}
```

Both are backed by the internal session/DB **today**; at extraction the host provides identity and
recipient resolution, and only this module changes.

## Read path — feed list + counts (`backend/src/http/notifications/routes.ts`)

Both `GET /notifications` and `GET /notifications/counts` gain the **same** audience predicate,
matched against `resolvePrincipal(req.user)`. A shared helper keeps them identical (so what you
count always equals what you can see):

```ts
// Appends audience params to `params`, returns the SQL fragment. No identity-table joins.
function audiencePredicate(p: Principal, params: unknown[]): string {
  params.push(p.teamKeys, p.roles, p.userKey);
  const t = params.length - 2,
    r = params.length - 1,
    u = params.length;
  return `(n.audience_scope = 'global'
        OR (n.audience_scope = 'team' AND n.audience_id = ANY($${t}::text[]))
        OR (n.audience_scope = 'role' AND n.audience_id = ANY($${r}::text[]))
        OR (n.audience_scope = 'user' AND n.audience_id = $${u}::text))`;
}
```

- Feed list: `AND` this into the existing `WHERE n.suppressed = false ...` before the keyset
  comparison. The existing `notifications_audience_idx` supports it.
- Counts: `AND` the same fragment into the counts aggregate's `WHERE`.
- Empty `teamKeys`/`roles` arrays are fine — `= ANY('{}')` simply matches nothing, leaving `global`
  - `user`.

## Live delivery (`backend/src/pipeline/ingest.ts`)

Replace the Week-1 broadcast with recipient-resolved delivery:

```ts
if (enabled) {
  const recipients = await resolveRecipients(result.data.audience);
  if (recipients === "all") deliveryHub.broadcast(result.data);
  else deliveryHub.publishToRecipients(recipients, result.data);
}
```

`publishToRecipients` already exists (delivers only to subscribers whose `userId` is in the set).
A `team`/`role` notification with zero current members simply reaches no live socket (it's still
persisted and shows on next load for anyone who later matches).

## Frontend

No change. Filtering is entirely server-side; the feed, counts, and SSE stream simply carry less.
The store's live-arrival / counts logic is unaffected (it only ever receives what's addressed to the
user now).

## Tests

- **Seam unit tests** (`backend/test/audience.test.ts`): `resolvePrincipal` maps username→userKey,
  roles, teamKeys; `resolveRecipients` returns `"all"` for global, the right user ids for
  team/role/user, and `[]` for an unknown key.
- **Read filter** (`backend/test/notifications.test.ts`): seed notifications across all four scopes
  plus users with different memberships (the auth seed already has admin / casey[privacy-analyst,
  privacy-ops] / sam[security-reviewer,security] / jordan[privacy-ops]). Assert each user's
  `GET /notifications` returns exactly global + their team/role/user items and excludes others; a
  `user`-scoped item reaches only that username.
- **Counts parity**: `GET /notifications/counts` for a user counts exactly their visible unread set
  (same predicate) — assert via deltas, mirroring the existing counts tests.
- **Live delivery** (`backend/test/sse.test.ts` / pipeline): a `team`-scoped publish reaches a
  subscriber in that team and not one outside it; a `global` publish reaches all.

## Out of scope

- **Swapping the identity source** — identity still comes from our session + DB (via the seam). The
  actual host handoff is the later library-ification step.
- **Per-tenant data partitioning** — all notifications remain in shared tables; audience controls
  visibility only, not physical isolation.
- Any audience _editing_ UI, or an admin "view all" audit surface (would be a separate, deliberate
  feature, per the no-bypass decision).

## Forward note (library-ification)

The `audience/` seam is the future library's identity integration point, and the current dashboard
will become the reference consumer that wires it exactly as a third-party host would. Keeping the
read filter free of identity-table joins now is what makes that dogfooding real rather than a false
pass. Confirm the seam's public shape with the mentor before the library API is locked.

## Self-review

- **Placeholders:** none.
- **Consistency:** the same `audiencePredicate` feeds list + counts, so visible set == counted set.
  `resolvePrincipal` (read) keys on username/role_key/team_key; `resolveRecipients` (delivery) maps
  to the hub's `userId` — different match points, each correct for its side.
- **Scope:** one cohesive change (seam + read filter + counts + delivery); no migration; no FE change.
- **Ambiguity resolved:** username-as-userKey; no admin bypass; empty membership → global + own;
  zero-member team/role publish is a no-op live but still persisted.
