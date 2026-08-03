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

// Bound the persisted key: keeps it under the route's `?group=` cap (300) and well under Postgres's
// btree tuple limit for the (group_key, created_at, id) index, even for a maximally-long/multibyte
// title. Truncation can only merge two very-long same-prefix keys — a benign over-grouping, never a
// leak — and is far better than an un-drill-into-able (400) group or a failing INSERT.
const KEY_MAX = 200;
function capKey(key: string): string {
  return key.length > KEY_MAX ? key.slice(0, KEY_MAX) : key;
}

// Keep stack headings to a consistent, sane length across all branches.
const LABEL_MAX = 80;
function capLabel(label: string): string {
  return label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) : label;
}

export function createTextGroupingStrategy(): GroupingStrategy {
  return {
    keyFor(n: Notification): GroupAssignment | null {
      // (1) explicit module-provided key
      const explicit = n.metadata?.["groupKey"];
      if (typeof explicit === "string" && explicit.trim() !== "") {
        return { key: capKey(`${n.module}:${explicit.trim()}`), label: capLabel(n.title) };
      }
      // (2) instance: earliest entity token in the title
      const ent = firstEntity(n.title);
      if (ent) {
        const norm = ent.text.toLowerCase().replace(/\s+/g, "");
        return {
          key: capKey(`${n.module}:${norm}`),
          label: capLabel(n.title.slice(0, ent.end).trim()),
        };
      }
      // (3) kind: normalized template
      const template = templateOf(n.title);
      if (template === "") return null;
      return {
        key: capKey(`${n.module}:${n.category ?? "_"}:${template}`),
        label: capLabel(capitalize(template)),
      };
    },
  };
}
