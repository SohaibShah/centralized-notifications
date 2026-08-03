<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { FeedNotification, GroupedEntry, NotificationAction } from "@notifications/shared";
import Spinner from "../../ui/Spinner.vue";
import StackRow from "../panel/StackRow.vue";

// The grouped feed: collapsed stacks split into Needs action (any unread member) / Earlier, mirroring
// FeedList's section chrome + keyset pagination. Members and drill-in are handled by StackRow / the
// parent; this component only lays out the stacks.
const props = defineProps<{
  entries: GroupedEntry[];
  unread: number;
  hasMore: boolean;
  loadingMore: boolean;
  transport: { get: <T>(url: string) => Promise<T> };
}>();
const emit = defineEmits<{
  loadMore: [];
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification, index: number];
  "see-all": [key: string, label: string];
}>();

// Each entry is read-state-homogeneous (the grouped read partitions by read), so an unread stack
// lands in Needs action and a read stack in Earlier — split on the entry's own read flag.
const needsAction = computed(() => props.entries.filter((e) => !e.read));
const earlier = computed(() => props.entries.filter((e) => e.read));
const showEarlier = ref(true);

const scroller = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
function maybeLoadMore(): void {
  if (props.hasMore && !props.loadingMore) emit("loadMore");
}
onMounted(() => {
  if (!scroller.value || !sentinel.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeLoadMore();
    },
    { root: scroller.value, rootMargin: "300px" },
  );
  observer.observe(sentinel.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
    <section v-if="needsAction.length">
      <div
        class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur"
      >
        <h2 class="font-display text-[13px] font-medium text-text">Needs action</h2>
        <span
          v-if="props.unread > 0"
          data-test="needs-action-count"
          class="rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-accent"
        >
          {{ props.unread }} unread
        </span>
      </div>
      <StackRow
        v-for="e in needsAction"
        :key="e.groupKey ?? e.id"
        :entry="e"
        :transport="transport"
        @open="(x) => emit('open', x)"
        @action="(a, x, i) => emit('action', a, x, i)"
        @see-all="(k, l) => emit('see-all', k, l)"
      />
    </section>

    <section v-if="earlier.length">
      <div class="flex justify-center py-2.5">
        <button
          type="button"
          data-test="show-earlier"
          class="rounded-full bg-sunken px-3.5 py-1.5 text-[12px] font-semibold text-accent transition-colors duration-100 hover:bg-accent/10"
          :aria-expanded="showEarlier"
          @click="showEarlier = !showEarlier"
        >
          {{ showEarlier ? "Hide earlier" : `Show ${earlier.length} earlier` }}
        </button>
      </div>
      <div v-if="showEarlier" data-test="earlier-list">
        <StackRow
          v-for="e in earlier"
          :key="e.groupKey ?? e.id"
          :entry="e"
          :transport="transport"
          @open="(x) => emit('open', x)"
          @action="(a, x, i) => emit('action', a, x, i)"
          @see-all="(k, l) => emit('see-all', k, l)"
        />
      </div>
    </section>

    <div ref="sentinel" aria-hidden="true" class="h-px" />

    <div
      v-if="loadingMore"
      class="flex items-center justify-center gap-2 py-5 text-[12px] text-faint"
      role="status"
    >
      <Spinner :size="14" />
      Loading earlier notifications…
    </div>
  </div>
</template>
