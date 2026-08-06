<script setup lang="ts">
import type { Component } from "vue";
import Icon from "../../ui/Icon.vue";
import { useUi } from "../../theming/useUi";

// A compact feed-mode banner: an icon + label, optionally a one-click exit. Used by the muted view
// ("Snoozed & muted notifications", no exit) and the "See all" group view (group label + "Exit group").
// `icon` accepts a registry NAME (preferred) or a lucide component (legacy).
const parts = {
  root: "flex shrink-0 items-center gap-1.5 px-3 pb-1 text-[11px] text-muted",
  exit: "ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-muted hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
} as const;
const props = defineProps<{
  icon: string | Component;
  label: string;
  exitLabel?: string;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
defineEmits<{ exit: [] }>();
const ui = useUi("feed-banner", parts, () => props.ui);
</script>

<template>
  <div data-test="feed-banner" :class="ui('root')">
    <Icon v-bind="typeof icon === 'string' ? { name: icon } : { icon }" :size="12" />
    <span>{{ label }}</span>
    <button
      v-if="exitLabel"
      type="button"
      data-test="feed-banner-exit"
      :class="ui('exit')"
      @click="$emit('exit')"
    >
      <Icon name="x" :size="11" aria-hidden="true" /> {{ exitLabel }}
    </button>
  </div>
</template>
