---
name: design-system
description: This project's design tokens and visual rules — color, type, spacing, motion, and the specific generic patterns to avoid. Use for any new UI, any styling change, or any design review.
---

# Design system

Fill in the token values below once you've picked them (with a designer, a Figma file, or
deliberately in a planning session with Claude) — then treat them as fixed. The point of
this file is that every screen pulls from the same small set of decisions instead of each
component inventing its own.

## Before building anything: name the decisions

Don't start writing components with default Tailwind values "for now." Spend one short
session deciding:
- **Color**: 4–6 named values — a background, a surface color, one primary accent, one
  text-primary, one text-secondary, one semantic-danger. Not "Tailwind blue-500" by
  default — pick something specific to this product.
- **Type**: one display/heading face, one body face (they can be the same family at
  different weights, but the choice should be deliberate, not "whatever the framework
  ships with"). Define a scale (e.g. 12/14/16/20/24/32/40) and don't invent sizes outside it.
- **Spacing**: a scale (e.g. 4/8/12/16/24/32/48/64px) — components use only these values,
  never an arbitrary `padding: 13px`.
- **Radius & elevation**: pick radius values with a reason (sharp for data-dense tools,
  soft for consumer-friendly products) and use them consistently, not "rounded-lg on
  everything by default."

**Chosen — "Editorial Command, ivory"** (decided in a visual-brainstorm session, Week 1 Task 7).
Tokens live in `frontend/src/styles/main.css` (`@theme`, OKLCH) and `frontend/src/design/tokens.ts`;
style via Tailwind utilities off these tokens — never hardcode a hex/px in a component.

```
Color (OKLCH):
  background     = oklch(0.975 0.012 85)   (warm ivory)   surface = oklch(0.995 0.006 85)
  sunken         = oklch(0.965 0.013 85)
  text-primary   = oklch(0.23 0.02 60)     text-secondary(muted) = oklch(0.5 0.02 60)
  faint          = oklch(0.63 0.018 70)    line = oklch(0.9 0.012 80)  line-strong = oklch(0.87 0.014 80)
  accent (pine)  = oklch(0.45 0.09 155)    accent-ink = oklch(0.98 0.01 155)
  danger         = oklch(0.52 0.17 28)     warning = oklch(0.72 0.14 68)   success = oklch(0.55 0.10 150)
Type (self-hosted via @fontsource; never a CDN):
  display = "Fraunces Variable"        (serif — app title, section heads only)
  body/UI = "Hanken Grotesk Variable"
  mono    = "JetBrains Mono Variable"  (counts, times, IDs, module codes; tabular-nums)
  scale   = 12 / 13 / 14 / 16 / 18 / 22 / 28   (~1.2 ratio)
Spacing:  4 / 8 / 12 / 16 / 24 / 32 / 48 / 64
Radius:   sm 6 · md 9 · lg 12 · pill 999   (hierarchy of intent, not one radius everywhere)
Motion:   feedback ≤120ms · state ~200ms · overlay ~240ms; transform/opacity only;
          ease-out cubic-bezier(0.16,1,0.3,1); new feed rows fade+rise; honor prefers-reduced-motion.
Icons:    lucide (@lucide/vue) — never emoji.
```

**Layout & component decisions (hold these so it stays a designed console, not a Linear clone):**

- **Flat + hairline.** No drop shadows on cards/rows — separate with 1px `line` borders and background
  shifts. Shadows are allowed only as *functional* elevation on overlays (dropdowns, popovers, modals).
- **Priority = a small dot + weight**, never a wall of colored left-bars: critical→danger, high→warning,
  normal→faint (filled), low→hollow ring. See `priorityDotClass` in `design/tokens.ts`.
- **Role-aware sidebar.** `Admin` nav is gated to the `admin` role; every user gets a settings cog.
  Drives off the session user's `roles`.
- **Filters = quick chip presets + a searchable `FilterMenu` dropdown** (module/priority/custom tags),
  applied filters shown as removable pills. Not a hand-rolled form (it's a `FilterRenderer`, not the
  `FormRenderer`).

## Patterns to actively avoid

These are the tells that make an app look AI-generated/templated rather than designed:
- A centered card with a soft drop shadow as the default layout for everything
- Purple-to-blue (or similar) gradient hero sections with no connection to the product
- Every corner at the same rounded radius with no hierarchy of intent
- Generic emoji used as icons instead of a real icon set
- Dashboard "stat cards" that are just a big number, a small label, and an unrelated icon
- Filler copy ("Lorem ipsum", "Click here", "Something went wrong") instead of specific,
  plain-language interface text
- Decorative animation with no functional purpose (things fading/sliding in just because)
- A type scale with only one or two sizes, so everything looks the same weight of important

## States are part of the design, not an afterthought

Every data-driven view needs an explicit:
- **Loading state** — a skeleton or spinner that matches the shape of the real content
- **Empty state** — tells the user what this space is for and what to do about it, not
  just a blank area or "No data."
- **Error state** — says what went wrong and how to recover, in the interface's voice
  ("Couldn't save your changes. Try again." not "Error: undefined is not a function")

A component that only renders correctly for the happy-path/populated-data case isn't
finished.

## Copy guidelines

- Active voice, sentence case, no filler. "Save changes," not "Submit."
- Name a button's action consistently through the whole flow: a "Publish" button leads to
  a "Published" confirmation, not "Success!"
- Name things the way the user thinks about them, not the way the system is built (a
  person manages "notifications," not "webhook config").

## Accessibility floor (non-negotiable, not a nice-to-have)

- Every interactive element has a visible keyboard focus state
- Color contrast meets WCAG AA for text
- Every form input has an associated, visible label (see `json-form-conventions`)
- Motion respects `prefers-reduced-motion`

## Component conventions

- Shared, reusable pieces (buttons, inputs, cards, modals) live in
  `frontend/src/components/ui/` and pull every value from the tokens above.
- Feature-specific components live under `frontend/src/features/<feature>/` and compose
  the shared `ui/` components — they should rarely need their own one-off CSS.
