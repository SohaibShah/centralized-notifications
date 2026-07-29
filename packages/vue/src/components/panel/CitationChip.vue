<script setup lang="ts">
import { ref } from "vue";
import type { ChatSource } from "@notifications/shared";
import { formatRelativeAge } from "@notifications/shared";
import { actionIcon } from "../../design/icons";
import Icon from "../../ui/Icon.vue";
import Spinner from "../../ui/Spinner.vue";
import { useActions } from "../../provider/context";

const props = defineProps<{ source: ChatSource }>();
const open = ref(false);
const { runAction, isPending, isLocked, resultFor } = useActions();

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
        <span
          v-for="(action, i) in props.source.actions"
          :key="action.label + '-' + i"
          class="inline-flex flex-col items-start gap-1"
        >
          <button
            type="button"
            data-test="chip-action"
            class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 font-medium text-text transition-colors duration-100 hover:bg-sunken disabled:pointer-events-none disabled:opacity-50"
            :disabled="action.kind === 'dispatch' && isLocked(props.source.id)"
            :aria-busy="
              action.kind === 'dispatch' && isPending(props.source.id, i) ? 'true' : undefined
            "
            @click="runAction(action, { id: props.source.id, ref: i })"
          >
            <Spinner
              v-if="action.kind === 'dispatch' && isPending(props.source.id, i)"
              :size="13"
            />
            <Icon v-else-if="actionIcon(action.icon)" :icon="actionIcon(action.icon)!" :size="13" />
            {{ action.label }}
          </button>
          <span
            v-if="action.kind === 'dispatch' && resultFor(props.source.id, i)"
            data-test="chip-action-result"
            class="text-[12px]"
            :class="resultFor(props.source.id, i)?.ok ? 'text-success-strong' : 'text-danger'"
          >
            {{ resultFor(props.source.id, i)?.message }}
          </span>
        </span>
      </span>
    </span>
  </span>
</template>
