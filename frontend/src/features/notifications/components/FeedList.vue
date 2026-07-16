<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Check } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Icon from "@/components/ui/Icon.vue";
import Spinner from "@/components/ui/Spinner.vue";
import type { FeedGroup } from "@/stores/feed";
import NotificationCardRenderer from "../renderers/NotificationCardRenderer.vue";

const props = defineProps<{ groups: FeedGroup[]; hasMore: boolean; loadingMore: boolean }>();
const emit = defineEmits<{
  loadMore: [];
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
  unread: [notification: FeedNotification];
  markAll: [];
}>();

const needsAction = computed(() => props.groups.find((g) => g.key === "needs-action"));
const earlier = computed(() => props.groups.find((g) => g.key === "earlier"));
const showEarlier = ref(false);

// Only genuinely-unread rows count — sticky-read items sitting in Needs action don't inflate it.
const unreadInNeedsAction = computed(
  () => needsAction.value?.items.filter((n) => !n.read).length ?? 0,
);

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
  <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
    <section v-if="needsAction">
      <div
        class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur"
      >
        <h2 class="font-display text-[13px] font-medium text-text">{{ needsAction.label }}</h2>
        <span
          v-if="unreadInNeedsAction > 0"
          data-test="needs-action-count"
          class="rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-accent"
        >
          {{ unreadInNeedsAction }} unread
        </span>
        <button
          v-if="unreadInNeedsAction > 0"
          type="button"
          data-test="mark-all"
          class="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:bg-sunken"
          @click="emit('markAll')"
        >
          <Icon :icon="Check" :size="12" /> Mark all read
        </button>
      </div>
      <NotificationCardRenderer
        v-for="n in needsAction.items"
        :key="n.id"
        :notification="n"
        @open="(x) => emit('open', x)"
        @action="(a, x) => emit('action', a, x)"
        @unread="(x) => emit('unread', x)"
      />
    </section>

    <section v-if="earlier">
      <div class="flex justify-center py-2.5">
        <button
          type="button"
          data-test="show-earlier"
          class="rounded-full bg-sunken px-3.5 py-1.5 text-[12px] font-semibold text-accent transition-colors duration-100 hover:bg-accent/10"
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
          @action="(a, x) => emit('action', a, x)"
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
