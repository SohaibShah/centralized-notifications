# Design: Notification panel density redesign + critical toast

Date: 2026-07-15
Status: Approved (design); implementation plan to follow
Scope: Frontend redesign of the (already-built, not-yet-merged) bell popover for density,
plus a new critical-only toast. One small backend addition (bulk mark-read) — see Backend.
Builds on `2026-07-14-notifications-dashboard-popover-design.md`.

## Context

The bell popover shipped (Tasks 1–4 on `chore/scaffold-monorepo`), but in use only ~2
notifications fit above the fold: cards are tall and the chrome above the feed (header +
tabs + AI-summary card + search row + chip row) eats most of the 70vh popover. We
redesigned the panel interior for density (target: ~5 unread visible at once) without
clutter, and designed a critical-notification toast the user asked for. Explored visually
with the brainstorming companion; the design system ("Editorial Command, ivory") is
unchanged and was applied rigorously (priority = dot, flat + hairline, restrained motion).

## Goals

- Fit ~5 unread notifications above the fold in the popover.
- Keep the panel uncluttered — condense chrome, don't just shrink text.
- Surface critical notifications app-wide via a bottom-right toast, without opening the bell.
- Reuse the existing feed store / SSE / card renderer; stay within the design system.

## Non-goals

- Real AI (summary + chat stay stubs). Real preferences/settings. The separate admin app.
- Changing the bell/popover _surface_ (still Option A). Dark mode.
- Reopening the audience/cross-tenant model (unchanged; still gated on mentor sign-off).

## Locked decisions

### Panel interior

1. **Toolbar (one row)** replaces the separate header + tab bands: `Inbox` / `Ask AI ✦`
   tabs on the left; search + filter icon-buttons (filter keeps its active-count badge) on
   the right; a close (✕). **The "Live" connection indicator is removed** (a dev signal, not
   a production one).
2. **AI summary band** — one slim line, expandable via a **chevron icon** (rotates on open)
   to reveal the fuller digest. Keeps the "Sample" marker (still a stub).
3. **Quick-chips band** — `All` / `Unread` / `Critical` / `High`, always visible; deeper
   filters remain behind the toolbar filter icon.
4. **Cards (the "V1" pattern)** — compact by default: priority dot, title, one-line
   (truncated) description, module meta, time, and a **right-side chevron**. Clicking the
   chevron **expands the card**, revealing the notification's `actions` as a row of buttons
   **each with its lucide icon** along the bottom. Cards with no actions have no chevron.
5. **Read behavior** — the chevron **expands** the card; **clicking the card body** _and_
   **expanding a card** both **mark it read**. (Chevron = expand _and_ mark read; body click
   = mark read.)
6. **Collapsed read list** — the "Earlier" (read) group is collapsed by default behind a
   **subtle centered "Show N earlier" link** (option B); clicking expands the read list
   (compact single-line rows), clicking again collapses. Re-collapses each time the panel
   is opened (does not persist expanded state).
7. **Mark all as read** — a **"Mark all read" text link on the right of the "Needs action"
   group header**. Marks every **unread notification in the current filter scope** as read
   (filtered to Critical → only unread criticals; unfiltered → all unread).
8. **Panel height** — raised from `max-h-[70vh]` to **`max-h-[80vh]`** so ~5 unread rows
   clear the fold. (The scroll fix from commit `849f95d` — flex `min-h-0` chain — stays.)

### Critical toast

9. **Trigger** — fires **only for `critical`** notifications arriving over SSE while the
   user is anywhere in the dashboard. Suppressed if the bell popover is already open (the
   user is already looking). App-level (renders from `DashboardLayout`, not the popover).
10. **Look** — Editorial Ivory, mirroring the feed-card language: **danger dot** + mono
    "Critical" eyebrow (no alert triangle, no colored left-bar), Hanken title, one-line
    description, mono `module · time` meta, `View` (secondary button) + `Dismiss` (ghost),
    on a flat hairline `surface` with **restrained** warm overlay elevation (not a heavy
    colored shadow). A **quiet 2px neutral hairline** recedes as the auto-dismiss timer runs.
11. **Behavior** — anchored **bottom-right**; **auto-dismiss ~6s**, **pauses on hover and on
    keyboard focus**; **click the toast body → opens the bell popover** (does _not_ mark
    read); **✕ / Dismiss → hides the toast only** (the notification stays unread in the
    panel). **Stacking:** multiple criticals stack newest-at-bottom (nearest the cursor),
    **cap ~3**, older fold into a hairline **"+N earlier critical"** chip.
12. **Motion/a11y** — rise+fade in (`transform`/`opacity`, ~240ms, ease-out
    `cubic-bezier(0.16,1,0.3,1)`); **fade-only under `prefers-reduced-motion`**. The toast
    region is `role="alert"` / `aria-live="assertive"`; `View`/`Dismiss`/✕ are real
    keyboard-focusable buttons.

## Architecture

### Frontend — modify existing panel components

- `features/notifications/NotificationPopover.vue` — collapse header+tabs into one toolbar;
  drop the connection indicator; keep tabs + add search/filter icon-buttons + close.
- `features/notifications/panel/InboxTab.vue` — AI summary becomes a chevron-expandable
  band; chips band stays; wire the "Mark all read" link on the Needs-action header; render
  the collapsed "Show N earlier" read group.
- `features/notifications/renderers/NotificationCardRenderer.vue` — becomes the **V1
  expandable card**: compact row + right chevron; expanding reveals the icon+label action
  bar; card-body click and expand both emit read.
- `features/notifications/components/FeedList.vue` — split groups so "Needs action" renders
  rich and "Earlier" renders inside the collapsible "Show N earlier" control; compact read
  rows.
- `stores/feed.ts` — add: `markAllReadInScope()` (marks the currently-_visible_ unread —
  i.e. `visibleItems` filtered to unread — read); a `criticalArrivals` signal/callback for
  the toast (see below). The `groups`/`unreadCount`/filter logic is reused.
- `NotificationBell.vue` — unaffected (badge + open/close unchanged).

### Frontend — new toast pieces

- `stores/toast.ts` (or `composables/useCriticalToasts.ts`) — a small queue of active
  critical toasts (id, title, description, module, createdAt), with `push`, `dismiss`,
  per-toast auto-dismiss timers (pausable), and the stack cap + overflow count.
- `features/notifications/CriticalToastViewport.vue` — the bottom-right stack; renders
  `CriticalToast` items + the "+N earlier critical" chip.
- `features/notifications/CriticalToast.vue` — one toast (dot/eyebrow/title/desc/meta,
  View/Dismiss/✕, countdown hairline, a11y, motion).
- Mounted once in `DashboardLayout.vue` so it's app-wide.

### Wiring the toast to SSE

The feed store already receives coalesced SSE batches in `onLiveBatch(batch)`. Extend that
path (or a shared subscription) so any `priority === "critical"` arrival is pushed to the
toast store — **unless** the popover is open. `View` opens the popover (shared open-state
lifted to a small UI store or provided from `DashboardLayout`/`NotificationBell`).

## Behavior details

- **Mark-all scope** = `visibleItems.filter(n => !n.read)` at click time (respects active
  chips + search). Optimistic: flip locally, persist (see Backend), revert on failure.
- **Expand + read**: expanding a card calls the existing `markRead(id)` (idempotent no-op if
  already read) in addition to toggling local expand state.
- **Read-collapse**: "Earlier" group hidden behind the link; count = read items in scope.
- **Toast dedupe**: the same notification id never toasts twice (guard in the toast store).

## Backend impact

Mark-all-read needs to persist N reads. Two options:

- **(Recommended) Bulk endpoint** `POST /notifications/read` with `{ ids: string[] }`
  (`requireUser`, zod-validated, parameterized `INSERT ... ON CONFLICT DO NOTHING` over the
  ids, per-user). One request, atomic-ish, testable. **This is a new API surface** → needs
  `security-reviewer` + a `docs/api/notifications.md` update (api-documentation rule).
- (Fallback) Client-side loop over the existing `POST /notifications/:id/read`. No backend
  change, but N requests per click.

Decision: **bulk endpoint**, because mark-all is a first-class action and the loop is wasteful;
the endpoint is small and reuses the existing read-table pattern. Flag to the mentor with the
audience question since it touches the API contract.

## Testing

- **Unit (Vitest + @vue/test-utils):** card expand toggles + reveals actions with icons;
  expanding marks read; card-body click marks read; chevron does not double-fire read;
  "Show N earlier" expand/collapse; AI-summary chevron expand; `markAllReadInScope` marks
  only visible unread (respects a priority filter) and leaves out-of-scope items unread;
  toast store — critical push enqueues, non-critical does not, dedupe, auto-dismiss timer
  (fake timers), pause on hover/focus, stack cap → overflow count, suppressed when popover
  open.
- **Backend (if bulk endpoint):** `notifications.test.ts` — bulk read marks the given ids,
  ignores unknown ids, is idempotent, 401 unauth, zod-rejects a bad body.
- **e2e (Playwright):** update `feed.spec.ts` for the new card interaction (expand → action
  visible; body click marks read). Add a critical-toast path: publish a `critical` over
  `/internal/publish` with the popover closed → toast appears bottom-right → `View` opens
  the popover. Keep the bad-password failure case.
- Browser-verify (`browser-tester`) density + toast motion/stacking; `frontend-design-reviewer`
  for design-system compliance; not "done" on `tsc` alone.

## Review gates

- `frontend-design-reviewer` (density + toast against the system), `browser-tester`
  (renders/scrolls/animates, a11y focus/dismiss), `code-reviewer` after the change.
- `security-reviewer` **if** the bulk mark-read endpoint is added (new authed write).
- The cross-tenant visibility gate + mentor heads-up (bell-popover pivot, now + this
  density/toast pass + the new bulk endpoint) still precede the Week-1 PR.

## Risks / open questions

- **Percentage-height regressions:** the density work touches the same flex chain that was
  just fixed (849f95d) — keep the `min-h-0`/`flex-1` pattern; re-verify scroll after.
- **Toast ↔ popover coupling:** `View` opening the popover needs the popover open-state
  lifted out of `NotificationBell` (small refactor) or an event bus; keep it minimal.
- **Mark-all optimism vs bulk failure:** if the bulk POST fails, revert all optimistically-
  flipped rows.
- **Countdown treatment:** shipping with the quiet hairline countdown (option A look); trivial
  to drop to "no countdown" (B) if it reads busy in practice.
