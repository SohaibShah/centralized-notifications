<script setup lang="ts">
import { computed } from "vue";
import { cn } from "../lib/cn";
import { useComponentUi } from "../theming/useUi";

// Quick filter preset. `active` reflects both styling and aria-pressed.
const props = defineProps<{ active?: boolean; ui?: { root?: string } }>();
// Precedence: base+active  ←  provider ui.chip.root  ←  instance ui.root (last wins via cn).
const globalUi = useComponentUi("chip");
const classes = computed(() =>
  cn(
    "rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
    props.active ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-text",
    globalUi("root"),
    props.ui?.root,
  ),
);
</script>

<template>
  <button type="button" :aria-pressed="active" :class="classes">
    <slot />
  </button>
</template>
