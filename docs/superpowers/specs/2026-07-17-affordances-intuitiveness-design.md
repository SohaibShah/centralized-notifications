# Design: Affordances & intuitiveness pass

Date: 2026-07-17
Status: Approved (design); implementation plan to follow
Branch: `chore/qol-improvements` (another commit group on the existing QoL branch — frontend only)

## Context

A UX pass focused on making interactions discoverable. Two roots:

1. **Nothing looks clickable.** This app is on **Tailwind v4**, whose Preflight sets `<button>` to
   `cursor: default`. The `Button`/`Chip` primitives override it, but ~29 raw `<button>` elements
   (tabs, segment switchers, admin nav, "Mark all read", "Show N earlier", the card's own controls)
   fall back to the arrow cursor with no hover feedback.
2. **Clicking a notification card marks it read — but that's invisible and semantically backwards.**
   Users expect clicking a notification to _open/read_ it, not dismiss it. Today the card click marks
   read (relocating it to the collapsed "Earlier" section) while the chevron expands; neither is
   announced, and the read/unread model is only signalled by a 2px dot + bold title.

All frontend, no new endpoints. Three changes, approved to ship together.

## Goals

- Every interactable shows a pointer cursor + a hover state, from one source of truth.
- The notification card follows an **open-and-seen** model: click = open (expand) **and** mark read,
  with the card staying in place so it can actually be read (**sticky read**), and a clear unread
  affordance.
- The read/unread model is legible: a "N unread" header and a "Mark all read" control that reads as
  an action.

## Non-goals

- No backend/API changes; no change to what "read" means server-side.
- No dark-mode work; no new design tokens beyond what these need.
- No redesign of the toast, login, or filter menu beyond the shared cursor/hover rule.

## Locked decisions

1. **Cursor/hover: one base-layer rule** (option A), not per-element classes.
2. **Card: open-and-seen (Model 1) with sticky read** — clicking opens + marks read, and the card
   **stays in "Needs action"** (now styled read, with "Mark as unread") until the panel is reopened
   or the feed reloads, then settles into "Earlier".
3. **Unread affordance: dot + a restrained left-edge accent** (mock A + a touch of B), plus a subtle
   hover "click to open" hint on unread, collapsed cards.
4. **Header + Mark-all**: the "Needs action" count reads "N unread"; "Mark all read" gets a light
   button frame + check icon.
5. **"Mark all read" is NOT sticky** — it clears the unread pile to Earlier immediately (that is its
   intent), unlike a single open-and-seen click.

## Design

### 1 — Pointer cursor + hover (base rule)

- **`frontend/src/styles/main.css`** `@layer base`, add:
  ```css
  button:not(:disabled),
  [role="button"],
  [role="tab"],
  label[for],
  summary,
  a[href] {
    cursor: pointer;
  }
  :disabled {
    cursor: not-allowed;
  }
  ```
- **`components/ui/Button.vue`** and **`components/ui/Chip.vue`**: remove the now-redundant
  `hover:cursor-pointer` fragment (the base rule covers them).
- Hover states: the segment switchers / admin nav already carry `hover:bg-sunken hover:text-text` on
  inactive items and the preset/maintenance controls use `Button` — so no per-element hover work is
  needed beyond the cursor rule. The one exception is "Mark all read" (see §3).

### 2 — Card: open-and-seen + sticky read + unread affordance

**`frontend/src/features/notifications/renderers/NotificationCardRenderer.vue`:**

- Replace the separate `open()` and `toggleExpand()` with one `activate()`:
  ```ts
  function activate() {
    if (canExpand.value) expanded.value = !expanded.value;
    emit("open", item.value); // parent → markRead (no-op if already read)
  }
  ```
  The outer body `<div>`, the title `<button>`, and the chevron `<button>` all call `activate`
  (`@click.stop` on the inner controls so they don't double-fire). Actions and "Mark as unread" keep
  their own `@click.stop` handlers and do NOT activate.
- **Unread affordance** (no layout shift): on the `<article>`, when `!item.read`, add an inset
  left-edge accent — `shadow-[inset_2px_0_0_var(--color-accent)]`. Keep the existing filled-vs-hollow
  priority dot and bold-vs-muted title. Once read (sticky, in place), the accent/bold drop so the row
  visibly reads as "read" while staying positioned.
- **Hover hint**: when `!item.read && !expanded`, a small `group-hover`-revealed mono accent hint
  ("click to open") in the meta row, teaching the gesture. Hidden once read or expanded.

**`frontend/src/stores/feed.ts` — sticky read:**

- Add `readThisSession = ref<Set<string>>(new Set())`.
- `markRead(id)`: on marking read, `readThisSession.value = new Set(readThisSession.value).add(id)`
  (kept out of `setRead` so bulk/other callers don't become sticky).
- Grouping: an item goes to Earlier only if `n.read && !readThisSession.value.has(n.id)`; otherwise it
  stays in `needs-action`. So a just-opened card is read but stays in place.
- `markUnread(id)`: also drop the id from `readThisSession` (it's genuinely unread again).
- `markAllReadInScope()`: does NOT add to `readThisSession` → those items relocate to Earlier
  immediately (clears the pile).
- Add `flushSessionReads()` that clears `readThisSession` (read items then regroup to Earlier). Call
  it from `load()`/`reset()` too.
- The 404-stale-removal fix from the prior bug stays; `remove(id)` also drops the id from
  `readThisSession`.

**`frontend/src/features/notifications/NotificationPopover.vue`:** call `feed.flushSessionReads()` in
`onMounted` so reopening the panel settles this-session reads into Earlier (delivers "stays until you
reopen").

### 3 — "N unread" header + clearer Mark-all

**`frontend/src/features/notifications/components/FeedList.vue`:**

- Header count: show the count of genuinely-unread items in the group as a small accent pill —
  `{{ unreadInNeedsAction }} unread`, where
  `unreadInNeedsAction = needsAction.items.filter((n) => !n.read).length` (sticky-read items don't
  inflate it).
- "Mark all read": wrap the text in a light control — `border border-line rounded-md px-2 py-1
hover:bg-sunken` with a leading `Check` lucide icon — so it reads as an action, not a label. Still
  emits `markAll`.

## Data flow

- Open-and-seen: card `activate` → `open` → `feed.markRead(id)` → optimistic read + add to
  `readThisSession` → grouping keeps it in Needs action (styled read) → server POST.
- Reopen panel: `NotificationPopover` mount → `feed.flushSessionReads()` → this-session reads regroup
  to Earlier.
- Mark-all: `markAllReadInScope` → read, not sticky → items move to Earlier now.

## Testing

- **Card (Vitest):** `activate` expands AND emits `open`; the chevron now also marks read (update the
  existing "expanding does not mark read" test — that behavior is intentionally inverted); an unread
  card carries the left-accent affordance class and a read one doesn't; "Mark as unread" still emits.
- **Feed store (Vitest):** `markRead` keeps the item in `needs-action` (sticky) with `read: true`;
  `flushSessionReads` moves it to Earlier; `markAllReadInScope` moves items to Earlier immediately
  (not sticky); `markUnread` clears stickiness; the 404-removal path also clears the session set.
- **FeedList (Vitest):** header renders "N unread" from genuinely-unread items; "Mark all read"
  emits.
- **e2e (Playwright):** UPDATE `feed.spec.ts` — clicking a card now marks it read **in place** (stays
  in Needs action, styled read, "Mark as unread" available); it relocates to Earlier only after the
  panel is closed and reopened. Add a check that a hovered control shows a pointer cursor is not
  feasible in Playwright reliably, so cursor is covered by design review + browser-tester instead.
- Browser-verify + `frontend-design-reviewer`.

## Review gates

- `frontend-design-reviewer` — the cursor/hover rule, the card affordance, and the header/mark-all
  against the ivory system.
- `code-reviewer` — the sticky-read state machine (the subtle part) and the card interaction refactor.
- `browser-tester` — pointer cursors across screens, the open-and-seen flow, sticky read, and the
  reopen-flush.
- No `security-reviewer` (frontend-only, no endpoints/authz/migrations).

## Risks / open questions

- **Sticky-read is the subtle bit.** The grouping predicate, the flush hook, and keeping `markRead`
  sticky while `markAllReadInScope` is not are the parts to get right and to test explicitly.
- **Existing feed e2e changes behavior** — clicking no longer immediately relocates the card; the e2e
  and its comments must be rewritten to the sticky model rather than patched around.
- **Hover "click to open" hint** must stay restrained (mono, faint, hover-only) so it doesn't clutter
  the editorial feed; drop it if it reads as noisy in the browser check.
- **"N unread" when only sticky-read items remain** shows "0 unread" while rows are visible — correct
  (they're read), acceptable; the group still lists them until the next flush.
