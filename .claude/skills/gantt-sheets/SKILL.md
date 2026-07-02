---
name: gantt-sheets
description: Build or update the project timeline directly in the Google Sheet linked from the SRS, using the google-docs MCP server's Sheets tools. Use when the timeline should live in Sheets rather than a standalone HTML file — this is the default; see the gantt-chart skill for the offline HTML alternative.
disable-model-invocation: true
argument-hint: [spreadsheet-id-or-url] [srs-doc-id]
allowed-tools: mcp__google-docs
---

Build the project timeline in an existing Google Sheet rather than a local file.

## Find the spreadsheet

- If `$ARGUMENTS[0]` is given, use it (accepts either a bare spreadsheet ID or a full
  `docs.google.com/spreadsheets/d/...` URL — extract the ID from the URL if given one).
- Otherwise, read the SRS doc at `$ARGUMENTS[1]` with `readDocument` (format markdown)
  and look for a `docs.google.com/spreadsheets/d/<ID>` link in it — the timeline section
  is the most likely place. If found, confirm with the user before editing it (state the
  sheet's title back to them).
- If neither is given and no link is found in the SRS, ask for the spreadsheet ID/URL
  directly. Don't guess or create a new spreadsheet unless the user says to.

## Inspect before writing — don't clobber an existing layout

Call `getSpreadsheetInfo` and `readSpreadsheet` on the relevant sheet(s) first. This
matters more here than almost anywhere else in this project, because a hand-built Gantt
layout usually encodes real intent (which columns are dates, whether there's already a
chart object, existing conditional formatting, a specific color per workstream).

- **If a Gantt-like structure already exists** (task/start/duration/date columns, an
  existing chart, existing per-cell coloring across a date range): fill in or update the
  *data* using `writeSpreadsheet`/`batchWrite`, matching the existing column layout
  exactly. Don't restructure it, rename its headers, or replace its chart unless asked.
- **If the sheet is empty or has no clear Gantt structure**, build one:
  1. Header row: Task | Start Date | Duration (days) | End Date, then one column per
     day or week across the project timeline (pick weeks if the project spans more than
     ~8 weeks, to keep the sheet from becoming absurdly wide).
  2. One row per milestone/task (pull from the SRS's milestones section, or ask for the
     task list if run standalone).
  3. For each task row, color the cells spanning its start-to-end range in the date/week
     columns using `formatCells` — this is what actually reads as a Gantt bar in Sheets.
     Use a distinct color per task or per workstream, not one flat color for everything.
  4. Bold the header row and freeze it plus the Task column with
     `freezeRowsAndColumns`, so both stay visible when scrolling.
  5. If dependency relationships matter and you want a native chart in addition to the
     colored-cell view, `insertChart` with a stacked bar chart (an invisible "start
     offset" series stacked under a visible "duration" series) is the standard
     spreadsheet Gantt technique — offer this as an addition, not a replacement for the
     colored-cell grid, since the grid is more readable at a glance.

## After writing

Report back the spreadsheet's URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`)
and a short summary of what you changed. If the milestone list changes later, re-run this
skill rather than hand-editing the sheet, so the SRS and the sheet don't drift apart.

## If Sheets access isn't set up yet

Fall back to the `gantt-chart` skill (generates a standalone interactive HTML file
instead) rather than blocking on Google Sheets access.
