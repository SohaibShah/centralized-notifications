#!/bin/bash
# PreToolUse hook on Bash. Only inspects `git commit` / `git push`; every other
# command passes straight through untouched. This is a heuristic safety net, not a
# replacement for a real scanner (gitleaks/truffleHog) in CI — it catches the common,
# careless cases: a committed .env, an AWS key pasted into config, a private key file.
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE '\bgit +commit\b'; then
  DIFF=$(git diff --cached 2>/dev/null)
  FILES=$(git diff --cached --name-only 2>/dev/null)
elif echo "$COMMAND" | grep -qE '\bgit +push\b'; then
  # Commits that exist locally but aren't on any remote-tracking branch yet —
  # i.e. what a push would actually send for the first time.
  DIFF=$(git log --branches --not --remotes -p 2>/dev/null)
  FILES=$(git log --branches --not --remotes --name-only --pretty=format: 2>/dev/null)
else
  exit 0
fi

FLAGS=""

# Example/sample/template files are meant to be committed (placeholders, not real secrets);
# .gitignore already whitelists .env.example. Exclude those from the sensitive-FILENAME check
# only — their CONTENT is still scanned strictly by the checks below.
if echo "$FILES" | grep -vE '\.(example|sample|template)$' | grep -qE '(^|/)\.env(\.[a-zA-Z0-9_-]+)?$|credentials\.json$|token\.json$|service-account.*\.json$|\.pem$|\.key$|(^|/)id_rsa$'; then
  FLAGS="${FLAGS}- A file matches a sensitive filename pattern (.env, credentials.json, token.json, *.pem, *.key, id_rsa)."$'\n'
fi

if echo "$DIFF" | grep -qE 'AKIA[0-9A-Z]{16}'; then
  FLAGS="${FLAGS}- Found what looks like an AWS access key ID."$'\n'
fi

if echo "$DIFF" | grep -qE '\-\-\-\-\-BEGIN (RSA|EC|OPENSSH|DSA)? ?PRIVATE KEY\-\-\-\-\-'; then
  FLAGS="${FLAGS}- Found a private key block."$'\n'
fi

# Reading a secret FROM the environment/config (process.env.X, import.meta.env.X, getEnv().X,
# os.environ[...]) is the CORRECT pattern, not a hardcoded credential — exclude those so they
# don't produce false positives. A real hardcoded value (a literal string/number) still trips.
if echo "$DIFF" | grep -iE '(api.?key|secret|password|token)[[:space:]]*[:=][[:space:]]*.{0,3}[A-Za-z0-9/+_.-]{16,}' | grep -qivE 'process\.env|import\.meta\.env|getenv\(|os\.environ'; then
  FLAGS="${FLAGS}- Found a line that looks like a hardcoded credential (key/secret/password/token assigned to a long value)."$'\n'
fi

if [ -n "$FLAGS" ]; then
  printf "Blocked: this commit/push looks risky.\n%s\nIf this is a real secret: remove it, add the file to .gitignore if it should never be tracked, run 'git reset HEAD <file>' to unstage, and rotate the credential if it was ever committed. If this is a false positive (e.g. a long test fixture ID), edit .claude/scripts/validate-git-safety.sh to narrow the pattern, or run the git command yourself outside Claude Code.\n" "$FLAGS" >&2
  exit 2
fi

exit 0
