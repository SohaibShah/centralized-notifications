# Security rules

These apply to every change, not just ones that look security-sensitive at a glance.

- Never commit `.env`, API keys, DB credentials, or tokens. If you see one in a diff,
  stop and flag it before proceeding.
- Every API endpoint validates its input with zod (or the shared schema from
  `packages/shared`) before touching the database or calling another service.
- Every endpoint that reads or writes user-owned data checks that the authenticated user
  actually owns/can access that resource — not just that they're logged in.
- Redis Stream consumers must handle malformed/unexpected message payloads without
  crashing the consumer process.
- SQL is parameterized, never string-concatenated with user input.
- Before adding a new npm dependency, prefer one that's actively maintained; call out
  anything with a low weekly download count or no updates in over a year.
- Any change touching auth, sessions, payments, PII, or DB migrations should go through
  the `security-reviewer` subagent before merge, not just the general `code-reviewer`.
