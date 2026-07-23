<script setup lang="ts">
import { ref } from "vue";
import type { ChatSource } from "@notifications/shared";
import { formatRelativeAge } from "@notifications/shared";
import { actionIcon } from "@/design/icons";
import Icon from "@/components/ui/Icon.vue";
import { useNotificationActions } from "@/composables/useNotificationActions";

const props = defineProps<{ source: ChatSource }>();
const open = ref(false);
const { runAction } = useNotificationActions();

// Priority → dot color, mirroring the notification card's convention.
const dotClass: Record<ChatSource["priority"], string> = {
  critical: "bg-danger",
  high: "bg-warning",
  normal: "bg-muted",
  low: "ring-1 ring-line-strong",
};
</script>

<template>
  <span class="inline-flex flex-col align-baseline">
    <button
      type="button"
      data-test="chip-toggle"
      class="ai-bubble-border inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-text hover:bg-sunken"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="size-1.5 rounded-full" :class="dotClass[props.source.priority]" />
      {{ props.source.title }}
    </button>

    <span
      v-if="open"
      class="mt-1 flex flex-col gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2 text-[12px]"
    >
      <span class="text-muted"
        >{{ props.source.priority }} · {{ formatRelativeAge(props.source.ageMinutes) }} old</span
      >
      <span v-if="props.source.actions.length" class="flex flex-wrap gap-2">
        <button
          v-for="action in props.source.actions"
          :key="action.label + action.url"
          type="button"
          data-test="chip-action"
          class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 font-medium text-text hover:bg-sunken"
          @click="runAction(action, { id: props.source.id })"
        >
          <Icon v-if="actionIcon(action.icon)" :icon="actionIcon(action.icon)!" :size="13" />
          {{ action.label }}
        </button>
      </span>
    </span>
  </span>
</template>
