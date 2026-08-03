## What changed

Two follow-ups to the per-user-settings feature:

### 1. "Show muted notifications" in the panel

Muted/snoozed notifications are filtered out server-side and never reach the client, so there was no way to see what your rules were hiding without un-muting. This adds a low-emphasis `BellOff` toggle at the right of the panel's filter-chip row that flips the feed body to show exactly the notifications your active snooze/mute rules are hiding.

- **API:** `GET /notifications` gains a `view=active|muted` query param. `muted` returns the exact inverse of the mute filter — only `snoozable: true` notifications matched by an active mute/snooze rule on their module or category. The two views **partition** the audience-scoped feed with no overlap and no gap (`snoozable` is `NOT NULL`, so every row lands in exactly one view). A non-snoozable notification is never in the muted view.
- **Core:** new `mutedOnlyWhere` (inverse of `muteWhere`, kept in lockstep), threaded through `list` → service → route; shared `FEED_VIEWS` enum. The keyset cursor is now **view-scoped** as well as sort-scoped — a cursor issued under one view is rejected if replayed under the other (the client always refetches page 1 on a view change).
- **Client:** feed store gains a `view` mode + `setView()` (mirrors the existing `setSort()`). Live SSE arrivals still update counts and fire toasts but never enter the muted view; their ids are still recorded in `seen` so an at-least-once redelivery can't double-count the badge.
- **UI:** the toggle (`aria-pressed` + tooltip), a "Snoozed & muted notifications" mode banner, and a dedicated "Nothing muted" empty state. Also added a `focus-visible` ring to the filter `Chip` primitive (was missing one).

### 2. Settings copy

The snooze/mute section now explains that some notifications are marked non-snoozable by their module and always come through even when the rest of the module/category is muted, and that muted notifications can be reviewed from the notification panel under the bell icon.

## Why

Extends the just-merged per-user snooze/mute feature: users need to audit what their rules are hiding (and understand why some notifications still arrive) without having to un-mute to check.

## How it was tested

- **Unit:** core (inverse predicate, explicit active∪muted complement, empty-muted, view-scoped cursor rejection), server-fastify (`view=muted` returns muted-only, invalid `view` → 400), vue feed store (default view, `setView` refetch/clear, SSE guard, duplicate-delivery no-double-count, reset), and InboxTab (toggle renders/toggles, banner, "Nothing muted" state).
- **e2e:** extended `settings.spec.ts` — after muting a module, the muted-view toggle reveals the snoozable notification and hides the non-snoozable one; toggling back returns to the active feed. Verified end-to-end in a running browser.
- Whole repo green: lint, typecheck (7 packages), all unit suites, and e2e (`settings.spec.ts` + `feed.spec.ts`).
- Reviewed by `code-reviewer` (one count-drift bug fixed + cursor view-scoping added) and `frontend-design-reviewer` (compliant; three minor polish items applied). `docs/api/notifications.md` updated for the new `view` param.

## Anything still open

- This touches the **read API contract** (`view` param + a changed cursor format). Cursors are ephemeral (per-session, client-held), so the format change is safe within a deploy — but worth a mentor sanity-check on the contract before other services depend on it, per the project's convention for hard-to-reverse API decisions.
