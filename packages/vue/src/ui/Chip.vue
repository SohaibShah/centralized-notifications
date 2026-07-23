<script setup lang="ts">
import { computed } from "vue";
import { cn } from "../lib/cn";

// Quick filter preset. `active` reflects both styling and aria-pressed.
const props = defineProps<{ active?: boolean }>();
const classes = computed(() =>
  cn(
    "rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-100 ease-out",
    props.active ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-text",
  ),
);
</script>

<template>
  <button type="button" :aria-pressed="active" :class="classes">
    <slot />
  </button>
</template>
