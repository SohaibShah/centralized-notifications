# Module catalog + action/card affordances — design

**Date:** 2026-07-20
**Branch:** `feat/module-catalog-and-affordances` (off `main`)
**Status:** approved (design converged in discussion; this formalizes it)

## Goal

A batch of four independent, small-to-medium changes that came out of a design
review. Each is independently testable and reviewable. Sorting (server-side) and
audience-based delivery are deliberately **out of scope** here — they are the next
two work cycles, in that order.

The four units:

1. **Known-module catalog** — stop auto-discovering modules; seed a fixed list and
   reject + log notifications from unknown module keys.
2. **Admin ModulesPanel cleanup** — remove the enabled/disabled priority dot and the
   module rename flow.
3. **Action `kind` discriminator** — the notification action model stops deciding UI
   behavior from the HTTP method; it uses an explicit `kind` (`link` | `dispatch`).
4. **Card read/unread affordance** — replace the left priority dot with a read/unread
   toggle icon (keeping open-and-seen), and move the priority indicator to a colored
   text label on the right.

## Global constraints (apply to every unit)

- TypeScript strict; `pnpm lint` + `pnpm typecheck` clean before any unit is "done".
- New/changed logic carries a Vitest test in the same unit (per `testing.md`).
- zod validation stays the intake boundary; SQL stays parameterized.
- No AI-attribution commit trailers.
- The two contract changes (unknown-module rejection at intake; `kind` on the action
  shape) require a `docs/api` update via the **docs-writer** subagent (`api-documentation.md`).
- Conventional Commits; one commit per unit (or per coherent sub-step).

---

## Unit 1 — Known-module catalog (backend)

### Today

- `modules` table (migration `005_admin.sql`) is populated by **auto-discovery**:
  `upsertModuleSeen(key)` (`backend/src/pipeline/modules.ts`) inserts a row (enabled,
  auto-labelled) the first time a key publishes, and bumps `last_seen_at` after.
- `ingest.ts` calls `isModuleEnabled` (policy) for the kill-switch, then, on accept,
  calls `upsertModuleSeen` best-effort.
- `policy.ts` caches only the set of **disabled** module keys.

### Target

Modules are a **fixed, seeded catalog**. An unknown module key is a bug in the calling
module, so intake **rejects + logs** it (never persists, never delivers).

**Migration** `backend/migrations/007_seed_modules.sql`:

```sql
-- The known module catalog. Modules are a fixed, known set for this internal tool;
-- they are no longer auto-discovered on first publish. A notification whose `module`
-- is not in this table is rejected at intake. Idempotent so re-running the migration
-- (or adding a module later) is safe.
INSERT INTO modules (key, label) VALUES
  ('dsr',               'DSR'),
  ('access-governance', 'Access Governance'),
  ('data-mapping',      'Data Mapping'),
  ('assessments',       'Assessments')
ON CONFLICT (key) DO NOTHING;
```

(Labels chosen to read well; `deriveLabel` would give "Access Governance" etc. anyway,
but the seed is explicit so labels are curated, not derived.)

**Policy** (`policy.ts`): add `knownModules: Set<string>` to `PolicyState`, loaded from
`SELECT key FROM modules`. Add a resolver used by ingest:

```ts
/** Known + enabled state for a module key, from the policy cache. */
export async function resolveModule(key: string): Promise<{ known: boolean; enabled: boolean }> {
  const state = await get();
  return {
    known: state.knownModules.has(key),
    enabled: !state.disabledModules.has(key),
  };
}
```

`isModuleEnabled` may stay for existing callers, or be expressed via `resolveModule`.
The load query for `knownModules` is one extra `SELECT key FROM modules` (the disabled
query already hits the same table; can be merged into one `SELECT key, enabled`).

**Ingest** (`ingest.ts`): after `validate` succeeds, resolve the module first:

```ts
const { known, enabled } = await resolveModule(result.data.module);
if (!known) {
  console.warn(`[intake] rejected notification from unknown module "${result.data.module}"`);
  return { status: "invalid" };
}
// ...persist with suppressed = !enabled; deliver only if enabled...
```

- Remove the `upsertModuleSeen` import + call and delete `upsertModuleSeen` from
  `modules.ts`. Keep `deriveLabel` only if still used (the seed hardcodes labels; if
  nothing else imports `deriveLabel`, remove it too).
- **Optional best-effort** `last_seen_at` bump for known modules (so the admin
  "recently active" sort stays meaningful): a `touchModule(key)` doing only
  `UPDATE modules SET last_seen_at = now() WHERE key = $1`, wrapped in the same
  try/catch the old discovery had. This is a nicety, not correctness — keep it.

**Maintenance reset** (`/admin/maintenance/modules/reset`): today it wipes discovered
modules. With a fixed catalog, "reset" must **re-enable all seeded modules** (set
`enabled = true` for every row), NOT delete rows. Update that handler + its test.

**Unknown status:** reuse the existing `IngestResult.status: "invalid"` (already mapped
to a 4xx at the HTTP intake route) — a distinct log line names the unknown module. No
new status value, to keep the `IngestResult` contract and the transport switch unchanged.

### Tests (Unit 1)

- `backend/test/` — ingest/policy: a notification with an **unknown module** returns
  `{ status: "invalid" }`, is **not persisted**, and logs. A **known** module still
  accepts (enabled → delivered; disabled → suppressed).
- Update `backend/test/modules.test.ts` (was testing `upsertModuleSeen`/`deriveLabel`)
  to the new reality; drop tests for removed functions.
- Maintenance reset test: reset **re-enables** disabled seeded modules, count unchanged.

### Notes

- The generator's **custom mode** lets a user type any `module` key; unknown keys now
  reject (acceptable for a dev/QA tool — it already offers known keys via the
  `fetchModuleKeys` datalist). No change required, but the reject is expected behavior.
- All presets already use seeded keys (`dsr`, `access-governance`, `data-mapping`,
  `assessments`), so the demo keeps working end-to-end.

---

## Unit 2 — Admin ModulesPanel cleanup (frontend + small backend)

### Remove

- The enabled/disabled **dot** (`ModulesPanel.vue`, the `size-1.5 rounded-full`
  `priorityDotClass[m.enabled ? 'high' : 'low']` span). The row's toggle switch already
  communicates enabled state; the dot is redundant.
- The **rename** flow entirely: `Pencil` import, `editingKey`/`draftLabel` refs,
  `startRename`/`cancelRename`/`commitRename`, and the template `<input>` + pencil
  button. The label renders as plain text.

### Contract

- `adminApi.patchModule` body type: `{ enabled?: boolean; label?: string }` →
  `{ enabled: boolean }`. Drop `label`.
- Backend admin PATCH `/admin/modules/:key`: drop `label` handling (only `enabled`
  toggles). The `label` column stays (seeded); it is simply no longer editable.

### Copy

- Header/description and empty state currently say "Sources that have published…" /
  "They'll appear here once a source publishes." Reframe to a fixed catalog, e.g.
  "The modules that can send you notifications. Disable one to stop it reaching anyone."
  The empty state effectively never triggers (catalog is always seeded), but keep a
  sensible message.

### Tests (Unit 2)

- `ModulesPanel.spec.ts`: remove rename + dot assertions; keep/adjust toggle test.
- `AdminView.spec.ts`, `frontend/e2e/admin.spec.ts`: drop any rename interaction.
- Backend admin route test: PATCH with `label` is ignored/rejected; `enabled` toggle
  still works.

---

## Unit 3 — Action `kind` discriminator (shared + frontend)

### Today

`InboxTab.onAction` branches on `action.method`: `GET` → `window.open` new tab; anything
else → `console.info("...will dispatch in Week 4")`. HTTP method is the wrong
discriminator for user intent.

### Target

`actionSchema` (`packages/shared/src/notification.ts`) gains an explicit intent field:

```ts
export const ACTION_KINDS = ["link", "dispatch"] as const;
// in actionSchema:
kind: z.enum(ACTION_KINDS).default("link"),
```

- Optional with `.default("link")` → backward compatible on the input side; every parsed
  action carries a concrete `kind`. Update the schema doc comment to explain that `kind`
  (not `method`) drives client behavior, and that `navigate` (in-app routing) is a future
  value to add when there's a real internal target.
- Export `ACTION_KINDS` and `type ActionKind`.

**Frontend** (`InboxTab.onAction`): branch on `action.kind`:

```ts
feed.markRead(notification.id);
if (action.kind === "link") {
  window.open(action.url, "_blank", "noopener,noreferrer");
} else {
  // "dispatch": server-side action-dispatch proxy is a later cycle.
  console.info(`[actions] "${action.label}" (dispatch) — coming soon`);
}
```

**Presets/samples** (`backend/src/sim/presets.ts`): add explicit `kind` to every action:

- `Review`, `Open DSR`, `View assessments` → `kind: "link"`.
- `Approve`, `Dismiss` → `kind: "dispatch"`.
  This is **required**: those two are `POST`; with `kind` defaulting to `link`, an
  un-annotated POST action would wrongly open in a tab.

### Tests (Unit 3)

- Shared schema test: parsing an action without `kind` yields `kind: "link"`; explicit
  `kind: "dispatch"` round-trips.
- `InboxTab.spec.ts`: rename the "GET action opens a new tab" test to a **`link`** action
  opening a tab (+ marks read); add a **`dispatch`** action test asserting **no**
  `window.open` and that it still marks read.
- `presets.test.ts`: sample/preset actions carry the expected `kind` values.

---

## Unit 4 — Card read/unread icon + priority text (frontend)

Interaction model = **option (b)**: the read/unread icon is a status indicator that is
_also_ a toggle; **open-and-seen stays** (clicking the card body still expands + marks
read). The icon is an explicit shortcut to flip read state without expanding.

### Left: priority dot → read/unread toggle icon

`NotificationCardRenderer.vue` — replace the `role="img"` priority dot (the
`mt-1.5 size-2 rounded-full priorityDotClass[...]` span) with a toggle **button**:

- Unread → a filled accent indicator (e.g. lucide `Circle` filled / `CircleDot` in
  `text-accent`); `aria-label="Mark as read"`; click → `emit("open", item)` (parent maps
  `@open` → `feed.markRead`). It marks read **without** toggling `expanded`.
- Read → a hollow/check indicator (e.g. `CircleCheck` / hollow `Circle` in `text-faint`);
  `aria-label="Mark as unread"`; click → `emit("unread", item)`.
- `@click.stop` so it never triggers the card-body `activate()` (no expand/re-open).
- Reuses the existing `open` / `unread` emits — no new store surface.

### Right: "Mark as unread" text / "click to open" hint → priority label

- Remove the right-meta `Mark as unread` text button and the `click to open` hover hint
  (both superseded by the left icon).
- In their place, render the **priority label in its semantic color**:
  `priorityLabel[item.priority]` styled by a new `priorityTextClass` map.

**`design/tokens.ts`** — add alongside `priorityDotClass`/`priorityLabel`:

```ts
export const priorityTextClass: Record<NotificationPriority, string> = {
  critical: "text-danger",
  high: "text-warning",
  normal: "text-muted",
  low: "text-faint",
};
```

(Warning is a light amber; verify the `high` label clears WCAG AA on ivory at the meta
text size during the browser review — nudge to a darker token if it dips, same as the
AI-label AA fix.)

### Body / open-and-seen (unchanged)

- Card-body `activate()` still expands (if `canExpand`) and emits `open` (marks read).
- The expand caret next to the timestamp stays.
- The unread left inset accent (`shadow-[inset_2px_0_0_var(--color-accent)]`) stays.

### Tests (Unit 4)

- Card spec: remove the priority-dot `role="img"` / `aria-label="… priority"` assertions.
- New: an **unread** card shows a "Mark as read" toggle; clicking it emits `open` and does
  **not** expand (no `aria-expanded` flip, no action bar reveal). A **read** card shows
  "Mark as unread"; clicking emits `unread`.
- New: the card renders the **priority label** with the expected `priorityTextClass`.
- Keep the existing open-and-seen body-click tests (they must still pass unchanged).
- Browser review (`frontend-design-reviewer` + `browser-tester`) for the visual/AA check.

---

## Sequencing & review

Order (smallest/safest first): **Unit 2 → Unit 1 → Unit 3 → Unit 4.**
(Admin cleanup is pure deletion; catalog is contract-ish; `kind` touches shared; card is
the most visual.) Each unit: implement + tests green + `lint`/`typecheck` clean + commit.

Reviews before the branch is done:

- `code-reviewer` after the backend units (1, 3-shared).
- `frontend-design-reviewer` + `browser-tester` after Unit 4 (and a glance at Unit 2).
- `security-reviewer` for Unit 1 (intake boundary change — a new rejection path on the
  contract other services call).
- docs-writer updates `docs/api` for the intake (unknown-module reject) + action `kind`.

## Out of scope (explicit)

- **Server-side sorting** (default by time, priority as an option) — next cycle.
- **Audience-based delivery** (per-user/role/team; retiring the global broadcast) — the
  cycle after sorting; needs its own brainstorm (recipients-vs-resolve, tenancy) and a
  mentor check on the contract.
- **The rest of the action model** (the server-side dispatch proxy that actually executes
  `dispatch` actions with module-supplied metadata) — after audience scope.
