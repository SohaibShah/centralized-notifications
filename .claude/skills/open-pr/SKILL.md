---
name: open-pr
description: Push the current branch and open a pull request with a description generated from the actual commits. Manual only — run with /open-pr.
disable-model-invocation: true
---

1. **Refuse to run directly on `main`/`master`.** If the current branch is the default
   branch, stop and say so — ask whether a feature branch should be created instead.

2. **Push the branch.** Use `git push -u origin <branch>` if there's no upstream yet, or
   plain `git push` if there is. If this fails, hand off to the `git-troubleshooter`
   subagent rather than guessing at flags (especially never reach for `--force` here).

3. **Create the PR.** Prefer the `github` MCP server if it's connected (check `/mcp`); if
   it's not, fall back to the `gh` CLI (`gh pr create`) if it's installed and
   authenticated (`gh auth status`). If neither is available, say so and give the user
   the command to run themselves rather than failing silently.

4. **Write the PR description** from the actual commit log on this branch
   (`git log main..HEAD` or equivalent), not a generic template filler:
   - **What changed** — a real summary, not "various fixes"
   - **Why** — link back to the SRS/requirement this addresses if there is one
   - **How it was tested** — mention specific test coverage added, and whether
     `browser-tester` was used to verify the UI end to end
   - **Anything still open** — carry forward any `[NEEDS INPUT]` items from the SRS that
     this PR touches but doesn't fully resolve

5. Before finishing, remind (don't block) if `code-reviewer` and, for anything
   security-sensitive, `security-reviewer` haven't been run yet on this branch this
   session.

6. Report back the PR URL.
