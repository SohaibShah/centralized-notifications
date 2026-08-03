# Affordances & Intuitiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make interactions discoverable — a global pointer/hover rule, an open-and-seen notification card with sticky read, and a legible "N unread" / Mark-all header.

**Architecture:** One base-layer CSS rule restores the pointer cursor Tailwind v4 strips from raw buttons. The card gains a single `activate()` (click = expand + mark read); the feed store gains a per-session "sticky read" set so a just-opened card stays in place until the panel is reopened (a `flushSessionReads()` call on `NotificationPopover` mount). FeedList surfaces the unread count and a clearer Mark-all control.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Tailwind v4, `@lucide/vue`, Vitest, Playwright.

## Global Constraints

- **Frontend only** — no backend/API/migration changes; branch `chore/qol-improvements`.
- **Tailwind v4** — its Preflight defaults `<button>` to `cursor: default`; the base rule is the fix.
- Design-system tokens only (no raw hex); the unread accent uses `var(--color-accent)`.
- **Sticky read applies to single `markRead` only** — `markAllReadInScope` is NOT sticky (it clears the pile to Earlier immediately).
- Read items stay in "Needs action" only while their id is in `readThisSession`; `flushSessionReads()` (on panel reopen / `load` / `reset`) settles them into "Earlier".
- TS strict; `pnpm lint` + `pnpm typecheck` clean before a task is done.
- Conventional Commits; **never** add "Generated with AI" / "Co-Authored-By: AI" trailers.

---

## File Structure

- Modify `frontend/src/styles/main.css` — base-layer cursor rule.
- Modify `frontend/src/components/ui/Button.vue`, `frontend/src/components/ui/Chip.vue` — drop redundant `hover:cursor-pointer`.
- Modify `frontend/src/stores/feed.ts` — `readThisSession` sticky set + `flushSessionReads()` + grouping predicate.
- Modify `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue` — `activate()` open-and-seen, unread accent, hover hint.
- Modify `frontend/src/features/notifications/NotificationPopover.vue` — flush sticky reads on mount.
- Modify `frontend/src/features/notifications/components/FeedList.vue` — "N unread" pill + Check-icon Mark-all.
- Tests: `feed.spec.ts`, `NotificationCardRenderer.spec.ts`, `FeedList.spec.ts`, `NotificationPopover.spec.ts`, e2e `feed.spec.ts`.

---

### Task 1: Global pointer cursor + hover (base rule)

**Files:**

- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/components/ui/Button.vue`
- Modify: `frontend/src/components/ui/Chip.vue`

**Interfaces:**

- Produces: every `<button>`/`[role="button"]`/`[role="tab"]`/`a[href]`/`summary`/`label[for]` shows `cursor: pointer`; `:disabled` shows `not-allowed`.

- [ ] **Step 1: Add the base-layer rule**

In `frontend/src/styles/main.css`, inside the existing `@layer base { … }`, right after the `:focus-visible { … }` block, add:

```css
/* Tailwind v4 Preflight defaults <button> to `cursor: default`. Restore the pointer for
     every interactable from one place so raw buttons/tabs/links all read as clickable. */
button:not(:disabled),
[role="button"],
[role="tab"],
label[for],
summary,
a[href] {
  cursor: pointer;
}
:disabled {
  cursor: not-allowed;
}
```

- [ ] **Step 2: Remove the now-redundant fragment from the primitives**

In `frontend/src/components/ui/Button.vue`, delete ` hover:cursor-pointer` from the end of the base cva string (the string that ends `…disabled:opacity-50 hover:cursor-pointer`). It becomes `…disabled:opacity-50`.

In `frontend/src/components/ui/Chip.vue`, delete ` hover:cursor-pointer` from its base class string (`…ease-out hover:cursor-pointer` → `…ease-out`).

- [ ] **Step 3: Verify build, lint, and existing tests**

Run: `pnpm --filter @notifications/frontend build && pnpm lint && pnpm --filter @notifications/frontend test`
Expected: build succeeds; lint clean; all existing tests pass (no behavior change).

Run: `grep -n "cursor: pointer" frontend/src/styles/main.css`
Expected: the new rule is present. (Cursor rendering itself is verified by `browser-tester` in Task 5 — it isn't unit-testable.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/main.css frontend/src/components/ui/Button.vue frontend/src/components/ui/Chip.vue
git commit -m "feat(ui): global pointer cursor + hover affordance for all interactables"
```

---

### Task 2: Sticky read in the feed store

**Files:**

- Modify: `frontend/src/stores/feed.ts`
- Test: `frontend/src/stores/feed.spec.ts`

**Interfaces:**

- Consumes: existing `setRead`, `remove`, `markRead`, `markUnread`, `markAllReadInScope`, `groups`, `ApiError`.
- Produces: `flushSessionReads(): void` (exported); a `readThisSession` set that keeps single-`markRead` items in the `needs-action` group until flushed.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/stores/feed.spec.ts` (the mock already exposes `getMock`/`postMock`/`delMock` and preserves `ApiError`):

```ts
it("markRead() keeps the item in Needs action (sticky) until flushed, then moves it to Earlier", async () => {
  const feed = useFeedStore();
  getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
  await feed.load();

  await feed.markRead("a");
  expect(feed.items.find((n) => n.id === "a")?.read).toBe(true);
  // Sticky: still grouped under needs-action even though it's read.
  expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]);

  feed.flushSessionReads();
  expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
});

it("markAllReadInScope() is NOT sticky — items move to Earlier immediately", async () => {
  const feed = useFeedStore();
  getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
  await feed.load();

  await feed.markAllReadInScope();
  expect(feed.groups.map((g) => g.key)).toEqual(["earlier"]);
});

it("markUnread() clears stickiness so the item is genuinely unread again", async () => {
  const feed = useFeedStore();
  getMock.mockResolvedValueOnce(page([feedItem({ id: "a", read: false })]));
  await feed.load();
  await feed.markRead("a"); // sticky read
  await feed.markUnread("a");
  expect(feed.items.find((n) => n.id === "a")?.read).toBe(false);
  feed.flushSessionReads();
  // Still unread after a flush (not left stuck as read).
  expect(feed.items.find((n) => n.id === "a")?.read).toBe(false);
  expect(feed.groups.map((g) => g.key)).toEqual(["needs-action"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @notifications/frontend test -- feed`
Expected: FAIL — `flushSessionReads` is not a function; sticky grouping not implemented (markRead currently moves the row to Earlier).

- [ ] **Step 3: Add the sticky-read state + helpers**

In `frontend/src/stores/feed.ts`, near the other refs (after `items`/`seen` are declared), add:

```ts
// Ids read *this session* via a single open-and-seen click. They stay in "Needs action"
// (shown read) instead of jumping to "Earlier", so a just-opened card can actually be read.
// Cleared by flushSessionReads() on panel reopen / load / reset.
const readThisSession = ref<Set<string>>(new Set());

function stick(id: string): void {
  readThisSession.value = new Set(readThisSession.value).add(id);
}
function unstick(id: string): void {
  if (!readThisSession.value.has(id)) return;
  const next = new Set(readThisSession.value);
  next.delete(id);
  readThisSession.value = next;
}
function flushSessionReads(): void {
  if (readThisSession.value.size === 0) return;
  readThisSession.value = new Set();
}
```

- [ ] **Step 4: Make single markRead sticky; keep the others not-sticky**

In `markRead`, stick on success and unstick on the revert/remove paths:

```ts
async function markRead(id: string): Promise<void> {
  const target = items.value.find((n) => n.id === id);
  if (!target || target.read) return;
  setRead(id, true);
  stick(id); // open-and-seen: keep it in place while it's read this session
  try {
    await api.post(`/notifications/${encodeURIComponent(id)}/read`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      remove(id);
      return;
    }
    setRead(id, false); // genuine failure — revert
    unstick(id);
    console.warn(`[feed] failed to mark ${id} read; reverted`);
  }
}
```

In `markUnread`, drop stickiness when un-reading:

```ts
setRead(id, false);
unstick(id);
try {
  await api.del(`/notifications/${encodeURIComponent(id)}/read`);
} catch {
  setRead(id, true); // revert — the server didn't clear it
  console.warn(`[feed] failed to mark ${id} unread; reverted`);
}
```

In `remove`, also unstick (keep the sticky set consistent when a stale row is dropped):

```ts
function remove(id: string): void {
  unstick(id);
  items.value = items.value.filter((n) => n.id !== id);
}
```

`markAllReadInScope` is left unchanged — it never calls `stick`, so those items regroup to Earlier immediately.

- [ ] **Step 5: Sticky the grouping + clear on load/reset + export**

Update the grouping predicate (in the `groups` computed) so read-this-session items stay in needs-action:

```ts
for (const n of visibleItems.value) {
  const sticky = n.read && readThisSession.value.has(n.id);
  (n.read && !sticky ? earlier : needsAction).push(n);
}
```

In `reset()`, clear the set: add `readThisSession.value = new Set();` alongside the other resets.

In `load()`, flush at the start of the try (a fresh page reconciles positions): add `flushSessionReads();` as the first line inside `load()` (before `status.value = "loading"` is fine, or right after).

Add `flushSessionReads` to the store's returned object, in the `// actions` group next to `markUnread`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- feed`
Expected: PASS (the 3 new tests + the existing feed tests, including the 404-removal and markUnread tests).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck` → clean.

```bash
git add frontend/src/stores/feed.ts frontend/src/stores/feed.spec.ts
git commit -m "feat(feed): sticky read — a clicked card stays in place until the panel reopens"
```

---

### Task 3: Card open-and-seen + unread affordance

**Files:**

- Modify: `frontend/src/features/notifications/renderers/NotificationCardRenderer.vue`
- Test: `frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts`

**Interfaces:**

- Produces: clicking the card body / title / chevron calls `activate()` → expands (if expandable) AND emits `open`; unread cards carry an inset left accent; a hover "click to open" hint on unread, collapsed cards.

- [ ] **Step 1: Invert the two affected tests + add affordance tests**

In `NotificationCardRenderer.spec.ts`, replace the test `"expands via the chevron to reveal action buttons with icons, without marking read"` with:

```ts
it("expands via the chevron to reveal actions AND marks read (open-and-seen)", async () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: withActions({ id: "a" }) },
  });
  const chevron = wrapper.get('[aria-label="Show actions"]');
  expect(wrapper.find('[data-test="action"]').exists()).toBe(false); // collapsed
  await chevron.trigger("click");
  const actions = wrapper.findAll('[data-test="action"]');
  expect(actions).toHaveLength(1);
  expect(actions[0]!.find("svg").exists()).toBe(true);
  expect(wrapper.emitted("open")).toHaveLength(1); // opening now marks read
});
```

Replace the test `"clicking an action emits action and not open"` with:

```ts
it("clicking an action emits action without an extra open beyond the expand", async () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: withActions({ id: "a" }) },
  });
  await wrapper.get('[aria-label="Show actions"]').trigger("click"); // expand → open (1)
  await wrapper.get('[data-test="action"]').trigger("click");
  expect(wrapper.emitted("action")).toHaveLength(1);
  expect(wrapper.emitted("open")).toHaveLength(1); // the action itself did not emit another open
});
```

Add two tests at the end of the describe block:

```ts
it("marks an unread card with an inset left accent; a read card has none", () => {
  const unread = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "a" }) },
  });
  expect(unread.get("article").classes()).toContain("shadow-[inset_2px_0_0_var(--color-accent)]");
  const read = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "b", read: true }) },
  });
  expect(read.get("article").classes()).not.toContain("shadow-[inset_2px_0_0_var(--color-accent)]");
});

it("clicking the card body expands an expandable card and emits open", async () => {
  const wrapper = mount(NotificationCardRenderer, {
    props: { notification: feedItem({ id: "a", description: LONG }) },
  });
  const body = wrapper.get('[data-test="card-body"]');
  expect(body.classes()).toContain("truncate");
  await wrapper.get("article > div").trigger("click"); // the clickable body row
  expect(body.classes()).not.toContain("truncate");
  expect(wrapper.emitted("open")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @notifications/frontend test -- NotificationCardRenderer`
Expected: FAIL — chevron/body don't yet mark read on expand; no left-accent class.

- [ ] **Step 3: Replace `open`/`toggleExpand` with `activate` + fix the header comment**

In the card's `<script setup>`, replace the two functions:

```ts
function activate() {
  // Open-and-seen: clicking a card opens it (expands, if there's more to show) AND marks it read.
  if (canExpand.value) expanded.value = !expanded.value;
  emit("open", item.value); // parent → markRead (no-op if already read)
}
function markUnread() {
  emit("unread", item.value);
}
```

Update the file's top comment block to describe the open-and-seen behavior (replace the "expanding alone does not mark it read" sentence with): "Clicking the card (body, title, or chevron) opens it — expands any extra content AND marks it read (open-and-seen). Actions and 'Mark as unread' stop propagation and don't mark read here."

- [ ] **Step 4: Wire the template to `activate` + add the affordances**

Change the three click targets to `activate`:

- Outer body div: `@click="activate"` (was `@click="open"`).
- Title button: `@click.stop="activate"` (was `@click.stop="open"`).
- Chevron button: `@click.stop="activate"` (was `@click.stop="toggleExpand"`).

Add the unread inset accent to the `<article>`:

```html
<article
  class="group border-b border-line px-4 py-2.5 transition-colors duration-100 hover:bg-sunken"
  :class="[
      { 'animate-enter': isFresh },
      item.read ? '' : 'shadow-[inset_2px_0_0_var(--color-accent)]',
    ]"
></article>
```

Add the hover hint in the meta row (after the module/category, before/around the mark-unread button — mark-unread only shows when read, the hint only when unread, so they never collide on `ml-auto`):

```html
<span
  v-if="!item.read && !expanded"
  aria-hidden="true"
  class="ml-auto hidden font-mono text-[11px] uppercase tracking-wide text-accent group-hover:inline"
>
  click to open
</span>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- NotificationCardRenderer`
Expected: PASS (the two inverted tests + two new + the unchanged ones).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @notifications/frontend typecheck` → clean.

```bash
git add frontend/src/features/notifications/renderers/NotificationCardRenderer.vue frontend/src/features/notifications/renderers/NotificationCardRenderer.spec.ts
git commit -m "feat(feed): open-and-seen card — click opens + marks read, clear unread affordance"
```

---

### Task 4: Panel wiring — flush on reopen + "N unread" header + Mark-all

**Files:**

- Modify: `frontend/src/features/notifications/NotificationPopover.vue`
- Modify: `frontend/src/features/notifications/components/FeedList.vue`
- Test: `frontend/src/features/notifications/NotificationPopover.spec.ts`, `frontend/src/features/notifications/components/FeedList.spec.ts`

**Interfaces:**

- Consumes: `feed.flushSessionReads()` (Task 2); `Icon`, `Check` from the design system.
- Produces: the panel flushes sticky reads on open; the "Needs action" header shows a "N unread" pill and a Check-icon Mark-all button.

- [ ] **Step 1: Write the failing tests**

Add to `NotificationPopover.spec.ts` (add `vi` and `useFeedStore` imports):

```ts
it("flushes this-session reads when the panel opens", () => {
  const feed = useFeedStore();
  const spy = vi.spyOn(feed, "flushSessionReads");
  mount(NotificationPopover);
  expect(spy).toHaveBeenCalled();
});
```

Add to `FeedList.spec.ts`:

```ts
it("shows the unread count in the Needs action header and a Mark all read control", () => {
  const withRead: FeedGroup[] = [
    {
      key: "needs-action",
      label: "Needs action",
      items: [feedItem({ id: "u1" }), feedItem({ id: "r1", read: true })], // 1 unread, 1 sticky-read
    },
  ];
  const wrapper = mount(FeedList, {
    props: { groups: withRead, hasMore: false, loadingMore: false },
  });
  expect(wrapper.get('[data-test="needs-action-count"]').text()).toContain("1 unread");
  expect(wrapper.find('[data-test="mark-all"]').exists()).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @notifications/frontend test -- NotificationPopover FeedList`
Expected: FAIL — no flush on mount; no `needs-action-count` test id / "N unread" text.

- [ ] **Step 3: Flush on popover mount**

In `frontend/src/features/notifications/NotificationPopover.vue`, update the existing `onMounted`:

```ts
onMounted(() => {
  feed.flushSessionReads();
  inboxTabButton.value?.focus();
});
```

(`feed` is already `useFeedStore()` in this component.)

- [ ] **Step 4: "N unread" pill + Check-icon Mark-all in FeedList**

In `frontend/src/features/notifications/components/FeedList.vue` script, import the icon and add the unread computed:

```ts
import { Check } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
```

```ts
// Only genuinely-unread rows count — sticky-read items sitting in Needs action don't inflate it.
const unreadInNeedsAction = computed(
  () => needsAction.value?.items.filter((n) => !n.read).length ?? 0,
);
```

Replace the header count `<span>` and the Mark-all `<button>` with:

```html
<span
  data-test="needs-action-count"
  class="rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-accent"
>
  {{ unreadInNeedsAction }} unread
</span>
<button
  type="button"
  data-test="mark-all"
  class="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-accent transition-colors duration-100 hover:bg-sunken"
  @click="emit('markAll')"
>
  <Icon :icon="Check" :size="12" /> Mark all read
</button>
```

(`computed` is already imported in FeedList; if not, add it to the `vue` import.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- NotificationPopover FeedList`
Expected: PASS. Then `pnpm --filter @notifications/frontend test` — full frontend suite green (the existing FeedList "mark all read emits" test still passes; the "collapses the earlier group" test is unaffected).

- [ ] **Step 6: Typecheck + lint + commit**

Run: `pnpm --filter @notifications/frontend typecheck && pnpm lint` → clean.

```bash
git add frontend/src/features/notifications/NotificationPopover.vue frontend/src/features/notifications/components/FeedList.vue frontend/src/features/notifications/NotificationPopover.spec.ts frontend/src/features/notifications/components/FeedList.spec.ts
git commit -m "feat(feed): flush sticky reads on panel open; N-unread header + Mark-all control"
```

---

### Task 5: e2e rewrite (sticky model) + verification + reviews

**Files:**

- Modify: `frontend/e2e/feed.spec.ts`

**Interfaces:** consumes the running app (`pnpm dev`) with the seeded `admin` account (`notify-dev-2026`).

- [ ] **Step 1: Rewrite the read-flow assertions to the sticky model**

In `frontend/e2e/feed.spec.ts`, the first test currently asserts that clicking a card immediately relocates it to "Earlier". Replace the block from the `card.click()` read-assertion through the "Show N earlier" check with the sticky behavior: the card stays in Needs action (read, "Mark as unread" available) after clicking, and only relocates after the panel is closed and reopened.

```ts
// Clicking the card marks it read (FR-6) but — open-and-seen / sticky read — it STAYS in
// Needs action so you can read it, now showing the "Mark as unread" control.
const [readResponse] = await Promise.all([
  page.waitForResponse(
    (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST",
  ),
  card.click(),
]);
expect(readResponse.status()).toBe(204);
await expect(page.getByRole("button", { name: "Mark as unread" })).toBeVisible();

// Close and reopen the panel → the this-session read now settles into "Earlier".
await page.getByRole("button", { name: /Notifications/ }).click(); // close
await page.getByRole("button", { name: /Notifications/ }).click(); // reopen
const showEarlier = page.getByRole("button", { name: /Show \d+ earlier/ });
await expect(showEarlier).toBeVisible();
await showEarlier.click();
await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
```

> Implementer: confirm the bell toggle's accessible name (`/Notifications/`) matches how `feed.spec.ts` already opens it earlier in the same test; reuse that exact locator. If closing needs a different control (an X within the dialog), use whatever the panel already exposes — the point is close-then-reopen so `NotificationPopover` remounts and flushes.

- [ ] **Step 2: Run the e2e (app running)**

Run (one shell): `pnpm dev`
Run (another): `pnpm --filter @notifications/frontend test:e2e feed`
Expected: PASS. Adjust the close/reopen locators to the real DOM if needed (verify with `browser-tester`).

- [ ] **Step 3: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @notifications/frontend test:e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/feed.spec.ts
git commit -m "test(e2e): sticky-read model — clicked card stays until the panel reopens"
```

- [ ] **Step 5: Review gates**

- `frontend-design-reviewer` — the cursor/hover rule, the card open-and-seen affordance (unread accent, hover hint), and the header/Mark-all against the ivory system.
- `code-reviewer` — the sticky-read state machine (`readThisSession`/`stick`/`unstick`/`flush`, grouping predicate, the markRead vs markAllRead distinction) and the card refactor.
- `browser-tester` — pointer cursors across every screen; open-and-seen (click opens + marks read in place); sticky read; the reopen-flush; the "N unread" header and Mark-all.
- No `security-reviewer` (frontend-only, no endpoints/authz/migrations).

---

## Verification (end-to-end)

1. `pnpm dev` → log in as `admin`.
2. **Cursors:** hovering any button/tab/link/card shows a pointer; disabled controls show not-allowed.
3. **Open-and-seen:** an unread card shows the left accent + (on hover) "click to open"; clicking it expands the body/actions AND marks it read, and it **stays in Needs action** (now muted, with "Mark as unread").
4. **Sticky flush:** close and reopen the bell → the read card has moved to "Earlier".
5. **Header:** "Needs action" shows "N unread"; "Mark all read" reads as a button (border + check) and clears the pile to Earlier immediately.
6. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all green.

## Notes / deliberate scope

- **Sticky read is single-click only.** "Mark all read" intentionally clears to Earlier at once.
- **Flush triggers:** panel reopen (`NotificationPopover` mount), plus `load()`/`reset()`.
- **`isLongBody` heuristic (>140 chars)** for the expand chevron is unchanged from the prior QoL batch.
- **Cursor is CSS** — verified by `browser-tester`/design review, not a unit test.
