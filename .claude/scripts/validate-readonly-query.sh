#!/bin/bash
# Blocks SQL write operations, allows SELECT queries only.
# Used as a PreToolUse hook on the db-reader subagent.
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE)\b' > /dev/null; then
  echo "Blocked: db-reader only allows SELECT queries. Use a migration file for schema/data changes." >&2
  exit 2
fi

exit 0
