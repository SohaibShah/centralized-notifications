# Grouping UI/UX redesign — flat, list-native stacks

**Status:** design approved (via visual companion), pending spec review
**Scope:** frontend-only restyle of the grouped feed. **No server, API, schema, or data changes** —
`groupTotal`, `topPriority`, per-member `priority`/`read`, and the read-split all already exist (from
the shipped grouping feature: [2026-08-03-grouping-design.md](./2026-08-03-grouping-design.md) +
[-refinements-](./2026-08-03-grouping-refinements-design.md)). This is purely how `packages/vue`
renders a stack.

## Problem

The shipped grouping renders a stack as a **rounded, inset card box with layered "iOS peek" edges**,
its own chevron/dot/count chrome, and an expanded region with a bordered mark-all button + nested
peek. The default notification cards are the opposite — **flat, full-width, sharp list rows**
(`border-b` separators, no card box; priority = a left edge-strip + faint wash). The two visual
languages clash: grouped rows read as floating cards, ungrouped rows as flat list rows. The goal is
to make a stack **live in the same flat list** as the default cards, distinguished only by a
lightweight, purpose-built stack treatment.

## Design language

All colours are the real design tokens (verified in `packages/vue/src/design/tokens.ts` +
`styles/lib.css`): **accent = pine green** `oklch(0.45 0.09 155)` (unread circle, links/actions);
**critical = danger red** `oklch(0.52 0.17 28)`; **high = warning amber** `oklch(0.72 0.14 68)`
(label text uses `warning-strong`); normal = muted; low = faint. Everything below is flat, sharp,
and full-width — no rounded card box, no drop shadows, no iOS layers.

### Collapsed stack row

A stack is a normal flat list row (same height/padding as a default card), distinguished by:

- **Two vertical stack-lines at the left edge**, full row height, ~2px each:
  - **outer line = neutral** "stack thread" (`--neutral`, a warm grey).
  - **inner line = the group's top priority colour** (critical red / high amber / normal-low a faint
    neutral so the line still reads as continuous). This replaces the old separate priority strip —
    priority is woven into the stack, not added beside it.
- **Anchored label** — the group label (`groupLabel`) sits just right of the stack-lines, with **no
  read-circle slot** (a group has no single read state). It anchors the row; it is _not_ indented to
  line up with member titles.
- **Right side:** the count pill (`groupTotal` for this read-state section) · a chevron (expand
  affordance) · the representative's relative time.
- **Background wash = the group's highest priority** (`topPriority`): critical → faint red wash, high
  → faint amber wash, normal/low → none. (Same wash the default card uses for its own priority.)
- No layers glyph, no rounded border, no faux peek edges.

A single-member entry (`groupTotal === 1`) is **not** a stack — it renders as a plain default card,
unchanged.

### Expanded stack (chosen layout: "anchored header + nested members", option C)

Clicking the collapsed row expands it in place:

- **Header** = the collapsed row, chevron rotated. Stays the anchor.
- **Members** render **nested (indented)** beneath the header, each the real
  `NotificationCardRenderer` (read circle, title, meta, expand-to-actions) — collapsed by default,
  exactly like the main feed.
- **Two thread lines run down the whole open stack** (header + members): outer neutral thread; inner
  line = **each member's own priority colour** (a per-row segment, so scanning down the inner line
  shifts red → amber → quiet, showing per-item severity while the neutral thread holds the stack
  together).
- **Header wash = top priority** (as collapsed).
- **Footer row** (the only row with **no thread lines** — it's a control, not a card): a tinted bar
  with a top divider, carrying **"Mark all read"** as a bordered mono-uppercase button (matching the
  flat feed's own mark-all chrome) on the left, and **"See all →"** as an accent link on the right.

### Read-split & sections (unchanged behaviour)

The unread stack sits under **Needs action**, the read stack under **Earlier** (the shipped
read-split). Marking members read/unread and "See all" (read-scoped drill-in) behave exactly as
today — only the visuals change.

## Component impact

- **`packages/vue/src/components/panel/StackRow.vue`** — the bulk of the work. Replace the rounded
  card + iOS-layer collapsed treatment and the accent-rail expanded treatment with: the flat row +
  two left stack-lines (neutral outer / priority inner) + anchored label + count/chevron/time +
  priority wash (collapsed); and the anchored header + nested threaded members + clean footer
  (expanded). The peek members already reuse `NotificationCardRenderer` — keep that; add the nesting
  indent and the per-member inner priority-line. Keep all existing emits/props and `data-test` hooks
  so the store wiring and e2e keep working.
- **`packages/vue/src/components/components/StackList.vue`** — unchanged logic (Needs action / Earlier
  split by `read`); only spacing tweaks if needed so stacks sit flush in the list.
- **Tokens** — introduce a `--neutral` stack-line token (or reuse an existing warm-grey line token);
  keep priority colours mapped through the existing `priorityDotClass` / priority tokens rather than
  hardcoding.

No changes to `feed.ts`, the routes, core, or shared. No migration.

## Accessibility

- The stack-lines and wash are decorative (`aria-hidden`); **priority must also be conveyed
  non-visually** — keep the existing priority word in the row's meta (the current design keeps a
  `priorityLabel` text), and the collapsed header keeps an `sr-only` priority word as today.
- The header button keeps `aria-expanded` / `aria-controls`; the count keeps its `aria-label`
  ("N in this group"); footer actions keep discernible names.
- Respect `prefers-reduced-motion` for the expand transition; the stack-lines are static.
- Colour is never the _only_ signal (priority word + line together).

## Testing

- **vue unit (`StackRow.spec.ts`)** — the collapsed row renders the two stack-lines and the priority
  wash for a critical-topped group; the header label is not in a circle slot; expanded renders nested
  members + a footer with mark-all + see-all and **no** thread line on the footer. Existing StackRow
  behaviour tests (peek fetch, mark-all emit, see-all payload, single-card path) keep passing against
  the same `data-test` hooks.
- **frontend-design-reviewer** on the reworked `StackRow.vue` / `StackList.vue`.
- **browser-tester / `/verify`** — publish a mixed-severity same-subject burst (critical + high +
  normal) via the module-sim control center; confirm collapsed row, per-member inner priority line,
  header anchor + top-priority wash, nested members, clean footer, and that grouped rows sit flush in
  the flat list beside ungrouped cards. No visual regression on the default cards.

## Out of scope

- Any server/API/schema/data change (this is a pure restyle).
- The grouping _behaviour_ (read-split, sort, mark-read, drill-in) — unchanged.
- The separate AI Summary UI work — its own branch.
