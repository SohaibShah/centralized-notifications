<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, ChevronRight } from "@lucide/vue";
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
  unread: [notification: FeedNotification];
  "mark-all-read": [key: string];
  "see-all": [key: string, label: string];
}>();

const PEEK = 3;
const open = ref(false);
const peek = ref<FeedNotification[] | null>(null);
const loading = ref(false);
const peekError = ref(false);

// A stable id so the header's aria-controls can point at the expanded peek region.
const peekId = computed(() => `stack-peek-${props.entry.groupKey ?? props.entry.id}`);

async function fetchPeek(): Promise<void> {
  if (!props.entry.groupKey) return;
  loading.value = true;
  peekError.value = false;
  try {
    const page = await props.transport.get<NotificationPage>(
      `/notifications?group=${encodeURIComponent(props.entry.groupKey)}&limit=${PEEK}`,
    );
    peek.value = Array.isArray(page?.items) ? page.items : [];
  } catch {
    peekError.value = true; // distinct from an empty group — surfaced with a retry
  } finally {
    loading.value = false;
  }
}

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value && peek.value === null && !loading.value) await fetchPeek();
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
      :aria-controls="peekId"
      @click="toggle"
    >
      <Icon
        :icon="ChevronRight"
        :size="14"
        aria-hidden="true"
        class="shrink-0 text-faint transition-transform"
        :class="{ 'rotate-90': open }"
      />
      <span
        aria-hidden="true"
        class="mt-1 size-2 shrink-0 rounded-full"
        :class="priorityDotClass[entry.topPriority]"
      />
      <span class="min-w-0 flex-1 truncate font-display text-[13px] font-semibold text-text">
        {{ entry.groupLabel }}
      </span>
      <time
        data-test="stack-time"
        :datetime="entry.createdAt"
        :title="entry.createdAt"
        class="shrink-0 font-mono text-[11px] tabular-nums text-faint"
        >{{ relativeTime(entry.createdAt) }}</time
      >
      <span
        data-test="stack-total"
        :aria-label="`${entry.groupTotal} in this group`"
        class="shrink-0 rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted"
        >{{ entry.groupTotal }}</span
      >
    </button>

    <div v-if="open" :id="peekId" data-test="stack-peek" class="bg-surface">
      <!-- Whole-group "Mark all read" — only meaningful on an unread stack. -->
      <div v-if="!entry.read" class="flex justify-end border-t border-line px-4 py-1.5">
        <button
          type="button"
          data-test="stack-mark-all"
          class="text-[12px] font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          @click="emit('mark-all-read', entry.groupKey ?? '')"
        >
          Mark all read
        </button>
      </div>
      <div v-if="loading" class="flex items-center gap-2 px-11 py-3 text-[12px] text-muted">
        <Spinner :size="12" /> Loading…
      </div>
      <div
        v-else-if="peekError"
        data-test="stack-peek-error"
        class="flex items-center gap-2 px-11 py-3 text-[12px] text-muted"
      >
        <span>Couldn't load these.</span>
        <button
          type="button"
          class="font-semibold text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          @click="fetchPeek()"
        >
          Try again
        </button>
      </div>
      <!-- Members are the real feed card — collapsed by default, expandable in place to their actions,
           exactly like the main feed (one card renderer, no divergent stack-only markup). -->
      <div v-else>
        <NotificationCardRenderer
          v-for="m in peek ?? []"
          :key="m.id"
          :notification="m"
          @open="(n) => emit('open', n)"
          @action="(a, n, i) => emit('action', a, n, i)"
          @unread="(n) => emit('unread', n)"
        />
      </div>
      <button
        type="button"
        data-test="stack-see-all"
        class="flex w-full items-center justify-center gap-1 border-t border-line px-4 py-2 text-center text-[12px] font-semibold text-accent transition-colors hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        @click="emit('see-all', entry.groupKey ?? '', entry.groupLabel ?? '')"
      >
        See all {{ entry.groupTotal }} in this group
        <Icon :icon="ArrowRight" :size="13" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
