import {
  ArrowRight,
  Bell,
  BellOff,
  Boxes,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  ClipboardList,
  Clock,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  Inbox,
  Layers,
  RotateCcw,
  RotateCw,
  ScrollText,
  Search,
  SearchX,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  ToggleRight,
  WifiOff,
  X,
} from "@lucide/vue";
import type { Component, InjectionKey, Ref } from "vue";

/** The library's icon set. Keys are the stable public icon NAMES (kebab-case); a host overrides
 *  any of them via <NotificationProvider :icons>. Add a key here when a component needs a new glyph. */
export const defaultIcons = {
  "arrow-right": ArrowRight,
  bell: Bell,
  "bell-off": BellOff,
  boxes: Boxes,
  check: Check,
  "chevron-down": ChevronDown,
  circle: Circle,
  "circle-check": CircleCheck,
  "clipboard-list": ClipboardList,
  clock: Clock,
  "external-link": ExternalLink,
  "flask-conical": FlaskConical,
  "folder-open": FolderOpen,
  inbox: Inbox,
  layers: Layers,
  "rotate-ccw": RotateCcw,
  "rotate-cw": RotateCw,
  "scroll-text": ScrollText,
  search: Search,
  "search-x": SearchX,
  "send-horizontal": SendHorizontal,
  "sliders-horizontal": SlidersHorizontal,
  sparkles: Sparkles,
  "toggle-right": ToggleRight,
  "wifi-off": WifiOff,
  x: X,
} satisfies Record<string, Component>;

export type IconName = keyof typeof defaultIcons;

/** A host override: swap a name to another component, or `false` to hide that icon everywhere. */
export type IconRegistry = Partial<Record<IconName, Component | false>>;

/** Provided by NotificationProvider = defaultIcons merged with the host's :icons. */
export const NOTIFICATION_ICONS_KEY: InjectionKey<Ref<Record<string, Component | false>>> =
  Symbol("notification-icons");
