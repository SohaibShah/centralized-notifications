<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { Inbox, SearchX, WifiOff } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Button from "@/components/ui/Button.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import StatePanel from "@/components/ui/StatePanel.vue";
import { useFeedStore } from "@/stores/feed";
import AppSidebar from "./components/AppSidebar.vue";
import FeedList from "./components/FeedList.vue";
import TopBar from "./components/TopBar.vue";

const feed = useFeedStore();

// Empty vs filtered-empty are different states with different remedies: nothing has
// arrived yet, versus the active filters hid everything that has.
const isEmpty = computed(() => feed.status === "ready" && feed.items.length === 0);
const isFilteredEmpty = computed(
  () => feed.status === "ready" && feed.items.length > 0 && feed.groups.length === 0,
);

onMounted(() => {
  // Order matters: reset clears any prior user's feed, connect subscribes to live
  // delivery *before* the initial fetch, and load() merges (rather than clobbers) so a
  // burst arriving mid-load isn't lost.
  feed.reset();
  feed.connect();
  void feed.load();
});

onBeforeUnmount(() => feed.disconnect());

// Week-1: a module action is a module-owned callback. A GET action is safe to open
// directly; other methods need the authenticated action-dispatch proxy that lands in
// Week 4, so for now they're surfaced but not fired.
function onAction(action: NotificationAction, _notification: FeedNotification) {
  if (action.method === "GET") {
    window.open(action.url, "_blank", "noopener,noreferrer");
  } else {
    // TODO(week-4): dispatch mutating actions through the authenticated callback proxy.
    console.info(`[actions] "${action.label}" (${action.method}) will dispatch in Week 4`);
  }
}
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar />

      <main class="relative z-0 min-h-0 flex-1">
        <!-- Loading: skeletons shaped like the real rows. -->
        <div v-if="feed.status === 'loading'" class="px-4 py-3" aria-hidden="true">
          <div v-for="i in 6" :key="i" class="flex gap-3 border-b border-line py-3.5">
            <Skeleton class="mt-1 size-2 rounded-full" />
            <div class="flex-1 space-y-2">
              <Skeleton class="h-3.5 w-2/5" />
              <Skeleton class="h-3 w-4/5" />
              <Skeleton class="h-2.5 w-24" />
            </div>
          </div>
        </div>

        <!-- Error: what happened + how to recover, in the interface's voice. -->
        <StatePanel
          v-else-if="feed.status === 'error'"
          :icon="WifiOff"
          title="Couldn't load your notifications"
          :description="feed.error ?? 'Check your connection and try again.'"
        >
          <Button variant="secondary" size="sm" @click="feed.load()">Try again</Button>
        </StatePanel>

        <!-- Empty: nothing has arrived yet. -->
        <StatePanel
          v-else-if="isEmpty"
          :icon="Inbox"
          title="You're all caught up"
          description="New notifications from your modules will appear here as they arrive — live."
        />

        <!-- Filtered-empty: filters hid everything. -->
        <StatePanel
          v-else-if="isFilteredEmpty"
          :icon="SearchX"
          title="No notifications match your filters"
          description="Try removing a filter or clearing your search."
        >
          <Button variant="secondary" size="sm" @click="feed.clearFilters()">Clear filters</Button>
        </StatePanel>

        <!-- Populated feed. -->
        <FeedList
          v-else
          :groups="feed.groups"
          :has-more="feed.hasMore"
          :loading-more="feed.loadingMore"
          @load-more="feed.loadMore()"
          @action="onAction"
        />
      </main>
    </div>
  </div>
</template>
