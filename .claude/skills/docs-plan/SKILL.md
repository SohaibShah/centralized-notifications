---
name: docs-plan
description: Scan the codebase for things that look worth documenting (complex components, shared utilities, architecture decisions, setup steps), suggest candidates, and plan the documentation with the user before writing anything. Manual only — run with /docs-plan. Does not cover API endpoints, which are handled automatically — see api-documentation.md.
disable-model-invocation: true
---

Never write documentation as a side effect of running this skill. This skill produces a
**plan to discuss**, not a finished doc — writing happens only after the user picks what
they actually want, in a follow-up step.

## 1. Scan for candidates

Look for things that are disproportionately hard to understand from the code alone:
- Shared components/utilities used in more than a couple of places (`packages/shared/`,
  `frontend/src/components/ui/`) — worth documenting once, not re-explained at every call
  site.
- Non-obvious architectural decisions (why Redis Streams instead of a simple queue, why a
  particular data model shape) — check for existing comments hinting at a decision but no
  written rationale.
- Anything the SRS's "Alternatives considered" or "Non-functional requirements" sections
  imply matters but isn't reflected anywhere in the code comments.
- Setup/operational steps a new contributor would otherwise have to reconstruct by
  reading `package.json` scripts and guessing (local dev setup, how to run migrations,
  how to add a new channel adapter if that pattern exists in this project).
- Anything already flagged with a `TODO: document this` or similar in the code.

Don't scan `docs/api/` — that's handled automatically, not by this skill.

## 2. Present candidates, don't write yet

List what you found, each with a one-line reason it's worth documenting and a rough
size estimate (quick reference vs. a real explainer). Ask the user to pick — offer this
as a genuine choice, not a formality before you write everything anyway.

## 3. Plan the picked item(s) with the user

For each thing the user picks, before writing anything:
- Propose the structure (sections/headings) and confirm it fits what they actually want
- Ask about audience if it's ambiguous (a future teammate onboarding vs. an external
  API consumer read differently)
- Confirm where it should live under `docs/` (a new subfolder, or an existing one)

## 4. Write

Once the plan is agreed, hand off to the **`docs-writer` subagent** to actually produce
the file(s), pointing it at the specific code to document and the agreed structure.
