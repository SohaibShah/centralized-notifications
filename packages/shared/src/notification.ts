import { z } from "zod";

/**
 * The notification contract — the single shape every module publishes and the
 * frontend renders. It is the stable boundary of the domain-agnostic backend:
 * the system acts only on the top-level fields (dedupes on `id`, resolves
 * `audience`, applies policy on `priority`/`category`) and treats `metadata` as
 * opaque. New per-module needs are met by extending `metadata`, NOT by changing
 * this shape — that is what lets modules be added without touching the core.
 *
 * Shape signed off before implementation (contract checkpoint, see
 * docs/implementation-plan.md "Task 2"). Decisions baked in here:
 *  - unknown top-level fields are STRIPPED (forwards-compatible), not rejected;
 *  - `id` is caller-supplied and doubles as the dedupe / idempotency key;
 *  - `snoozable` is required so every publisher makes the choice explicitly.
 *
 * This is also the input-validation boundary, so it is defensive on purpose:
 * action URLs are restricted to http(s) (no javascript:/data:/file:), and every
 * free-text field and the actions array are length-bounded to keep a buggy or
 * hostile publisher from sending abusive payloads. (Overall body size is also
 * capped at the HTTP intake layer in Task 5.)
 */

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export const AUDIENCE_SCOPES = ["global", "team", "role", "user"] as const;
export const ACTION_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Who a notification is for. `id` identifies the team/role/user for non-global
 * scopes; it is absent for `global` (everyone).
 */
export const audienceSchema = z
  .object({
    scope: z.enum(AUDIENCE_SCOPES),
    id: z.string().min(1).max(200).optional(),
  })
  .refine((audience) => audience.scope === "global" || audience.id !== undefined, {
    message: "audience.id is required for non-global scope",
    path: ["id"],
  });

/**
 * A module-owned callback surfaced as a button on the notification card.
 * `url` is restricted to http(s) — it is rendered as a clickable/fetchable
 * target, so javascript:/data:/file: schemes must never pass the boundary.
 * `icon` is an identifier from the design-system icon set (e.g. "check",
 * "external-link"), not a URL/image. Extensible later (e.g. variant, confirm).
 */
export const actionSchema = z.object({
  label: z.string().min(1).max(100),
  method: z.enum(ACTION_METHODS),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), { message: "url must use http(s)" }),
  icon: z.string().min(1).max(100).optional(),
});

export const notificationSchema = z.object({
  // Caller-supplied dedupe / idempotency key. `.trim()` guard rejects blank
  // values (e.g. "  "), which would otherwise split into distinct notifications.
  id: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.trim().length > 0, { message: "id must not be blank" }),
  module: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  // `description` may be empty (a title-only notification is valid); `title` may not.
  description: z.string().max(5000),
  priority: z.enum(NOTIFICATION_PRIORITIES),
  snoozable: z.boolean(),
  actions: z.array(actionSchema).max(10).optional(),
  audience: audienceSchema,
  category: z.string().min(1).max(100).optional(),
  // ISO 8601, timezone offset allowed (…Z or …+05:30); set on intake if omitted.
  timestamp: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Audience = z.infer<typeof audienceSchema>;
export type NotificationAction = z.infer<typeof actionSchema>;
export type Notification = z.infer<typeof notificationSchema>;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];
export type ActionMethod = (typeof ACTION_METHODS)[number];
