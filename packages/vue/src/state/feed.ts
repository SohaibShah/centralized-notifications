import { computed, reactive, ref, shallowRef, type Ref } from "vue";
import type {
  FeedNotification,
  FeedSort,
  Notification,
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
        `/notifications?limit=${PAGE_SIZE}&sort=${sort.value}`,
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

  /** Fetch the next (older) keyset page. No-op while one is in flight or at the end. */
  async function loadMore(): Promise<void> {
    if (loadingMore.value || !nextCursor.value) return;
    loadingMore.value = true;
    try {
      const cursor = encodeURIComponent(nextCursor.value);
      const page = await deps.transport.get<NotificationPage>(
        `/notifications?limit=${PAGE_SIZE}&sort=${sort.value}&cursor=${cursor}`,
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
    seen.clear();
    items.value = [];
    nextCursor.value = null;
    await load(); // load() flushes session reads and refetches the newest page in the new order
  }

  // Critical-arrival subscribers (the toast listens here). Fired only with items that
  // are genuinely new to the feed this batch, so a duplicate delivery never re-toasts.
  const criticalSubs = new Set<(items: FeedNotification[]) => void>();
  function onLiveCritical(cb: (items: FeedNotification[]) => void): () => void {
    criticalSubs.add(cb);
    return () => criticalSubs.delete(cb);
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
    const freshCriticals = fresh.filter((n) => n.priority === "critical");
    addFront(incoming); // dedupes on `seen` internally
    if (freshCriticals.length > 0) for (const cb of criticalSubs) cb(freshCriticals);
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
    const target = items.value.find((n) => n.id === id);
    if (!target || target.read) return;
    const prio = target.priority;
    setRead(id, true);
    stick(id); // open-and-seen: keep it in place while it's read this session
    adjustCount(prio, -1); // optimistic: one fewer unread of this priority
    try {
      await deps.transport.post(`/notifications/${encodeURIComponent(id)}/read`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The notification no longer exists server-side (e.g. deleted via admin maintenance
        // while this feed stayed open). Drop the stale row instead of reverting — otherwise it
        // lingers, un-markable, because every future read POST 404s the same way. It's no longer
        // an unread-existing notification, so the count decrement stands.
        remove(id);
        return;
      }
      setRead(id, false); // genuine failure — revert
      unstick(id);
      adjustCount(prio, +1); // revert the count delta too
      console.warn(`[feed] failed to mark ${id} read; reverted`);
    }
  }

  /**
   * Undo a read for this user (mirror of markRead). Optimistic: flip to unread locally
   * (the row moves back to "Needs action"), then persist the delete; revert on failure.
   * No-op if unknown or already unread.
   */
  async function markUnread(id: string): Promise<void> {
    const target = items.value.find((n) => n.id === id);
    if (!target || !target.read) return;
    const prio = target.priority;
    const wasSticky = readThisSession.value.has(id);
    setRead(id, false);
    unstick(id);
    adjustCount(prio, +1); // optimistic: one more unread of this priority
    try {
      await deps.transport.del(`/notifications/${encodeURIComponent(id)}/read`);
    } catch {
      setRead(id, true); // revert — the server didn't clear it
      if (wasSticky) stick(id); // restore its in-place (sticky) position too — a true inverse
      adjustCount(prio, -1); // revert the count delta too
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

  function togglePriority(p: NotificationPriority): void {
    toggleInSet(priorities, p);
  }
  function toggleModule(m: string): void {
    toggleInSet(modules, m);
  }
  function toggleUnreadOnly(): void {
    unreadOnly.value = !unreadOnly.value;
  }
  function clearFilters(): void {
    priorities.value = new Set();
    modules.value = new Set();
    unreadOnly.value = false;
    query.value = ""; // the search query is a filter too — "Clear filters" clears it
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
    counts,
    // filters
    query,
    priorities,
    modules,
    unreadOnly,
    availableModules,
    activeFilterCount,
    isFiltered,
    appliedPills,
    // derived
    visibleItems,
    groups,
    // actions
    load,
    loadMore,
    setSort,
    fetchCounts,
    reset,
    connect,
    disconnect,
    markRead,
    markUnread,
    flushSessionReads,
    markAllReadInScope,
    onLiveCritical,
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
