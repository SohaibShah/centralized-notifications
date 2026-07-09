import { Check, ClipboardList, ExternalLink, FolderOpen, X } from "@lucide/vue";
import type { Component } from "vue";

/**
 * Maps a contract action's `icon` identifier (a name from the design-system icon set,
 * e.g. "external-link") to its lucide component. The contract deliberately carries a
 * name, not a component/URL, so the design system owns which glyph each maps to. An
 * unknown or absent name renders no icon (label alone) rather than a broken glyph.
 */
const ACTION_ICONS: Record<string, Component> = {
  check: Check,
  x: X,
  "external-link": ExternalLink,
  "folder-open": FolderOpen,
  "clipboard-list": ClipboardList,
};

export function actionIcon(name?: string): Component | undefined {
  return name ? ACTION_ICONS[name] : undefined;
}
