<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, Check, ChevronRight } from "@lucide/vue";
import type {
  FeedNotification,
  GroupedEntry,
  NotificationAction,
  NotificationPage,
  NotificationPriority,
} from "@notifications/shared";
import Icon from "../../ui/Icon.vue";
import Spinner from "../../ui/Spinner.vue";
import { priorityLabel, stackLineClass, stackWashClass } from "../../design/tokens";
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
  "see-all": [key: string, label: string, read: boolean];
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
      `/notifications?group=${encodeURIComponent(props.entry.groupKey)}&read=${props.entry.read}&limit=${PEEK}`,
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

// Optimistically flip a peek member's read flag so its card responds instantly; the panel then
// persists the change and refetches the stacks (their counts/split are server-derived).
function flipPeekRead(id: string, read: boolean): void {
  if (peek.value) peek.value = peek.value.map((m) => (m.id === id ? { ...m, read } : m));
}
function onMemberRead(n: FeedNotification): void {
  flipPeekRead(n.id, true);
  emit("open", n);
}
function onMemberUnread(n: FeedNotification): void {
  flipPeekRead(n.id, false);
  emit("unread", n);
}

// Collapsed header / open header take the group's top-priority line + wash; each member takes its own.
const headerLine = computed(() => stackLineClass[props.entry.topPriority]);
const headerWash = computed(() => stackWashClass[props.entry.topPriority]);
// Washed headers (critical/high) keep the priority wash at rest, hover (via `.nt-wash-*:hover`), and
// when open — so we do NOT also apply the neutral bg-sunken utilities there (they'd fight the wash and
// turn an open critical header grey). Unwashed headers (normal/low) get the sunken hover/open feedback.
const headerBg = computed(() =>
  headerWash.value ? headerWash.value : open.value ? "bg-sunken/50" : "hover:bg-sunken/50",
);
function memberLine(p: NotificationPriority): string {
  return stackLineClass[p];
}
</script>

<template>
  <!-- A single-member entry is just a card — unchanged. -->
  <NotificationCardRenderer
    v-if="entry.groupTotal === 1"
    :notification="entry"
    @open="(n) => emit('open', n)"
    @action="(a, n, i) => emit('action', a, n, i)"
    @unread="(n) => emit('unread', n)"
  />

  <div v-else data-test="stack" class="border-b border-line">
    <!-- The neutral thread runs down the header + members; the footer sits OUTSIDE it (no lines). -->
    <div class="nt-thread">
      <button
        type="button"
        data-test="stack-header"
        class="nt-prio-line relative flex w-full items-center gap-2.5 py-3 pl-6 pr-4 text-left transition-colors duration-100"
        :class="[headerLine, headerBg]"
        :aria-expanded="open"
        :aria-controls="open ? peekId : undefined"
        @click="toggle"
      >
        <span class="min-w-0 flex-1 truncate font-sans text-[14px] font-semibold text-text">
          {{ entry.groupLabel }}
        </span>
        <!-- Priority is conveyed by the line + wash (decorative); carry the word for SR / color-blind users. -->
        <span class="sr-only">{{ priorityLabel[entry.topPriority] }} priority</span>
        <span
          data-test="stack-total"
          :aria-label="`${entry.groupTotal} in this group`"
          class="shrink-0 rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted"
          >{{ entry.groupTotal }}</span
        >
        <Icon
          :icon="ChevronRight"
          :size="14"
          aria-hidden="true"
          class="shrink-0 text-faint motion-safe:transition-transform"
          :class="{ 'rotate-90': open }"
        />
        <time
          data-test="stack-time"
          :datetime="entry.createdAt"
          :title="entry.createdAt"
          class="shrink-0 font-mono text-[11px] tabular-nums text-faint"
          >{{ relativeTime(entry.createdAt) }}</time
        >
      </button>

      <div v-if="open" :id="peekId" data-test="stack-peek">
        <div v-if="loading" class="flex items-center gap-2 py-3 pl-11 text-[12px] text-muted">
          <Spinner :size="12" /> Loading…
        </div>
        <div
          v-else-if="peekError"
          data-test="stack-peek-error"
          class="flex items-center gap-2 py-3 pl-11 text-[12px] text-muted"
        >
          <span>Couldn't load these.</span>
          <button type="button" class="font-semibold text-accent underline" @click="fetchPeek()">
            Try again
          </button>
        </div>
        <div v-else-if="(peek ?? []).length === 0" class="py-3 pl-11 text-[12px] text-muted">
          Nothing left in this group.
        </div>
        <!-- Members are the real feed card, nested (indented) and threaded with a per-member priority
             line — collapsed by default, expandable in place to their actions, exactly like the feed. -->
        <div v-else>
          <div
            v-for="m in peek ?? []"
            :key="m.id"
            class="nt-prio-line pl-6"
            :class="memberLine(m.priority)"
          >
            <NotificationCardRenderer
              :notification="m"
              flush
              @open="onMemberRead"
              @action="(a, n, i) => emit('action', a, n, i)"
              @unread="onMemberUnread"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Footer: a control row, not a card — OUTSIDE the thread, so it carries no lines. -->
    <div
      v-if="open"
      data-test="stack-footer"
      class="-mt-px flex items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2"
    >
      <button
        v-if="!entry.read"
        type="button"
        data-test="stack-mark-all"
        class="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:bg-sunken"
        @click="emit('mark-all-read', entry.groupKey ?? '')"
      >
        <Icon :icon="Check" :size="12" /> Mark all read
      </button>
      <span v-else aria-hidden="true" />
      <button
        type="button"
        data-test="stack-see-all"
        class="inline-flex items-center gap-1 text-[12px] font-semibold text-accent transition-colors hover:underline"
        @click="emit('see-all', entry.groupKey ?? '', entry.groupLabel ?? '', entry.read)"
      >
        See all
        <Icon :icon="ArrowRight" :size="13" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
