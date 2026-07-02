# Setup walkthrough

Two parts: (1) get everything installed and wired up, once, (2) how to actually use it
day to day, walked through on a small example project so it's concrete.

---

# Part 1: Installation

## 1.1 Install Claude Code itself

You need Node.js only if you install via npm; the native installer doesn't need it.

**Recommended (native installer):**

macOS / Linux:
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Windows PowerShell:
```powershell
irm https://claude.ai/install.ps1 | iex
```

**Alternative (npm, requires Node.js 18+):**
```bash
npm install -g @anthropic-ai/claude-code
```

Verify it worked:
```bash
claude --version
claude doctor    # deeper health check
```

You need a Claude Pro, Max, Team, or Enterprise plan (the free plan doesn't include
Claude Code). Authenticate:
```bash
claude
```
This opens a browser to log in. Once logged in you're in an interactive session — type
`/exit` or Ctrl+C twice to leave.

## 1.2 Install the VS Code extension

In VS Code: `Cmd/Ctrl+Shift+X` → search "Claude Code" → Install. Reload the window if the
icon (a small spark, ✱) doesn't appear in the editor toolbar. Open any file, click the
spark icon, sign in with the same account.

You now have two ways to use Claude Code in VS Code: the graphical panel (what opens by
default) and the CLI inside VS Code's integrated terminal (just type `claude`). The panel
is friendlier for day-to-day work; the terminal is needed for some one-time setup
commands below (like `claude mcp add`).

## 1.3 Drop the starter kit into your repo

Unzip the kit from earlier into your project root, so you have:
```
your-project/
├── CLAUDE.md
├── .mcp.json
├── .claude/
│   ├── settings.json
│   ├── scripts/
│   ├── agents/
│   ├── skills/
│   └── rules/
└── docs/           (starts empty — gantt chart gets generated here later)
```

Make the shell scripts executable, then commit everything:
```bash
chmod +x .claude/scripts/*.sh
git add . && git commit -m "chore: add Claude Code config"
```

`.claude/` is meant to be shared like any other code — this is how your whole team gets
the same subagents, skills, and rules automatically, just by cloning the repo.

## 1.4 Set up the Postgres MCP server

Already configured in `.mcp.json` (committed, shared with the team). It uses a
`DATABASE_URL` environment variable with a localhost default, so it won't break if unset.
Two things to actually do:

- Set `DATABASE_URL` in your shell (or a local `.env` you don't commit) to point at your
  dev database.
- If your database has a way to create a **read-only user**, use that connection string
  here instead of your main one — this MCP server can then never accidentally damage
  data no matter what gets asked of it, on top of (not instead of) the migration-only
  rule in `CLAUDE.md`.

The first time Claude Code sees a project-scoped MCP server in `.mcp.json`, it asks you
to approve it — that's expected, just say yes.

## 1.5 Set up the Google Docs MCP server (for the SRS workflow)

Your idea notes and SRS template live in Google Docs, so Claude needs a way to actually
read and edit Google Docs. There's no single official "Google Docs" MCP server from
Anthropic or Google — the standard, well-maintained option the community has converged
on is [`@a-bonus/google-docs-mcp`](https://github.com/a-bonus/google-docs-mcp) (actively
maintained, 500+ stars, MIT licensed). It runs **locally on your machine** via OAuth — it
never sends your Google credentials to a third party.

**One-time Google Cloud setup** (you only do this once, ~5 minutes):

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) → create a new
   project (e.g. "Claude Docs Access").
2. Go to **APIs & Services → Library** → enable **Google Docs API**, **Google Drive
   API**, and **Google Sheets API** (skip Gmail/Calendar — you don't need them, and
   fewer enabled scopes is safer).
3. Go to **APIs & Services → OAuth consent screen** → choose **External** → fill in an
   app name and your email → add scopes for `documents`, `drive`, `spreadsheets` → add
   your own Google account as a **Test User**.
4. Go to **APIs & Services → Credentials** → **Create Credentials → OAuth client ID** →
   Application type **Desktop app** → create → copy the **Client ID** and **Client
   Secret**.

**Authorize once from your terminal:**
```bash
GOOGLE_CLIENT_ID="your-client-id" \
GOOGLE_CLIENT_SECRET="<your client secret>" \
npx -y @a-bonus/google-docs-mcp auth
```
This opens your browser to approve access. The resulting token is saved locally to
`~/.config/google-docs-mcp/token.json` — nothing is sent anywhere else.

**Register the server with Claude Code, at user scope** (not project scope — your client
ID/secret are personal and shouldn't be committed to a shared repo):
```bash
claude mcp add-json google-docs \
  '{"command":"npx","args":["-y","@a-bonus/google-docs-mcp"],"env":{"GOOGLE_CLIENT_ID":"your-client-id","GOOGLE_CLIENT_SECRET":"<your client secret>"}}' \
  --scope user
```

Verify it's connected: open Claude Code and run `/mcp` — you should see `google-docs`
listed. If it shows an auth error, re-run the `auth` command above.

If you'd rather not do OAuth setup right now, you don't have to — see "If you skip
Google Docs MCP" at the very end of this file for the fallback.

## 1.6 Fill in the design tokens before writing any UI

Open `.claude/skills/design-system/SKILL.md` and spend 15 minutes actually deciding your
color/type/spacing values (with a designer, an existing Figma file, or just deliberately
with Claude). This single step is the biggest lever against generic-looking output —
skip it and every component will quietly fall back to framework defaults.

If Securiti has an existing design system or Figma file, connect Figma too, so Claude
pulls real tokens instead of inventing new ones:
```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp --scope user
```

## 1.7 Set up GitHub access (for `/open-pr`)

Either works — the `open-pr` skill checks for the MCP server first and falls back to the
CLI:

**Option A — GitHub MCP server:**
```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/ \
  --header "Authorization: Bearer YOUR_GITHUB_PAT" --scope user
```
(Create a fine-grained personal access token at
[github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
scoped to the repos you work in.)

**Option B — GitHub CLI:**
```bash
gh auth login
```

That's the whole install. Everything past this point is workflow, not setup.

---

# Part 2: Using it — walked through on a real example

Let's build something small end to end: **an internal tool where employees submit
expense reimbursement requests, and finance approves or rejects them.** Small enough to
walk through completely, but it touches every piece of the kit: a JSON-driven form, a
Postgres-backed API, a Redis Stream event (notify finance on submission), and a real
SRS.

Everything below is what *you type to Claude*, in order, in a fresh Claude Code session
in your project root (VS Code panel or terminal — same thing).

## Step 1 — Generate the SRS

**You say:**
> /fill-srs 1AbCdEfGhIj... 1XyZwVuT...
>
> (the first ID is your idea-notes Google Doc, the second is your SRS template — both
> are the long string in the doc's URL: `docs.google.com/document/d/`**`THIS PART`**`/edit`)

**What happens:** Claude reads both docs, and — because the skill tells it to ask before
assuming anything scope-defining — it comes back with something like:

> Before I fill this in: (1) Can any employee submit a request, or only certain roles?
> (2) Is there a $ threshold above which a second approver is required? (3) Does this
> need to integrate with an existing payroll/accounting system, or is "approved" the
> final state for now?

You answer those. Claude then makes a *copy* of the template (your original stays
reusable), fills in every section, numbers the functional/non-functional requirements,
and leaves a "NEEDS INPUT" list for anything it genuinely couldn't infer. You get back a
link to the new doc. **Read it.** This is the step where catching a wrong assumption
costs you five minutes instead of two days of the wrong thing getting built.

**What you didn't have to tell Claude:** the skill already knows to ask before guessing,
how to edit the doc without destroying its formatting, and to number requirements
properly — that's what the skill file encodes so you don't have to re-explain it.

## Step 2 — Generate the timeline

**You say:**
> /gantt-sheets

**What happens:** the skill looks for a Google Sheets link inside the SRS you just
generated (your template links one), confirms the sheet with you, reads its existing
layout first, and fills in the actual data without restructuring whatever's already
there. If your SRS doesn't link a sheet for this project, Claude will say so — at that
point say **"use gantt-chart instead"** to get a standalone HTML timeline instead.

If a milestone looks wrong afterward, just say so in plain language ("integration
testing should come after both backend and frontend are done, not in parallel") and
re-run the skill.

## Step 3 — Scaffold the project

**You say:**
> Based on the SRS, propose the initial project structure — pnpm workspaces for
> frontend (Vue 3 + TS), backend (Node + TS), and packages/shared. Use plan mode.

**What happens:** Claude proposes a plan (directory layout, initial dependencies, what
goes where) and *stops* — because you asked for plan mode, or because CLAUDE.md tells it
to use plan mode for anything touching this many files anyway. You review, say
"looks good" or push back on specifics, then it builds.

**What you didn't have to tell Claude:** which subagents exist, what the JSON-form rule
is, what the security rules are — all of that is already loaded from CLAUDE.md and the
skills. You only need to say what's specific to *this* task.

## Step 4 — Build the expense request form

**You say:**
> Build the expense request submission form: amount, category (dropdown), receipt
> upload, description, employee ID (auto-filled from session). On submit, it should hit
> POST /api/expenses.

**What Claude does on its own, without being told:** because `json-form-conventions` is
loaded as background knowledge, Claude builds this as a schema in
`frontend/src/forms/expense-request.form.ts` and renders it with `<FormRenderer>` — you
don't need to say "use the JSON form pattern," it already knows that's the only way
forms get built here. It also pulls field styling from the `design-system` tokens without
being asked.

**What you should still watch for:** if you see it about to hand-write a `<form>` with
raw `<input>` tags, that's your cue to stop it — say "this should go through
FormRenderer" — because it means the renderer is missing a field type (probably file
upload) that needs to be added to the shared component instead of worked around here.

## Step 5 — Build the backend endpoint + Redis event

**You say:**
> Add POST /api/expenses: validate the payload with zod, insert into the expenses table,
> then publish an ExpenseSubmitted event to the Redis Stream so the notifications
> service can pick it up. Use plan mode since this touches the DB schema.

Claude proposes the migration file, the endpoint, the zod schema, and the stream publish
call. You approve the plan, it builds.

## Step 6 — Verify it actually works

**You say:**
> Use the browser-tester subagent to fill out the expense form end to end and confirm
> the submission shows up, including what happens if I submit with no receipt attached.

This is the step people skip and shouldn't. The subagent launches a real browser,
screenshots the form, submits it (including the error case), and reports back with
specifics — not just "tests passed."

## Step 7 — Review before it's "done"

**You say:**
> Run code-reviewer and security-reviewer on this change before I open a PR.

Two subagents, two focused reports, in their own context windows so your main
conversation doesn't fill up with their working-out. Fix what they flag. For this
feature specifically, `security-reviewer` should be checking: can an employee see or
edit another employee's expense requests, is the receipt upload restricted by file
type/size, is the amount validated server-side (not just in the form).

## Step 8 — Investigate data, safely, if something looks off

**You say:**
> Use db-reader to check how many expense requests are stuck in "pending" for more than
> a week.

This subagent can only run SELECT — the hook blocks anything else at the shell level, so
even a badly-phrased request can't turn into an accidental write.

## Step 9 — Commit and open the PR

**You say:**
> /commit

Claude checks what's staged/untracked against `.gitignore` first — if it notices, say, a
stray `.env` or a `credentials.json` about to be swept in, it flags it and updates
`.gitignore` before proceeding, rather than committing it. It writes a real Conventional
Commit message from the actual diff, not a generic one. Separately, a hook double-checks
the diff for obvious secrets (an AWS key, a private key block) right before the commit
executes — that one can't be talked past, by design.

**You say:**
> /open-pr

Pushes the branch and opens the PR with a description built from your actual commits —
what changed, why, how it was tested — using the GitHub MCP server or `gh` CLI, whichever
you set up.

**If something with git goes wrong at any point** (rejected push, merge conflict,
detached HEAD, "I think I just did something bad"):
> Use git-troubleshooter to figure out what happened here.

It diagnoses before touching anything, and will never force-push or hard-reset without
telling you exactly what that would throw away first.

---

## General guidelines, distilled

**Always tell Claude:**
- The specific feature/behavior you want, in plain language — not the mechanism.
  ("Build the expense form" not "use FormRenderer to build the expense form" — it
  already knows to do that.)
- When something is ambiguous and matters (scope, who can access what) — or better,
  let the `/fill-srs` step catch these upfront so you're not deciding them mid-build.
- Explicitly, when you want a subagent by name ("use security-reviewer") rather than
  hoping Claude delegates on its own — for anything security-sensitive, always ask
  explicitly rather than relying on "proactive" delegation.
- When to use plan mode, for anything you're not 100% sure about — schema changes,
  auth, anything spanning many files. (CLAUDE.md already asks for this on big changes,
  but say it explicitly whenever in doubt.)

**Claude/the kit figures out on its own:**
- That forms go through `<FormRenderer>` — from `json-form-conventions`.
- What tokens/spacing/type to use — from `design-system`.
- Not to write raw SQL, not to leave secrets in code, to validate input — from
  `security.md` and `CLAUDE.md`, loaded every session.
- To reformat whatever file it just touched — from the post-edit hook.
- Not to run destructive SQL through `db-reader` — enforced by the hook, not just asked.
- Not to let a secret slip into a commit or push — enforced by the git-safety hook, not
  just asked. It's a heuristic, not a guarantee — see Part 3 below on layering a real
  scanner in CI too.

**What still needs a human:**
- Reading the generated SRS and actually catching wrong assumptions — Claude will ask
  good questions, but only about things it noticed were ambiguous. Read it anyway.
- Deciding the actual design tokens once, at the start.
- Approving plans in plan mode rather than rubber-stamping them.
- Actually reading the `code-reviewer`/`security-reviewer` output instead of treating it
  as a formality.

---

# Part 3: what's already covered vs. what to add before real production traffic

This kit covers day-to-day correctness and a reasonable security floor. A few things are
genuinely production-specific and worth doing deliberately rather than leaving implicit:

**Already in the kit:**
- `.github/workflows/ci.yml` — lint/typecheck/test gate every PR, with real Postgres +
  Redis service containers (not mocks) so integration tests mean something. Uncomment
  the Playwright block once e2e is set up.
- `.gitignore` + `.env.example` — secrets stay out of git, required config is documented
  without exposing real values.
- `redis-streams.md` rule — consumer groups, idempotency, dead-letter handling. Called
  out separately because Redis Streams looks simple and silently breaks in specific ways
  if these aren't followed from the start.
- The git-safety hook and `security-reviewer` subagent, as a local layer.

**Worth adding once you're past the prototype stage (ask me to build any of these when
you get there):**
- **A real secret scanner in CI** (gitleaks or truffleHog as a GitHub Action) — the local
  git hook is a heuristic net for careless mistakes, not a substitute for one. Belt and
  suspenders.
- **Error tracking** — connect Sentry's MCP server
  (`claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`) so Claude can
  read and triage real production errors, not just guess from logs.
- **A named migration tool** — pick one (Drizzle, Prisma Migrate, or `node-pg-migrate`)
  and put it in CLAUDE.md's "Build & run" section. Right now the rule says "migrations
  only," but doesn't name the tool — that's the one open decision left from the SRS
  process.
- **Accessibility testing in CI**, not just the manual floor in `design-system` — add
  `@axe-core/playwright` to the e2e suite so contrast/label/focus regressions fail a
  build instead of shipping.
- **Dependency vulnerability scanning** — turn on GitHub's Dependabot alerts (Settings →
  Security) and consider Renovate for automated update PRs.
- **An OpenAPI spec** generated from (or validated against) the zod schemas, once the API
  surface stabilizes — keeps the SRS's "API design" section from drifting from reality.
- **A secrets manager for production** (not `.env` files) — Doppler, AWS Secrets Manager,
  or Vault, depending on where this deploys. `.env` is fine for local dev, not for
  production config.
- **Anthropic's automatic PR code review**, if your team is on GitHub — it runs a model
  review on every PR in CI, independent of the local `code-reviewer` subagent. Worth
  checking current setup docs for this since it's evolved recently
  ([code review docs](https://code.claude.com/docs/en/code-review)).
- **Check with Securiti's security/compliance team before real production data flows
  through this.** A generic checklist can't know what's specific to a security/privacy
  company's own compliance posture (data residency, retention, audit logging
  requirements) — this kit gives you a solid baseline, not a compliance sign-off.

---

## If you skip Google Docs MCP for now

You don't need it to make progress — just do the SRS step manually instead:

1. Copy the idea notes and the SRS template content out of Google Docs (Ctrl+A, copy)
   into two local files, e.g. `/tmp/idea-notes.md` and `/tmp/srs-template.md`.
2. Ask Claude: *"Read /tmp/idea-notes.md and /tmp/srs-template.md, fill in the template
   the same way the fill-srs skill describes, ask me anything ambiguous, and write the
   result to docs/srs-draft.md."*
3. Either paste `docs/srs-draft.md` back into your Google Doc by hand, or ask Claude to
   generate a `.docx` version instead (`pip install python-docx` or the Node `docx`
   package — ask Claude to write a short script) that you upload to Drive and let Google
   convert to Docs format on open.

It's more manual, but nothing else in the kit depends on the Google Docs MCP server
specifically — everything past the SRS step works the same either way.
