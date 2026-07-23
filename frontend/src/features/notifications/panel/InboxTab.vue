<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { ChevronDown, Inbox, SearchX, Sparkles, WifiOff } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Button from "@/components/ui/Button.vue";
import Chip from "@/components/ui/Chip.vue";
import Icon from "@/components/ui/Icon.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import StatePanel from "@/components/ui/StatePanel.vue";
import { useFeedStore } from "@/stores/feed";
import { useSettingsStore } from "@/stores/settings";
import { useSummaryStore } from "@/stores/summary";
import FeedList from "../components/FeedList.vue";

const feed = useFeedStore();
const settings = useSettingsStore();
const summary = useSummaryStore();
const aiOpen = ref(false);

// One-shot "bloom" on the AI summary glow on each click. Bumping the counter re-keys the glow
// element so the CSS `ai-bloom` animation restarts every time (even mid-flight); it stays 0 on
// first render so the card doesn't bloom unprompted. Under reduced motion the animation is a
// no-op and the glow just holds its rest opacity.
const bloomCount = ref(0);
function toggleSummary(): void {
  aiOpen.value = !aiOpen.value;
  bloomCount.value++;
  // Refetch fresh on every open so the digest reflects the CURRENT unread set (the server's
  // signature cache returns instantly when nothing changed, so this is cheap).
  if (aiOpen.value) void summary.fetchSummary(true);
}

// While the disclosure is open, keep it fresh as the unread set changes (new arrivals, reads).
// Debounced so a burst of changes collapses into one refresh and can't spam the model.
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => feed.counts.unread,
  () => {
    if (!aiOpen.value) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void summary.fetchSummary(true), 1000);
  },
);
onUnmounted(() => clearTimeout(refreshTimer));

// Empty vs filtered-empty are different states with different remedies.
const isEmpty = computed(() => feed.status === "ready" && feed.items.length === 0);
const isFilteredEmpty = computed(
  () => feed.status === "ready" && feed.items.length > 0 && feed.groups.length === 0,
);

// A module action's `kind` (not its HTTP method) decides UI behavior. "link" opens the url in a
// new tab; "dispatch" will run through a server-side action proxy (a later cycle) — stubbed now.
// Firing any action also marks the notification read.
function onAction(action: NotificationAction, notification: FeedNotification) {
  feed.markRead(notification.id);
  if (action.kind === "dispatch") {
    console.info(`[actions] "${action.label}" (dispatch) — coming soon`);
  } else {
    // "link" — or a legacy action persisted before `kind` existed (treated as link). Never
    // leave a link doing nothing.
    window.open(action.url, "_blank", "noopener,noreferrer");
  }
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
        <div
          v-if="summary.status === 'loading'"
          data-test="ai-summary-loading"
          class="flex items-center gap-1.5 text-ai motion-safe:animate-pulse"
        >
          <Icon :icon="Sparkles" :size="13" />
          <span class="font-medium">Summarizing your inbox…</span>
        </div>
        <p v-else-if="summary.status === 'ready'" data-test="ai-summary-text">{{ summary.text }}</p>
        <p
          v-else-if="summary.status === 'error'"
          data-test="ai-summary-error"
          class="text-danger-ink"
        >
          Couldn't generate a summary — is the local model running?
          <button
            type="button"
            data-test="ai-summary-retry"
            class="underline"
            @click="summary.fetchSummary(true)"
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
    </div>

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
        <Button variant="secondary" size="sm" @click="feed.load()">Try again</Button>
      </StatePanel>

      <StatePanel
        v-else-if="isEmpty"
        :icon="Inbox"
        title="You're all caught up"
        description="New notifications from your modules will appear here as they arrive — live."
      />

      <StatePanel
        v-else-if="isFilteredEmpty"
        :icon="SearchX"
        title="No notifications match your filters"
        description="Try removing a filter or clearing your search."
      >
        <Button variant="secondary" size="sm" @click="feed.clearFilters()">Clear filters</Button>
      </StatePanel>

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
