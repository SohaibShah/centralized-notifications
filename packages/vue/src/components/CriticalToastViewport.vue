<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useToast } from "../provider/context";
import { usePanel } from "../provider/context";
import { useFeed } from "../provider/context";
import { usePreferences } from "../provider/context";
import { shouldToast } from "../state/toast";
import { useUi } from "../theming/useUi";
import CriticalToast from "./CriticalToast.vue";

const parts = {
  root: "pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2",
  overflow:
    "pointer-events-auto rounded-full border border-line-strong bg-surface px-3 py-1 font-sans text-[11px] font-semibold text-muted shadow-md shadow-black/5",
} as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("toast-viewport", parts, () => props.ui);

const toasts = useToast();
const panel = usePanel();
const feed = useFeed();
const preferences = usePreferences();
let off: (() => void) | null = null;

onMounted(() => {
  off = feed.onLiveAlert((items) => {
    // Suppress the toast if the panel is already open — the user is already looking.
    if (panel.isOpen) return;
    // Narrow the high+critical alert set to the user's toast preference ('off' shows nothing).
    const toastable = items.filter((n) =>
      shouldToast(n.priority, preferences.prefs.toastMinPriority),
    );
    if (toastable.length === 0) return;
    toasts.pushCritical(
      toastable.map((n) => ({
        id: n.id,
        title: n.title,
        description: n.description,
        module: n.module,
        priority: n.priority,
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
  <div :class="ui('root')">
    <div v-if="toasts.overflowCount > 0" :class="ui('overflow')">
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
