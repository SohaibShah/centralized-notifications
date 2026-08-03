import type { Notification } from "@notifications/shared";
import type { GroupAssignment, GroupingStrategy } from "./types";

// Anchored, bounded patterns (title is <= 500 chars), all linear-time — no catastrophic backtracking.
// Entity ids are treated as UPPERCASE-prefixed (DSAR-1042) so lowercase suffixes like "host-07" are
// NOT mistaken for a per-instance id — those group by kind instead.
const ENTITY_PATTERNS: RegExp[] = [
  /\b[A-Z]{2,10}-\d{1,10}\b/, // DSAR-1042
  /#\d{1,10}\b/, // #1042
];
// Volatile tokens stripped to form a "kind" template. A digit-run drops "07" from "host-07" but keeps
// the "host" stem, so hosts/instances collapse into one kind group.
const VOLATILE: RegExp[] = [
  /#\d{1,10}\b/g, // #1042
  /\b[0-9a-f]{8,}\b/gi, // hex / uuid-ish runs
  /\d[\d.,:/-]*/g, // any run starting with a digit: 07, 2026-01-01, 12:00, 1,024
];

/** Earliest entity match across ENTITY_PATTERNS (by position in the title), or null. */
function firstEntity(title: string): { text: string; end: number } | null {
  let best: RegExpExecArray | null = null;
  for (const re of ENTITY_PATTERNS) {
    const m = re.exec(title);
    if (m && (best === null || m.index < best.index)) best = m;
  }
  return best ? { text: best[0], end: best.index + best[0].length } : null;
}

/** Lowercased title with volatile tokens and non-letters stripped, whitespace collapsed. */
function templateOf(title: string): string {
  let t = title.toLowerCase();
  for (const re of VOLATILE) t = t.replace(re, " ");
  t = t
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

export function createTextGroupingStrategy(): GroupingStrategy {
  return {
    keyFor(n: Notification): GroupAssignment | null {
      // (1) explicit module-provided key
      const explicit = n.metadata?.["groupKey"];
      if (typeof explicit === "string" && explicit.trim() !== "") {
        return { key: `${n.module}:${explicit.trim()}`, label: n.title };
      }
      // (2) instance: earliest entity token in the title
      const ent = firstEntity(n.title);
      if (ent) {
        const norm = ent.text.toLowerCase().replace(/\s+/g, "");
        return { key: `${n.module}:${norm}`, label: n.title.slice(0, ent.end).trim() };
      }
      // (3) kind: normalized template
      const template = templateOf(n.title);
      if (template === "") return null;
      return {
        key: `${n.module}:${n.category ?? "_"}:${template}`,
        label: capitalize(template).slice(0, 60),
      };
    },
  };
}
