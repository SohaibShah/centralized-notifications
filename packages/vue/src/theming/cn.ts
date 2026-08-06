import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Project-configured tailwind-merge. Our Tailwind theme (styles/lib.css `@theme inline`) renames
 * the color palette to semantic tokens (accent, surface, sunken, text, muted, faint, line,
 * line-strong, neutral, danger, warning, success, ai*, and their -ink/-strong variants). Default
 * tailwind-merge only knows the stock palette, so it would NOT treat `bg-accent` and `bg-black`
 * as the same conflict group — both would survive and fight on source order. We register our
 * color names into the color-bearing class groups so an override reliably wins.
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

/** clsx-composed, tailwind-merge-deduped class string (later wins on conflicts). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
