<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Spinner from "@/components/ui/Spinner.vue";
import type { FeedGroup } from "@/stores/feed";
import NotificationCardRenderer from "../renderers/NotificationCardRenderer.vue";

const props = defineProps<{
  groups: FeedGroup[];
  hasMore: boolean;
  loadingMore: boolean;
}>();

const emit = defineEmits<{
  loadMore: [];
  action: [action: NotificationAction, notification: FeedNotification];
}>();

// Plain scroll container + an IntersectionObserver sentinel drive pagination. This is
// deliberately not a windowing library: with the store's MAX_ITEMS cap the DOM stays
// bounded, live arrivals are real node insertions (so the CSS entrance animation fires),
// sticky group headers work, and nothing paints over the filter dropdown. The observer
// prefetches the next page as the sentinel nears the viewport.
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
      if (entries.some((entry) => entry.isIntersecting)) maybeLoadMore();
    },
    { root: scroller.value, rootMargin: "300px" },
  );
  observer.observe(sentinel.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="scroller" class="h-full overflow-y-auto">
    <section v-for="group in groups" :key="group.key">
      <div
        class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur"
      >
        <h2 class="font-display text-[13px] font-medium text-text">{{ group.label }}</h2>
        <span class="font-mono text-[12px] tabular-nums text-faint">{{ group.items.length }}</span>
      </div>

      <NotificationCardRenderer
        v-for="n in group.items"
        :key="n.id"
        :notification="n"
        @action="(action, notification) => emit('action', action, notification)"
      />
    </section>

    <!-- Sentinel: prefetches the next page as it nears view. Kept in the DOM always. -->
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
