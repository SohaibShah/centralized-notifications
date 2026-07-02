#!/bin/bash
# Runs after every Edit/Write. Formats only the touched file. Never blocks Claude —
# always exits 0 so a missing formatter or a weird file type can't stall a session.
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

case "$FILE" in
  *.ts|*.tsx|*.vue|*.js|*.jsx|*.json|*.css|*.scss|*.md)
    npx --no-install prettier --write "$FILE" >/dev/null 2>&1
    ;;
esac

exit 0
