# Component `ui` overrides + icon registry — design

**Status:** approved design, pre-implementation
**Branch:** `feat/component-ui-overrides` (off `main`)
**Package:** `@notifications/vue`

## Problem

The library's look is hard-coded. Components render fixed Tailwind classes (`border`,
`rounded-md`, button shapes, washes) and import their icons directly from `@lucide/vue`. A
consumer can recolor via the `--nt-*` CSS variables, but cannot:

- remove borders or square off corners,
- restyle buttons/chips/badges,
- swap the icon pack, or
- hide icons.

The gripe is **structural/appearance rigidity**, not color. Overriding a color variable does
not help when what you want is _no_ border, _your_ icons, or _no_ icons.

## Goal

Make every public component's appearance and icons fully overridable by the consuming
developer, while keeping our design as the out-of-the-box default. Chosen direction: **styled
but fully overridable** (Radix Themes / Nuxt UI model) — not headless, not an `unstyled` mode
(those remain possible later; this design is a strict subset).

## Non-goals (deliberate, YAGNI)

- **No structural/markup replacement via slots** in this pass (swapping the whole card/toast
  body). The `ui` + icon layers cover every named use case; slots can be added later without
  reworking this.
- **No folding colors into JS.** Color theming stays on the `--nt-*` CSS variables — they work
  well and carry runtime dark mode. This design adds a parallel structure/appearance layer.
- **No change to component behavior, data flow, transport, or the read/API contract.** This is
  a presentation-layer change inside `@notifications/vue`.

## Constraints (carried from the project)

- Components are built on Tailwind utilities compiled at build time; "fully overridable"
  resolves under the hood to class overrides merged so the consumer's classes win.
- New public API surface on the component library → **mentor sanity-check before merge** (the
  component API is a mentor-gated contract per the project workflow).
- New npm dependency (`tailwind-merge`) must be called out per the security/deps rule.

---

## Architecture

### Named parts + `useUi`

Each component declares its stylable **parts** with default classes in one place, and renders
each part via a resolver rather than a hardcoded `class`:

```ts
// bell.ui.ts (or co-located in the SFC)
export const bellParts = {
  root: "relative inline-flex items-center justify-center rounded-md border border-line bg-surface size-9",
  icon: "size-5 text-muted",
  badge:
    "absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-danger text-danger-ink text-[11px] leading-4 text-center",
} as const;
export type BellUi = Partial<Record<keyof typeof bellParts, string>>;
```

```vue
<script setup lang="ts">
import { useUi } from "../theming/useUi";
const props = defineProps<{ ui?: BellUi }>();
const ui = useUi("bell", bellParts, () => props.ui);
</script>

<template>
  <button :class="ui('root')">
    <Icon name="bell" :class="ui('icon')" />
    <span v-if="count" :class="ui('badge')">{{ count }}</span>
  </button>
</template>
```

`ui(part)` returns the merged class string for that part, resolving three layers (later wins):

```
componentDefault[part]  ←  provider ui[component]?.[part]  ←  instance props.ui?.[part]
```

Merged with **`tailwind-merge`**, so a consumer's `border-0 rounded-none` _replaces_ our
`border rounded-md` instead of both landing in the list and fighting on specificity.

### tailwind-merge configured for our tokens

Our theme uses custom class groups (`bg-accent`, `text-muted`, `bg-sunken`, custom radii). A
default `twMerge` does not know these, so conflict resolution would be wrong (e.g. it might not
treat `bg-accent` and `bg-black` as the same group). We create **one project-local merge
instance** via `extendTailwindMerge`, taught our color names, radius scale, and any custom
class groups, and use it everywhere in `useUi`.

### Global tokens for the common "off" switches

Radius is already a token (`--nt-radius-sm|md|lg`). Add **`--nt-border-width`** (default the
current border width) so a consumer can make the whole library borderless / square with two
token lines, no `ui` needed:

```css
.notifications-root {
  --nt-border-width: 0;
  --nt-radius-md: 0;
}
```

Component defaults that draw borders reference the token (`border-[length:var(--nt-border-width)]`
via a small utility/class), so the token switch actually removes them.

---

## The `ui` API

### Provider level (global), separate props

The provider keeps `:config` for data/identity and gains two appearance props:

```vue
<NotificationProvider
  :config="config"
  :ui="{
    bell: { badge: 'bg-black text-white rounded-none' },
    card: { root: 'border-0 rounded-none shadow-none' },
    button: { root: 'uppercase tracking-wide font-semibold' },
  }"
  :icons="{ bell: MyBellIcon, chevronDown: false }"
/>
```

`ui` is keyed by **component name** then **part**; `icons` is the icon registry (below). Both
are provided via `inject` to every descendant. Types: a `NotificationUi` map whose keys are the
component names and whose values are that component's `*Ui` part type — misspelling a component
or a part is a compile error.

### Instance level (per component)

Every public component accepts a `ui` prop keyed by its parts, merged **over** the global:

```vue
<NotificationBell :ui="{ icon: 'hidden', badge: 'bg-indigo-600' }" />
```

Precedence at render: `componentDefault ← provider.ui[component] ← instance.ui`.

---

## Icon registry (swap / hide)

All icon usage routes through `<Icon name="…">`. `Icon.vue` changes from taking a
`Component` to taking a **name** resolved against an injected registry:

- **Default registry**: the current lucide mapping (bell, check, x, chevron-down, external-link,
  …), centralized into one `defaultIcons` map. The 15 components importing `@lucide/vue`
  directly are refactored to `<Icon name>`.
- **Override globally**: provider `:icons` merges over the defaults by name.
  - `bell: MyBellIcon` — swap one glyph (any Vue component accepting `size`/`stroke-width`).
  - `chevronDown: false` — hide that glyph everywhere (`<Icon>` renders nothing).
- **Hide / resize on one instance**: `:ui="{ icon: 'hidden' }"` or `size-6` — no separate prop,
  since `ui` already reaches the icon part.
- **Unknown/absent name** renders nothing (label alone), matching today's `actionIcon`
  behavior — never a broken glyph.

`Icon` keeps its a11y contract (decorative, `aria-hidden`; the interactive parent owns the
label), so swapping/hiding icons never removes an accessible name.

Icon **names** become a small documented enum (the union of registry keys) so `:icons`
overrides and `<Icon name>` are typed.

---

## Scope: components covered (one pass)

Infra: `theming/useUi.ts`, `theming/twMerge.ts` (configured instance), `theming/parts/*` (or
co-located `*Ui` types), icon registry (`design/icons.ts` reworked + `ui/Icon.vue`), provider
`inject` wiring, `--nt-border-width` token.

Then apply `parts` + `ui` prop + `<Icon name>` to **every public component**:

- Entry/surface: `NotificationBell`, `NotificationPopover`, `CriticalToast`,
  `CriticalToastViewport`.
- Feed: `FeedList`, `StackList`, `StackRow`, `NotificationCardRenderer`, `FeedBanner`,
  `FilterMenu`, `InboxTab`, `AssistantTab`, `CitationChip`.
- Primitives: `Button`, `Chip`, `Icon`, `StatePanel`, `Skeleton`, `Spinner`.
- Admin: `NotificationAdmin`, `ModulesPanel`, `FeaturesPanel`, `MaintenancePanel`,
  `DevLabsPanel`.
- Forms/prefs: `FormRenderer`, `SelectField`, `SwitchField`, `TextField`, `MuteRulesEditor`.

Each component's part set is small and named for what it is (`root`, `icon`, `badge`, `title`,
`meta`, `action`, …). Part names are part of the public API, so they are chosen deliberately
and documented.

---

## Compatibility

Fully additive. `ui` and `icons` are optional; with neither provided, every component renders
**byte-identical** classes to today (the defaults are the current hardcoded strings). No
existing consumer breaks; the reference app passes nothing and looks the same.

---

## Testing

- **`useUi`**: merge precedence (default < provider < instance); tailwind-merge conflict
  resolution with our custom tokens (e.g. `rounded-none` beats default `rounded-md`,
  `bg-black` beats `bg-accent`); a part with no override returns its default.
- **Icon registry**: default resolves; provider swap resolves the override; `name: false`
  renders nothing; unknown name renders nothing.
- **Per component (representative sample, not all 30)**: renders the overridden class on the
  targeted part; a "defaults unchanged" guard for at least the core components so a future
  refactor can't silently alter the default look.
- **e2e / browser**: one flow proving a global `ui` + `icons` override visibly changes the
  panel (borderless + swapped icons), and that omitting them is unchanged. Run through
  `browser-tester` / `frontend-design-reviewer`.

## Dependency

`tailwind-merge` — widely used, actively maintained; the standard tool for this exact problem.
Configured once via `extendTailwindMerge` for our theme. Flagged here per the deps rule.

## Rollout / gate

- One implementation pass (infra + all public components), one PR.
- **Mentor sanity-check before merge**: the `ui` prop shape, the component→part key names, and
  the icon-registry contract become public API of the component library. Additive and
  backward-compatible, but a contract other consumers will depend on — worth a review before
  locking in.

## Open questions

None blocking. Part-name choices per component are a design detail settled during
implementation (named for the element's role, documented as they land).
