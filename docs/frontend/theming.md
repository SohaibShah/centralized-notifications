# Theming `@notifications/vue`

The library ships a complete default look, and lets you override it at three levels without
forking a component:

1. **Color & shape tokens** — CSS variables (`--nt-*`). Best for a global recolor / dark mode.
2. **Per-part class overrides** — the `ui` prop (global via the provider, or per instance).
   Best for "no borders", "square corners", "restyle this button/badge".
3. **Icon registry** — the `:icons` prop. Swap the icon pack, or hide icons.

Overrides are additive: pass nothing and you get the default look, byte-for-byte.

## 1. Color & shape tokens

Every color, radius, and border width is a scoped CSS variable on `.notifications-root`.
Override them in your own stylesheet (or inline) to re-theme globally:

```css
.notifications-root {
  --nt-color-accent: #6d28d9;
  --nt-color-bg: #0b0b0f;
  --nt-radius-md: 0; /* square corners everywhere */
  --nt-color-line: transparent; /* hide 1px hairline borders globally */
}
```

The full token list is in `packages/vue/src/styles/lib.css`. Dark mode is just a different set
of `--nt-*` values (see `styles/presets/dark.css`). To fully remove borders on specific surfaces
(not just hide their color), use a `ui` override — e.g. `ui: { card: { root: 'border-0' } }`.

## 2. Per-part `ui` overrides

Each component is built from named **parts** (e.g. `root`, `icon`, `badge`). Override any part's
classes; `tailwind-merge` makes your class win, so `border-0 rounded-none` actually _removes_ the
default `border rounded-md`.

**Global** — on the provider, keyed by component name then part. Applies everywhere:

```vue
<NotificationProvider
  :config="config"
  :ui="{
    card: { root: 'border-0 rounded-none shadow-none' },
    bell: { badge: 'bg-black text-white rounded-none' },
    button: { root: 'uppercase tracking-wide' },
  }"
/>
```

**Per instance** — the `ui` prop on any component, merged over the global:

```vue
<NotificationBell :ui="{ icon: 'hidden', badge: 'bg-indigo-600' }" />
```

Precedence (last wins): component default → provider `ui[component]` → instance `ui`.

The per-instance `ui` prop is fully typed (`ComponentUi<…>`) — a misspelled part is a compile
error. The **global** provider map (`NotificationUi`) is `Record<string, Record<string, string>>`,
so its component and part keys are **not** type-checked: a typo like `ui: { bel: { root } }`
compiles and silently does nothing. Use the reference table below as the source of truth for
global keys.

### Component → part reference

These part names are public API.

| `ui` component key  | Parts                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `button`            | `root`                                                                                                         |
| `chip`              | `root`                                                                                                         |
| `skeleton`          | `root`                                                                                                         |
| `spinner`           | `root`                                                                                                         |
| `state-panel`       | `root`, `icon`, `title`, `description`                                                                         |
| `bell`              | `root`, `badge`                                                                                                |
| `panel`             | `root`, `toolbar`, `tab`, `iconButton`, `searchField`, `body`                                                  |
| `toast`             | `root`, `dot`, `priority`, `close`, `title`, `description`, `meta`, `viewButton`, `dismissButton`, `countdown` |
| `toast-viewport`    | `root`, `overflow`                                                                                             |
| `card`              | `root`, `readToggle`, `title`, `caret`, `time`, `description`, `meta`, `priority`, `action`                    |
| `citation-chip`     | `root`, `toggle`, `dot`, `popover`, `action`                                                                   |
| `feed-banner`       | `root`, `exit`                                                                                                 |
| `stack`             | `root`, `header`, `glyph`, `label`, `count`, `chevron`, `time`, `member`, `footer`, `markAll`, `seeAll`        |
| `stack-list`        | `root`, `sectionHeader`, `sectionTitle`, `count`, `showEarlier`                                                |
| `feed-list`         | `root`, `sectionHeader`, `sectionTitle`, `count`, `markAll`, `showEarlier`                                     |
| `filter-menu`       | `trigger`, `badge`, `panel`, `searchField`, `option`, `clearButton`                                            |
| `inbox-tab`         | `root`, `summaryCard`, `summaryToggle`, `chipRow`, `mutedToggle`, `body`                                       |
| `assistant-tab`     | `root`, `scroller`, `empty`, `aiBubble`, `userBubble`, `composer`, `input`, `sendButton`, `offState`           |
| `admin`             | `root`, `nav`, `title`, `navItem`, `content`                                                                   |
| `admin-modules`     | `root`, `title`, `description`, `row`, `toggle`                                                                |
| `admin-features`    | `root`, `title`, `description`                                                                                 |
| `admin-maintenance` | `root`, `title`, `description`, `row`                                                                          |
| `admin-devlabs`     | `root`                                                                                                         |
| `form`              | `root`, `heading`, `error`                                                                                     |
| `text-field`        | `root`, `label`, `hint`, `input`, `error`                                                                      |
| `select-field`      | `root`, `label`, `select`, `error`                                                                             |
| `switch-field`      | `root`, `label`, `hint`, `track`, `thumb`                                                                      |
| `mute-editor`       | `root`, `groupTitle`, `row`, `resume`, `snoozeSummary`, `muteToggle`                                           |

> Nested components resolve their own global `ui` entry via injection — e.g. `ui: { stack: … }`
> restyles every `StackRow` inside a `StackList` without forwarding. Only components a consumer
> mounts directly (`NotificationBell`, `NotificationPanel`, `NotificationAdmin`, `FormRenderer`,
> `Button`, `Icon`, `StatePanel`) accept a per-instance `ui` prop from you; the rest are reached
> through the global map by their component key above.

## 3. Icon registry

All icons resolve by **name** through a registry (defaults in `theming/icons.ts`, exported as
`defaultIcons`). Override globally on the provider:

```vue
<NotificationProvider
  :config="config"
  :icons="{
    bell: MyBellIcon, // swap one glyph (any component taking `size`/`stroke-width`)
    'chevron-down': false, // hide it everywhere
  }"
/>
```

- **Swap the whole pack**: map each name to your own icon component.
- **Hide everywhere**: set a name to `false` — `<Icon>` renders nothing.
- **Hide / resize one instance**: use the `ui` icon part, e.g. `:ui="{ icon: 'hidden' }"` or
  `size-6`.
- An unknown/absent name renders nothing (label alone) — never a broken glyph.

`IconName` (the union of registry keys) and `IconRegistry` are exported for typed overrides.

## Escape hatches summary

| I want to…                          | Use                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Recolor / dark mode                 | `--nt-color-*` tokens                                                             |
| Square corners, globally            | `--nt-radius-*` tokens                                                            |
| Remove borders                      | `--nt-color-line: transparent` (hide) or a `ui` override with `border-0` (remove) |
| Restyle one part of one component   | instance `ui` prop                                                                |
| Restyle a part across the whole app | provider `:ui` map                                                                |
| Different icon set                  | provider `:icons` map                                                             |
| Hide an icon                        | `:icons` `{ name: false }` (global) or `ui.icon: 'hidden'` (instance)             |
