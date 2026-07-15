<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Spinner from "@/components/ui/Spinner.vue";
import type { FeedGroup } from "@/stores/feed";
import { relativeTime } from "@/lib/time";
import { priorityDotClass, priorityLabel } from "@/design/tokens";
import NotificationCardRenderer from "../renderers/NotificationCardRenderer.vue";

const props = defineProps<{ groups: FeedGroup[]; hasMore: boolean; loadingMore: boolean }>();
const emit = defineEmits<{
  loadMore: [];
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification];
  markAll: [];
}>();

const needsAction = computed(() => props.groups.find((g) => g.key === "needs-action"));
const earlier = computed(() => props.groups.find((g) => g.key === "earlier"));
const showEarlier = ref(false);

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
        <span class="font-mono text-[12px] tabular-nums text-faint">{{
          needsAction.items.length
        }}</span>
        <button
          type="button"
          data-test="mark-all"
          class="ml-auto font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:text-text"
          @click="emit('markAll')"
        >
          Mark all read
        </button>
      </div>
      <NotificationCardRenderer
        v-for="n in needsAction.items"
        :key="n.id"
        :notification="n"
        @open="(x) => emit('open', x)"
        @action="(a, x) => emit('action', a, x)"
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
        <button
          v-for="n in earlier.items"
          :key="n.id"
          type="button"
          class="flex w-full items-center gap-2.5 border-b border-line px-4 py-2 text-left transition-colors duration-100 hover:bg-sunken"
          @click="emit('open', n)"
        >
          <span
            role="img"
            :aria-label="`${priorityLabel[n.priority]} priority`"
            class="size-1.5 shrink-0 rounded-full"
            :class="priorityDotClass[n.priority]"
          />
          <span class="min-w-0 flex-1 truncate text-[12px] text-muted" :title="n.title">{{
            n.title
          }}</span>
          <time
            class="shrink-0 font-mono text-[11px] tabular-nums text-faint"
            :datetime="n.createdAt"
          >
            {{ relativeTime(n.createdAt) }}
          </time>
        </button>
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
