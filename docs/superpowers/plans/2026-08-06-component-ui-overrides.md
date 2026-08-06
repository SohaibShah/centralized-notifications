# Component `ui` Overrides + Icon Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public `@notifications/vue` component's appearance and icons fully overridable by the consuming developer (per-part Tailwind class overrides + a pluggable icon registry), while keeping the current design as the byte-identical default.

**Architecture:** Each component declares named `parts` (default class strings). A `useUi(component, parts, () => props.ui)` composable resolves each part by merging three layers — component default ← provider global `ui[component]` ← instance `ui` prop — through a project-configured `tailwind-merge` so consumer classes win. All icons route through `<Icon name="…">`, resolved against an injected registry that the provider can override by name (swap a component, or `false` to hide). Colors stay on the existing `--nt-*` CSS variables, untouched.

**Tech Stack:** Vue 3 `<script setup>` + TS, Tailwind v4, Vitest (+ `@vue/test-utils`), `tailwind-merge` + `clsx` + `class-variance-authority` (all already dependencies).

## Global Constraints

- **No new dependency.** `tailwind-merge@^3.6.0`, `clsx@^2.1.1`, `class-variance-authority@^0.7.1` are already in `packages/vue/package.json`. (The design spec's "new dependency" note is therefore moot — do not add anything.)
- **Additive & backward-compatible.** `ui`/`icons` are always optional. With neither passed, every component must render the exact classes it renders today. A "defaults unchanged" guard test protects this for core components.
- **Colors unchanged.** Do not touch the `--nt-*` color tokens or fold color into JS. This work is structure/appearance + icons only.
- **No behavior/data/transport/API changes.** Presentation layer only.
- **TypeScript strict.** No `any` without an inline justification comment. `pnpm --filter @notifications/vue lint` + `typecheck` clean before any task is "done".
- **Public API surface.** The `ui` prop shape, component→part key names, and icon-name set become library public API → typed and exported; a mentor sanity-check is expected before merge (out of band, not a task).
- **Icon a11y contract preserved.** Icons stay decorative (`aria-hidden`); the interactive parent owns the accessible label. Swapping/hiding an icon never removes an accessible name.
- **Commit style:** Conventional Commits, `feat(vue):` / `test(vue):` / `refactor(vue):`. No AI trailers.

---

## File Structure

**New files**

- `packages/vue/src/theming/cn.ts` — configured `tailwind-merge` instance + `cn()` helper.
- `packages/vue/src/theming/cn.spec.ts`
- `packages/vue/src/theming/useUi.ts` — the part-resolver composable + inject key + `NotificationUi` type.
- `packages/vue/src/theming/useUi.spec.ts`
- `packages/vue/src/theming/icons.ts` — `defaultIcons` registry, `IconName` union, `IconRegistry` type, inject key. (Supersedes `design/icons.ts`.)
- `packages/vue/src/theming/icons.spec.ts`

**Modified files**

- `packages/vue/src/ui/Icon.vue` — resolve by `name` against the injected registry (keep legacy `icon` prop until Task 10).
- `packages/vue/src/provider/NotificationProvider.vue` — accept `:ui` and `:icons`; `provide` them.
- `packages/vue/src/styles/lib.css` — add `--nt-border-width` token + a border-width utility class.
- Every public component `.vue` (Tasks 5–9) — hardcoded `class="…"` → `:class="ui('part')"`, add `ui` prop, migrate icons to `<Icon name>`.
- `packages/vue/src/index.ts` — export the public theming types.
- `packages/vue/src/design/icons.ts` — removed in Task 10 (folded into `theming/icons.ts`).

---

## Task 1: `cn` helper (configured tailwind-merge)

**Files:**

- Create: `packages/vue/src/theming/cn.ts`
- Test: `packages/vue/src/theming/cn.spec.ts`

**Interfaces:**

- Produces: `export function cn(...inputs: ClassValue[]): string` — clsx-composed, tailwind-merge-deduped against our theme (custom color names + radius scale), last-wins on conflicts.

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/src/theming/cn.spec.ts
import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("later class wins on a standard conflict", () => {
    expect(cn("rounded-md", "rounded-none")).toBe("rounded-none");
    expect(cn("border", "border-0")).toBe("border-0");
  });

  it("dedupes our CUSTOM color tokens as one group (bg-accent vs bg-black)", () => {
    // Our theme registers custom color names (accent, surface, danger, sunken, …). Default
    // tailwind-merge doesn't know them and would keep BOTH. The configured instance must treat
    // them as the same 'background-color' group so the override wins.
    expect(cn("bg-accent", "bg-black")).toBe("bg-black");
    expect(cn("text-muted", "text-white")).toBe("text-white");
  });

  it("drops falsy inputs and keeps non-conflicting classes", () => {
    expect(cn("px-2", undefined, false && "hidden", "py-1")).toBe("px-2 py-1");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @notifications/vue test -- cn.spec`
Expected: FAIL (module `./cn` not found).

- [ ] **Step 3: Implement**

```ts
// packages/vue/src/theming/cn.ts
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

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @notifications/vue test -- cn.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/theming/cn.ts packages/vue/src/theming/cn.spec.ts
git commit -m "feat(vue): configured tailwind-merge cn() helper aware of our theme tokens"
```

---

## Task 2: `useUi` composable

**Files:**

- Create: `packages/vue/src/theming/useUi.ts`
- Test: `packages/vue/src/theming/useUi.spec.ts`

**Interfaces:**

- Consumes: `cn` (Task 1).
- Produces:
  - `type ComponentUi<P> = Partial<Record<keyof P, string>>`
  - `interface NotificationUi { [component: string]: Record<string, string> }` (global map, keyed component→part→classes)
  - `const NOTIFICATION_UI_KEY: InjectionKey<Ref<NotificationUi | undefined>>`
  - `function useUi<P extends Record<string, string>>(component: string, parts: P, instanceUi?: () => ComponentUi<P> | undefined): (part: keyof P) => string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/src/theming/useUi.spec.ts
import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { mount } from "@vue/test-utils";
import { NOTIFICATION_UI_KEY, useUi, type NotificationUi } from "./useUi";

const parts = { root: "rounded-md border border-line", icon: "size-5 text-muted" } as const;

function harness(
  globalUi: NotificationUi | undefined,
  instanceUi?: () => Partial<Record<keyof typeof parts, string>>,
) {
  const Child = defineComponent({
    setup() {
      const ui = useUi("bell", parts, instanceUi);
      return () => h("button", { class: ui("root") }, h("i", { class: ui("icon") }));
    },
  });
  const Parent = defineComponent({
    setup() {
      provide(NOTIFICATION_UI_KEY, ref(globalUi));
      return () => h(Child);
    },
  });
  return mount(Parent);
}

describe("useUi", () => {
  it("returns the part default when nothing overrides it", () => {
    const w = harness(undefined);
    expect(w.get("button").classes()).toContain("rounded-md");
    expect(w.get("i").classes()).toContain("text-muted");
  });

  it("provider global overrides the default (later wins via cn)", () => {
    const w = harness({ bell: { root: "rounded-none" } });
    expect(w.get("button").classes()).toContain("rounded-none");
    expect(w.get("button").classes()).not.toContain("rounded-md");
  });

  it("instance ui overrides the provider global", () => {
    const w = harness({ bell: { root: "rounded-none" } }, () => ({ root: "rounded-full" }));
    expect(w.get("button").classes()).toContain("rounded-full");
    expect(w.get("button").classes()).not.toContain("rounded-none");
  });

  it("only overrides the named part; other parts keep defaults", () => {
    const w = harness({ bell: { root: "border-0" } });
    expect(w.get("i").classes()).toContain("text-muted"); // icon untouched
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @notifications/vue test -- useUi.spec`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/vue/src/theming/useUi.ts
import { inject, type InjectionKey, type Ref } from "vue";
import { cn } from "./cn";

/** A single component's per-part override map (part name → extra/overriding classes). */
export type ComponentUi<P> = Partial<Record<keyof P, string>>;

/** The provider-level global override map: component name → its part→classes overrides. */
export type NotificationUi = Record<string, Record<string, string>>;

export const NOTIFICATION_UI_KEY: InjectionKey<Ref<NotificationUi | undefined>> =
  Symbol("notification-ui");

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
  const globalUi = inject(NOTIFICATION_UI_KEY, undefined);
  return (part) =>
    cn(parts[part], globalUi?.value?.[component]?.[part as string], instanceUi?.()?.[part]);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @notifications/vue test -- useUi.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/theming/useUi.ts packages/vue/src/theming/useUi.spec.ts
git commit -m "feat(vue): useUi part resolver with provider+instance override layering"
```

---

## Task 3: Icon registry + name-based `Icon.vue`

**Files:**

- Create: `packages/vue/src/theming/icons.ts`, `packages/vue/src/theming/icons.spec.ts`
- Modify: `packages/vue/src/ui/Icon.vue`

**Interfaces:**

- Produces:
  - `type IconName` = union of the kebab-case registry keys.
  - `type IconRegistry = Partial<Record<IconName, Component | false>>`
  - `const defaultIcons: Record<IconName, Component>`
  - `const NOTIFICATION_ICONS_KEY: InjectionKey<Ref<Record<string, Component | false>>>`
  - `Icon.vue` renders the registry component for `name`, nothing if `false`/absent; keeps legacy `icon?: Component` prop working (removed in Task 10).

**Registry (kebab name → lucide component).** Register every lucide icon currently imported in the package. Sweep with `grep -rhE 'from "@lucide/vue"' packages/vue/src` to confirm none are missed; the current set is:

`arrow-right`→ArrowRight, `bell`→Bell, `bell-off`→BellOff, `boxes`→Boxes, `check`→Check, `chevron-down`→ChevronDown, `circle`→Circle, `circle-check`→CircleCheck, `clipboard-list`→ClipboardList, `clock`→Clock, `external-link`→ExternalLink, `flask-conical`→FlaskConical, `folder-open`→FolderOpen, `layers`→Layers, `rotate-ccw`→RotateCcw, `scroll-text`→ScrollText, `search`→Search, `search-x`→SearchX, `send-horizontal`→SendHorizontal, `sliders-horizontal`→SlidersHorizontal, `sparkles`→Sparkles, `toggle-right`→ToggleRight, `wifi-off`→WifiOff, `x`→X.

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/src/theming/icons.spec.ts
import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { mount } from "@vue/test-utils";
import Icon from "../ui/Icon.vue";
import { defaultIcons, NOTIFICATION_ICONS_KEY } from "./icons";

const Stub = defineComponent({ name: "StubIcon", render: () => h("svg", { "data-stub": "1" }) });

function withRegistry(registry: Record<string, unknown>, name: string) {
  const Parent = defineComponent({
    setup() {
      provide(NOTIFICATION_ICONS_KEY, ref(registry));
      return () => h(Icon, { name });
    },
  });
  return mount(Parent);
}

describe("icon registry", () => {
  it("resolves a default icon by name", () => {
    const w = mount(Icon, { props: { name: "bell" } });
    expect(w.findComponent(defaultIcons.bell).exists()).toBe(true);
  });

  it("a provider override swaps the component for that name", () => {
    const w = withRegistry({ ...defaultIcons, bell: Stub }, "bell");
    expect(w.find("[data-stub]").exists()).toBe(true);
  });

  it("name mapped to false renders nothing", () => {
    const w = withRegistry({ ...defaultIcons, bell: false }, "bell");
    expect(w.find("svg").exists()).toBe(false);
  });

  it("an unknown name renders nothing (no broken glyph)", () => {
    const w = mount(Icon, { props: { name: "definitely-not-an-icon" } });
    expect(w.find("svg").exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @notifications/vue test -- icons.spec`
Expected: FAIL (module not found / Icon has no `name` prop).

- [ ] **Step 3: Implement `theming/icons.ts`**

```ts
// packages/vue/src/theming/icons.ts
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
  Layers,
  RotateCcw,
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
  layers: Layers,
  "rotate-ccw": RotateCcw,
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
```

- [ ] **Step 4: Rework `Icon.vue` to resolve by name (legacy `icon` kept)**

```vue
<!-- packages/vue/src/ui/Icon.vue -->
<script setup lang="ts">
import { computed, inject } from "vue";
import type { Component } from "vue";
import { defaultIcons, NOTIFICATION_ICONS_KEY } from "../theming/icons";

// `name` resolves against the injected registry (host-overridable). `icon` is the legacy direct-
// component prop, kept until every caller is migrated (Task 10). Icons stay decorative.
const props = withDefaults(defineProps<{ name?: string; icon?: Component; size?: number }>(), {
  size: 16,
});
const registry = inject(NOTIFICATION_ICONS_KEY, undefined);

const resolved = computed<Component | false | undefined>(() => {
  if (props.icon) return props.icon; // legacy path
  if (!props.name) return undefined;
  const fromRegistry = registry?.value?.[props.name];
  // A host may set a name to `false` to hide it; only fall back to the default when the host
  // hasn't set that key at all (so `false` is respected, undefined isn't).
  if (fromRegistry !== undefined) return fromRegistry;
  return (defaultIcons as Record<string, Component>)[props.name];
});
</script>

<template>
  <component :is="resolved" v-if="resolved" :size="size" :stroke-width="1.75" aria-hidden="true" />
</template>
```

- [ ] **Step 5: Run it, verify it passes**

Run: `pnpm --filter @notifications/vue test -- icons.spec`
Expected: PASS (4 tests). Also run the full vue suite to confirm the legacy `:icon=` callers still work: `pnpm --filter @notifications/vue test`. Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/vue/src/theming/icons.ts packages/vue/src/theming/icons.spec.ts packages/vue/src/ui/Icon.vue
git commit -m "feat(vue): host-overridable icon registry; Icon resolves by name (legacy icon prop kept)"
```

---

## Task 4: Provider wiring + `--nt-border-width` token

**Files:**

- Modify: `packages/vue/src/provider/NotificationProvider.vue`
- Modify: `packages/vue/src/styles/lib.css`
- Test: `packages/vue/src/provider/provider-theming.spec.ts` (create)

**Interfaces:**

- Consumes: `NOTIFICATION_UI_KEY` (Task 2), `NOTIFICATION_ICONS_KEY` + `defaultIcons` (Task 3).
- Produces: `<NotificationProvider>` accepts `ui?: NotificationUi` and `icons?: IconRegistry`, provided reactively to all descendants; a `.notifications-root` `--nt-border-width` token (default `1px`) + `.border-token` utility.

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/src/provider/provider-theming.spec.ts
import { describe, expect, it } from "vitest";
import { defineComponent, h, inject, ref } from "vue";
import { mount } from "@vue/test-utils";
import { NOTIFICATION_UI_KEY } from "../theming/useUi";
import { NOTIFICATION_ICONS_KEY } from "../theming/icons";
import NotificationProvider from "./NotificationProvider.vue";

// A probe child that reports what the provider provided.
const Probe = defineComponent({
  setup() {
    const ui = inject(NOTIFICATION_UI_KEY, ref(undefined));
    const icons = inject(NOTIFICATION_ICONS_KEY, ref({}));
    return () =>
      h("div", {
        "data-accent": JSON.stringify(ui.value?.bell?.root ?? null),
        "data-bell-hidden": String(icons.value.bell === false),
      });
  },
});

const config = { user: null, baseUrl: "http://x" };

describe("NotificationProvider theming props", () => {
  it("provides the global ui map to descendants", () => {
    const w = mount(NotificationProvider, {
      props: { config, ui: { bell: { root: "rounded-none" } } },
      slots: { default: () => h(Probe) },
    });
    expect(w.get("[data-accent]").attributes("data-accent")).toBe(JSON.stringify("rounded-none"));
  });

  it("merges :icons over the defaults (false hides)", () => {
    const w = mount(NotificationProvider, {
      props: { config, icons: { bell: false } },
      slots: { default: () => h(Probe) },
    });
    expect(w.get("[data-bell-hidden]").attributes("data-bell-hidden")).toBe("true");
  });
});
```

Note: if `NotificationProvider` requires transport/SSE wiring that makes a bare mount hard, provide the minimal `config` the existing provider tests use (check `packages/vue/src/provider/*.spec.ts` for the established mount harness and reuse it).

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @notifications/vue test -- provider-theming.spec`
Expected: FAIL (props not accepted / not provided).

- [ ] **Step 3: Implement provider changes**

In `NotificationProvider.vue` `<script setup>`, add to the props the optional `ui` and `icons`, and provide them (alongside the existing `provide(NOTIFICATIONS_KEY, …)`):

```ts
import { computed, provide } from "vue";
import { NOTIFICATION_UI_KEY, type NotificationUi } from "../theming/useUi";
import { NOTIFICATION_ICONS_KEY, defaultIcons, type IconRegistry } from "../theming/icons";

// merge existing props definition to add:
//   ui?: NotificationUi; icons?: IconRegistry;
const props = defineProps<{
  config: NotificationConfig;
  ui?: NotificationUi;
  icons?: IconRegistry;
}>();

provide(
  NOTIFICATION_UI_KEY,
  computed(() => props.ui),
);
provide(
  NOTIFICATION_ICONS_KEY,
  computed(() => ({ ...defaultIcons, ...(props.icons ?? {}) })),
);
```

(Adapt to the file's existing `defineProps` shape — do not drop existing props/wiring.)

- [ ] **Step 4: Add the border-width token**

In `packages/vue/src/styles/lib.css`, inside the `.notifications-root { … }` block, add:

```css
--nt-border-width: 1px;
```

and after the custom classes, add a utility so components can opt into the token:

```css
/* Border that honors the --nt-border-width token — set the token to 0 for a borderless library. */
.border-token {
  border-width: var(--nt-border-width);
  border-style: solid;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @notifications/vue test -- provider-theming.spec && pnpm --filter @notifications/vue typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/vue/src/provider/NotificationProvider.vue packages/vue/src/provider/provider-theming.spec.ts packages/vue/src/styles/lib.css
git commit -m "feat(vue): NotificationProvider :ui/:icons props + --nt-border-width token"
```

---

## The component recipe (Tasks 5–9)

Every component-application task follows the **same mechanical recipe**. Apply it per component; the part names are listed per component in each task's table.

1. **Declare parts.** At the top of `<script setup>`, define the part→default-classes map from the element's _current_ `class` attributes (copy them verbatim so defaults are unchanged), and its instance-prop type:
   ```ts
   const parts = { root: "<current root classes>" /* … */ } as const;
   const props = defineProps<{
     ui?: Partial<Record<keyof typeof parts, string>>; /* existing props */
   }>();
   const ui = useUi("<componentName>", parts, () => props.ui);
   ```
   Use a stable, documented `<componentName>` (kebab of the component, e.g. `bell`, `card`, `filter-menu`).
2. **Swap classes.** Replace each hardcoded `class="…"` on a declared part with `:class="ui('part')"`. Dynamic/conditional classes that already exist (e.g. priority washes) stay — append them: `:class="[ui('root'), extraConditional]"`.
3. **Migrate icons.** Replace `import { X } from "@lucide/vue"` + `<Icon :icon="X" />` with `<Icon name="x" />` (kebab name from the registry). Remove the now-unused lucide import.
4. **Test (per task, representative):** for at least one part, assert an instance `ui` override changes the rendered class; and a "defaults unchanged" assertion for the component's root (mount with no `ui` and assert a signature default class is present). Reuse each component's existing `.spec.ts` harness where one exists.
5. **Verify:** `pnpm --filter @notifications/vue test` for the touched specs + `typecheck` + `lint` clean.
6. **Commit** per task.

> Only elements a consumer would plausibly want to restyle need to be parts — root containers, icons, badges, titles, meta text, action buttons, list rows. Do not part-ify every `<div>`; keep the part set small and named for its role. Parts are public API.

---

## Task 5: Primitives

**Files (Modify + their existing specs; create a spec if none):**

- `packages/vue/src/ui/Button.vue`, `Chip.vue`, `StatePanel.vue`, `Skeleton.vue`, `Spinner.vue`
- (Icon.vue already done in Task 3.)

**Per-component parts:**

| Component  | `<componentName>` | Parts                                  | Icon migrations     |
| ---------- | ----------------- | -------------------------------------- | ------------------- |
| Button     | `button`          | `root`                                 | none                |
| Chip       | `chip`            | `root`, `icon`, `label`                | any lucide → `name` |
| StatePanel | `state-panel`     | `root`, `icon`, `title`, `description` | its lucide → `name` |
| Skeleton   | `skeleton`        | `root`                                 | none                |
| Spinner    | `spinner`         | `root`                                 | none                |

**Button special case (cva).** Keep the cva variants; merge `ui.root` last so an override wins:

```ts
import { cn } from "../theming/cn";
const props = defineProps<{ variant?: …; size?: …; type?: …; disabled?: boolean; ui?: { root?: string } }>();
const classes = computed(() => cn(button({ variant: props.variant, size: props.size }), props.ui?.root));
```

(Do not route Button through `useUi` — its single part is the cva output; `cn(...)` is the right merge. A global `ui.button.root` is also supported: inject it — but simplest is to keep Button instance-only for now and note it. If a global button override is required, read the provider `ui` via `useUi("button", { root: "" }, () => props.ui)` and pass the cva output as the default: `useUi("button", { root: button({variant,size}) }, …)`. Prefer this so Button honors provider global too.)

- [ ] **Step 1:** For Button, write a failing test: `mount(Button, { props: { ui: { root: "rounded-none" } } })` → root classes contain `rounded-none`, not `rounded-md`; and default mount contains `rounded-md`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Apply the recipe to all five primitives (tables above).
- [ ] **Step 4:** Run the primitive specs → PASS; `typecheck` + `lint` clean.
- [ ] **Step 5:** Commit `refactor(vue): parts + ui override on ui/ primitives (Button, Chip, StatePanel, Skeleton, Spinner)`.

---

## Task 6: Entry / surface components

**Files:** `packages/vue/src/components/NotificationBell.vue`, `NotificationPopover.vue`, `components/CriticalToast.vue`, `components/CriticalToastViewport.vue`

**Worked example — `NotificationBell.vue`** (full before→after so the recipe is unambiguous):

_Before_ (current): a `<button class="relative grid size-9 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-sunken hover:text-text">` containing `<Icon :icon="Bell" :size="18" />` and a `<span class="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[11px] font-semibold tabular-nums text-danger-ink">`.

_After_:

```vue
<script setup lang="ts">
// … existing imports MINUS `import { Bell } from "@lucide/vue"` …
import { useUi } from "../theming/useUi";

const parts = {
  root: "relative grid size-9 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-sunken hover:text-text",
  badge:
    "absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[11px] font-semibold tabular-nums text-danger-ink",
} as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("bell", parts, () => props.ui);
// … existing feed/panel/refs logic unchanged …
</script>

<template>
  <div ref="root" class="relative">
    <button ref="bellButton" type="button" :class="ui('root')" …>
      <Icon name="bell" :size="18" />
      <span v-if="feed.counts.unread > 0" :class="ui('badge')" aria-hidden="true">{{ badge }}</span>
    </button>
    <div v-if="panel.isOpen" class="absolute right-0 top-full z-40 mt-2">
      <NotificationPopover @close="() => close(true)" />
    </div>
  </div>
</template>
```

**Per-component parts:**

| Component             | `<componentName>` | Parts                                                                                         | Icon migrations     |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------- | ------------------- |
| NotificationBell      | `bell`            | `root`, `badge`                                                                               | `Bell`→`bell`       |
| NotificationPopover   | `panel`           | `root`, `header`, `body`, `footer` (map to the current wrapper/header/scroll/footer elements) | its lucide → `name` |
| CriticalToast         | `toast`           | `root`, `icon`, `title`, `body`, `close`, `countdown`                                         | its lucide → `name` |
| CriticalToastViewport | `toast-viewport`  | `root`                                                                                        | none                |

- [ ] **Step 1:** Failing test for Bell: `ui: { badge: 'bg-black' }` renders badge with `bg-black` (not `bg-danger`); default mount keeps `bg-danger`. (Reuse the existing Bell spec harness if present.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Apply the recipe to all four (table above); use the worked Bell code verbatim.
- [ ] **Step 4:** Run touched specs + full vue suite (icons migrated here must still render) → PASS; `typecheck`/`lint` clean.
- [ ] **Step 5:** Commit `refactor(vue): parts + ui override + icon-name migration on entry/surface components`.

---

## Task 7: Feed components

**Files:** `components/components/FeedList.vue`, `StackList.vue`, `components/panel/StackRow.vue`, `components/renderers/NotificationCardRenderer.vue`, `components/panel/FeedBanner.vue`, `components/components/FilterMenu.vue`, `components/panel/InboxTab.vue`, `components/panel/AssistantTab.vue`, `components/panel/CitationChip.vue`

**Per-component parts:**

| Component                | `<componentName>` | Parts (map to current elements)                                    | Icon migrations                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------ | --------------------------------------- |
| NotificationCardRenderer | `card`            | `root`, `dot`, `title`, `description`, `meta`, `actions`, `action` | lucide → `name`                         |
| StackRow                 | `stack`           | `root`, `header`, `label`, `count`, `chevron`, `member`, `footer`  | `Layers`/`ChevronDown`→names            |
| StackList                | `stack-list`      | `root`, `section`, `sectionLabel`                                  | none                                    |
| FeedList                 | `feed-list`       | `root`, `section`, `sectionLabel`                                  | none                                    |
| FeedBanner               | `feed-banner`     | `root`, `icon`, `text`, `action`                                   | lucide → `name`                         |
| FilterMenu               | `filter-menu`     | `root`, `trigger`, `panel`, `option`                               | `SlidersHorizontal`/`ChevronDown`→names |
| InboxTab                 | `inbox-tab`       | `root`, `empty`                                                    | lucide → `name`                         |
| AssistantTab             | `assistant-tab`   | `root`, `bubble`, `input`, `send`                                  | `SendHorizontal`/`Sparkles`→names       |
| CitationChip             | `citation-chip`   | `root`, `icon`, `label`                                            | lucide → `name`                         |

Notes: **StackRow already uses dynamic priority washes** (`nt-wash-*`, `headerBg`) — those conditional classes stay; append them next to the part class: `:class="[ui('root'), headerBg]"`. Do not move wash logic into parts.

- [ ] **Step 1:** Failing test for NotificationCardRenderer: `ui: { root: 'border-0' }` merges (root loses any default border); `ui: { title: 'text-red-500' }` applies. Reuse the existing renderer spec harness.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Apply the recipe to all nine (table above).
- [ ] **Step 4:** Run touched specs + full vue suite → PASS; `typecheck`/`lint` clean.
- [ ] **Step 5:** Commit `refactor(vue): parts + ui override + icon-name migration on feed components`.

---

## Task 8: Admin components

**Files:** `admin/NotificationAdmin.vue`, `admin/ModulesPanel.vue`, `admin/FeaturesPanel.vue`, `admin/MaintenancePanel.vue`, `admin/DevLabsPanel.vue`

**Per-component parts:**

| Component         | `<componentName>`   | Parts                                 | Icon migrations                |
| ----------------- | ------------------- | ------------------------------------- | ------------------------------ |
| NotificationAdmin | `admin`             | `root`, `nav`, `navItem`, `panel`     | lucide → `name`                |
| ModulesPanel      | `admin-modules`     | `root`, `row`, `moduleName`, `toggle` | `ToggleRight`/`Boxes`→names    |
| FeaturesPanel     | `admin-features`    | `root`, `row`, `label`, `toggle`      | lucide → `name`                |
| MaintenancePanel  | `admin-maintenance` | `root`, `row`, `action`               | `RotateCcw`/lucide → names     |
| DevLabsPanel      | `admin-devlabs`     | `root`, `row`, `label`                | `FlaskConical`→`flask-conical` |

- [ ] **Step 1:** Failing test for ModulesPanel (reuse its spec harness): a `ui` override on `root` applies.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Apply the recipe (table above).
- [ ] **Step 4:** Run admin specs + full suite → PASS; `typecheck`/`lint` clean.
- [ ] **Step 5:** Commit `refactor(vue): parts + ui override + icon-name migration on admin components`.

---

## Task 9: Forms / preferences

**Files:** `forms/FormRenderer.vue`, `forms/fields/SelectField.vue`, `forms/fields/SwitchField.vue`, `forms/fields/TextField.vue`, `components/preferences/MuteRulesEditor.vue`

**Per-component parts:**

| Component       | `<componentName>` | Parts                                  | Icon migrations                      |
| --------------- | ----------------- | -------------------------------------- | ------------------------------------ |
| FormRenderer    | `form`            | `root`, `field`, `label`, `error`      | none                                 |
| TextField       | `text-field`      | `root`, `label`, `input`, `error`      | none                                 |
| SelectField     | `select-field`    | `root`, `label`, `select`, `chevron`   | `ChevronDown`→`chevron-down`         |
| SwitchField     | `switch-field`    | `root`, `label`, `track`, `thumb`      | none                                 |
| MuteRulesEditor | `mute-editor`     | `root`, `row`, `moduleName`, `control` | `BellOff`→`bell-off`, lucide → names |

- [ ] **Step 1:** Failing test for TextField: `ui: { input: 'border-red-500' }` applies to the input.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Apply the recipe (table above).
- [ ] **Step 4:** Run form specs + full suite → PASS; `typecheck`/`lint` clean.
- [ ] **Step 5:** Commit `refactor(vue): parts + ui override + icon-name migration on forms/preferences`.

---

## Task 10: Public API, cleanup, docs, e2e

**Files:**

- Modify: `packages/vue/src/index.ts`, `packages/vue/src/ui/Icon.vue`, `packages/vue/src/design/icons.ts` (remove), callers of `design/icons.ts`'s `actionIcon`.
- Create: `docs/frontend/theming.md` (usage guide), an e2e/browser override check.

- [ ] **Step 1: Export public theming types** from `index.ts`:

  ```ts
  export { NOTIFICATION_UI_KEY } from "./theming/useUi";
  export type { NotificationUi, ComponentUi } from "./theming/useUi";
  export { defaultIcons } from "./theming/icons";
  export type { IconName, IconRegistry } from "./theming/icons";
  ```

  (Do not export the injection symbols consumers shouldn't touch beyond what's needed; `ui`/`icons` are passed as props, so the `NotificationUi`/`IconRegistry` types are the key exports.)

- [ ] **Step 2: Remove the legacy `icon` prop** from `Icon.vue` now that every caller uses `name`. Grep to confirm zero `:icon=` / `:icon "` usages remain: `grep -rn ':icon=' packages/vue/src` → none. Update `Icon.vue` to `name`-only.

- [ ] **Step 3: Fold `design/icons.ts` into the registry.** Replace `actionIcon(name)` usages with `<Icon :name="…">` (the action contract already carries kebab icon names — they line up with the registry keys). Delete `packages/vue/src/design/icons.ts`. Run the suite.

- [ ] **Step 4: Write `docs/frontend/theming.md`** — how to override: colors (`--nt-*` unchanged), the `--nt-radius-*` / `--nt-border-width` tokens, the `ui` prop (global via provider + per-instance, with a borderless/square example), and the icon registry (swap + hide). Include a table of every component's `<componentName>` and its part keys (the public API). Keep this as a real reference, not a stub.

- [ ] **Step 5: e2e / browser override flow.** Add a Playwright (or `browser-tester`-driven) check in the reference app: render the panel with a global `ui` (borderless + square) and `icons` (one swapped, one hidden), assert the DOM reflects it, and assert the un-themed render is unchanged. Reuse `frontend/e2e` patterns.

- [ ] **Step 6: Full verification.** `pnpm --filter @notifications/vue test`, `pnpm test`, `pnpm lint`, `pnpm typecheck` all clean. Then `frontend-design-reviewer` + `browser-tester` on the override flow.

- [ ] **Step 7: Commit** `feat(vue): export theming public API, drop legacy Icon prop, theming docs + e2e`.

---

## Final review (after all tasks)

- Run `code-reviewer` on the whole branch (parts/`ui`/icon refactor across 30 components + infra).
- `frontend-design-reviewer` to confirm defaults are visually unchanged and overrides behave.
- Then `superpowers:finishing-a-development-branch`. **Mentor sanity-check the public API** (`ui` prop shape, component→part names, icon-name set) before merge, per the project workflow.

## Self-review notes (author)

- **Spec coverage:** parts+`ui` (Tasks 1–2, 5–9), icon registry swap/hide (Task 3), provider separate `:ui`/`:icons` props (Task 4), `--nt-border-width` token (Task 4), tailwind-merge configured for our tokens (Task 1), all-public-components breadth (Tasks 5–9), additive/defaults-unchanged (recipe step 4 + guards), typed public API (Task 10), docs + e2e (Task 10), mentor gate (final). All spec sections mapped.
- **Dependency correction:** the spec called `tailwind-merge` a new dependency; it is already present — no install step (noted in Global Constraints).
- **Type consistency:** `useUi(component, parts, () => props.ui)`, `ComponentUi<P>`, `NotificationUi`, `IconName`, `IconRegistry`, `defaultIcons`, `NOTIFICATION_UI_KEY`, `NOTIFICATION_ICONS_KEY` are used identically across tasks.
