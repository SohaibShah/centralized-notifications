# Per-User Settings Page — Design

**Date:** 2026-07-31
**Branch:** `feat/per-user-settings` (off `main`)
**Status:** Approved for planning

## Goal

Build the per-user settings page at `/settings` (today a "coming soon" stub). It gives each
user control over how notifications reach them — snoozing/muting per module and per category,
a grouping toggle, a personal AI-summary opt-out, critical-toast control, and timezone editing.
Snooze/mute is enforced server-side, not just as a cosmetic UI toggle.

## Context (current state)

- Every notification already carries `module` (string id), `category` (optional string),
  `priority`, and a **`snoozable: boolean`** flag ([packages/shared/src/notification.ts:150-158](../../../packages/shared/src/notification.ts#L150-L158)).
- Modules are a known registry (`dsr`, `access-governance`, `data-mapping`, `assessments`, …)
  with id + label ([backend/src/reference/catalog.ts:8](../../../backend/src/reference/catalog.ts#L8)).
- Per-user state today: `notification_reads` and `user_summaries`, both keyed by `user_key`
  (identity-free, core-owned). `users.timezone` is host-owned (backend), added for scheduled
  summaries. **No per-user settings exist yet** — only global settings.
- `/settings` route exists but renders `SettingsStub.vue` ([frontend/src/router/index.ts:23](../../../frontend/src/router/index.ts#L23)).
- `groupingEnabled` is a global stored-only flag; grouping-by-relatedness is **not implemented**
  (it is the feature immediately after this one).

## Library boundary — where each setting lives

| Setting                                      | Owner                                | Enforced?                                      |
| -------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| Snooze/mute rules (per module, per category) | `@notifications/core` (`user_key`)   | **yes — server-side read filter**              |
| Grouping on/off                              | core (`user_key`)                    | stored only (future grouping feature reads it) |
| Personal AI-summary opt-out                  | core (`user_key`)                    | yes — scheduler + summary endpoint             |
| Critical-toast control                       | core (`user_key`)                    | stored; client reads it to decide toasts       |
| Timezone                                     | **host** (`users.timezone`, backend) | injected into the library as today             |

Rationale: notification-domain prefs live in core keyed by `user_key`, matching the existing
`notification_reads`/`user_summaries` pattern; the library enforces them and the host injects
identity. **Timezone stays host-owned** — it is a user-profile attribute the scheduler already
reads, and keeping it there avoids churning the just-shipped scheduled-summaries code. The
settings page therefore has a small host-owned **Profile** section (timezone) and a
library-owned **Notification preferences** section, which honestly reflects the host-vs-library
split.

**Mentor gate:** timezone placement and the new per-user endpoints are part of the library's
public API contract (the "API contract other services will call" that CLAUDE.md says to
sanity-check with a mentor before locking in). Confirm host-owned timezone + core-owned prefs
is the intended boundary before merge — it is awkward to move later.

## Data model (two new core tables)

Both go in **both** migration dirs (`packages/core/migrations/` + `backend/migrations/`) and
are added to the schema-parity `SHARED_TABLES` list. Both are keyed by `user_key text`
(identity-free), like `user_summaries`.

```sql
-- scalar per-user prefs, latest-only upsert
user_preferences (
  user_key            text PRIMARY KEY,
  grouping_enabled    boolean NOT NULL DEFAULT true,
  summary_opt_out     boolean NOT NULL DEFAULT false,
  toast_min_priority  text    NOT NULL DEFAULT 'critical'   -- 'off' | 'critical' | 'high'
)

-- one row per active snooze/mute; NULL = mute (indefinite), future ts = snooze-until
user_mute_rules (
  user_key     text,
  target_kind  text,          -- 'module' | 'category'
  target       text,          -- module id or category name
  muted_until  timestamptz,   -- NULL = muted indefinitely; future ts = snoozed
  PRIMARY KEY (user_key, target_kind, target)
)
-- index: (user_key) for the read-filter NOT EXISTS lookup
```

A user with no `user_preferences` row uses the column defaults (grouping on, not opted out,
critical-only toast).

## Server-side enforcement — one pure core filter

A snoozable notification is hidden from a user when an **active** rule matches its module or
category. "Active" = `muted_until IS NULL` (mute) OR `muted_until > now()` (snooze not expired).

```sql
AND ( n.snoozable = false
   OR NOT EXISTS (
        SELECT 1 FROM user_mute_rules r
        WHERE r.user_key = $user
          AND (r.muted_until IS NULL OR r.muted_until > now())
          AND ( (r.target_kind = 'module'   AND r.target = n.module)
             OR (r.target_kind = 'category' AND r.target = n.category) ) ) )
```

Applied everywhere the user's visible set is computed:

- **Feed list** (`GET /notifications`) — the SQL condition above.
- **SSE fanout** — before delivering a newly-published notification to a connected recipient,
  skip it if it is snoozable and an active rule for that recipient matches its module/category.
- **Unread counts** — same filter.
- **AI summary / chat grounding** — the "based on" set uses the same filter, so a muted module
  does not feed the user's summary or the chatbot's answers.

Non-snoozable notifications (e.g. critical) always pass. Snoozes reappear automatically once
`muted_until` passes — the filter simply stops matching; no sweep/expiry job is needed.

The rule-matching + "active at time T" + "tomorrow-morning in the user's timezone" logic is a
pure, unit-testable core function (in the shape of `computeDueSummaries`), separate from the SQL.

## API

### Library (`packages/server-fastify`, all `requireUser`, zod-validated, scoped to the authed `user_key`)

- `GET /notifications/preferences`
  → `{ groupingEnabled, summaryOptOut, toastMinPriority, rules: [{ targetKind, target, mutedUntil }] }`
- `PATCH /notifications/preferences` — partial update of the scalars
  (`groupingEnabled?`, `summaryOptOut?`, `toastMinPriority?`); `toastMinPriority ∈ {off,critical,high}`.
- `PUT /notifications/mutes/:kind/:target` — body `{ until: string | null }`. `null` = mute;
  ISO datetime = snooze (must be in the future). Upsert.
- `DELETE /notifications/mutes/:kind/:target` — remove the rule (un-mute / un-snooze).

`:kind` is validated to `module|category`. For `module`, `:target` is validated against the
known module ids (the registry), so a bogus module cannot be written. Categories are **free-form
strings** on notifications (no registry), so a `category` target is validated by shape only
(non-empty, bounded length). Every read and write is scoped to the session user's `user_key` —
a user can never read or write another user's rules.

### Host (`backend/`, host-owned identity)

- `PATCH /me/timezone` — body `{ timezone: string }`, validated against
  `Intl.supportedValuesOf('timeZone')`; writes `users.timezone` for the session user.

### Enforcement wiring

- The scheduler skips users with `summary_opt_out = true`. The summary endpoint returns an
  `optedOut` state so the panel shows "summary off — turn on in settings" instead of the
  reload button.
- Feed / SSE / counts / summary all call the same core filter described above.

## Frontend

`/settings` replaces `SettingsStub.vue` with a host-owned `SettingsView.vue` that composes
library-provided pieces. The scalar sections are **JSON-driven via the shared `FormRenderer`**
(using its `group` section-heading support), never hand-placed inputs:

- **Profile** — `timezone` (`select`, IANA zones). Saves via `PATCH /me/timezone`.
- **Notifications** — `groupingEnabled` (switch, hint "coming soon"),
  `toastMinPriority` (select: Off / Critical only / Critical + High),
  `summaryOptOut` (switch).
- **Snooze & mute** — a dedicated **`MuteRulesEditor`** component (library, `packages/vue`),
  not a plain form field: lists the module catalog + the categories currently present in the
  feed (distinct `category` values), each row showing
  Active / Muted / "Snoozed · Nh left", with a "Snooze for…" menu
  (1 hour · 4 hours · Until tomorrow morning · 1 week) and a Mute toggle. It calls the
  `PUT/DELETE /notifications/mutes` endpoints. "Until tomorrow morning" resolves to 8am in the
  user's saved timezone.

State lives in a new `packages/vue/src/state/preferences.ts` store (load once; optimistic
updates with rollback on error), mirroring `settings.ts`/`summary.ts`. The library exports
`MuteRulesEditor` and the preferences store; the host `SettingsView.vue` adds the Profile
section it owns.

## Testing

**core (unit, identity-free):** rule-matching function — muted module hidden; snoozed module
hidden while active and visible after expiry; non-snoozable always visible; category rule
matches across modules; a notif with no `category` is unaffected by category rules;
`+05:30`/`+05:45` timezones handled for "tomorrow morning". Preferences store: `user_preferences`
defaults + upsert, `user_mute_rules` upsert/delete. Boundary test stays green (no `FROM users`).

**server-fastify:** GET/PATCH preferences round-trip; `PUT/DELETE /mutes` including rejecting an
unknown `:kind`/`:target`, a past/invalid `until`, and 401 unauth; feed + counts hide a
snoozed-module notif and reveal it after expiry; summary grounding excludes a muted module.

**backend:** `PATCH /me/timezone` — good zone, bad zone → 400, unauth → 401; scheduler skips an
opted-out user.

**vue (unit):** `preferences` store optimistic-update + rollback; `MuteRulesEditor` renders
module/category rows, fires the right endpoint per action, shows "Snoozed · Nh left" / "Muted" /
"Active"; the `FormRenderer` settings sections render.

**Frontend e2e (Playwright — happy + one failure):** log in → `/settings` → mute a module →
publish a snoozable notif from that module via module-sim → assert it does not appear in the feed
→ un-mute → publish again → it appears. Failure case: an invalid timezone save surfaces an inline
error.

**Reviews:** `code-reviewer` after build; **`security-reviewer`** (per-user authorization — every
rule/pref read-write scoped to the authed `user_key`; new PII-adjacent surface);
`frontend-design-reviewer` + `browser-tester` for the settings UI; `docs-writer` updates
`docs/api/notifications.md` (preferences + mutes) and adds the `PATCH /me/timezone` doc.

## Out of scope (deliberate)

- **Quiet hours** — a per-user timezone-aware suppression window. Deferred to future work.
- **Grouping behavior** — this ships only the per-user toggle (stored); the grouping feature
  that consumes it is the next project.
- **Inline snooze from a notification card** — snooze/mute is driven from the settings page in
  v1; card-level snooze is a future UX addition.
- **Per-user summary-time override** and **personal default feed sort** — considered, deferred.
