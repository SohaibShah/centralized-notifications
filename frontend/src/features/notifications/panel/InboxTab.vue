<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, Inbox, SearchX, Sparkles, WifiOff } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Button from "@/components/ui/Button.vue";
import Chip from "@/components/ui/Chip.vue";
import Icon from "@/components/ui/Icon.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import StatePanel from "@/components/ui/StatePanel.vue";
import { useFeedStore } from "@/stores/feed";
import { useSettingsStore } from "@/stores/settings";
import FeedList from "../components/FeedList.vue";

const feed = useFeedStore();
const settings = useSettingsStore();
const aiOpen = ref(false);

// Empty vs filtered-empty are different states with different remedies.
const isEmpty = computed(() => feed.status === "ready" && feed.items.length === 0);
const isFilteredEmpty = computed(
  () => feed.status === "ready" && feed.items.length > 0 && feed.groups.length === 0,
);

// A module action is a module-owned callback. GET is safe to open directly; other methods
// need the authenticated action-dispatch proxy (Week 4), so they're surfaced but not fired.
// Firing any action also marks the notification read.
function onAction(action: NotificationAction, notification: FeedNotification) {
  feed.markRead(notification.id);
  if (action.method === "GET") {
    window.open(action.url, "_blank", "noopener,noreferrer");
  } else {
    console.info(`[actions] "${action.label}" (${action.method}) will dispatch in Week 4`);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- AI summary — static/canned this pass; chevron expands the fuller digest.
         Hidden entirely when an admin disables the AI-summary feature (global kill-switch). -->
    <div
      v-if="settings.flags.aiSummaryEnabled"
      class="m-3 rounded-lg border border-accent/20 bg-accent/5"
    >
      <button
        type="button"
        class="flex w-full items-center gap-1.5 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-accent/10"
        :aria-expanded="aiOpen"
        aria-controls="ai-summary-detail"
        @click="aiOpen = !aiOpen"
      >
        <Icon :icon="Sparkles" :size="13" class="text-accent" />
        <span class="font-mono text-[11px] uppercase tracking-wide text-accent">AI summary</span>
        <span
          class="ml-1 rounded-full bg-sunken px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-faint"
          >Sample</span
        >
        <Icon
          :icon="ChevronDown"
          :size="14"
          class="ml-auto text-faint transition-transform"
          :class="{ 'rotate-180': aiOpen }"
        />
      </button>
      <p
        v-if="aiOpen"
        id="ai-summary-detail"
        class="px-3 pb-2.5 text-[12px] leading-relaxed text-muted"
      >
        2 need action today — an overdue DSAR and a new tracker finding. 4 lower-priority updates
        since yesterday.
      </p>
    </div>

    <div class="flex items-center gap-1.5 px-3 pb-2">
      <Chip :active="!feed.isFiltered" @click="feed.clearFilters()">All</Chip>
      <Chip :active="feed.unreadOnly" @click="feed.toggleUnreadOnly()">Unread</Chip>
      <Chip :active="feed.priorities.has('critical')" @click="feed.togglePriority('critical')"
        >Critical</Chip
      >
      <Chip :active="feed.priorities.has('high')" @click="feed.togglePriority('high')">High</Chip>
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
        :has-more="feed.hasMore"
        :loading-more="feed.loadingMore"
        @load-more="feed.loadMore()"
        @open="(n) => feed.markRead(n.id)"
        @action="onAction"
        @mark-all="feed.markAllReadInScope()"
      />
    </div>
  </div>
</template>
