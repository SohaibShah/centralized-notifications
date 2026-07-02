---
name: commit
description: Stage the current changes, make sure nothing sensitive is about to be tracked, and commit with a well-written Conventional Commits message. Manual only — run with /commit.
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git add *) Bash(git commit *) Bash(git log *) Read Edit(.gitignore)
---

1. Run `git status` and `git diff` (plus `git diff --staged` if anything's already
   staged) to see the full picture of what changed.

2. **Check for anything that shouldn't be tracked** before staging:
   - Compare untracked/changed files against `.gitignore`. If something matches a
     sensitive pattern (`.env*`, `credentials.json`, `token.json`, `*.pem`, `*.key`,
     `node_modules/`, build output, `.DS_Store`, IDE folders, coverage reports,
     `*.tsbuildinfo`) but isn't yet in `.gitignore`, add it there first.
   - If a sensitive file is already **tracked** (previously committed), adding it to
     `.gitignore` won't remove it from history — stop and flag this loudly rather than
     silently proceeding. That needs `git rm --cached <file>` plus, if it was ever
     pushed, treating the credential as compromised and rotating it. Don't do the
     history rewrite yourself without explicit confirmation — hand this off to the
     `git-troubleshooter` subagent if it's non-trivial.
   - Note: a `PreToolUse` hook will also independently scan the diff for obvious secrets
     before the commit actually runs. That's a backstop, not a reason to skip this step —
     it catches different things than a `.gitignore` check does.

3. **Stage deliberately.** Don't `git add -A` or `git add .` without having looked at
   `git status` first — if there's untracked cruft that shouldn't be there, that's a sign
   `.gitignore` needs another entry, not something to sweep into the commit.

4. **Write the commit message** as Conventional Commits:
   ```
   <type>(<scope>): <concise summary, imperative mood, under ~70 chars>

   <body — what changed and why, only if it's not obvious from the summary>

   <footer — "Refs #123" / "Closes #123" if an issue was mentioned in conversation>
   ```
   Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`. Base the
   message on the actual diff, not a generic description — name the specific
   files/behavior that changed.

5. Commit. Report the commit hash and the message used.

If the git-safety hook blocks the commit, don't just retry — read what it flagged,
actually fix it (unstage the file, add it to `.gitignore`, rotate the credential if it
was real), then retry.
