import { reactive, ref } from "vue";

/**
 * Open-state of the bell popover, lifted out of NotificationBell so other surfaces can
 * drive it — the critical toast opens the panel on "View" and suppresses itself while the
 * panel is already open. Dismissal/focus mechanics stay in the bell.
 */
export function createPanelState() {
  const isOpen = ref(false);
  function open(): void {
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
  }
  function toggle(): void {
    isOpen.value = !isOpen.value;
  }
  return reactive({ isOpen, open, close, toggle });
}

export type PanelState = ReturnType<typeof createPanelState>;
