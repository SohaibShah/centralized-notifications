# API documentation

Every API endpoint/function needs a corresponding doc in `docs/api/` — kept in sync,
not written once and forgotten. This applies whether the endpoint was written by Claude
or by hand by someone else; if you notice an endpoint (a new route file, a new handler
function, a change to an existing one's request/response shape) that doesn't have a
matching doc, or has one that's now out of date, say so and offer to update it — don't
wait to be asked.

- Delegate the actual writing to the **`docs-writer` subagent** rather than doing it
  inline — keeps the main conversation focused on the feature itself.
- One doc file per resource under `docs/api/` (e.g. `docs/api/expenses.md` covering all
  `/api/expenses*` endpoints), not one file per single endpoint — related endpoints read
  better together.
- A doc is out of sync the moment the request shape, response shape, auth requirement,
  or side effects (e.g. a Redis Stream event it publishes) change — treat that the same
  as a broken test: fix it before considering the change done.
- This is about API endpoints specifically. Documentation for anything else (frontend
  components, architecture, setup guides) is deliberate and human-planned — see the
  `docs-plan` skill — not automatic.
