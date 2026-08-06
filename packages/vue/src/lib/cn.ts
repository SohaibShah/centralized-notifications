import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Merge conditional classes and resolve Tailwind conflicts (base → variant → override).
 *
 * tailwind-merge is configured for our theme: styles/lib.css (`@theme inline`) renames the color
 * palette to semantic tokens (accent, surface, sunken, text, muted, faint, line, line-strong,
 * neutral, danger, warning, success, ai*, and their -ink/-strong variants). Default tailwind-merge
 * only knows the stock palette, so it would NOT treat `bg-accent` and `bg-black` as the same
 * conflict group — both would survive and fight on source order. Registering our color names into
 * the color-bearing class groups makes an override reliably win — the basis of the `ui` override API.
 */
const COLORS = [
  "bg",
  "surface",
  "sunken",
  "text",
  "muted",
  "faint",
  "line",
  "line-strong",
  "neutral",
  "accent",
  "accent-ink",
  "danger",
  "danger-ink",
  "warning",
  "warning-strong",
  "success",
  "success-strong",
  "ai",
  "ai-1",
  "ai-2",
  "ai-3",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "bg-color": [{ bg: COLORS }],
      "text-color": [{ text: COLORS }],
      "border-color": [{ border: COLORS }],
      "ring-color": [{ ring: COLORS }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
