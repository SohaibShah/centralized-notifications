<script setup lang="ts">
import { ref } from "vue";
import { ChevronRight } from "@lucide/vue";
import type {
  FeedNotification,
  GroupedEntry,
  NotificationAction,
  NotificationPage,
} from "@notifications/shared";
import Icon from "../../ui/Icon.vue";
import Spinner from "../../ui/Spinner.vue";
import { priorityDotClass } from "../../design/tokens";
import { relativeTime } from "../../lib/time";
import NotificationCardRenderer from "../renderers/NotificationCardRenderer.vue";

// A collapsed notification stack: one group's header + an inline peek of its most-recent members,
// with a "See all" that hands the group key up so the panel can drill in. Fetches the peek lazily via
// the injected transport (parent passes it from useTransport). A single-member entry renders as a
// plain card — no stack chrome.
const props = defineProps<{
  entry: GroupedEntry;
  transport: { get: <T>(url: string) => Promise<T> };
}>();
const emit = defineEmits<{
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification, index: number];
  "see-all": [key: string, label: string];
}>();

const PEEK = 3;
const open = ref(false);
const peek = ref<FeedNotification[] | null>(null);
const loading = ref(false);

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value && peek.value === null && props.entry.groupKey) {
    loading.value = true;
    try {
      const page = await props.transport.get<NotificationPage>(
        `/notifications?group=${encodeURIComponent(props.entry.groupKey)}&limit=${PEEK}`,
      );
      peek.value = page.items;
    } catch {
      peek.value = [];
    } finally {
      loading.value = false;
    }
  }
}
</script>

<template>
  <!-- A single-member entry is just a card. -->
  <NotificationCardRenderer
    v-if="entry.groupTotal === 1"
    :notification="entry"
    @open="(n) => emit('open', n)"
    @action="(a, n, i) => emit('action', a, n, i)"
  />

  <div v-else class="border-b border-line">
    <button
      type="button"
      data-test="stack-header"
      class="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      :aria-expanded="open"
      @click="toggle"
    >
      <Icon
        :icon="ChevronRight"
        :size="14"
        class="shrink-0 text-faint transition-transform"
        :class="{ 'rotate-90': open }"
      />
      <span
        class="mt-1 size-2 shrink-0 rounded-full"
        :class="priorityDotClass[entry.topPriority]"
      />
      <span class="min-w-0 flex-1 truncate font-display text-[13px] font-semibold text-text">
        {{ entry.groupLabel }}
      </span>
      <span
        v-if="entry.groupUnread > 0"
        data-test="stack-unread"
        class="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-accent"
        >{{ entry.groupUnread }}</span
      >
      <span
        data-test="stack-total"
        class="shrink-0 rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted"
        >{{ entry.groupTotal }}</span
      >
    </button>

    <div v-if="open" data-test="stack-peek" class="bg-surface">
      <div v-if="loading" class="flex items-center gap-2 px-11 py-3 text-[12px] text-muted">
        <Spinner :size="12" /> Loading…
      </div>
      <ul v-else>
        <li
          v-for="m in peek ?? []"
          :key="m.id"
          class="flex items-start gap-2 border-t border-line px-4 py-2.5 pl-11"
        >
          <span
            v-if="!m.read"
            class="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[12.5px] font-medium text-text">{{ m.title }}</p>
            <p class="mt-0.5 font-mono text-[11px] text-faint">
              {{ m.module }} · {{ relativeTime(m.createdAt) }}
            </p>
          </div>
        </li>
      </ul>
      <button
        type="button"
        data-test="stack-see-all"
        class="w-full border-t border-line px-4 py-2 text-center text-[12px] font-semibold text-accent transition-colors hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        @click="emit('see-all', entry.groupKey ?? '', entry.groupLabel ?? '')"
      >
        See all {{ entry.groupTotal }} in this group →
      </button>
    </div>
  </div>
</template>
