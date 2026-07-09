import { computed, ref, shallowRef, type Ref } from "vue";
import { defineStore } from "pinia";
import type {
  FeedNotification,
  Notification,
  NotificationPage,
  NotificationPriority,
} from "@notifications/shared";
import { api } from "@/api/client";
import { connectSse, type SseClient, type SseStatus } from "@/api/sse";
import { priorityRank } from "@/design/tokens";

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
export const useFeedStore = defineStore("feed", () => {
  // --- history + connection -------------------------------------------------
  const items = shallowRef<FeedNotification[]>([]);
  const seen = new Set<string>(); // id set backing O(1) dedupe across load + live
  const status = ref<"idle" | "loading" | "ready" | "error">("idle");
  const error = ref<string | null>(null);
  const loadingMore = ref(false);
  const nextCursor = ref<string | null>(null);
  const connection = ref<SseStatus>("closed");
  let sse: SseClient | null = null;

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
  }

  /**
   * Load the newest page. Deliberately *merges* (addBack de-dupes on `seen`) rather than
   * resetting: `connect()` runs before `load()`, so a live burst can arrive while this
   * fetch is in flight — clearing here would drop it. Call `reset()` first for a clean
   * slate (login). Older, already-loaded pages are preserved.
   */
  async function load(): Promise<void> {
    status.value = "loading";
    error.value = null;
    try {
      const page = await api.get<NotificationPage>(`/notifications?limit=${PAGE_SIZE}`);
      addBack(page.items);
      nextCursor.value = page.nextCursor;
      status.value = "ready";
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
      const page = await api.get<NotificationPage>(
        `/notifications?limit=${PAGE_SIZE}&cursor=${cursor}`,
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

  /** Handle one coalesced SSE burst: prepend the genuinely-new notifications. */
  function onLiveBatch(batch: Notification[]): void {
    addFront(batch.map(toFeed));
  }

  function connect(): void {
    if (sse) return;
    sse = connectSse({
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
   * Mark one notification read for this user (FR-6). Optimistic: flip the flag locally
   * first (instant feedback, moves the row to "Earlier"), then persist; revert on
   * failure. No-op if it's unknown or already read, so a re-click costs nothing.
   */
  async function markRead(id: string): Promise<void> {
    const target = items.value.find((n) => n.id === id);
    if (!target || target.read) return;
    setRead(id, true);
    try {
      await api.post(`/notifications/${encodeURIComponent(id)}/read`);
    } catch {
      setRead(id, false); // revert — the server didn't record it
      console.warn(`[feed] failed to mark ${id} read; reverted`);
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

  const unreadCount = computed(() => items.value.reduce((n, x) => n + (x.read ? 0 : 1), 0));

  /**
   * Split the visible feed into "Needs action" (unread) and "Earlier" (read). Unread
   * is ordered by urgency then recency so a live critical rises to the top; read stays
   * in load order (newest-first). Empty groups are omitted.
   */
  const groups = computed<FeedGroup[]>(() => {
    const needsAction: FeedNotification[] = [];
    const earlier: FeedNotification[] = [];
    for (const n of visibleItems.value) (n.read ? earlier : needsAction).push(n);
    needsAction.sort(
      (a, b) =>
        priorityRank[a.priority] - priorityRank[b.priority] || cmpDesc(a.createdAt, b.createdAt),
    );
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

  return {
    // state
    items,
    status,
    error,
    loadingMore,
    nextCursor,
    connection,
    hasMore,
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
    unreadCount,
    groups,
    // actions
    load,
    loadMore,
    reset,
    connect,
    disconnect,
    markRead,
    togglePriority,
    toggleModule,
    toggleUnreadOnly,
    clearFilters,
    removePill,
  };
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ISO-string comparison, newest first (lexical order works for ISO 8601 UTC). */
function cmpDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}
