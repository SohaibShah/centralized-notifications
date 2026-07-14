<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

// Dashboard chrome. Left: current page title (single h1 per view). Right: the
// notifications bell mounts here in the notifications task. Deliberately thin — the feed's
// search/filters moved into the bell popover, so this bar no longer owns them.
const route = useRoute();
const title = computed(() => (route.name === "settings" ? "Settings" : "Dashboard"));
</script>

<template>
  <header class="flex items-center gap-4 border-b border-line bg-bg/95 px-6 py-4 backdrop-blur">
    <h1 class="font-display text-[18px] font-medium tracking-tight text-text">{{ title }}</h1>
    <div class="ml-auto flex items-center gap-3">
      <!-- NotificationBell mounts here (Task 3) -->
    </div>
  </header>
</template>
