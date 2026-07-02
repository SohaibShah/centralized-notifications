---
name: fill-srs
description: Turn idea notes into a filled Software Requirements Specification, editing the actual Google Doc template via the google-docs MCP server. Manual only — run with /fill-srs.
disable-model-invocation: true
argument-hint: [idea-notes-doc-id] [srs-template-doc-id]
allowed-tools: mcp__google-docs
---

Read the idea notes Google Doc (`$ARGUMENTS[0]`) and the SRS template Google Doc
(`$ARGUMENTS[1]`) using the `google-docs` MCP server's `readDocument` tool with
`format: markdown` for both. If either ID isn't given, ask for it — don't guess a doc ID.

## Process

1. **Read both documents as markdown** so you can see actual structure: headings, any
   placeholder markers (`[TBD]`, `TODO`, empty bullet points under a heading, bracketed
   instructions), and existing formatting to preserve.

2. **Map idea notes to template sections.** The idea notes are almost certainly
   unstructured. For each section in the template, find the relevant material in the
   notes. If the template's sections don't match a standard SRS shape, use this as a
   fallback checklist for what a complete SRS usually covers, and flag any of these
   that are missing from the template entirely: purpose & scope, definitions/acronyms,
   overall description (product perspective, user classes, constraints, assumptions,
   dependencies), specific functional requirements (ideally numbered/testable), external
   interface requirements, non-functional requirements (performance, security, usability,
   reliability), and other constraints.

3. **Don't invent facts.** Where the idea notes don't cover something the template asks
   for, write `[NEEDS INPUT: <what's missing>]` in that spot instead of guessing
   plausible-sounding specifics — this is a spec other people will build from.

4. **Ask before assuming anything that shapes scope** — multi-tenant vs. single-tenant,
   hard compliance requirements, integration boundaries, who the user classes are. Batch
   these questions and ask them together before editing the doc, not one at a time.

5. **Make a copy of the template, don't overwrite it.** Use the `copyFile` tool to
   duplicate the template doc, named `SRS - <project name> - <today's date>`, so the
   original template stays reusable for the next project. Do all editing on the copy.

6. **Fill the copy section by section**, preferring the edit that disturbs the least
   existing formatting:
   - A literal placeholder marker (`[TBD]`, `TODO`, `{{SECTION}}`) → `findAndReplace` with
     the generated content for that section.
   - A heading with nothing useful underneath → `insertText` or `appendMarkdown` right
     after that heading.
   - A section that needs rich formatting (numbered requirement lists, tables) →
     `replaceRangeWithMarkdown` for just that range, not the whole document. Never use
     `replaceDocumentWithMarkdown` on a real template — it discards native formatting the
     round-trip can't represent.

7. **Number functional requirements** (FR-1, FR-2, ...) and non-functional requirements
   (NFR-1, NFR-2, ...) if the template doesn't already have its own numbering scheme —
   testable, numbered requirements are the actual point of an SRS.

8. **Add a final section (or fill the template's existing "Open Questions" section if it
   has one)** listing every assumption you made and every `[NEEDS INPUT]` you left, so a
   reviewer can scan it in one place.

9. **Report back** the new document's title and a link (Google Docs URLs are
   `https://docs.google.com/document/d/<ID>/edit`), plus a short summary of what still
   needs input.

10. **Check for a linked timeline.** Look for a `docs.google.com/spreadsheets/d/...`
    link in the template's timeline/milestones section. If found, mention it and suggest
    running `/gantt-sheets` to fill it in. If there's no linked sheet, mention
    `/gantt-chart` as a standalone HTML alternative instead.

Once the SRS is reviewed and the requirements/milestones are stable, use `/gantt-sheets`
(preferred, if a sheet is linked) or `/gantt-chart` (standalone HTML) to turn the
milestone list into a visual timeline.
