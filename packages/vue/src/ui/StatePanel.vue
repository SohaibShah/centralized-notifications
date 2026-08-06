<script setup lang="ts">
import Icon from "./Icon.vue";
import { useUi } from "../theming/useUi";

// Shared empty/error state (loading uses skeletons instead). Copy is specific and in
// the interface's voice — never "No data" / "Something went wrong" (design-system).
// `icon` is an icon-registry NAME (host-overridable via <NotificationProvider :icons>).
const parts = {
  root: "flex flex-col items-center justify-center gap-2 px-6 py-16 text-center",
  icon: "text-faint",
  title: "font-display text-[16px] text-text",
  description: "max-w-[44ch] text-[13px] leading-relaxed text-muted",
} as const;
const props = defineProps<{
  icon?: string;
  title: string;
  description?: string;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const ui = useUi("state-panel", parts, () => props.ui);
</script>

<template>
  <div :class="ui('root')">
    <Icon v-if="icon" :name="icon" :size="22" :class="ui('icon')" />
    <p :class="ui('title')">{{ title }}</p>
    <p v-if="description" :class="ui('description')">{{ description }}</p>
    <div class="mt-2"><slot /></div>
  </div>
</template>
