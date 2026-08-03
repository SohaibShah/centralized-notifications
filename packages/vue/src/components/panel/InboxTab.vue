<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BellOff,
  ChevronDown,
  Inbox,
  Layers,
  RotateCw,
  SearchX,
  Sparkles,
  WifiOff,
} from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Button from "../../ui/Button.vue";
import Chip from "../../ui/Chip.vue";
import Icon from "../../ui/Icon.vue";
import Skeleton from "../../ui/Skeleton.vue";
import StatePanel from "../../ui/StatePanel.vue";
import { useFeed } from "../../provider/context";
import { useSettings } from "../../provider/context";
import { useSummary } from "../../provider/context";
import { usePreferences } from "../../provider/context";
import { useActions } from "../../provider/context";
import { useTransport } from "../../provider/context";
import { relativeTime, exactTime } from "../../lib/time";
import FeedList from "../components/FeedList.vue";
import StackList from "../components/StackList.vue";
import FeedBanner from "./FeedBanner.vue";

const feed = useFeed();
const settings = useSettings();
const summary = useSummary();
const preferences = usePreferences();
const aiOpen = ref(false);

// The user's personal opt-out (distinct from the admin-global aiSummaryEnabled kill-switch). Reactive
// so re-enabling here — or toggling it on the settings page — updates the panel with no reload.
const summaryOptedOut = computed(() => preferences.prefs.summaryOptOut);

// Re-enable the summary from the panel, then fetch it so the digest appears immediately.
const enabling = ref(false);
async function enableSummary(): Promise<void> {
  if (enabling.value) return;
  enabling.value = true;
  try {
    await preferences.updatePref({ summaryOptOut: false });
    await summary.fetchStored();
  } finally {
    enabling.value = false;
  }
}

// One-shot "bloom" on the AI summary glow on each click. Bumping the counter re-keys the glow
// element so the CSS `ai-bloom` animation restarts every time (even mid-flight); it stays 0 on
// first render so the card doesn't bloom unprompted. Under reduced motion the animation is a
// no-op and the glow just holds its rest opacity.
const bloomCount = ref(0);
function toggleSummary(): void {
  aiOpen.value = !aiOpen.value;
  bloomCount.value++;
  // Open shows the STORED summary (pre-generated on schedule) — fetch it once, don't regenerate.
  // Regeneration only happens on the daily job or an explicit reload. Skip when the user has opted
  // out (the detail shows the re-enable prompt instead).
  if (aiOpen.value && !summaryOptedOut.value && summary.status === "idle")
    void summary.fetchStored();
}

// Empty vs filtered-empty vs muted-empty are different states with different remedies. The
// "all caught up" empty only applies to the active feed — an empty muted view means nothing is
// currently muted, which is its own state.
const isMutedView = computed(() => feed.view === "muted");

// --- grouping -------------------------------------------------------------
const transport = useTransport();
// Grouping is available when the admin flag AND the user preference are on, and no filter/search or
// muted view is narrowing the feed (those force the flat list — a scope decision, see the spec).
const groupingOn = computed(
  () =>
    settings.flags.groupingEnabled &&
    preferences.prefs.groupingEnabled &&
    !feed.isFiltered &&
    feed.view === "active",
);
// Show collapsed stacks only when grouping is on AND we're not drilled into a single group ("See all").
const showStacks = computed(() => groupingOn.value && feed.activeGroup === null);

// Drive the data source: entering the stacks view loads the collapsed feed; leaving it for a filtered/
// muted flat list refetches flat. A drill-in (enterGroup) loads its own members, and exitGroup flips
// activeGroup back to null which re-enters the stacks view here. Also keep the store's SSE flag synced.
watch(
  showStacks,
  (on, prev) => {
    feed.grouped = on;
    if (on) {
      void feed.loadGrouped();
    } else if (
      feed.view === "active" &&
      feed.activeGroup === null &&
      (prev || feed.items.length === 0)
    ) {
      // Load the flat ACTIVE feed when leaving stacks for it — both on a live toggle (prev) and on a
      // fresh mount where grouping is off but the flat list was never populated (e.g. after grouped
      // mode). The muted view manages its own load via setView, so it's excluded here.
      void feed.load();
    }
  },
  { immediate: true },
);

const isEmpty = computed(
  () =>
    feed.view === "active" &&
    feed.activeGroup === null &&
    feed.status === "ready" &&
    (showStacks.value ? feed.groupedEntries.length === 0 : feed.items.length === 0),
);
const isMutedEmpty = computed(
  () => feed.view === "muted" && feed.status === "ready" && feed.items.length === 0,
);
const isFilteredEmpty = computed(
  () => feed.status === "ready" && feed.items.length > 0 && feed.groups.length === 0,
);

// Toggle the panel between the normal feed and the muted view (what the user's snooze/mute rules
// are hiding). setView refetches the appropriate slice.
function toggleMutedView(): void {
  void feed.setView(isMutedView.value ? "active" : "muted");
}

// The action path is shared with the AI chat via useNotificationActions ("link" opens the url;
// "dispatch" is the server-side proxy stub; either marks the notification read).
const { runAction } = useActions();
async function onAction(
  action: NotificationAction,
  notification: FeedNotification,
  index: number,
): Promise<void> {
  await runAction(action, { id: notification.id, ref: index });
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- AI summary — static/canned this pass; chevron expands the fuller digest.
         Hidden entirely when an admin disables the AI-summary feature (global kill-switch). -->
    <div
      v-if="settings.flags.aiSummaryEnabled"
      class="ai-gradient-border group relative mx-3 mt-3 shrink-0 overflow-hidden rounded-lg"
    >
      <span
        :key="bloomCount"
        data-test="ai-glow"
        aria-hidden="true"
        class="ai-glow pointer-events-none"
        :class="{ 'is-blooming': bloomCount > 0 }"
      />
      <button
        type="button"
        class="relative z-10 flex w-full items-center gap-1.5 rounded-lg px-3 py-2.5 text-left"
        :aria-expanded="aiOpen"
        aria-controls="ai-summary-detail"
        @click="toggleSummary"
      >
        <Icon :icon="Sparkles" :size="13" class="text-ai-2" />
        <span
          data-test="ai-summary-label"
          class="font-mono text-[11px] font-semibold uppercase tracking-wide text-ai"
          >AI summary</span
        >
        <Icon
          :icon="ChevronDown"
          :size="14"
          class="ml-auto text-faint transition-transform"
          :class="{ 'rotate-180': aiOpen }"
        />
      </button>
      <div
        v-if="aiOpen"
        id="ai-summary-detail"
        class="relative z-10 px-3 pb-2.5 text-[12px] leading-relaxed text-muted"
      >
        <p v-if="summaryOptedOut" data-test="ai-summary-optedout" class="text-muted">
          You've turned off your AI summary.
          <button
            type="button"
            data-test="ai-summary-enable"
            class="font-medium text-ai underline disabled:opacity-50"
            :disabled="enabling"
            @click="enableSummary"
          >
            Turn it back on
          </button>
        </p>

        <div
          v-else-if="summary.status === 'loading'"
          data-test="ai-summary-loading"
          class="flex items-center gap-1.5 text-ai motion-safe:animate-pulse"
        >
          <Icon :icon="Sparkles" :size="13" />
          <span class="font-medium">Loading your summary…</span>
        </div>

        <div v-else-if="summary.status === 'ready'" class="flex flex-col gap-1.5">
          <p v-if="summary.basedOn > 0" data-test="ai-summary-text">{{ summary.summary }}</p>
          <p v-else data-test="ai-summary-caughtup" class="text-muted">You're all caught up.</p>
          <div class="flex items-center gap-2 text-[11px] text-faint">
            <time
              v-if="summary.generatedAt"
              data-test="ai-summary-timestamp"
              :datetime="summary.generatedAt"
              :title="exactTime(summary.generatedAt)"
              class="font-mono tabular-nums"
            >
              Generated {{ relativeTime(summary.generatedAt) }}
            </time>
            <button
              type="button"
              data-test="ai-summary-reload"
              class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-ai transition-colors hover:bg-sunken disabled:opacity-50"
              :disabled="summary.refreshing"
              :aria-busy="summary.refreshing ? 'true' : undefined"
              @click="summary.refresh()"
            >
              <Icon
                :icon="RotateCw"
                :size="12"
                :class="{ 'motion-safe:animate-spin': summary.refreshing }"
              />
              Reload
            </button>
          </div>
        </div>

        <p v-else-if="summary.status === 'empty'" data-test="ai-summary-empty" class="text-muted">
          No summary yet — the daily summary runs at {{ settings.summaryTime }}.
          <button
            type="button"
            data-test="ai-summary-reload"
            class="inline-flex items-center gap-1 font-medium text-ai underline disabled:opacity-50"
            :disabled="summary.refreshing"
            :aria-busy="summary.refreshing ? 'true' : undefined"
            @click="summary.refresh()"
          >
            <Icon
              v-if="summary.refreshing"
              :icon="RotateCw"
              :size="12"
              class="motion-safe:animate-spin"
            />
            {{ summary.refreshing ? "Generating…" : "Generate now" }}
          </button>
        </p>

        <p v-else-if="summary.status === 'error'" data-test="ai-summary-error" class="text-danger">
          Couldn't load the summary — is the local model running?
          <button
            type="button"
            data-test="ai-summary-retry"
            class="underline"
            @click="summary.refresh()"
          >
            Retry
          </button>
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
      <Chip :active="!feed.isFiltered" @click="feed.clearFilters()">All</Chip>
      <Chip :active="feed.unreadOnly" @click="feed.toggleUnreadOnly()">
        Unread
        <span
          v-if="feed.counts.unread > 0"
          data-test="chip-count-unread"
          class="ml-1 font-mono text-[11px] tabular-nums"
          >{{ feed.counts.unread }}</span
        >
      </Chip>
      <Chip :active="feed.priorities.has('critical')" @click="feed.togglePriority('critical')">
        Critical
        <span
          v-if="feed.counts.unreadByPriority.critical > 0"
          data-test="chip-count-critical"
          class="ml-1 font-mono text-[11px] tabular-nums"
          >{{ feed.counts.unreadByPriority.critical }}</span
        >
      </Chip>
      <Chip :active="feed.priorities.has('high')" @click="feed.togglePriority('high')">
        High
        <span
          v-if="feed.counts.unreadByPriority.high > 0"
          data-test="chip-count-high"
          class="ml-1 font-mono text-[11px] tabular-nums"
          >{{ feed.counts.unreadByPriority.high }}</span
        >
      </Chip>

      <!-- Low-emphasis toggle into the muted view (what your snooze/mute rules are hiding). Pushed
           to the far right; highlighted while active. -->
      <button
        type="button"
        data-test="muted-view-toggle"
        class="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        :class="isMutedView ? 'bg-sunken text-text' : 'text-faint hover:bg-sunken hover:text-muted'"
        :aria-pressed="isMutedView"
        :title="isMutedView ? 'Hide muted notifications' : 'Show muted notifications'"
        :aria-label="isMutedView ? 'Hide muted notifications' : 'Show muted notifications'"
        @click="toggleMutedView"
      >
        <Icon :icon="BellOff" :size="15" />
      </button>
    </div>

    <!-- Mode banner: makes it unambiguous the feed body is now showing muted items, not the feed. -->
    <FeedBanner
      v-if="isMutedView"
      data-test="muted-view-banner"
      :icon="BellOff"
      label="Snoozed & muted notifications"
    />

    <!-- "See all" drill-in: shows one group's members with a one-click exit back to the stacks. -->
    <FeedBanner
      v-else-if="feed.activeGroup !== null"
      data-test="group-view-banner"
      :icon="Layers"
      :label="feed.activeGroupLabel || 'Group'"
      exit-label="Exit group"
      @exit="feed.exitGroup()"
    />

    <!-- Body: loading / error / empty / filtered-empty / populated -->
    <div class="flex min-h-0 flex-1 flex-col">
      <div v-if="feed.status === 'loading'" class="px-3 py-2" aria-hidden="true">
        <div v-for="i in 5" :key="i" class="flex gap-3 border-b border-line py-3">
          <Skeleton class="mt-1 size-2 rounded-full" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-4/5" />
          </div>
        </div>
      </div>

      <StatePanel
        v-else-if="feed.status === 'error'"
        :icon="WifiOff"
        title="Couldn't load your notifications"
        :description="feed.error ?? 'Check your connection and try again.'"
      >
        <Button variant="secondary" size="sm" @click="showStacks ? feed.loadGrouped() : feed.load()"
          >Try again</Button
        >
      </StatePanel>

      <StatePanel
        v-else-if="isEmpty"
        :icon="Inbox"
        title="You're all caught up"
        description="New notifications from your modules will appear here as they arrive — live."
      />

      <StatePanel
        v-else-if="isMutedEmpty"
        :icon="BellOff"
        title="Nothing muted"
        description="Notifications you've snoozed or muted will appear here. Manage your rules in Settings."
      />

      <StatePanel
        v-else-if="isFilteredEmpty"
        :icon="SearchX"
        title="No notifications match your filters"
        description="Try removing a filter or clearing your search."
      >
        <Button variant="secondary" size="sm" @click="feed.clearFilters()">Clear filters</Button>
      </StatePanel>

      <!-- Grouped stacks (grouping on, not drilled into a group). -->
      <StackList
        v-else-if="showStacks"
        :entries="feed.groupedEntries"
        :unread="feed.counts.unread"
        :has-more="feed.hasMoreGrouped"
        :loading-more="feed.loadingGrouped"
        :transport="transport"
        @load-more="feed.loadMoreGrouped()"
        @open="(n) => feed.markRead(n.id)"
        @action="onAction"
        @unread="(n) => feed.markUnread(n.id)"
        @mark-all-read="(key) => feed.markAllReadInGroup(key)"
        @see-all="(key, label) => feed.enterGroup(key, label)"
      />

      <!-- Flat feed: the ungrouped case, and the "See all" drill-in (one group's members). -->
      <FeedList
        v-else
        :groups="feed.groups"
        :unread="feed.counts.unread"
        :has-more="feed.hasMore"
        :loading-more="feed.loadingMore"
        @load-more="feed.loadMore()"
        @open="(n) => feed.markRead(n.id)"
        @action="onAction"
        @unread="(n) => feed.markUnread(n.id)"
        @mark-all="feed.markAllReadInScope()"
      />
    </div>
  </div>
</template>
