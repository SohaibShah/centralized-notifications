# Notification module domain rules

Notification systems fail in specific, well-known ways. These apply regardless of which
channel (email/SMS/push/in-app/Slack) is involved.

- **Every notification request carries an idempotency key**, and the pipeline dedupes on
  it before sending. Combined with the at-least-once delivery from Redis Streams
  (`redis-streams.md`), skipping this means real users get duplicate notifications on
  retry — the single most common bug class in systems like this.
- **Check user preferences/opt-out status before sending, not after.** This is a
  compliance requirement, not a nice-to-have — a user who opted out of a category must
  never receive it, full stop. Preference checks belong in the delivery pipeline itself,
  not just as a UI toggle that nothing enforces server-side.
- **Channels go behind a common adapter interface** (`send(notification): Promise<DeliveryResult>`),
  never called directly from business logic. This is what makes it possible to add a
  channel (SMS, push) without touching the ingestion/templating/preference logic, and to
  swap providers (e.g. SES to SendGrid) later without a rewrite.
- **Templates are versioned.** A template edit must not silently change the content of
  notifications already queued or mid-retry — resolve the template version at
  enqueue time, not at send time.
- **Rate-limit per recipient, per category, and separately per provider.** A bug that
  fires a loop shouldn't be able to flood one person with hundreds of notifications, and
  the system shouldn't exceed a provider's own send-rate limits (which usually means
  temporary bans or extra cost, not just errors).
- **Record delivery status as its own durable fact** (sent/delivered/bounced/failed),
  separate from the request itself, and reconcile provider webhooks (bounce/complaint/
  delivery callbacks) against it asynchronously — don't assume "sent to the provider"
  means "delivered."
- **Treat recipient data and message content as sensitive by default.** Notification
  logs often contain PII (email addresses, phone numbers, message bodies with account
  details) — apply the same secrets/PII discipline from `security.md` to logging and
  the audit trail, not just to config. Redact or truncate message bodies in logs unless
  there's a specific reason to keep them in full.
- **Provider API keys are config, validated at startup, never in code** — same rule as
  everything else, called out here because this module will accumulate several of them
  (email/SMS/push providers) and it's an easy place to get sloppy.
- **Test the failure paths, not just successful sends**: a provider timeout, a bounced
  address, a duplicate request, an opted-out recipient, a rate-limit hit. These are the
  actual behaviors that matter in production; a test suite that only sends to a mock
  "happy" recipient hasn't tested the module.
