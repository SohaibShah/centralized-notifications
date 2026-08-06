<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Icon from "../../ui/Icon.vue";
import Spinner from "../../ui/Spinner.vue";
import type { FeedGroup } from "../../state/feed";
import { useUi } from "../../theming/useUi";
import NotificationCardRenderer from "../renderers/NotificationCardRenderer.vue";

const parts = {
  root: "min-h-0 flex-1 overflow-y-auto",
  sectionHeader:
    "sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur",
  sectionTitle: "font-display text-[13px] font-medium text-text",
  count: "rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-accent",
  markAll:
    "ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:bg-sunken",
  showEarlier:
    "rounded-full bg-sunken px-3.5 py-1.5 text-[12px] font-semibold text-accent transition-colors duration-100 hover:bg-accent/10",
} as const;
const props = defineProps<{
  groups: FeedGroup[];
  /** Server-sourced total unread over the whole dataset (may exceed the loaded needs-action group). */
  unread: number;
  hasMore: boolean;
  loadingMore: boolean;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const emit = defineEmits<{
  loadMore: [];
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification, index: number];
  unread: [notification: FeedNotification];
  markAll: [];
}>();

const ui = useUi("feed-list", parts, () => props.ui);
const needsAction = computed(() => props.groups.find((g) => g.key === "needs-action"));
const earlier = computed(() => props.groups.find((g) => g.key === "earlier"));
// Earlier (read) rows show expanded by default; the toggle collapses them ("Hide earlier").
const showEarlier = ref(true);

// Plain scroll container + IntersectionObserver sentinel drive keyset pagination.
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
  <div ref="scroller" :class="ui('root')">
    <section v-if="needsAction">
      <div :class="ui('sectionHeader')">
        <h2 :class="ui('sectionTitle')">{{ needsAction.label }}</h2>
        <span v-if="props.unread > 0" data-test="needs-action-count" :class="ui('count')">
          {{ props.unread }} unread
        </span>
        <button
          v-if="props.unread > 0"
          type="button"
          data-test="mark-all"
          :class="ui('markAll')"
          @click="emit('markAll')"
        >
          <Icon name="check" :size="12" /> Mark all read
        </button>
      </div>
      <NotificationCardRenderer
        v-for="n in needsAction.items"
        :key="n.id"
        :notification="n"
        @open="(x) => emit('open', x)"
        @action="(a, x, i) => emit('action', a, x, i)"
        @unread="(x) => emit('unread', x)"
      />
    </section>

    <section v-if="earlier">
      <div class="flex justify-center py-2.5">
        <button
          type="button"
          data-test="show-earlier"
          :class="ui('showEarlier')"
          :aria-expanded="showEarlier"
          @click="showEarlier = !showEarlier"
        >
          {{ showEarlier ? "Hide earlier" : `Show ${earlier.items.length} earlier` }}
        </button>
      </div>
      <div v-if="showEarlier" data-test="earlier-list">
        <NotificationCardRenderer
          v-for="n in earlier.items"
          :key="n.id"
          :notification="n"
          @open="(x) => emit('open', x)"
          @action="(a, x, i) => emit('action', a, x, i)"
          @unread="(x) => emit('unread', x)"
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
