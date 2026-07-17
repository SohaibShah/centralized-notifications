# Design: AI-features "pizazz" — a scoped, on-brand AI visual identity

Date: 2026-07-17
Status: Approved (design); implementation plan to follow
Branch: `chore/qol-improvements` (another commit group on the existing QoL branch — frontend only)

## Context

The AI surfaces (the **Ask AI** tab, the **AI summary** disclosure on the Inbox tab, and the **AI
chat**) currently render in the same flat pine accent as everything else, so nothing signals "this is
the AI part." The goal is to make the AI features feel special — tasteful gradient + motion — the way
modern products (Copilot / Gemini / Notion AI) give AI its own visual language, **without** breaking
the restrained "Editorial Command, ivory" system.

Converged over a visual-brainstorm session (Balanced blend → muted/on-brand correction → cool family →
vivid-cohesive palette). All frontend, no new endpoints.

## Goals

- A **scoped AI identity**: a signature gradient + sparkle used only on AI surfaces, so AI reads as
  distinct but still belongs to the ivory system.
- A **special, read-friendly moment** on the AI summary card: a soft glow that is slightly present at
  rest, brighter on hover, and **blooms on click then settles back down** so the expanded text stays
  readable.
- Motion that is restrained and **honors `prefers-reduced-motion`**.

## Non-goals

- No backend/API changes; the AI itself stays a visual stub (canned thread, disabled composer).
- No dark-mode work.
- The aurora-style **glow is not applied app-wide** — only the AI summary card (see Locked decisions).
- No change to the AI summary's existing expand/collapse behavior (`aiOpen`) or its kill-switch
  (`settings.flags.aiSummaryEnabled`).

## Locked decisions

1. **Palette — "Vivid but cohesive" (cool family).** A three-stop gradient:
   - from `#2f8060` (emerald-pine) → via `#17a596` (teal) → to `#3a72c8` (sapphire).
   - Muted enough to sit on ivory, saturated enough to read as intentional color (the user rejected the
     original electric rainbow and the too-washed-out first muted pass).
   - Added as **AI-scoped design tokens** (OKLCH, matching the token system), not raw hex in components.
2. **Base treatment = the "Balanced blend":** calm at rest, comes alive on interaction.
3. **The bloom glow is summary-card-only** (Inbox tab). The Ask AI tab and the chat get the gradient
   text + sparkle identity but **not** the aurora glow.
4. **Bloom choreography** (AI summary card): rest opacity ≈ 13% → hover ≈ 30% → click blooms to ≈ 55%
   then eases back to the ~13% rest over ~1.3s (readable expansion). One-shot, never a persistent loop.
5. **Reduced motion:** under `prefers-reduced-motion`, no gradient drift / spin / bloom — the glow
   renders static at rest opacity and gradient text renders static. (The app already has a global
   reduced-motion guard; this must degrade gracefully under it.)

## Design

### Tokens — `frontend/src/styles/main.css` `@theme`

Add the AI gradient stops (OKLCH; verify in-browser against the approved hex at build time):

- `--color-ai-1` ≈ `oklch(0.53 0.10 162)` (emerald-pine `#2f8060`)
- `--color-ai-2` ≈ `oklch(0.63 0.11 185)` (teal `#17a596`) — also the single-color "AI accent" (sparkles)
- `--color-ai-3` ≈ `oklch(0.55 0.15 262)` (sapphire `#3a72c8`)

Keyframes (alongside the existing `enter-rise` / `countdown-recede`):

- `ai-gradient-shift` — `background-position` 0 → 200% (for the gradient text/border drift).
- `ai-spin` — `rotate(360deg)` (the glow blob).
- `ai-bloom` — `opacity: 0.55 → var(--ai-glow-rest, 0.13)` (the click bloom-settle).

All three gated behind the existing `@media (prefers-reduced-motion: reduce)` guard (it already zeroes
`animation-duration`, which freezes them at their start frame — acceptable, but the glow's rest opacity
must be its _static_ state, so set the blob's base `opacity` to the rest value, not 0).

### 1 — AI summary card (`frontend/src/features/notifications/panel/InboxTab.vue`)

The star. Replace the flat `border border-accent/20 bg-accent/5` wrapper with:

- **Animated gradient hairline border** — the standard 1px gradient-border trick (a padding-box /
  border-box gradient, or a `padding:1px` gradient wrapper with an inner `bg-surface` surface), using
  the three AI tokens with `ai-gradient-shift`.
- **The glow blob** — an absolutely-positioned, blurred (`blur(~19px)`) conic gradient of the three AI
  tokens, `z-0` behind the content (which is `z-1`), `overflow` clipped to the card. Base opacity =
  rest (~0.13), slowly rotating (`ai-spin`).
  - Hover (`group-hover`): opacity ~0.30.
  - Click: the existing `aiOpen` toggle also fires a **bloom** — add a `blooming` class that runs
    `ai-bloom` once (~1.3s), removed on `animationend` (or a matched timeout). This is the read-friendly
    bright-then-settle.
- **Label + sparkle** — "AI summary" in gradient text (see risk on contrast), Sparkles in AI teal.
- Keep the existing chevron rotate, the "Sample" pill, `aria-expanded`, `aria-controls`, and the
  expand/collapse detail exactly as-is.

### 2 — Ask AI tab (`frontend/src/features/notifications/NotificationPopover.vue`)

- "Ask AI" label → gradient text; the Sparkles icon → AI teal. No glow.
- Active/inactive states keep their current treatment (the active `bg-accent/10` is fine, or swap to a
  subtle AI-tinted active); this is a light identity touch, not the full bloom.

### 3 — AI chat (`frontend/src/features/notifications/panel/AssistantTab.vue`) — light touch (locked)

- AI-message Sparkles → AI teal.
- **A subtle gradient accent inside the AI (assistant) bubbles** — a restrained gradient-tinted
  border/edge on the `from === "ai"` bubbles (keep the `me` bubbles as-is on the solid pine accent).
- **A subtle gradient chat-send button.** The composer is still an inert stub this pass, so add a
  **disabled/decorative** gradient send button (paper-plane/arrow) in the composer's right slot in place
  of the current "Soon" pill; "coming soon" stays conveyed via the input's placeholder + aria-label. No
  focus-border animation yet — that arrives when the composer is wired to a real LLM (separate task).

## Data flow

- Bloom: AI summary button `@click` → toggles `aiOpen` (unchanged) **and** sets `blooming` true →
  `ai-bloom` runs once → `animationend`/timeout clears `blooming`. Hover is pure CSS (`group-hover`).
- Everything else is static styling; no store or state changes.

## Testing

- **Vitest (`InboxTab.spec.ts`):** the existing "toggles the AI-summary detail visibility" test must
  still pass. Add: the AI summary card renders the decorative glow element (a `data-test` hook) and the
  gradient label; clicking the summary toggles the `blooming` class (assert it's added on click). CSS
  animation/color itself is not unit-tested.
- **`prefers-reduced-motion`** correctness, the bloom timing, color/legibility, and "no jank" are
  verified by `browser-tester` + `frontend-design-reviewer`, not units.

## Review gates

- `frontend-design-reviewer` — is it tasteful and on-brand (does the vivid-cool palette sit right on
  ivory, is the gradient text legible, is the motion restrained), token usage (no raw hex).
- `code-reviewer` — the bloom class lifecycle (no leaked timers/listeners), the gradient-border/glow
  markup, and that `aiOpen`/kill-switch behavior is untouched.
- `browser-tester` — the rest→hover→bloom→settle choreography, reduced-motion degradation, gradient
  text legibility, and that the glow is summary-card-only (absent on Ask AI tab + chat).
- No `security-reviewer` (frontend-only, no endpoints/authz/migrations).

## Risks / open questions

- **Gradient-clip text legibility.** "AI summary" is small mono text; a gradient fill can lower
  contrast. If it fails AA or reads muddy, fall back to a **solid AI-teal** label and keep the gradient
  for the border + glow + sparkle only. Decide in the browser check.
- **Sapphire is the least "pine."** It's the far gradient stop (a minority of the blend), but watch that
  it doesn't read as an info/link blue; nudge toward teal if it does.
- **OKLCH conversion.** The tokens above are approximate conversions of the approved hex — verify they
  match visually in-browser and adjust chroma/lightness to taste.
- **Motion cost.** One blurred animated blob exists only on the single AI summary card, so cost is
  negligible; keep animations to `transform`/`opacity`/`background-position` only.
