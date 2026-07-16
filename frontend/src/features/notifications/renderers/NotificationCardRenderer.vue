<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Icon from "@/components/ui/Icon.vue";
import { actionIcon } from "@/design/icons";
import { priorityDotClass, priorityLabel } from "@/design/tokens";
import { exactTime, relativeTime } from "@/lib/time";

// Config-driven feed row. Compact by default; a chevron (only when the notification has
// actions or a long body) expands the card to reveal that extra content. Clicking the card
// (body, title, or chevron) opens it — expands any extra content AND marks it read
// (open-and-seen, emit "open"). Actions and "Mark as unread" stop propagation and don't mark
// read here; firing an action marks it read too, but that's the consumer's (InboxTab) job.
const props = defineProps<{ notification: FeedNotification }>();
const emit = defineEmits<{
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
  unread: [notification: FeedNotification];
}>();

const item = computed(() => props.notification);
const hasActions = computed(() => (item.value.actions?.length ?? 0) > 0);
// A long body gets an expand affordance even with no actions (single-line truncate hides it).
const isLongBody = computed(() => (item.value.description?.length ?? 0) > 140);
const canExpand = computed(() => hasActions.value || isLongBody.value);
const expanded = ref(false);

// Only genuinely-live rows (createdAt ≈ now) get the fade+rise entrance.
const isFresh = Date.now() - new Date(props.notification.createdAt).getTime() < 4000;

function activate() {
  // Open-and-seen: clicking a card opens it (expands, if there's more to show) AND marks it read.
  if (canExpand.value) expanded.value = !expanded.value;
  emit("open", item.value); // parent → markRead (no-op if already read)
}
function markUnread() {
  emit("unread", item.value);
}
</script>

<template>
  <article
    class="group border-b border-line px-4 py-2.5 transition-colors duration-100 hover:bg-sunken"
    :class="[
      { 'animate-enter': isFresh },
      item.read ? '' : 'shadow-[inset_2px_0_0_var(--color-accent)]',
    ]"
  >
    <div class="flex cursor-pointer gap-3" @click="activate">
      <span
        role="img"
        :aria-label="`${priorityLabel[item.priority]} priority`"
        class="mt-1.5 size-2 shrink-0 rounded-full"
        :class="priorityDotClass[item.priority]"
      />

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="min-w-0 flex-1">
            <button
              type="button"
              class="block w-full truncate text-left font-sans text-[14px]"
              :class="item.read ? 'font-normal text-muted' : 'font-semibold text-text'"
              :title="item.title"
              @click.stop="activate"
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

        <p
          v-if="item.description"
          data-test="card-body"
          class="mt-0.5 text-[13px] leading-relaxed text-muted"
          :class="expanded ? 'whitespace-pre-line break-words' : 'truncate'"
        >
          {{ item.description }}
        </p>

        <div class="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
          <span class="font-mono uppercase tracking-wide">{{ item.module }}</span>
          <template v-if="item.category">
            <span aria-hidden="true">·</span>
            <span>{{ item.category }}</span>
          </template>
          <span
            v-if="!item.read && !expanded"
            aria-hidden="true"
            class="ml-auto hidden font-mono text-[11px] uppercase tracking-wide text-accent group-hover:inline"
          >
            click to open
          </span>
          <button
            v-if="item.read"
            type="button"
            data-test="mark-unread"
            class="ml-auto font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:text-text"
            @click.stop="markUnread"
          >
            Mark as unread
          </button>
        </div>
      </div>

      <button
        v-if="canExpand"
        type="button"
        class="mt-0.5 grid size-6 shrink-0 place-items-center self-start rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
        :aria-label="
          expanded
            ? hasActions
              ? 'Hide actions'
              : 'Hide details'
            : hasActions
              ? 'Show actions'
              : 'Show details'
        "
        :aria-expanded="expanded"
        @click.stop="activate"
      >
        <Icon
          :icon="ChevronDown"
          :size="15"
          :class="expanded ? 'rotate-180 transition-transform' : 'transition-transform'"
        />
      </button>
    </div>

    <div v-if="expanded && hasActions" class="mt-2.5 flex flex-wrap gap-2 pl-5">
      <button
        v-for="action in item.actions"
        :key="action.label + action.url"
        type="button"
        data-test="action"
        class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-text transition-colors duration-100 hover:bg-sunken"
        @click.stop="emit('action', action, item)"
      >
        <Icon v-if="actionIcon(action.icon)" :icon="actionIcon(action.icon)!" :size="13" />
        {{ action.label }}
      </button>
    </div>
  </article>
</template>
