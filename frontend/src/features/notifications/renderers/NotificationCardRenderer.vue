<script setup lang="ts">
import { computed } from "vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Icon from "@/components/ui/Icon.vue";
import { actionIcon } from "@/design/icons";
import { priorityDotClass, priorityLabel } from "@/design/tokens";
import { exactTime, relativeTime } from "@/lib/time";

// Config-driven feed row: everything it shows comes from the notification contract
// (priority → dot, title/description, module/category meta, contract `actions` →
// buttons). Adding a field to the contract surfaces here without a new component.
const props = defineProps<{ notification: FeedNotification }>();
const emit = defineEmits<{
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
}>();

const item = computed(() => props.notification);

// Only genuinely-live rows (createdAt ≈ now) get the fade+rise entrance; loaded
// history does not, so the list doesn't shimmer on load. Evaluated once, not reactive.
const isFresh = Date.now() - new Date(props.notification.createdAt).getTime() < 4000;
</script>

<template>
  <article
    class="group flex cursor-pointer gap-3 border-b border-line px-4 py-3.5 transition-colors duration-100 hover:bg-sunken"
    :class="{ 'animate-enter': isFresh }"
    @click="emit('open', item)"
  >
    <span
      role="img"
      :aria-label="`${priorityLabel[item.priority]} priority`"
      class="mt-1.5 size-2 shrink-0 rounded-full"
      :class="priorityDotClass[item.priority]"
    />

    <div class="min-w-0 flex-1">
      <div class="flex items-baseline justify-between gap-3">
        <!-- Title is a button so the "open → mark read" action is keyboard-reachable;
             the h3 keeps heading semantics. The whole card is also click-to-open for
             mouse users (article @click above). -->
        <h3 class="min-w-0 flex-1">
          <button
            type="button"
            class="block w-full truncate text-left font-sans text-[14px]"
            :class="item.read ? 'font-normal text-muted' : 'font-semibold text-text'"
            :title="item.title"
            @click.stop="emit('open', item)"
          >
            {{ item.title }}
          </button>
        </h3>
        <time
          class="shrink-0 font-mono text-[12px] tabular-nums text-faint"
          :datetime="item.createdAt"
          :title="exactTime(item.createdAt)"
        >
          {{ relativeTime(item.createdAt) }}
        </time>
      </div>

      <p v-if="item.description" class="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
        {{ item.description }}
      </p>

      <div class="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
        <span class="font-mono uppercase tracking-wide">{{ item.module }}</span>
        <template v-if="item.category">
          <span aria-hidden="true">·</span>
          <span>{{ item.category }}</span>
        </template>
      </div>

      <div v-if="item.actions?.length" class="mt-2.5 flex flex-wrap gap-2">
        <button
          v-for="action in item.actions"
          :key="action.label + action.url"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-text transition-colors duration-100 hover:bg-sunken"
          @click.stop="emit('action', action, item)"
        >
          <Icon v-if="actionIcon(action.icon)" :icon="actionIcon(action.icon)!" :size="13" />
          {{ action.label }}
        </button>
      </div>
    </div>
  </article>
</template>
