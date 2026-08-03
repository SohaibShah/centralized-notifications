import { computed, reactive, ref } from "vue";
import type { NotificationPriority, ToastMinPriority } from "@notifications/shared";

/** Whether a notification of `priority` should pop a toast given the user's `min` toast preference:
 *  'off' = never; 'critical' = critical only; 'high' = high + critical. */
export function shouldToast(priority: NotificationPriority, min: ToastMinPriority): boolean {
  if (min === "off") return false;
  if (min === "critical") return priority === "critical";
  return priority === "critical" || priority === "high";
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  module: string;
  /** The notification's priority — drives the toast's label + colour (critical vs high). */
  priority: NotificationPriority;
}

export const AUTO_DISMISS_MS = 6000;
export const MAX_VISIBLE = 3;

/**
 * Queue of active critical-notification toasts. Newest-last. Each active toast carries an
 * auto-dismiss timer (pausable on hover/focus). An id is toasted at most once ever (a
 * duplicate SSE delivery, or re-push, is ignored) so a retry can't re-alert.
 */
export function createToastState() {
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

  return reactive({ visible, overflowCount, pushCritical, dismiss, pause, resume, reset });
}

export type ToastState = ReturnType<typeof createToastState>;
