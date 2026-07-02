# Redis Streams conventions

Redis Streams look simple and bite production systems in specific, predictable ways.
These rules exist to head that off.

- **Always use consumer groups** (`XGROUP CREATE` / `XREADGROUP`), never bare `XREAD`,
  for anything more than one consumer or anywhere delivery matters. Bare `XREAD` has no
  concept of "this message was handled."
- **Every consumer handler must be idempotent.** Streams guarantee at-least-once
  delivery, not exactly-once — the same message can be delivered twice (a crash between
  processing and `XACK` is enough to cause this). Handlers must be safe to run twice on
  the same message (e.g. upsert instead of insert, check-then-act guarded by a unique
  constraint).
- **`XACK` only after the work is actually durable** (e.g. after the DB write commits),
  not before. Acking early and then crashing loses the message's "still needs
  processing" status.
- **Have a dead-letter path.** Track delivery count per message (`XPENDING`); after N
  failed attempts, move the message to a `<stream>:dead-letter` stream instead of
  retrying forever, and alert on anything landing there.
- **Name streams and consumer groups predictably**: `<domain>-events` for the stream
  (e.g. `expenses-events`), `<service-name>` for the consumer group (e.g.
  `notifications-service`). This makes `XINFO` output and monitoring dashboards
  readable.
- **Never let a stream grow unbounded.** Set a reasonable `MAXLEN` (approximate, `~`) on
  `XADD` calls, or a scheduled trim job — an unbounded stream is a slow-motion memory
  leak.
- **Malformed messages must not crash the consumer process.** Validate the payload
  (zod) inside the handler; on validation failure, log it, ack it or dead-letter it
  (don't leave it pending forever), and keep the consumer loop running.
- **Test the dead-letter and idempotency paths explicitly** — feed a consumer test a
  duplicate message and a malformed one, not just the happy path.
