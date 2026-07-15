import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  module: string;
}

export const AUTO_DISMISS_MS = 6000;
export const MAX_VISIBLE = 3;

/**
 * Queue of active critical-notification toasts. Newest-last. Each active toast carries an
 * auto-dismiss timer (pausable on hover/focus). An id is toasted at most once ever (a
 * duplicate SSE delivery, or re-push, is ignored) so a retry can't re-alert.
 */
export const useToastStore = defineStore("toast", () => {
  const queue = ref<ToastItem[]>([]);
  const seen = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const visible = computed(() => queue.value.slice(-MAX_VISIBLE));
  const overflowCount = computed(() => Math.max(0, queue.value.length - MAX_VISIBLE));

  function startTimer(id: string): void {
    clearTimer(id);
    timers.set(
      id,
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
    );
  }
  function clearTimer(id: string): void {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
  }

  function pushCritical(items: ToastItem[]): void {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      queue.value = [...queue.value, item];
      startTimer(item.id);
    }
  }

  function dismiss(id: string): void {
    clearTimer(id);
    queue.value = queue.value.filter((t) => t.id !== id);
  }
  function pause(id: string): void {
    clearTimer(id);
  }
  function resume(id: string): void {
    if (queue.value.some((t) => t.id === id)) startTimer(id);
  }

  /** Clear all toasts, timers, and dedupe memory — used on (re)login so one user never sees another's toasts. */
  function reset(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    queue.value = [];
    seen.clear();
  }

  return { visible, overflowCount, pushCritical, dismiss, pause, resume, reset };
});
