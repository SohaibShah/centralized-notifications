<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useFeed, useToast, useSettings } from "@notifications/vue";

// Host-owned lifecycle for the notification feed, run INSIDE <NotificationProvider> so the injected
// state is available. SSE connects on entry so the topbar bell's unread badge is live even while the
// panel is closed; reset() clears any prior user's feed; connect() subscribes before load() so a burst
// mid-load isn't lost. Feature flags gate UI (fire-and-forget — flags default on).
const feed = useFeed();
const toast = useToast();
const settings = useSettings();

onMounted(() => {
  feed.reset();
  toast.reset();
  feed.connect();
  void feed.load();
  void settings.load();
});
onBeforeUnmount(() => feed.disconnect());
</script>

<template>
  <slot />
</template>
