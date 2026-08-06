<script setup lang="ts">
import { useUi } from "../theming/useUi";

// Loading placeholder. Size it with a `class` (e.g. `h-4 w-40`) at the call site so it
// matches the shape of the real content it stands in for.
const parts = { root: "animate-pulse rounded-sm bg-sunken" } as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("skeleton", parts, () => props.ui);
</script>

<template>
  <div :class="ui('root')" aria-hidden="true" />
</template>
