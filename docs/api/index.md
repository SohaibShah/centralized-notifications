---
title: API Reference
---

# API Reference

Every endpoint below is documented as it's built or changed — see
`.claude/rules/api-documentation.md` and the `docs-writer` subagent. If something here
looks stale, that's a bug in the process, not a doc you should just trust blindly —
flag it.

- [Auth](./auth.md) — prototype username/password login, logout, and current-user
  endpoints backed by encrypted cookie sessions.
- [Intake](./intake.md) — the service-to-service publish endpoint (`POST /internal/publish`)
  where backend modules feed notifications into the ingestion pipeline.
- [Notifications](./notifications.md) — the notification contract every module publishes
  and the frontend renders.
