<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Bell } from "@lucide/vue";
import Icon from "@/ui/Icon.vue";
import { useFeed } from "@/provider/context";
import { usePanel } from "@/provider/context";
import NotificationPopover from "./NotificationPopover.vue";

const feed = useFeed();
const panel = usePanel();
const root = ref<HTMLElement | null>(null);
const bellButton = ref<HTMLButtonElement | null>(null);

const badge = computed(() => (feed.counts.unread > 9 ? "9+" : String(feed.counts.unread)));

function close(restoreFocus = true) {
  panel.close();
  if (restoreFocus) bellButton.value?.focus();
}
function toggle() {
  panel.toggle();
}

function onDocumentPointer(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!root.value || root.value.contains(target)) return;
  // The filter dropdown is teleported out of the panel (to escape its overflow clip), so a click
  // inside it isn't within `root`. Treat any teleported panel overlay as "inside" — otherwise
  // choosing a sort/filter option would close the whole panel before the change registers.
  if (target?.closest("[data-notification-overlay]")) return;
  close(false);
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close(true);
}

watch(
  () => panel.isOpen,
  (isOpen) => {
    if (isOpen) {
      document.addEventListener("mousedown", onDocumentPointer);
      document.addEventListener("keydown", onKeydown);
    } else {
      document.removeEventListener("mousedown", onDocumentPointer);
      document.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="bellButton"
      type="button"
      class="relative grid size-9 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
      :aria-label="
        feed.counts.unread > 0 ? `Notifications, ${feed.counts.unread} unread` : 'Notifications'
      "
      aria-haspopup="dialog"
      :aria-expanded="panel.isOpen"
      @click="toggle"
    >
      <Icon :icon="Bell" :size="18" />
      <span
        v-if="feed.counts.unread > 0"
        class="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[11px] font-semibold tabular-nums text-danger-ink"
        aria-hidden="true"
      >
        {{ badge }}
      </span>
    </button>

    <div v-if="panel.isOpen" class="absolute right-0 top-full z-40 mt-2">
      <NotificationPopover @close="() => close(true)" />
    </div>
  </div>
</template>
