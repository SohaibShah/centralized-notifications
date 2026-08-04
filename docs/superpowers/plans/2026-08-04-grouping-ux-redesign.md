# Grouping UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the grouped feed so a stack lives in the same flat, sharp list as the default notification cards — no rounded card box, no iOS peek layers — distinguished only by two left stack-lines (neutral thread + priority) and a priority wash.

**Architecture:** Pure frontend restyle in `@notifications/vue`. Add a `--neutral` design token plus a small set of scoped CSS classes (`.nt-thread`, `.nt-prio-line`, `.nt-line-*`, `.nt-wash-*`) and two TS priority→class maps, then rewrite `StackRow.vue`'s collapsed and expanded markup to use them. `StackList.vue` gets only spacing tweaks. No server, API, schema, data, or migration changes; all grouping *behaviour* (read-split, sort, mark-read, drill-in, peek fetch) and every existing emit / prop / `data-test` hook are preserved.

**Tech Stack:** Vue 3 `<script setup>` + TS, Tailwind v4 (`@theme` off `--nt-*` tokens scoped to `.notifications-root`), Vitest + `@vue/test-utils`.

## Global Constraints

- **Frontend-only.** No changes to `feed.ts`, routes, `@notifications/core`, or `@notifications/shared`. No migration. (spec: "No changes to `feed.ts`, the routes, core, or shared. No migration.")
- **Real design tokens only — never hardcode hex/px in components; go through the tokens** (`packages/vue/src/design/tokens.ts` + `styles/lib.css`). accent = pine green `oklch(0.45 0.09 155)`; critical/danger red `oklch(0.52 0.17 28)`; high/warning amber `oklch(0.72 0.14 68)`, label text `warning-strong oklch(0.53 0.13 68)`.
- **Flat, sharp, full-width** — no rounded card box, no drop shadows, no faux peek edges, no layers glyph.
- **Preserve all existing emits, props, and `data-test` hooks** on `StackRow.vue` (`stack-header`, `stack-peek`, `stack-peek-error`, `stack-total`, `stack-time`, `stack-mark-all`, `stack-see-all`) so store wiring and e2e keep working. Emits unchanged: `open`, `action`, `unread`, `mark-all-read [key]`, `see-all [key,label,read]`.
- **Priority is never color-only.** Keep the `sr-only` priority word on the collapsed header; members keep their `priorityLabel` meta (they render the real `NotificationCardRenderer`).
- **A single-member entry (`groupTotal === 1`) is not a stack** — it renders as the plain `NotificationCardRenderer`, unchanged.
- `pnpm --filter @notifications/vue lint` and `typecheck` must be clean; `pnpm --filter @notifications/vue test` green.

---

### Task 1: Neutral token + stack CSS classes + priority→class maps

Foundation the rewrite consumes: a `--neutral` stack-line token, the CSS that draws the two lines + wash, and two typed priority→class maps (mirroring the existing `priorityDotClass`) so `StackRow.vue` never hardcodes a class string.

**Files:**
- Modify: `packages/vue/src/styles/lib.css` (add `--nt-color-neutral` + `--color-neutral` alias; add `@theme inline` name; append the `.nt-*` classes after the `.prio-high:hover` block near line 185)
- Modify: `packages/vue/src/design/tokens.ts` (append two maps)
- Test: `packages/vue/src/design/tokens.spec.ts` (create)

**Interfaces:**
- Produces:
  - `stackLineClass: Record<NotificationPriority, string>` — the inner priority-line **color modifier** class (`"nt-line-critical"` | `"nt-line-high"` | `""` for normal/low, which fall back to the base line color).
  - `stackWashClass: Record<NotificationPriority, string>` — the row background wash class (`"nt-wash-critical"` | `"nt-wash-high"` | `""` for normal/low).
  - CSS classes: `.nt-thread` (outer neutral thread, `::before` at `left:5px`), `.nt-prio-line` (base inner line, `::before` at `left:10px`, default `--color-line-strong`), `.nt-line-critical`/`.nt-line-high` (recolor the inner line), `.nt-wash-critical`/`.nt-wash-high` (wash, no inset strip).

- [ ] **Step 1: Write the failing test** — `packages/vue/src/design/tokens.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import { stackLineClass, stackWashClass } from "./tokens";

describe("stack priority → class maps", () => {
  it("colors the inner priority line for critical and high only", () => {
    expect(stackLineClass.critical).toBe("nt-line-critical");
    expect(stackLineClass.high).toBe("nt-line-high");
    // normal/low fall back to the base .nt-prio-line color — no modifier.
    expect(stackLineClass.normal).toBe("");
    expect(stackLineClass.low).toBe("");
  });

  it("washes the row for critical and high only", () => {
    expect(stackWashClass.critical).toBe("nt-wash-critical");
    expect(stackWashClass.high).toBe("nt-wash-high");
    expect(stackWashClass.normal).toBe("");
    expect(stackWashClass.low).toBe("");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @notifications/vue test -- tokens.spec`
Expected: FAIL — `stackLineClass`/`stackWashClass` are not exported from `./tokens`.

- [ ] **Step 3: Add the maps** — append to `packages/vue/src/design/tokens.ts`

```ts
/**
 * Grouped-stack chrome (see StackRow.vue). The inner "priority line" recolors for critical/high;
 * normal/low keep the base neutral line (empty modifier). Paired with `.nt-prio-line` in lib.css.
 */
export const stackLineClass: Record<NotificationPriority, string> = {
  critical: "nt-line-critical",
  high: "nt-line-high",
  normal: "",
  low: "",
};

/** Row background wash by priority — critical/high only; normal/low stay quiet (no wash). */
export const stackWashClass: Record<NotificationPriority, string> = {
  critical: "nt-wash-critical",
  high: "nt-wash-high",
  normal: "",
  low: "",
};
```

- [ ] **Step 4: Add the `--neutral` token** — in `packages/vue/src/styles/lib.css`

In the `@theme inline` block (after `--color-line-strong: var(--nt-color-line-strong);`, ~line 28) add:

```css
  --color-neutral: var(--nt-color-neutral);
```

In `.notifications-root`, after `--nt-color-line-strong: oklch(0.87 0.014 80);` (~line 63) add:

```css
  /* Stack "thread" line — a warm grey a step darker than line-strong so the stack reads as a thread. */
  --nt-color-neutral: oklch(0.8 0.028 85);
```

And in the scoped `--color-*` alias block, after `--color-line-strong: var(--nt-color-line-strong);` (~line 95) add:

```css
  --color-neutral: var(--nt-color-neutral);
```

- [ ] **Step 5: Add the stack CSS classes** — append after the `.prio-high:hover` block (~line 185) in `lib.css`

```css
/* ── Grouped-stack chrome (see StackRow.vue) ──
   A collapsed/expanded stack lives in the same flat list as the default cards. Two left lines mark
   it: an OUTER neutral "thread" (.nt-thread) down the header + members (never the footer), and an
   INNER per-row PRIORITY segment (.nt-prio-line). Wash reuses the card's priority mix WITHOUT the
   inset strip the default card carries — that strip would collide with these lines. */
.nt-thread {
  position: relative;
}
.nt-thread::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: var(--color-neutral);
}
.nt-prio-line {
  position: relative;
}
.nt-prio-line::before {
  content: "";
  position: absolute;
  left: 10px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: var(--color-line-strong); /* normal/low: a quiet segment so the line stays continuous */
}
.nt-line-critical::before {
  background: var(--color-danger);
}
.nt-line-high::before {
  background: var(--color-warning-strong);
}
.nt-wash-critical {
  background: color-mix(in oklab, var(--color-danger) 8%, transparent);
}
.nt-wash-high {
  background: color-mix(in oklab, var(--color-warning) 10%, transparent);
}
```

- [ ] **Step 6: Run the test — verify it passes**

Run: `pnpm --filter @notifications/vue test -- tokens.spec`
Expected: PASS (both cases).

- [ ] **Step 7: Verify the stylesheet still builds**

Run: `pnpm --filter @notifications/vue build:css`
Expected: exits 0, no Tailwind error (confirms `--color-neutral` resolves and the new classes compile).

- [ ] **Step 8: Commit**

```bash
git add packages/vue/src/design/tokens.ts packages/vue/src/design/tokens.spec.ts packages/vue/src/styles/lib.css
git commit -m "feat(vue): --neutral token + flat stack-line CSS classes and priority maps"
```

---

### Task 2: Rewrite StackRow.vue — flat threaded stack (collapsed + expanded)

Replace the rounded card + iOS-layer collapsed treatment and the accent-rail expanded treatment with the flat, threaded design: a full-width header row with two left stack-lines + anchored label + count/chevron/time + priority wash (collapsed), and nested threaded members (per-member priority line) + a clean footer with no lines (expanded). Keep the single-member plain-card path, all emits, and all `data-test` hooks.

**Files:**
- Modify: `packages/vue/src/components/panel/StackRow.vue` (script imports + full `<template>` rewrite)
- Test: `packages/vue/src/components/panel/StackRow.spec.ts` (add cases; keep existing)

**Interfaces:**
- Consumes: `stackLineClass`, `stackWashClass` from `../../design/tokens` (Task 1); `priorityLabel` (existing); `relativeTime`; `NotificationCardRenderer`; icons `ArrowRight`, `Check`, `ChevronRight`.
- Produces: unchanged component contract — props `{ entry: GroupedEntry; transport }`, emits `open`/`action`/`unread`/`mark-all-read`/`see-all`. New `data-test="stack-footer"` on the footer control row (footer must **not** carry `.nt-thread`/`.nt-prio-line`).

- [ ] **Step 1: Add the failing tests** — append inside the `describe("StackRow", …)` block in `StackRow.spec.ts`

```ts
  it("collapsed header carries the priority line + wash for a critical-topped group", () => {
    const w = mount(StackRow, {
      props: { entry: entry({ topPriority: "critical" }), transport: { get: vi.fn() } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    const header = w.get('[data-test="stack-header"]');
    expect(header.classes()).toContain("nt-prio-line");
    expect(header.classes()).toContain("nt-line-critical");
    expect(header.classes()).toContain("nt-wash-critical");
    // The outer neutral thread wraps the stack.
    expect(w.find(".nt-thread").exists()).toBe(true);
  });

  it("anchors the label with no read-circle dot slot", () => {
    const w = mount(StackRow, {
      props: { entry: entry({ topPriority: "high" }), transport: { get: vi.fn() } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    const header = w.get('[data-test="stack-header"]');
    // No 2x2 priority dot; the label anchors the row.
    expect(header.find(".size-2").exists()).toBe(false);
    expect(header.text().startsWith("DSAR #1042")).toBe(true);
  });

  it("expanded footer is a plain control row with no thread/priority lines", async () => {
    const get = vi.fn().mockResolvedValue({ items: [feedItem({ id: "m1" })], nextCursor: null });
    const w = mount(StackRow, {
      props: { entry: entry({ read: false }), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    const footer = w.get('[data-test="stack-footer"]');
    expect(footer.classes()).not.toContain("nt-thread");
    expect(footer.classes()).not.toContain("nt-prio-line");
    // The footer lives OUTSIDE the threaded region.
    expect(w.get(".nt-thread").find('[data-test="stack-footer"]').exists()).toBe(false);
  });

  it("wraps each peek member with its own priority line", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [feedItem({ id: "m1", priority: "critical" }), feedItem({ id: "m2", priority: "normal" })],
      nextCursor: null,
    });
    const w = mount(StackRow, {
      props: { entry: entry(), transport: { get } },
      global: { stubs: { NotificationCardRenderer: true } },
    });
    await w.get('[data-test="stack-header"]').trigger("click");
    await Promise.resolve();
    // Two member wrappers, both on the inner line; the critical one recolors it.
    expect(w.findAll('[data-test="stack-peek"] .nt-prio-line').length).toBe(2);
    expect(w.find('[data-test="stack-peek"] .nt-line-critical').exists()).toBe(true);
  });
```

- [ ] **Step 2: Run them — verify they fail**

Run: `pnpm --filter @notifications/vue test -- StackRow.spec`
Expected: FAIL — the four new cases fail (`nt-prio-line`/`nt-wash-critical`/`stack-footer` don't exist yet); the existing cases still pass.

- [ ] **Step 3: Update the `<script setup>` imports** in `StackRow.vue`

Change the shared type import (line ~4) to add `NotificationPriority`:

```ts
import type {
  FeedNotification,
  GroupedEntry,
  NotificationAction,
  NotificationPage,
  NotificationPriority,
} from "@notifications/shared";
```

Replace the tokens import (line 12) — drop `priorityDotClass`, add the two maps:

```ts
import { priorityLabel, stackLineClass, stackWashClass } from "../../design/tokens";
```

Add these computeds/helper just after `onMemberUnread` (end of `<script setup>`, ~line 74):

```ts
// Collapsed header / open header take the group's top-priority line + wash; each member takes its own.
const headerLine = computed(() => stackLineClass[props.entry.topPriority]);
const headerWash = computed(() => stackWashClass[props.entry.topPriority]);
function memberLine(p: NotificationPriority): string {
  return stackLineClass[p];
}
```

- [ ] **Step 4: Replace the entire `<template>`** in `StackRow.vue` with:

```vue
<template>
  <!-- A single-member entry is just a card — unchanged. -->
  <NotificationCardRenderer
    v-if="entry.groupTotal === 1"
    :notification="entry"
    @open="(n) => emit('open', n)"
    @action="(a, n, i) => emit('action', a, n, i)"
    @unread="(n) => emit('unread', n)"
  />

  <div v-else data-test="stack" class="border-b border-line">
    <!-- The neutral thread runs down the header + members; the footer sits OUTSIDE it (no lines). -->
    <div class="nt-thread">
      <button
        type="button"
        data-test="stack-header"
        class="nt-prio-line relative flex w-full items-center gap-2.5 py-3 pl-6 pr-4 text-left transition-colors duration-100"
        :class="[headerLine, headerWash, open ? 'bg-sunken/50' : 'hover:bg-sunken/50']"
        :aria-expanded="open"
        :aria-controls="open ? peekId : undefined"
        @click="toggle"
      >
        <span class="min-w-0 flex-1 truncate font-sans text-[13px] font-semibold text-text">
          {{ entry.groupLabel }}
        </span>
        <!-- Priority is conveyed by the line + wash (decorative); carry the word for SR / color-blind users. -->
        <span class="sr-only">{{ priorityLabel[entry.topPriority] }} priority</span>
        <span
          data-test="stack-total"
          :aria-label="`${entry.groupTotal} in this group`"
          class="shrink-0 rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted"
          >{{ entry.groupTotal }}</span
        >
        <Icon
          :icon="ChevronRight"
          :size="14"
          aria-hidden="true"
          class="shrink-0 text-faint motion-safe:transition-transform"
          :class="{ 'rotate-90': open }"
        />
        <time
          data-test="stack-time"
          :datetime="entry.createdAt"
          :title="entry.createdAt"
          class="shrink-0 font-mono text-[11px] tabular-nums text-faint"
          >{{ relativeTime(entry.createdAt) }}</time
        >
      </button>

      <div v-if="open" :id="peekId" data-test="stack-peek">
        <div v-if="loading" class="flex items-center gap-2 py-3 pl-11 text-[12px] text-muted">
          <Spinner :size="12" /> Loading…
        </div>
        <div
          v-else-if="peekError"
          data-test="stack-peek-error"
          class="flex items-center gap-2 py-3 pl-11 text-[12px] text-muted"
        >
          <span>Couldn't load these.</span>
          <button type="button" class="font-semibold text-accent underline" @click="fetchPeek()">
            Try again
          </button>
        </div>
        <div v-else-if="(peek ?? []).length === 0" class="py-3 pl-11 text-[12px] text-muted">
          Nothing left in this group.
        </div>
        <!-- Members are the real feed card, nested (indented) and threaded with a per-member priority
             line — collapsed by default, expandable in place to their actions, exactly like the feed. -->
        <div v-else>
          <div
            v-for="m in peek ?? []"
            :key="m.id"
            class="nt-prio-line pl-6"
            :class="memberLine(m.priority)"
          >
            <NotificationCardRenderer
              :notification="m"
              @open="onMemberRead"
              @action="(a, n, i) => emit('action', a, n, i)"
              @unread="onMemberUnread"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Footer: a control row, not a card — OUTSIDE the thread, so it carries no lines. -->
    <div
      v-if="open"
      data-test="stack-footer"
      class="flex items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2"
    >
      <button
        v-if="!entry.read"
        type="button"
        data-test="stack-mark-all"
        class="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:bg-sunken"
        @click="emit('mark-all-read', entry.groupKey ?? '')"
      >
        <Icon :icon="Check" :size="12" /> Mark all read
      </button>
      <span v-else aria-hidden="true" />
      <button
        type="button"
        data-test="stack-see-all"
        class="inline-flex items-center gap-1 text-[12px] font-semibold text-accent transition-colors hover:underline"
        @click="emit('see-all', entry.groupKey ?? '', entry.groupLabel ?? '', entry.read)"
      >
        See all
        <Icon :icon="ArrowRight" :size="13" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Run the StackRow tests — verify all pass**

Run: `pnpm --filter @notifications/vue test -- StackRow.spec`
Expected: PASS — the four new cases and all pre-existing cases (collapsed header, peek fetch `?group&limit=3`, member render, optimistic read flip, single-entry unread, see-all payload `["dsr:#1042","DSAR #1042",false]`, mark-all payload, peek error retry, single-card no-chrome).

- [ ] **Step 6: Typecheck** (confirms the dropped `priorityDotClass` import + new `NotificationPriority` import are clean)

Run: `pnpm --filter @notifications/vue typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/vue/src/components/panel/StackRow.vue packages/vue/src/components/panel/StackRow.spec.ts
git commit -m "feat(vue): flat, threaded StackRow — stack-lines, anchored label, clean footer"
```

---

### Task 3: StackList flush spacing + whole-package green

`StackList.vue`'s logic (Needs action / Earlier split, keyset pagination) is unchanged; the only visual concern is that flat stacks sit flush in the list beside ungrouped cards (no leftover gap/padding from the old card treatment). Then confirm the whole `@notifications/vue` package is green.

**Files:**
- Modify: `packages/vue/src/components/components/StackList.vue` (only if a wrapping gap/padding is present)
- Test: `packages/vue/src/components/components/StackList.spec.ts` if it exists (run; no new assertions expected), plus the full package suite

- [ ] **Step 1: Inspect StackList for stack-specific spacing**

Read `packages/vue/src/components/components/StackList.vue`. The two `<StackRow>` loops (Needs action ~line 66, Earlier ~line 92) must render rows with no extra horizontal padding or vertical gap around them — each `StackRow` root already owns its `border-b border-line` and full-width flat row. If a `space-y-*`, `gap-*`, `px-*`, or wrapper padding sits on or around the `<StackRow>` lists that would inset the flat rows, remove it so stacks are flush with the ungrouped `NotificationCardRenderer` rows. If none is present, make no change (the split/section chrome stays as-is).

- [ ] **Step 2: Run the StackList tests (if present) + confirm no regression**

Run: `pnpm --filter @notifications/vue test -- StackList`
Expected: PASS (or "no tests" — the file may have no spec; behaviour is unchanged either way).

- [ ] **Step 3: Run the whole vue package suite**

Run: `pnpm --filter @notifications/vue test`
Expected: all green (the ~240 existing vue tests + the new token/StackRow cases).

- [ ] **Step 4: Lint + typecheck the package**

Run: `pnpm --filter @notifications/vue lint && pnpm --filter @notifications/vue typecheck`
Expected: both exit 0.

- [ ] **Step 5: Commit** (only if StackList changed; otherwise skip)

```bash
git add packages/vue/src/components/components/StackList.vue
git commit -m "style(vue): grouped stacks sit flush in the flat feed list"
```

---

### Task 4: Browser verification + design & code review

The change is UI — per project rules it is not "done" on a green `tsc`/unit suite alone. Verify it renders and works in a running browser, then run the design and code reviewers on the reworked files.

**Files:** none (verification/review only)

- [ ] **Step 1: Run the app and publish a mixed-severity burst**

Run `pnpm dev` (frontend + backend + module-sim on :4000). From the control center (http://localhost:4000), publish a same-subject burst to one module with mixed priorities — one **critical**, one **high**, one **normal** — plus at least one unrelated single (ungrouped) notification, so the panel shows a stack beside a plain card.

- [ ] **Step 2: Verify with the browser-tester subagent (or `/verify`)**

Dispatch the `browser-tester` subagent to open the panel and confirm, with screenshots:
- Collapsed stack is a **flat full-width row** (no rounded box, no peek-layer edges) with the two left lines (neutral outer, priority inner = critical red), anchored label, count pill · chevron · time, and a faint red wash.
- Expanding shows the **anchored header** + nested members as real cards, each with its **own inner priority line** (red → amber → quiet down the thread), and a **footer with no lines** carrying "Mark all read" (bordered) + "See all →".
- Marking a member read/unread still works; "See all" drills in; the read-split (Needs action / Earlier) is intact.
- Grouped rows sit **flush** in the same list as the ungrouped card — no visual regression on the default cards.
- Flag if the member card's own left priority strip visually fights the inner thread line; if so, note it for a follow-up spacing tweak.

- [ ] **Step 3: Frontend design review**

Dispatch the `frontend-design-reviewer` subagent on `packages/vue/src/components/panel/StackRow.vue`, `packages/vue/src/components/components/StackList.vue`, and the `lib.css` / `tokens.ts` additions. Address any Critical/Important findings (fix + re-verify).

- [ ] **Step 4: Code review**

Dispatch the `code-reviewer` subagent on the branch diff (`git diff main..HEAD`). Address Critical/Important findings.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch. This restyle touches no server/API/PII/auth/migration surface, so `security-reviewer` is not required. Note that the read API-contract additions from the shipped grouping feature are already merged — this branch adds nothing to that contract — so no mentor sign-off gate applies here.

---

## Notes for the implementer

- **Why classes, not inline styles:** the two left lines are `::before` pseudo-elements (can't be inline Tailwind), and the wash reuses the project's `color-mix` token pattern from `.prio-*`. Keeping them as named classes in `lib.css` matches the existing `.prio-critical`/`.prio-high` precedent and keeps the component token-driven.
- **Why the wash classes omit the inset strip:** the default card's `.prio-*` adds `box-shadow: inset 3px 0 0` — a left strip that would land on top of the stack-lines. `.nt-wash-*` is wash-only for exactly that reason.
- **normal/low priority:** `stackLineClass`/`stackWashClass` return `""` — the base `.nt-prio-line` draws a quiet `--color-line-strong` segment and there's no wash, so a normal/low-topped stack still reads as a continuous thread without shouting.
