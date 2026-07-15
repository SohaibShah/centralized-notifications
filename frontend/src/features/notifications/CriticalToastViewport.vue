<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useToastStore } from "@/stores/toast";
import { useNotificationPanelStore } from "@/stores/notificationPanel";
import { useFeedStore } from "@/stores/feed";
import CriticalToast from "./CriticalToast.vue";

const toasts = useToastStore();
const panel = useNotificationPanelStore();
const feed = useFeedStore();
let off: (() => void) | null = null;

onMounted(() => {
  off = feed.onLiveCritical((items) => {
    // Suppress the toast if the panel is already open — the user is already looking.
    if (panel.isOpen) return;
    toasts.pushCritical(
      items.map((n) => ({
        id: n.id,
        title: n.title,
        description: n.description,
        module: n.module,
      })),
    );
  });
});
onBeforeUnmount(() => off?.());

function view(id: string) {
  toasts.dismiss(id);
  panel.open();
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
    <div
      v-if="toasts.overflowCount > 0"
      class="pointer-events-auto rounded-full border border-line-strong bg-surface px-3 py-1 font-sans text-[11px] font-semibold text-muted shadow-md shadow-black/5"
    >
      +{{ toasts.overflowCount }} earlier critical
    </div>
    <CriticalToast
      v-for="t in toasts.visible"
      :key="t.id"
      :toast="t"
      class="pointer-events-auto"
      @dismiss="toasts.dismiss(t.id)"
      @view="view(t.id)"
    />
  </div>
</template>
