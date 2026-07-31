<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, Inbox, RotateCw, SearchX, Sparkles, WifiOff } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Button from "../../ui/Button.vue";
import Chip from "../../ui/Chip.vue";
import Icon from "../../ui/Icon.vue";
import Skeleton from "../../ui/Skeleton.vue";
import StatePanel from "../../ui/StatePanel.vue";
import { useFeed } from "../../provider/context";
import { useSettings } from "../../provider/context";
import { useSummary } from "../../provider/context";
import { useActions } from "../../provider/context";
import { relativeTime, exactTime } from "../../lib/time";
import FeedList from "../components/FeedList.vue";

const feed = useFeed();
const settings = useSettings();
const summary = useSummary();
const aiOpen = ref(false);

// One-shot "bloom" on the AI summary glow on each click. Bumping the counter re-keys the glow
// element so the CSS `ai-bloom` animation restarts every time (even mid-flight); it stays 0 on
// first render so the card doesn't bloom unprompted. Under reduced motion the animation is a
// no-op and the glow just holds its rest opacity.
const bloomCount = ref(0);
function toggleSummary(): void {
  aiOpen.value = !aiOpen.value;
  bloomCount.value++;
  // Open shows the STORED summary (pre-generated on schedule) — fetch it once, don't regenerate.
  // Regeneration only happens on the daily job or an explicit reload.
  if (aiOpen.value && summary.status === "idle") void summary.fetchStored();
}

// Empty vs filtered-empty are different states with different remedies.
const isEmpty = computed(() => feed.status === "ready" && feed.items.length === 0);
const isFilteredEmpty = computed(
  () => feed.status === "ready" && feed.items.length > 0 && feed.groups.length === 0,
);

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
        <div
          v-if="summary.status === 'loading'"
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
            class="font-medium text-ai underline disabled:opacity-50"
            :disabled="summary.refreshing"
            @click="summary.refresh()"
          >
            Generate now
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
