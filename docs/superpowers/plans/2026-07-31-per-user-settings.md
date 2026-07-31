# Per-User Settings Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `/settings` — per-user snooze/mute (per module + per category, server-enforced), grouping toggle, personal AI-summary opt-out, critical-toast control, and timezone editing.

**Architecture:** Notification-domain prefs live in `@notifications/core` keyed by `user_key` (identity-free, like `user_summaries`); the library enforces them via one read-time filter reused across feed/counts/summary/chat and an in-memory twin for SSE. Timezone stays host-owned (`users.timezone`, backend). The settings page is a host-owned `SettingsView` composing FormRenderer sections + a library `MuteRulesEditor`.

**Tech Stack:** Vue 3 + TS (Composition API), Fastify, PostgreSQL, zod (shared schemas), Vitest, Playwright.

## Global Constraints

- Snooze/mute enforced **server-side** in the delivery/read path, keyed per user — never a UI-only toggle. Non-snoozable (critical) notifications always pass.
- `@notifications/core` stays identity-free: no `FROM users`; per-user state keyed by `user_key text`. `boundary.test.ts` must stay green.
- Migrations go in **both** `packages/core/migrations/` and `backend/migrations/`; new shared tables added to `SHARED_TABLES` in `backend/test/schema-parity.test.ts`.
- All API input validated with zod; schemas shared via `packages/shared` where shapes match. Every pref/rule read+write scoped to the authed `user_key`.
- Forms are JSON-driven via the shared `FormRenderer` — no hand-rolled form. Parameterized SQL only. TS strict; `pnpm lint`/`typecheck` clean before "done". New business logic gets a Vitest test; the new user-facing flow gets a Playwright happy + failure case.
- Snooze `until` is client-computed ISO; server validates it is a future datetime. `toastMinPriority ∈ {off,critical,high}`.

---

## Unit A — Shared schemas + core preferences foundation

### Task 1: Shared preferences schemas

**Files:**

- Create: `packages/shared/src/preferences.ts`
- Modify: `packages/shared/src/index.ts` (export new module)
- Test: `packages/shared/src/preferences.spec.ts`

**Produces:** `TOAST_MIN_PRIORITIES` (`['off','critical','high']`), `MUTE_TARGET_KINDS` (`['module','category']`), `userPreferencesSchema` → `UserPreferences {groupingEnabled,summaryOptOut,toastMinPriority}`, `preferencesPatchSchema` (all optional), `muteRuleSchema` → `MuteRule {targetKind,target,mutedUntil: string|null}`, `putMuteBodySchema` (`{until: string|null}` where non-null must be `datetime({offset:true})`), `preferencesResponseSchema` → `{...UserPreferences, rules: MuteRule[]}`.

- [ ] **Step 1: Failing test** — parse valid prefs; reject `toastMinPriority:'urgent'`; `putMuteBodySchema` accepts `{until:null}` and a future ISO, rejects `{until:'nope'}`.
- [ ] **Step 2:** Run `pnpm --filter @notifications/shared test -- preferences` → FAIL (module missing).
- [ ] **Step 3:** Implement schemas with zod (mirror `notification.ts` style; `mutedUntil`/`until` = `z.string().datetime({offset:true}).nullable()`).
- [ ] **Step 4:** Run test → PASS. `pnpm --filter @notifications/shared build`.
- [ ] **Step 5:** Commit `feat(shared): per-user preferences + mute-rule schemas`.

### Task 2: Migrations + schema parity

**Files:**

- Create: `packages/core/migrations/009_user_preferences.sql`, `packages/core/migrations/010_user_mute_rules.sql`
- Create: `backend/migrations/018_user_preferences.sql`, `backend/migrations/019_user_mute_rules.sql` (identical bodies)
- Modify: `backend/test/schema-parity.test.ts` (add `"user_preferences"`, `"user_mute_rules"` to `SHARED_TABLES`)

```sql
-- user_preferences
CREATE TABLE user_preferences (
  user_key            text PRIMARY KEY,
  grouping_enabled    boolean NOT NULL DEFAULT true,
  summary_opt_out     boolean NOT NULL DEFAULT false,
  toast_min_priority  text    NOT NULL DEFAULT 'critical'
);
-- user_mute_rules
CREATE TABLE user_mute_rules (
  user_key     text NOT NULL,
  target_kind  text NOT NULL,
  target       text NOT NULL,
  muted_until  timestamptz,
  PRIMARY KEY (user_key, target_kind, target)
);
CREATE INDEX user_mute_rules_user_idx ON user_mute_rules (user_key);
```

- [ ] **Step 1:** Write the four SQL files + update `SHARED_TABLES`.
- [ ] **Step 2:** `pnpm --filter @notifications/core migrate` and `pnpm --filter @notifications/backend migrate` → apply clean.
- [ ] **Step 3:** `pnpm --filter @notifications/backend test -- schema-parity` → PASS.
- [ ] **Step 4:** Commit `feat(db): user_preferences + user_mute_rules tables`.

### Task 3: Core preferences store + types

**Files:**

- Create: `packages/core/src/preferences/store.ts`
- Modify: `packages/core/src/types.ts` (add `UserPreferences`, `MuteRule`, re-export shape), `packages/core/src/index.ts`
- Test: `packages/core/test/preferences-store.test.ts`

**Produces:** `createPreferencesStore(query): { getPreferences(userKey): Promise<UserPreferences>; updatePreferences(userKey, patch): Promise<UserPreferences>; listRules(userKey): Promise<MuteRule[]>; putRule(userKey, kind, target, until: string|null): Promise<void>; deleteRule(userKey, kind, target): Promise<boolean> }`. `getPreferences` returns column defaults when no row. `updatePreferences` upserts (COALESCE unset fields to existing/default). Types imported from `@notifications/shared`.

- [ ] **Step 1: Failing tests** — defaults when no row; `updatePreferences` upsert+partial; `putRule` upsert then `listRules` reflects; `deleteRule` returns true then false.
- [ ] **Step 2:** Run `pnpm --filter @notifications/core test -- preferences-store` → FAIL.
- [ ] **Step 3:** Implement store (mirror `ai/summary-store.ts` upsert style; `putRule` = `INSERT ... ON CONFLICT (user_key,target_kind,target) DO UPDATE SET muted_until=EXCLUDED.muted_until`; `mutedUntil` mapped to/from ISO like summary-store's `generated_at`).
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit `feat(core): per-user preferences store`.

### Task 4: Mute filter — SQL predicate + in-memory twin (pure)

**Files:**

- Create: `packages/core/src/preferences/mute.ts`
- Modify: `packages/core/src/index.ts` (export `isSuppressed`, `resolveActive`... only what host needs — `isSuppressed`, `MuteRule` already via shared)
- Test: `packages/core/src/preferences/mute.spec.ts`

**Produces:**

- `muteWhere(userKey: string, params: unknown[]): string` — pushes `userKey`, returns the `( n.snoozable = false OR NOT EXISTS (SELECT 1 FROM user_mute_rules r WHERE r.user_key = $K AND (r.muted_until IS NULL OR r.muted_until > now()) AND ((r.target_kind='module' AND r.target=n.module) OR (r.target_kind='category' AND r.target=n.category))) )` fragment (caller aliases notifications `n`). SQL twin of `isSuppressed`.
- `isSuppressed(rules: MuteRule[], n: {snoozable: boolean; module: string; category?: string|null}, now: Date): boolean` — in-memory twin for the SSE hub: false if `!n.snoozable`; else true if any active rule (`mutedUntil===null || new Date(mutedUntil) > now`) matches module or category.

- [ ] **Step 1: Failing tests** for `isSuppressed`: non-snoozable → false; muted module (null) → true; snoozed module future → true, past → false; category rule matches across modules; no-category notif unaffected by category rule; no rules → false.
- [ ] **Step 2:** Run `pnpm --filter @notifications/core test -- mute.spec` → FAIL.
- [ ] **Step 3:** Implement both functions.
- [ ] **Step 4:** Run test → PASS. Confirm `pnpm --filter @notifications/core test -- boundary` still green.
- [ ] **Step 5:** Commit `feat(core): mute/snooze read filter (SQL + in-memory twin)`.

---

## Unit B — Enforcement

### Task 5: Apply the filter to feed list + counts

**Files:**

- Modify: `packages/core/src/read/feed.ts:168` (append `AND ${muteWhere(principal.userKey, params)}` after the audience clause), `packages/core/src/read/counts.ts:24`
- Test: extend `packages/core/test/` feed + counts tests (or the server-fastify route tests) with a muted-module case.

- [ ] **Step 1: Failing test** — seed a snoozable notif from module `dsr`; with a mute rule on `dsr` it's absent from `list`/`counts`; without it, present; a non-snoozable `dsr` notif always present; an expired snooze → present.
- [ ] **Step 2:** Run the relevant core/route test → FAIL.
- [ ] **Step 3:** Import `muteWhere`, append to both queries.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): hide snoozed/muted notifications from feed + counts`.

### Task 6: Apply the filter to summary + chat grounding

**Files:**

- Modify: `packages/core/src/ai/summarize.ts:50` (`buildSummaryContext` WHERE), `packages/core/src/ai/retrieve.ts` (the three arms + `retrieveStats`)
- Test: extend `packages/core/test/summarize.test.ts` / `answer.test.ts` with a muted-module exclusion case.

- [ ] **Step 1: Failing test** — a muted module's unread notif is excluded from `buildSummaryContext.items` and from `retrieveStats.total`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Append `AND ${muteWhere(principal.userKey, <params>)}` to each grounding query (FTS/urgency/recency/stats + summary).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): exclude muted modules from AI summary + chat grounding`.

### Task 7: SSE suppression (in-memory twin)

**Files:**

- Modify: `packages/server-fastify/src/routes/sse.ts` — load the user's rules at connect via a new `service.listMuteRules(principal)` (Task 9 dependency; stub call here and finalize after Task 9), refresh them on each heartbeat tick, and in `deliver` skip when `isSuppressed(rules, notification, new Date())`.
- Test: `packages/server-fastify/test/sse.route.test.ts` (extend) — a snoozable notif from a muted module is not written to the stream; a non-snoozable one is.

**Interfaces consumed:** `service.listMuteRules(principal)` (Task 9), `isSuppressed` (Task 4).

- [ ] **Step 1: Failing test** — subscribe with a muted-module rule; publish snoozable `dsr` → no frame; publish critical `dsr` (non-snoozable) → frame delivered.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: `let rules = await service.listMuteRules(principal)`; in heartbeat `rules = await service.listMuteRules(principal)`; guard `deliver` with `isSuppressed`. Import `isSuppressed`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(sse): suppress snoozed/muted notifications from the live stream`.

### Task 8: Summary opt-out enforcement

**Files:**

- Modify: `packages/core/src/service.ts` (`getStoredSummary`/`refreshSummary` consult prefs → return an opted-out signal), `packages/server-fastify/src/routes/summary.ts` (GET returns `{optedOut:true}` state), `backend/src/summary/schedule-repo.ts` (LEFT JOIN `user_preferences`, carry `summaryOptOut`), `backend/src/summary/scheduler.ts` (skip opted-out users)
- Test: `backend/test/summary-scheduler.test.ts` (skip opted-out), `packages/server-fastify/test/summary.route.test.ts` (GET optedOut)

- [ ] **Step 1: Failing tests** — scheduler does not generate for an opted-out user; GET summary returns `optedOut:true` when the pref is set.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (schedule-repo row gains `summaryOptOut`; `runSummaryTick` filters it out; summary route + service surface the state).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: honor personal AI-summary opt-out (scheduler + summary endpoint)`.

---

## Unit C — API surface

### Task 9: Service methods + wire the store

**Files:**

- Modify: `packages/core/src/service.ts` — construct `createPreferencesStore(query)`; add `getPreferences`, `updatePreferences`, `listMuteRules`, `putMuteRule`, `deleteMuteRule` to `NotificationService` (all take `{principal, ...}`). Update the interface + `index.ts` exports.
- Test: `packages/core/test/service-preferences.test.ts` (round-trip through the service).

**Produces (on `NotificationService`):** `getPreferences({principal}): Promise<UserPreferences>`, `updatePreferences({principal, patch}): Promise<UserPreferences>`, `listMuteRules({principal}): Promise<MuteRule[]>`, `putMuteRule({principal, targetKind, target, until}): Promise<void>`, `deleteMuteRule({principal, targetKind, target}): Promise<boolean>`.

- [ ] **Step 1: Failing test** — service round-trips prefs + rules for a principal.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement delegation to the store (`args.principal.userKey`).
- [ ] **Step 4:** Run → PASS. (Task 7's `listMuteRules` call now resolves — re-run its test.)
- [ ] **Step 5:** Commit `feat(core): preferences + mute-rule service methods`.

### Task 10: server-fastify preferences + mutes routes

**Files:**

- Create: `packages/server-fastify/src/routes/preferences.ts` — `GET /notifications/preferences`, `PATCH /notifications/preferences`, `PUT /notifications/mutes/:kind/:target`, `DELETE /notifications/mutes/:kind/:target`. Register in `packages/server-fastify/src/index.ts`.
- Test: `packages/server-fastify/test/preferences.route.test.ts`

Validation: body via `preferencesPatchSchema` / `putMuteBodySchema`; `:kind` via `MUTE_TARGET_KINDS`; for `kind==='module'`, `:target` must be a known module id (from `service` module catalog / policy) else 400; `until` non-null must be future else 400; all `requirePrincipal`; scope every op to `req.principal.userKey`.

- [ ] **Step 1: Failing tests** — GET returns defaults+`[]`; PATCH updates a scalar; PUT mute then GET shows the rule; DELETE removes it; unknown `:kind` → 400; unknown module target → 400; past `until` → 400; 401 unauth.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (mirror `routes/admin.ts` zod + error mapping). Known-module check via existing module list source.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(api): per-user preferences + mute/snooze endpoints`.

### Task 11: Host `PATCH /me/timezone`

**Files:**

- Modify/Create: `backend/src/http/me/routes.ts` (or the existing self/me route file — locate first) — `PATCH /me/timezone`, body `{timezone}` validated against `Intl.supportedValuesOf('timeZone')`, writes `users.timezone` for `req.session` user. Register in `backend/src/server.ts`.
- Test: `backend/test/me-timezone.test.ts`

- [ ] **Step 1: Failing tests** — valid zone persists + is reflected; bad zone → 400; unauth → 401.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (parameterized `UPDATE users SET timezone=$1 WHERE id=$2`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(backend): self-service timezone endpoint`.

---

## Unit D — Frontend + verification

### Task 12: Vue preferences store

**Files:**

- Create: `packages/vue/src/state/preferences.ts` (mirror `state/settings.ts` factory), export from `packages/vue/src/index.ts` + register in the provider/context.
- Test: `packages/vue/src/state/preferences.spec.ts`

**Produces:** `createPreferencesState({transport})` → reactive `{ prefs, rules, loaded, load(), updatePref(patch), setMute(kind,target,until), clearMute(kind,target) }` with optimistic update + rollback on transport error.

- [ ] **Step 1: Failing tests** — `load()` populates; `updatePref` optimistic + rollback on reject; `setMute`/`clearMute` update `rules` and call the right endpoint.
- [ ] **Step 2:** Run `pnpm --filter @notifications/vue test -- preferences.spec` → FAIL.
- [ ] **Step 3:** Implement (fake transport in test like `settings.spec.ts`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(vue): preferences store`.

### Task 13: Snooze resolver + MuteRulesEditor

**Files:**

- Create: `packages/vue/src/preferences/snooze.ts` (`resolveSnoozeUntil(option, now: Date, timezone: string): string` for `'1h'|'4h'|'1w'|'tomorrow-morning'`), `packages/vue/src/components/preferences/MuteRulesEditor.vue`; export the component.
- Test: `packages/vue/src/preferences/snooze.spec.ts`, `packages/vue/src/components/preferences/MuteRulesEditor.spec.ts`

`resolveSnoozeUntil`: relative options = `now + N`; `tomorrow-morning` = 08:00 next day in `timezone` (compute via `Intl.DateTimeFormat` parts, mirror `computeDueSummaries`). Component: props `modules: {id,label}[]`, `categories: string[]`, reads `preferences` store; each row shows Active/Muted/"Snoozed · Nh left"; "Snooze for…" menu + Mute toggle; calls `setMute`/`clearMute`.

- [ ] **Step 1: Failing tests** — `resolveSnoozeUntil('4h',…)` = +4h ISO; `'tomorrow-morning'` with `Asia/Kolkata` resolves 08:00 IST next day. Component renders a row per module+category, fires `setMute('module','dsr',<iso>)` on snooze, `clearMute` on un-mute, shows "Muted"/"Snoozed · Nh left".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement resolver + component (design-system tokens; lucide icons; loading/empty states).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(vue): MuteRulesEditor + snooze resolver`.

### Task 14: Settings form + SettingsView (replace stub)

**Files:**

- Create: `frontend/src/features/settings/SettingsView.vue`, `packages/vue/src/forms/preferences.form.ts` (grouped: Profile→timezone select; Notifications→grouping switch, toastMinPriority select, summaryOptOut switch)
- Modify: `frontend/src/router/index.ts:25` (point `settings` at `SettingsView`), delete `frontend/src/features/settings/SettingsStub.vue`, wire toast pref into `packages/vue/src/state/toast.ts` consumer + summary opt-out state into the panel.
- Test: `packages/vue/src/forms/*` renderer coverage already exists; add `SettingsView` mount smoke where feasible; toast-pref unit test.

- [ ] **Step 1: Failing test** — the toast state respects `toastMinPriority` ('off' suppresses; 'high' allows high+critical); settings form schema has Profile + Notifications groups.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement form schema + `SettingsView` (FormRenderer sections + `MuteRulesEditor`; timezone saves via `PATCH /me/timezone`, others via the preferences store); apply toast pref.
- [ ] **Step 4:** Run → PASS. `pnpm lint && pnpm typecheck && pnpm build` clean.
- [ ] **Step 5:** Commit `feat(settings): per-user settings page`.

### Task 15: e2e + docs + reviews

**Files:**

- Create: `frontend/e2e/settings.spec.ts`
- Docs: `docs/api/notifications.md` (preferences + mutes), `docs/api/*` for `PATCH /me/timezone` (via `docs-writer`)

- [ ] **Step 1:** Playwright happy path — login → `/settings` → mute a module → publish a snoozable notif from it via module-sim → assert not in feed → un-mute → publish → appears. Failure case — invalid timezone save shows inline error.
- [ ] **Step 2:** Run `pnpm test:e2e -- settings` → PASS (write test first, expect fail, then confirm behavior).
- [ ] **Step 3:** `docs-writer` updates the API docs.
- [ ] **Step 4:** Whole-repo `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e` green.
- [ ] **Step 5:** Commit `test(settings): e2e + API docs`. Then run `code-reviewer`, `security-reviewer` (per-user authz), `frontend-design-reviewer` + `browser-tester`.

---

## Self-review notes

- **Spec coverage:** snooze/mute per module+category (T3–T7,T10), grouping toggle (T3,T14), summary opt-out (T3,T8,T14), critical-toast (T3,T14), timezone (T11,T14), read-time filter across feed/counts/summary/chat/SSE (T5–T7), MuteRulesEditor + FormRenderer page (T13–T14), tests + docs (T15). Category = free-form (validated by shape, T10).
- **Boundary:** timezone host-owned (T11 backend); core stays identity-free (T3–T9 keyed by `user_key`).
- **Out of scope:** quiet hours, grouping behavior, inline card snooze, per-user summary-time override, personal default sort.
