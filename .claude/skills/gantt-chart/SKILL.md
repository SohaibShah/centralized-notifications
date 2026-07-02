---
name: gantt-chart
description: Generate a standalone interactive HTML Gantt chart from a project's milestone list, as a local file rather than a Google Sheet. Use when there's no linked Google Sheet to update, when offline viewing matters, or as a fallback if Sheets access isn't set up — otherwise prefer the gantt-sheets skill.
allowed-tools: Bash(python3 *)
---

# Gantt chart generator (standalone HTML)

If the SRS links a Google Sheet for the timeline, use the `gantt-sheets` skill instead —
this one is for when you want a local, no-dependencies file instead (or as a fallback).

Turns a milestone list into an interactive, self-contained HTML Gantt chart (no internet
connection needed to view it — everything is inlined).

## Usage

1. Build a task list as JSON, one entry per milestone/task:

```json
[
  { "id": "design", "name": "Design doc & architecture", "start": 0, "duration": 5 },
  { "id": "backend-core", "name": "Backend core: API + DB schema", "start": 5, "duration": 10, "dependsOn": ["design"] },
  { "id": "redis-streams", "name": "Redis Stream event pipeline", "start": 10, "duration": 7, "dependsOn": ["backend-core"] },
  { "id": "frontend-shell", "name": "Frontend shell + design system", "start": 5, "duration": 8, "dependsOn": ["design"] },
  { "id": "forms", "name": "JSON-driven form renderer + first forms", "start": 13, "duration": 6, "dependsOn": ["frontend-shell"] },
  { "id": "integration", "name": "Integration + e2e tests", "start": 20, "duration": 5, "dependsOn": ["redis-streams", "forms"] },
  { "id": "security-review", "name": "Security review & hardening", "start": 25, "duration": 3, "dependsOn": ["integration"] }
]
```

- `start` and `duration` are in days, relative to project day 0 (not calendar dates —
  this keeps it simple to re-plan; label the actual start date in the doc's timeline
  section instead).
- `dependsOn` is optional and only used to draw connector hints; it doesn't
  auto-schedule.

Save this as `docs/gantt-tasks.json`, then run:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/generate_gantt.py docs/gantt-tasks.json docs/gantt.html
```

This creates `docs/gantt.html` — open it in a browser (or in VS Code's Simple Browser)
to view the chart. Commit both the JSON and the HTML so the timeline stays versioned
alongside the design doc.

## When editing the timeline later

Edit `docs/gantt-tasks.json` and re-run the script rather than hand-editing the HTML.
