<script setup lang="ts">
import type { Component } from "vue";
import Icon from "../../ui/Icon.vue";

// A compact feed-mode banner: an icon + label, optionally a one-click exit. Used by the muted view
// ("Snoozed & muted notifications", no exit) and the "See all" group view (group label + "Exit group").
defineProps<{ icon: Component; label: string; exitLabel?: string }>();
defineEmits<{ exit: [] }>();
</script>

<template>
  <div
    data-test="feed-banner"
    class="flex shrink-0 items-center gap-1.5 px-3 pb-1 text-[11px] text-muted"
  >
    <Icon :icon="icon" :size="12" />
    <span>{{ label }}</span>
    <button
      v-if="exitLabel"
      type="button"
      data-test="feed-banner-exit"
      class="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-muted hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      @click="$emit('exit')"
    >
      ✕ {{ exitLabel }}
    </button>
  </div>
</template>
