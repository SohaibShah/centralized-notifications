import { computed, reactive, ref, shallowRef, type Ref } from "vue";
import type {
  FeedNotification,
  FeedSort,
  FeedView,
  GroupedEntry,
  GroupedPage,
  Notification,
  NotificationAction,
  NotificationCounts,
  NotificationPage,
  NotificationPriority,
} from "@notifications/shared";
import { notificationCountsSchema } from "@notifications/shared";
import { ApiError } from "../transport/cookie-transport";
import type { SseClient, SseFactory, SseStatus, Transport } from "../transport/types";

const PAGE_SIZE = 25;
// Cap the retained window so a long-lived tab receiving live bursts can't grow `items`
// (and `seen`) without bound. The trimmed tail is older history that stays re-fetchable
// via the cursor. Only the live prepend trims; `loadMore` is user-driven and left alone.
const MAX_ITEMS = 1000;

/** A contiguous run of the feed under one heading. */
export interface FeedGroup {
  key: "needs-action" | "earlier";
  label: string;
  items: FeedNotification[];
}

/** A removable representation of one active structured filter. */
export type FilterPill =
  | { type: "unread"; label: string }
  | { type: "priority"; value: NotificationPriority; label: string }
  | { type: "module"; value: string; label: string };

/**
 * The feed store owns everything about the live notification list: the keyset-paged
 * history, the live SSE prepend, dedupe, client-side filtering, and the derived
 * grouping / unread count the shell renders. The list is a `shallowRef` and every
 * mutation replaces the array reference (NFR-2: we never make Vue deeply-reactive over
 * a list that can grow large — we control invalidation ourselves).
 */
export function createFeedState(deps: { transport: Transport; connectSse: SseFactory }) {
  // --- history + connection -------------------------------------------------
  const items = shallowRef<FeedNotification[]>([]);
  const seen = new Set<string>(); // id set backing O(1) dedupe across load + live

  // Ids read *this session* via a single open-and-seen click. They stay in "Needs action"
  // (shown read) instead of jumping to "Earlier", so a just-opened card can actually be read.
  // Cleared by flushSessionReads() on panel reopen / load / reset.
  const readThisSession = ref<Set<string>>(new Set());

  function stick(id: string): void {
    readThisSession.value = new Set(readThisSession.value).add(id);
  }
  function unstick(id: string): void {
    if (!readThisSession.value.has(id)) return;
    const next = new Set(readThisSession.value);
    next.delete(id);
    readThisSession.value = next;
  }
  function flushSessionReads(): void {
    if (readThisSession.value.size === 0) return;
    readThisSession.value = new Set();
  }
  const status = ref<"idle" | "loading" | "ready" | "error">("idle");
  const error = ref<string | null>(null);
  const loadingMore = ref(false);
  const nextCursor = ref<string | null>(null);
  const connection = ref<SseStatus>("closed");
  let sse: SseClient | null = null;

  // Server-owned sort order. The keyset cursor is scoped to this value, so changing it
  // requires a page-1 refetch (see setSort). Default matches the backend default.
  const sort = ref<FeedSort>("newest");

  // Which slice of the feed to read: "active" (the normal feed) or "muted" (only what the user's
  // snooze/mute rules are hiding — the server-side inverse). Switching requires a page-1 refetch of
  // a different dataset, so setView clears the window like setSort. Default matches the backend.
  const view = ref<FeedView>("active");

  // --- grouping -------------------------------------------------------------
  // `grouped` is an INPUT flag the panel sets (from the admin + user toggles + filter state); it tells
  // the store to render collapsed stacks (`groupedEntries`) and drives the live-batch behaviour.
  const grouped = ref(false);
  const groupedEntries = shallowRef<GroupedEntry[]>([]);
  const groupedCursor = ref<string | null>(null);
  const loadingGrouped = ref(false);
  const hasMoreGrouped = computed(() => groupedCursor.value !== null);
  // The "See all" drill-in: when set, the flat item list is scoped to this one group's members.
  const activeGroup = ref<string | null>(null);
  // The label to show in the group banner while drilled in (captured from the stack the user opened).
  const activeGroupLabel = ref<string>("");
  // The read-state of the stack that was drilled into — scopes the drill-in to that stack's members
  // (unread stack → its unread members, read stack → its read members), matching the read-split.
  const activeGroupRead = ref<boolean | null>(null);

  // Grouped analog of `readThisSession`: representative-entry ids marked read *this session* stay in
  // "Needs action" (shown read) instead of jumping to Earlier or re-splitting the stacks. The grouped
  // view is session-stable — stacks only re-form on a fresh loadGrouped (panel reopen). Cleared there.
  // Keyed by the entry's own notification id (`e.id`), NOT `groupKey`: a split subject has two entries
  // (a read + an unread stack) sharing one `groupKey`, so keying on the key would flip/stick both.
  const groupedReadThisSession = ref<Set<string>>(new Set());
  function stickGroup(id: string): void {
    groupedReadThisSession.value = new Set(groupedReadThisSession.value).add(id);
  }
  function unstickGroup(id: string): void {
    if (!groupedReadThisSession.value.has(id)) return;
    const next = new Set(groupedReadThisSession.value);
    next.delete(id);
    groupedReadThisSession.value = next;
  }
  // Optimistically flip ONE grouped entry's read flag by its representative id (unique per entry).
  // Replaces the object so the `groupedEntries` shallowRef sees the change and StackList re-partitions.
  function setGroupedRead(id: string, read: boolean): void {
    groupedEntries.value = groupedEntries.value.map((e) => (e.id === id ? { ...e, read } : e));
  }

  // Authoritative unread counts over the WHOLE dataset (from GET /notifications/counts), so the
  // bell/header/chip counts don't undercount to the loaded window. Seeded by fetchCounts (on load
  // + panel open) and kept live by exact optimistic deltas (read actions) and SSE increments.
  function emptyByPriority(): Record<NotificationPriority, number> {
    return { critical: 0, high: 0, normal: 0, low: 0 };
  }
  const counts = ref<NotificationCounts>({ unread: 0, unreadByPriority: emptyByPriority() });

  /** Apply an exact delta to the unread total and one priority bucket; clamp at 0. */
  function adjustCount(priority: NotificationPriority, delta: number): void {
    const byPriority = { ...counts.value.unreadByPriority };
    byPriority[priority] = Math.max(0, byPriority[priority] + delta);
    counts.value = {
      unread: Math.max(0, counts.value.unread + delta),
      unreadByPriority: byPriority,
    };
  }

  /** Refresh the authoritative counts snapshot. Best-effort — a failure keeps the last snapshot. */
  async function fetchCounts(): Promise<void> {
    try {
      // Parse defensively: a malformed/partial body must never poison the snapshot (a missing
      // bucket would make a later optimistic delta compute NaN). On a bad shape, keep the last one.
      const parsed = notificationCountsSchema.safeParse(
        await deps.transport.get<unknown>("/notifications/counts"),
      );
      if (parsed.success) counts.value = parsed.data;
      else console.warn("[feed] counts response failed validation; keeping the last snapshot");
    } catch {
      console.warn("[feed] failed to refresh counts; keeping the last snapshot");
    }
  }

  // --- filters (client-side over the loaded set; server-side is Week 2) ------
  const query = ref("");
  const priorities = ref<Set<NotificationPriority>>(new Set());
  const modules = ref<Set<string>>(new Set());
  const unreadOnly = ref(false);

  const hasMore = computed(() => nextCursor.value !== null);

  /** A live-delivered notification is, by definition, brand new: unread, and received
   *  "just now" (the SSE frame carries the contract only, not the server createdAt). */
  function toFeed(n: Notification): FeedNotification {
    return { ...n, createdAt: new Date().toISOString(), read: false };
  }

  function addBack(incoming: FeedNotification[]): void {
    const fresh = incoming.filter((n) => !seen.has(n.id));
    if (fresh.length === 0) return;
    for (const n of fresh) seen.add(n.id);
    items.value = [...items.value, ...fresh];
  }

  function addFront(incoming: FeedNotification[]): void {
    const fresh = incoming.filter((n) => !seen.has(n.id));
    if (fresh.length === 0) return;
    for (const n of fresh) seen.add(n.id);
    let next = [...fresh, ...items.value];
    if (next.length > MAX_ITEMS) {
      for (const n of next.slice(MAX_ITEMS)) seen.delete(n.id);
      next = next.slice(0, MAX_ITEMS);
    }
    items.value = next;
  }

  /** Clear all loaded state — used on (re)login so one user never sees another's feed. */
  function reset(): void {
    seen.clear();
    items.value = [];
    nextCursor.value = null;
    status.value = "idle";
    readThisSession.value = new Set();
    sort.value = "newest"; // a re-login starts at the default order
    view.value = "active"; // …and in the normal (non-muted) view
    grouped.value = false;
    groupedEntries.value = [];
    groupedCursor.value = null;
    activeGroup.value = null;
    activeGroupLabel.value = "";
    counts.value = { unread: 0, unreadByPriority: emptyByPriority() };
  }

  /**
   * Load the newest page. Deliberately *merges* (addBack de-dupes on `seen`) rather than
   * resetting: `connect()` runs before `load()`, so a live burst can arrive while this
   * fetch is in flight — clearing here would drop it. Call `reset()` first for a clean
   * slate (login). Older, already-loaded pages are preserved.
   */
  async function load(): Promise<void> {
    flushSessionReads(); // a fresh page reconciles positions — settle this-session reads first
    status.value = "loading";
    error.value = null;
    try {
      const page = await deps.transport.get<NotificationPage>(
        `/notifications?limit=${PAGE_SIZE}&sort=${sort.value}&view=${view.value}${groupParam()}`,
      );
      addBack(page.items);
      nextCursor.value = page.nextCursor;
      status.value = "ready";
      await fetchCounts(); // dataset-wide counts; refreshed on load, NOT on loadMore
    } catch {
      status.value = "error";
      error.value = "Couldn't load your notifications. Check your connection and try again.";
    }
  }

  /**
   * Hard-refresh the loaded feed from scratch, preserving the current sort + filters. Unlike `load()`
   * (which merges), this clears the already-loaded items first, so notifications the server now
   * filters out — e.g. a module the user just snoozed/muted — actually disappear. Used when the user's
   * snooze/mute rules change (see the provider's `onRulesChanged`).
   */
  async function reload(): Promise<void> {
    seen.clear();
    items.value = [];
    nextCursor.value = null;
    await load();
  }

  /** Fetch the next (older) keyset page. No-op while one is in flight or at the end. */
  async function loadMore(): Promise<void> {
    if (loadingMore.value || !nextCursor.value) return;
    loadingMore.value = true;
    try {
      const cursor = encodeURIComponent(nextCursor.value);
      const page = await deps.transport.get<NotificationPage>(
        `/notifications?limit=${PAGE_SIZE}&sort=${sort.value}&view=${view.value}${groupParam()}&cursor=${cursor}`,
      );
      addBack(page.items);
      nextCursor.value = page.nextCursor;
    } catch {
      // Keep what we have; the sentinel re-triggers on the next scroll. Don't set the
      // page-level `error` here — the feed still renders, so surfacing the full error
      // state would be wrong; a transient older-page fetch failure just retries.
      console.warn("[feed] failed to load older notifications; will retry on next scroll");
    } finally {
      loadingMore.value = false;
    }
  }

  /**
   * Change the feed sort: soft-reset the loaded window (keep the SSE connection live) and
   * refetch page 1 in the new order. The keyset cursor is sort-scoped, so the old window is
   * discarded rather than merged. Distinct from reset(), which is login-scoped.
   */
  async function setSort(next: FeedSort): Promise<void> {
    if (next === sort.value) return;
    sort.value = next;
    // The grouped and flat feeds each own a sort-scoped cursor, so a sort change resets whichever
    // window is live and refetches page 1 in the new order. Only the collapsed-stacks view uses the
    // grouped read — a "See all" drill-in (activeGroup set) renders the flat member list, so it must
    // fall through to load() (which appends groupParam()) to re-sort the drilled-in group.
    if (grouped.value && activeGroup.value === null) {
      groupedEntries.value = [];
      groupedCursor.value = null;
      await loadGrouped();
      return;
    }
    seen.clear();
    items.value = [];
    nextCursor.value = null;
    await load(); // load() flushes session reads and refetches the newest page in the new order
  }

  /**
   * Switch the feed view between "active" (the normal feed) and "muted" (only what the user's
   * snooze/mute rules are hiding). It's a different dataset, so — like setSort — soft-reset the
   * loaded window and refetch page 1. The SSE connection stays live (onLiveBatch skips the prepend
   * while in the muted view; live arrivals are active notifications and must not enter it).
   */
  async function setView(next: FeedView): Promise<void> {
    if (next === view.value) return;
    view.value = next;
    seen.clear();
    items.value = [];
    nextCursor.value = null;
    await load();
  }

  /** `&group=<key>` (plus `&read=` for a read-split stack) when drilled into "See all", else empty. */
  function groupParam(): string {
    if (activeGroup.value === null) return "";
    const g = `&group=${encodeURIComponent(activeGroup.value)}`;
    return activeGroupRead.value === null ? g : `${g}&read=${activeGroupRead.value}`;
  }

  /** `&priority=<csv>&module=<csv>` for the active structured filters — applied server-side to the
   * grouped stacks so groups show only matching members (and empty groups drop out). Empty when none. */
  function groupFilterParams(): string {
    let p = "";
    if (priorities.value.size > 0)
      p += `&priority=${encodeURIComponent([...priorities.value].join(","))}`;
    if (modules.value.size > 0) p += `&module=${encodeURIComponent([...modules.value].join(","))}`;
    return p;
  }

  /**
   * Load the collapsed grouped feed (page 1) — one entry per stack/standalone. Replaces the grouped
   * window (not additive): the server owns the aggregates, so a refetch is always the source of truth.
   */
  async function loadGrouped(opts: { flush?: boolean } = {}): Promise<void> {
    // A deliberate (re)load re-forms the stacks from server truth, so drop this-session read stickiness
    // (flat + grouped) — read items settle into Earlier and groups re-partition. This is the panel-reopen
    // path (the `showStacks` watch). An involuntary SSE-triggered refresh passes `flush: false` to keep
    // the session stable while the panel stays open.
    if (opts.flush ?? true) {
      flushSessionReads();
      if (groupedReadThisSession.value.size > 0) groupedReadThisSession.value = new Set();
    }
    // Only show the skeleton on a first/cold load — a warm refetch (e.g. an SSE-triggered refresh)
    // keeps the current stacks visible rather than flashing the loading state.
    if (status.value !== "ready") status.value = "loading";
    error.value = null;
    try {
      const page = await deps.transport.get<GroupedPage>(
        `/notifications?grouped=true&limit=${PAGE_SIZE}&sort=${sort.value}${groupFilterParams()}`,
      );
      groupedEntries.value = Array.isArray(page?.entries) ? page.entries : [];
      groupedCursor.value = page?.nextCursor ?? null;
      status.value = "ready";
      await fetchCounts();
    } catch {
      status.value = "error";
      error.value = "Couldn't load your notifications. Check your connection and try again.";
    }
  }

  /** Fetch the next page of grouped stacks (older). No-op while one is in flight or at the end. */
  async function loadMoreGrouped(): Promise<void> {
    if (loadingGrouped.value || !groupedCursor.value) return;
    loadingGrouped.value = true;
    try {
      const cursor = encodeURIComponent(groupedCursor.value);
      const page = await deps.transport.get<GroupedPage>(
        `/notifications?grouped=true&limit=${PAGE_SIZE}&sort=${sort.value}&cursor=${cursor}${groupFilterParams()}`,
      );
      groupedEntries.value = [...groupedEntries.value, ...page.entries];
      groupedCursor.value = page.nextCursor;
    } catch {
      console.warn("[feed] failed to load older stacks; will retry on next scroll");
    } finally {
      loadingGrouped.value = false;
    }
  }

  /**
   * Drill into one group's members ("See all"): scope the flat list to `key` and refetch page 1. The UI
   * calls this WITHOUT `read`, so the drill-in shows the whole thread — every message in the subject,
   * read and unread together. (`read` still scopes to one read-state if ever passed; the server's `read`
   * filter is optional, so omitting it returns all members.)
   */
  async function enterGroup(key: string, label = "", read?: boolean): Promise<void> {
    activeGroup.value = key;
    activeGroupLabel.value = label;
    activeGroupRead.value = read ?? null;
    seen.clear();
    items.value = [];
    nextCursor.value = null;
    await load();
  }

  /** Leave the "See all" drill-in and return to the flat/grouped feed. */
  function exitGroup(): void {
    if (activeGroup.value === null) return;
    activeGroup.value = null;
    activeGroupLabel.value = "";
    activeGroupRead.value = null;
    seen.clear();
    items.value = [];
    nextCursor.value = null;
  }

  // Live alert subscribers (the toast listens here). Fired with genuinely-new high+critical items
  // this batch (the toastable set); the toast viewport narrows further by the user's toast preference.
  // Only fresh items are emitted, so a duplicate delivery never re-toasts.
  const alertSubs = new Set<(items: FeedNotification[]) => void>();
  function onLiveAlert(cb: (items: FeedNotification[]) => void): () => void {
    alertSubs.add(cb);
    return () => alertSubs.delete(cb);
  }

  /** Handle one coalesced SSE burst: prepend new notifications, then notify critical subs. */
  function onLiveBatch(batch: Notification[]): void {
    const incoming = batch.map(toFeed);
    // Compute fresh (new-to-`seen`) items BEFORE addFront dedupes them. Live arrivals are unread,
    // so each genuinely-new one bumps the counts by its priority. Dedupe within the batch too, so a
    // repeated id in one frame counts once (matching addFront's own de-dupe). Note: fetchCounts on
    // load + panel open is authoritative and reconciles any transient drift (e.g. an at-least-once
    // re-delivery of an older item after setSort cleared `seen`).
    const batchSeen = new Set<string>();
    const fresh = incoming.filter(
      (n) => !seen.has(n.id) && !batchSeen.has(n.id) && batchSeen.add(n.id),
    );
    for (const n of fresh) adjustCount(n.priority, +1);
    const freshAlerts = fresh.filter((n) => n.priority === "critical" || n.priority === "high");
    // Live arrivals are active (un-muted) notifications, so counts and toasts still update — but only
    // the plain active feed gains them in place. In every other mode we record their ids in `seen`
    // (so an at-least-once redelivery isn't counted as `fresh` twice) and reconcile differently.
    if (activeGroup.value !== null) {
      // "See all" drill-in: SSE items carry no group_key, so we can't place them in this group — skip.
      for (const n of fresh) seen.add(n.id);
    } else if (grouped.value) {
      // Grouped stacks: SSE items carry no group_key, so refetch the stacks from the server (which
      // has the keys) to fold the arrival into the right stack with correct totals. Keep the session
      // stable (`flush: false`) — an involuntary live refresh must not yank read items to Earlier.
      for (const n of fresh) seen.add(n.id);
      if (fresh.length > 0) void loadGrouped({ flush: false });
    } else if (view.value === "active") {
      addFront(incoming); // dedupes on `seen` internally
    } else {
      // Muted view: never gains active arrivals; an active notification can't belong in the muted list.
      for (const n of fresh) seen.add(n.id);
    }
    if (freshAlerts.length > 0) for (const cb of alertSubs) cb(freshAlerts);
  }

  function connect(): void {
    if (sse) return;
    sse = deps.connectSse({
      onBatch: onLiveBatch,
      onStatus: (s) => (connection.value = s),
    });
  }

  function disconnect(): void {
    sse?.close();
    sse = null;
    connection.value = "closed";
  }

  function setRead(id: string, read: boolean): void {
    // Replace matched item objects (new refs) so the shallowRef sees the change and the
    // grouping/unread computeds recimpute — the row moves between Needs action / Earlier.
    items.value = items.value.map((n) => (n.id === id ? { ...n, read } : n));
  }

  /**
   * Replace one notification's action set in place (e.g. a dispatch response hands back a fresh
   * set, such as swapping "Approve" for "Undo"). `items` is a `shallowRef`, so both the array and
   * the changed item are replaced with new references to make the mutation visible.
   */
  function setActions(id: string, actions: NotificationAction[]): void {
    items.value = items.value.map((n) => (n.id === id ? { ...n, actions } : n));
  }

  /** Drop a notification the server no longer has (e.g. deleted out from under an open feed). */
  function remove(id: string): void {
    unstick(id);
    items.value = items.value.filter((n) => n.id !== id);
  }

  /**
   * Mark one notification read for this user (FR-6). Optimistic: flip the flag locally
   * first (instant feedback, moves the row to "Earlier"), then persist; revert on
   * failure. No-op if it's unknown or already read, so a re-click costs nothing.
   */
  async function markRead(id: string): Promise<void> {
    // In the grouped stacks view a standalone / group-representative card lives in `groupedEntries`, not
    // the flat `items` window. Flip it optimistically + stick it (session-stable: no refetch — the stacks
    // only re-form on panel reopen). A peek member (neither in `items` nor an entry) is flipped locally by
    // StackRow; here we just persist it. This was the "the icon does nothing" bug — but without the old
    // refetch that yanked the card to Earlier (#4) and duplicated / collapsed stacks (#5, #6).
    // In grouped-stacks mode the on-screen rows are `groupedEntries`, NOT the flat `items` window (which
    // can be stale from a prior "See all" drill-in). Ignore `items` there — otherwise a stale flat copy
    // matches `target` and we mutate the invisible window instead of the grouped card (the "no reaction"
    // bug). A grouped STANDALONE (groupTotal === 1) is a card in `groupedEntries` — flip it optimistically.
    // Only groupTotal === 1: a multi-member stack's representative shares its id with a peek member, and
    // reading that member must NOT flip the whole stack (it's a peek member — handled below).
    const inGroupedStacks = grouped.value && activeGroup.value === null;
    const target = inGroupedStacks ? undefined : items.value.find((n) => n.id === id);
    const entry = inGroupedStacks
      ? groupedEntries.value.find((e) => e.id === id && e.groupTotal === 1)
      : undefined;
    const peekMember = inGroupedStacks && !entry;
    if (target) {
      if (target.read) return; // already read
      setRead(id, true);
      stick(id); // open-and-seen: keep it in place while it's read this session
      adjustCount(target.priority, -1); // optimistic: one fewer unread of this priority
    } else if (entry) {
      if (entry.read) return;
      setGroupedRead(id, true);
      stickGroup(id); // keep the standalone in Needs action until reopen
      adjustCount(entry.priority, -1);
    } else if (!grouped.value) {
      return; // an unknown notification in the flat feed — nothing to do
    }
    try {
      await deps.transport.post(`/notifications/${encodeURIComponent(id)}/read`);
      // A peek member has no local row/priority to delta, so reconcile the authoritative counts (the
      // bell) without re-forming the stacks — keeps the count honest while staying session-stable.
      if (peekMember) await fetchCounts();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The notification no longer exists server-side (e.g. deleted via admin maintenance
        // while this feed stayed open). Drop the stale row instead of reverting — otherwise it
        // lingers, un-markable, because every future read POST 404s the same way. It's no longer
        // an unread-existing notification, so the count decrement stands. A grouped entry self-heals
        // on reopen (loadGrouped), so we leave it.
        if (target) remove(id);
        return;
      }
      if (target) {
        setRead(id, false); // genuine failure — revert
        unstick(id);
        adjustCount(target.priority, +1); // revert the count delta too
      } else if (entry) {
        setGroupedRead(id, false);
        unstickGroup(id);
        adjustCount(entry.priority, +1);
      }
      console.warn(`[feed] failed to mark ${id} read; reverted`);
    }
  }

  /**
   * Undo a read for this user (mirror of markRead). Optimistic: flip to unread locally
   * (the row moves back to "Needs action"), then persist the delete; revert on failure.
   * No-op if unknown or already unread.
   */
  async function markUnread(id: string): Promise<void> {
    // Mirror of markRead: flat item, grouped standalone/representative entry, or a peek member (StackRow
    // flips it locally; we only persist). Session-stable — no refetch. In grouped-stacks mode the on-screen
    // rows are `groupedEntries`, NOT the flat `items` window (which can be stale from a prior drill-in), so
    // ignore `items` there and go straight to the grouped-entry / peek path.
    const inGroupedStacks = grouped.value && activeGroup.value === null;
    const target = inGroupedStacks ? undefined : items.value.find((n) => n.id === id);
    const entry = inGroupedStacks
      ? groupedEntries.value.find((e) => e.id === id && e.groupTotal === 1)
      : undefined;
    const peekMember = inGroupedStacks && !entry;
    if (target) {
      if (!target.read) return; // already unread
    } else if (entry) {
      if (!entry.read) return;
    } else if (!grouped.value) {
      return; // unknown in the flat feed — nothing to do
    }
    const wasSticky = readThisSession.value.has(id);
    const wasStickyGroup = entry ? groupedReadThisSession.value.has(id) : false;
    if (target) {
      setRead(id, false);
      unstick(id);
      adjustCount(target.priority, +1); // optimistic: one more unread of this priority
    } else if (entry) {
      setGroupedRead(id, false);
      unstickGroup(id);
      adjustCount(entry.priority, +1);
    }
    try {
      await deps.transport.del(`/notifications/${encodeURIComponent(id)}/read`);
      if (peekMember) await fetchCounts(); // reconcile the bell without re-forming the stacks
    } catch {
      if (target) {
        setRead(id, true); // revert — the server didn't clear it
        if (wasSticky) stick(id); // restore its in-place (sticky) position too — a true inverse
        adjustCount(target.priority, -1); // revert the count delta too
      } else if (entry) {
        setGroupedRead(id, true);
        if (wasStickyGroup) stickGroup(id);
        adjustCount(entry.priority, -1);
      }
      console.warn(`[feed] failed to mark ${id} unread; reverted`);
    }
  }

  /**
   * Mark every currently-visible unread notification read (the panel's "Mark all read",
   * scoped to the active filters). Optimistic: flip all locally, persist in one bulk
   * request, revert all on failure.
   */
  async function markAllReadInScope(): Promise<void> {
    const targets = visibleItems.value.filter((n) => !n.read);
    if (targets.length === 0) return;
    for (const n of targets) {
      setRead(n.id, true);
      adjustCount(n.priority, -1);
    }
    try {
      await deps.transport.post("/notifications/read", { ids: targets.map((n) => n.id) });
    } catch {
      for (const n of targets) {
        setRead(n.id, false);
        adjustCount(n.priority, +1);
      }
      console.warn("[feed] mark-all-read failed; reverted");
    }
  }

  /**
   * Mark an entire group read (a stack's "Mark all read"). Session-stable, like the single marks:
   * optimistically flip the UNREAD stack read + stick it (StackRow flips its loaded peek members locally)
   * so it stays put in Needs action, shown read, until the panel reopens — then loadGrouped re-forms the
   * stacks and the same-subject read stack absorbs it. The button lives on the unread stack's footer, so
   * we target that entry specifically by its own id — a split subject also has a read stack with the same
   * `groupKey`, which must NOT be touched. The bell reconciles via fetchCounts (no per-priority delta here).
   */
  async function markAllReadInGroup(key: string): Promise<void> {
    if (!key) return;
    const target = groupedEntries.value.find((e) => e.groupKey === key && !e.read);
    if (target) {
      setGroupedRead(target.id, true);
      stickGroup(target.id);
    }
    try {
      await deps.transport.post("/notifications/read", { group: key });
      await fetchCounts();
    } catch {
      if (target) {
        setGroupedRead(target.id, false);
        unstickGroup(target.id);
      }
      console.warn("[feed] mark-group-read failed");
    }
  }

  // --- filtering + grouping -------------------------------------------------
  const availableModules = computed(() =>
    [...new Set(items.value.map((n) => n.module))].sort((a, b) => a.localeCompare(b)),
  );

  // Structured-filter count drives the FilterMenu badge (priority/module/unread only).
  const activeFilterCount = computed(
    () => priorities.value.size + modules.value.size + (unreadOnly.value ? 1 : 0),
  );

  // "Anything narrowing the feed" — includes the search query, so the "All" chip and the
  // filtered-empty state reflect a live search too (a query is a filter as well).
  const isFiltered = computed(() => activeFilterCount.value > 0 || query.value.trim() !== "");
  // A text search can't be applied to the server's grouped aggregates, so the panel falls back to the
  // flat list while searching (priority/module filters DO compose with grouping — server-side).
  const hasSearchQuery = computed(() => query.value.trim() !== "");

  const appliedPills = computed<FilterPill[]>(() => {
    const pills: FilterPill[] = [];
    if (unreadOnly.value) pills.push({ type: "unread", label: "Unread" });
    for (const p of priorities.value)
      pills.push({ type: "priority", value: p, label: capitalize(p) });
    for (const m of modules.value) pills.push({ type: "module", value: m, label: m });
    return pills;
  });

  function matchesFilters(n: FeedNotification): boolean {
    if (unreadOnly.value && n.read) return false;
    if (priorities.value.size > 0 && !priorities.value.has(n.priority)) return false;
    if (modules.value.size > 0 && !modules.value.has(n.module)) return false;
    const q = query.value.trim().toLowerCase();
    if (q) {
      const haystack = `${n.title} ${n.description} ${n.module} ${n.category ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }

  const visibleItems = computed(() => items.value.filter(matchesFilters));

  /**
   * Split the visible feed into "Needs action" (unread) and "Earlier" (read). Both groups
   * preserve load order, which is the server-owned sort (see `sort` / setSort) — the client
   * no longer re-ranks Needs action by priority. Empty groups are omitted.
   */
  const groups = computed<FeedGroup[]>(() => {
    const needsAction: FeedNotification[] = [];
    const earlier: FeedNotification[] = [];
    for (const n of visibleItems.value) {
      // Sticky read: a card read this session stays in Needs action until the next flush.
      const sticky = n.read && readThisSession.value.has(n.id);
      (n.read && !sticky ? earlier : needsAction).push(n);
    }
    const out: FeedGroup[] = [];
    if (needsAction.length)
      out.push({ key: "needs-action", label: "Needs action", items: needsAction });
    if (earlier.length) out.push({ key: "earlier", label: "Earlier", items: earlier });
    return out;
  });

  // --- filter mutations -----------------------------------------------------
  function toggleInSet<T>(set: Ref<Set<T>>, value: T): void {
    const next = new Set(set.value);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set.value = next;
  }

  // In grouped-stacks mode, priority/module filters are applied server-side, so a filter change must
  // refetch the stacks (page-1 reset). In flat mode `visibleItems` re-filters reactively — no refetch.
  function refetchIfGrouped(): void {
    if (grouped.value && activeGroup.value === null) void loadGrouped();
  }
  function togglePriority(p: NotificationPriority): void {
    toggleInSet(priorities, p);
    refetchIfGrouped();
  }
  function toggleModule(m: string): void {
    toggleInSet(modules, m);
    refetchIfGrouped();
  }
  function toggleUnreadOnly(): void {
    unreadOnly.value = !unreadOnly.value;
  }
  function clearFilters(): void {
    priorities.value = new Set();
    modules.value = new Set();
    unreadOnly.value = false;
    query.value = ""; // the search query is a filter too — "Clear filters" clears it
    refetchIfGrouped();
  }
  function removePill(pill: FilterPill): void {
    if (pill.type === "unread") unreadOnly.value = false;
    else if (pill.type === "priority") togglePriority(pill.value);
    else toggleModule(pill.value);
  }

  // reactive() unwraps the nested refs on property access, preserving the Pinia store's ergonomics
  // (feed.items, feed.query = …) so consumers don't need `.value`.
  return reactive({
    // state
    items,
    status,
    error,
    loadingMore,
    nextCursor,
    connection,
    hasMore,
    sort,
    view,
    counts,
    // grouping
    grouped,
    groupedEntries,
    groupedReadThisSession,
    hasMoreGrouped,
    loadingGrouped,
    activeGroup,
    activeGroupLabel,
    // filters
    query,
    priorities,
    modules,
    unreadOnly,
    availableModules,
    activeFilterCount,
    isFiltered,
    hasSearchQuery,
    appliedPills,
    // derived
    visibleItems,
    groups,
    // actions
    load,
    reload,
    loadMore,
    setSort,
    setView,
    loadGrouped,
    loadMoreGrouped,
    enterGroup,
    exitGroup,
    fetchCounts,
    reset,
    connect,
    disconnect,
    markRead,
    markUnread,
    setActions,
    flushSessionReads,
    markAllReadInScope,
    markAllReadInGroup,
    onLiveAlert,
    togglePriority,
    toggleModule,
    toggleUnreadOnly,
    clearFilters,
    removePill,
  });
}

export type FeedState = ReturnType<typeof createFeedState>;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
