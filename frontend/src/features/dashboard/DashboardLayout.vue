<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useFeedStore } from "@/stores/feed";
import DashboardSidebar from "./components/DashboardSidebar.vue";
import DashboardTopBar from "./components/DashboardTopBar.vue";

// The shell owns the feed lifecycle now (not the feed view): SSE connects on entry so the
// topbar bell's unread badge is live even while the panel is closed. reset() clears any
// prior user's feed; connect() subscribes before load() so a burst mid-load isn't lost.
const feed = useFeedStore();
onMounted(() => {
  feed.reset();
  feed.connect();
  void feed.load();
});
onBeforeUnmount(() => feed.disconnect());
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <DashboardSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <DashboardTopBar />
      <main class="min-h-0 flex-1 overflow-y-auto bg-bg">
        <RouterView />
      </main>
    </div>
  </div>
</template>
