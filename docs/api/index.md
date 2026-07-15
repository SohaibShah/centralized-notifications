---
title: API Reference
---

# API Reference

Every endpoint below is documented as it's built or changed — see
`.claude/rules/api-documentation.md` and the `docs-writer` subagent. If something here
looks stale, that's a bug in the process, not a doc you should just trust blindly —
flag it.

- [Admin](./admin.md) — module enable/disable and global feature kill-switches
  (admin-only, plus the user-facing feature-flags read endpoint).
- [Auth](./auth.md) — prototype username/password login, logout, and current-user
  endpoints backed by encrypted cookie sessions.
- [Intake](./intake.md) — the service-to-service publish endpoint (`POST /internal/publish`)
  where backend modules feed notifications into the ingestion pipeline.
- [Notifications](./notifications.md) — the notification contract every module publishes
  and the frontend renders.
- [SSE](./sse.md) — the real-time delivery stream (`GET /sse`) the frontend feed subscribes
  to for live notifications.
