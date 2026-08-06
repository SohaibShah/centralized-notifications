import { inject, type InjectionKey, type Ref } from "vue";
import { cn } from "../lib/cn";

/** A single component's per-part override map (part name → extra/overriding classes). */
export type ComponentUi<P> = Partial<Record<keyof P, string>>;

/** The provider-level global override map: component name → its part→classes overrides. */
export type NotificationUi = Record<string, Record<string, string>>;

export const NOTIFICATION_UI_KEY: InjectionKey<Ref<NotificationUi | undefined>> =
  Symbol("notification-ui");

/**
 * Low-level accessor: returns a getter for this component's provider-level (global) override of a
 * part, or `undefined` if none. Used directly by components whose part DEFAULTS are dynamic (a cva
 * variant, an `active` state) and so can't be expressed as `useUi`'s static `parts` map — they
 * compose `cn(dynamicDefault, globalUi(part), props.ui?.part)` themselves, keeping the same
 * default ← global ← instance precedence.
 */
export function useComponentUi(component: string): (part: string) => string | undefined {
  const globalUi = inject(NOTIFICATION_UI_KEY, undefined);
  return (part) => globalUi?.value?.[component]?.[part];
}

/**
 * Resolves a component's parts to merged class strings. Layers, later winning (via `cn`, which
 * is tailwind-merge-configured so an override like `rounded-none` replaces a default `rounded-md`):
 *   part default  ←  provider global ui[component][part]  ←  instance ui[part]
 * `instanceUi` is a getter so the instance prop stays reactive.
 */
export function useUi<P extends Record<string, string>>(
  component: string,
  parts: P,
  instanceUi?: () => ComponentUi<P> | undefined,
): (part: keyof P) => string {
  const globalUi = useComponentUi(component);
  return (part) => cn(parts[part], globalUi(part as string), instanceUi?.()?.[part]);
}
