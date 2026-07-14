# Design: Notifications as a dashboard bell popover

Date: 2026-07-14
Status: Approved (design); implementation plan to follow
Scope: Frontend restructure only. No backend changes. Admin-as-separate-app is a
separate spec (not covered here).

## Context

The Week-1 frontend ships notifications as a **full-screen feed** (`NotificationsView.vue`)
that is the entire app after login. We are reframing the product as a **SaaS dashboard**
where notifications are a **bell popover** in the topbar — the way a real product surfaces
them — rather than the whole screen.

Everything notification-related except **user notification settings** moves into that panel:
the feed, filters, read-state, and an AI assistant. User settings (channels, mute, digest
cadence) live on a separate account/settings page, not in the panel.

This is a structural change. The backend (list endpoint, SSE, read-state, keyset
pagination) and the visual design system are **unchanged**; the existing feed store and
card renderer are reused.

## Decisions locked during brainstorming

Explored visually via the brainstorming companion; the user chose:

1. **Surface = Option A, the bell popover.** A compact dropdown anchored to the topbar
   bell (GitHub/Slack-familiar). Chosen over a right slide-over drawer, a mega two-pane
   dropdown, and a centered command overlay for being the lightest touch on the dashboard.
2. **Visual style = Direction 1, "Editorial Ivory"** — the existing design system, kept
   as-is (Fraunces + Hanken Grotesk + JetBrains Mono; ivory bg; pine accent; flat +
   hairline). No token changes.
3. **AI chat = visual stub this pass.** Build the "Ask AI" tab, thread UI, and composer
   as a non-functional stub (canned reply, visibly inert composer). Wire a real LLM in the
   dedicated AI task later (original Week-3 phasing).
4. **Dashboard shell = lightweight fake.** A convincing but non-functional SaaS frame
   (sidebar with fake nav + topbar + placeholder widgets) that exists only to stage the
   notifications panel. No real dashboard pages.
5. **Settings = stub link this pass.** The panel links out to a `/settings` route that
   exists as a placeholder. Real preference controls come in the Week-4 preferences task.

### Consequence of the popover surface

Because the popover is narrow (~320px), the feed and the AI chat cannot sit side by side.
The AI assistant therefore lives behind an **"Ask AI" tab**: the panel body swaps between
the Inbox (feed) and the Assistant (chat). This is the deliberate trade-off of Option A —
feed and chat are never visible at the same time.

## Goals

- Replace the full-screen feed with a dashboard shell + a bell popover, reusing the
  existing feed store, SSE client, and card renderer without modification to their public
  behavior.
- Keep the live unread badge accurate on the bell even while the panel is closed.
- Preserve every existing feed capability inside the popover: live SSE prepend, keyset
  pagination on scroll, priority grouping (Needs action / Earlier), read/unread, inline
  actions, filters, and the loading/empty/filtered-empty/error states.
- Add an AI Assistant tab (stub) and a Settings stub route.

## Non-goals (explicitly out of scope)

- Real AI chat (endpoint, streaming, prompting, tests) — later AI task.
- Real dashboard pages behind the fake nav.
- Working notification preferences / settings storage + enforcement — Week-4.
- The **separate admin frontend app** (the user's point 2) — its own spec.
- Any backend change. Dark mode (tokens already structured for it; not built here).

## Architecture

### Component tree

```
router "/"  →  DashboardLayout.vue                     (NEW — the SaaS shell)
   ├─ DashboardSidebar.vue      (RENAMED from AppSidebar.vue; fake nav + Settings cog, role-aware)
   ├─ DashboardTopBar.vue       (RENAMED from TopBar.vue; logo, page title, bell, user menu)
   │    └─ NotificationBell.vue  (NEW — bell button + live unread badge; toggles the popover)
   │         └─ NotificationPopover.vue (NEW — anchored popover; tabs; outside-click/Esc; focus mgmt)
   │              ├─ InboxTab.vue   (NEW — AI summary strip + compact filters + feed body)
   │              │     ├─ FilterMenu.vue                 (REUSED)
   │              │     └─ NotificationCardRenderer.vue   (REUSED, unchanged)
   │              └─ AssistantTab.vue (NEW — AI chat STUB: canned thread + inert composer)
   └─ DashboardHome.vue          (NEW — placeholder dashboard widgets; the stage)

router "/settings" → SettingsStub.vue                  (NEW — placeholder page linked from the panel)

REUSED unchanged: stores/feed.ts, api/sse.ts, api/client.ts, stores/session.ts, router guard, whole backend
REMOVED: features/notifications/NotificationsView.vue (full-screen shell)
ADAPTED: the feed list currently in FeedList.vue / NotificationsView is re-hosted inside InboxTab
         (a scroll container sized to the popover, keeping the IntersectionObserver sentinel).
```

Each unit has one job: the layout arranges the shell; the bell owns open/close + badge; the
popover owns tab state, dismissal, and focus; InboxTab composes existing feed pieces;
AssistantTab is a self-contained stub. The feed store remains the single source of feed
truth and is not aware of the popover.

### Data flow

- **App mount:** feed store `connect()`s SSE and does the initial keyset `load()` so the
  bell badge is populated and live immediately — independent of whether the panel is open.
- **SSE prepend:** new notifications flow into the store as today; the bell badge
  (`unreadCount`) and, if open, the Inbox list update reactively.
- **Open panel:** local UI state on the bell/popover (not a route). If the store hasn't
  loaded yet, ensure it has.
- **Scroll to bottom of Inbox:** existing IntersectionObserver → `loadMore()` keyset page.
- **Click a card:** optimistic `setRead(id)` → `POST /notifications/:id/read`; badge
  decrements; revert on failure (existing store logic).
- **Ask AI tab:** renders canned thread from static data; composer is disabled. No network.

## Behavior & UX details

- **Bell:** shows unread count badge (capped display, e.g. `9+`); accessible label
  ("Notifications, N unread"); `aria-haspopup`, `aria-expanded`.
- **Popover dismissal:** outside-click and `Esc` close it; focus returns to the bell.
  Focus moves into the panel on open. Respects `prefers-reduced-motion` for the open/close
  transition (existing motion rules).
- **Tabs:** `Inbox` (default) / `Ask AI ✦`; keyboard-navigable; `role="tablist"`.
- **Compact filters:** search input + priority chips inline; module pills fold into the
  `FilterMenu` dropdown to fit ~320px. Client-side filtering over the loaded set (unchanged
  from Week-1; server-side filtering remains a later task).
- **AI summary strip:** a static one-line digest at the top of the Inbox for now (it is not
  a live-computed summary this pass — canned text, same category as the AI stub). Labelled
  so it doesn't read as a real computed insight.
- **States:** loading, empty ("You're all caught up"), filtered-empty, and error all render
  inside the popover body.
- **Settings link:** the Settings cog (sidebar) and/or a link in the panel footer route to
  `/settings` (stub).

## Accessibility

- Popover is a labelled dialog/menu with managed focus (trap while open, restore on close),
  `Esc` to dismiss, and visible focus states (existing design-system focus tokens).
- Tabs use proper `tablist`/`tab`/`tabpanel` semantics.
- The live region: new-notification arrival should not steal focus; the badge is the
  primary passive indicator.

## Testing

Per `.claude/rules/testing.md`:

- **Unit (Vitest + @vue/test-utils):**
  - Bell badge reflects `unreadCount` and updates when the store changes.
  - Popover opens on bell click, closes on `Esc` and on outside-click, and returns focus to
    the bell.
  - Tab switch renders InboxTab vs AssistantTab.
  - AssistantTab renders the canned thread and an inert (disabled) composer.
  - Compact filters still filter the loaded set (reuse existing store filter tests where
    possible).
- **e2e (Playwright, `frontend/e2e/feed.spec.ts` rewritten):**
  - Happy path: login → dashboard shell → click bell → popover opens → publish via
    `POST /internal/publish` → live card appears in the popover → click card → `204` →
    read styling + badge decrement.
  - Failure: bad-password login shows the inline error (retained).
- Do not mark UI done on `tsc`/unit alone — verify in a real browser (`/verify` or
  `browser-tester`) per the rules.

## Review gates

- `frontend-design-reviewer` (design-system compliance of the shell + popover),
  `browser-tester` (renders/works, focus + dismissal behave), `code-reviewer` after the
  change. No `security-reviewer` needed — no backend/auth/PII surface changes.
- The pre-existing **cross-tenant visibility** gate (every authed user sees every
  notification) is unaffected by this redesign and still needs mentor sign-off before the
  Week-1 PR; this spec neither resolves nor worsens it.

## Risks / open questions

- **Popover density:** ~320px is tight for search + chips + module dropdown + grouped feed.
  Mitigation: fold module filters into the `FilterMenu` dropdown; validate with
  `browser-tester` early.
- **Focus management** in a Vue popover is the most bug-prone piece; cover it with explicit
  unit tests and a browser check.
- **e2e rewrite** changes the first user-facing flow's selectors; expect the happy-path
  spec to need new anchors (open the bell before asserting the feed).

```

```
