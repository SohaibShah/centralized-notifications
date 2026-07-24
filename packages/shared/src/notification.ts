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
 * hostile publisher from sending abusive payloads. (Overall request body size is
 * capped explicitly at the HTTP intake route — see backend/src/intake/http-intake.ts.)
 */

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export const AUDIENCE_SCOPES = ["global", "team", "role", "user"] as const;
export const ACTION_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const ACTION_KINDS = ["link", "dispatch"] as const;
export const FEED_SORTS = ["newest", "oldest", "priority-high", "priority-low"] as const;

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

export const ACTION_DISPATCH_METHODS = ["GET", "POST"] as const;

const MAX_METADATA_BYTES = 4096;

// A relative path only: one leading slash (not protocol-relative `//`), no scheme, no `..` segment.
// This is the egress-safety guarantee — the module host comes from the registry, never the payload.
const dispatchPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((p) => p.startsWith("/") && !p.startsWith("//"), {
    message: "path must start with a single /",
  })
  .refine((p) => !/^[a-z][a-z0-9+.-]*:/i.test(p), { message: "path must not contain a scheme" })
  .refine((p) => !p.split("/").includes(".."), { message: "path must not contain .." });

/**
 * A module-owned callback surfaced as a button on the notification card. Discriminated on `kind`:
 * "link" opens `url` client-side (http(s) only — javascript:/data:/file: schemes must never pass
 * the boundary); "dispatch" round-trips through the server to the module's `path` (relative only,
 * see `dispatchPathSchema`). `icon` is an identifier from the design-system icon set (e.g. "check",
 * "external-link"), not a URL/image. Legacy persisted actions with no `kind` are treated as `link`
 * (see the `z.preprocess` below) — the old flat schema defaulted `kind` to "link".
 */
const linkActionSchema = z.object({
  label: z.string().min(1).max(100),
  kind: z.literal("link"),
  // `method`/`url` retained for links (opened client-side); method is tolerated but unused for links.
  method: z.enum(ACTION_METHODS).optional(),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), { message: "url must use http(s)" }),
  icon: z.string().min(1).max(100).optional(),
});

const dispatchActionSchema = z.object({
  label: z.string().min(1).max(100),
  kind: z.literal("dispatch"),
  method: z.enum(ACTION_DISPATCH_METHODS),
  path: dispatchPathSchema,
  // Opaque, module-defined at publish time; the hub never interprets it. Size-bounded like every
  // other free field so a buggy/hostile publisher can't send an abusive payload.
  metadata: z
    .unknown()
    .optional()
    .refine((m) => m === undefined || JSON.stringify(m).length <= MAX_METADATA_BYTES, {
      message: `metadata must be <= ${MAX_METADATA_BYTES} bytes serialized`,
    }),
  icon: z.string().min(1).max(100).optional(),
});

// Legacy persisted/published actions may omit `kind` (the old schema defaulted it to "link"). Inject
// it so the discriminated union can parse them as links — keeps feed reads back-compatible.
export const actionSchema = z.preprocess(
  (v) =>
    v && typeof v === "object" && !Array.isArray(v) && !("kind" in v)
      ? { ...(v as object), kind: "link" }
      : v,
  z.discriminatedUnion("kind", [linkActionSchema, dispatchActionSchema]),
);

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
  // ISO 8601, timezone offset allowed (…Z or …+05:30). The module's own fired-at
  // time (persisted as notifications.source_ts); optional. When omitted it stays
  // null — server receive time is recorded separately as notifications.created_at.
  timestamp: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Audience = z.infer<typeof audienceSchema>;
export type NotificationAction = z.infer<typeof actionSchema>;
export type Notification = z.infer<typeof notificationSchema>;

/**
 * The response shape a module returns from a `dispatch` action's server-side round-trip
 * (see `ACTION_DISPATCH_METHODS`). `ok` reports success/failure; `message` is a short
 * user-facing status; `resolve` tells the feed whether to mark the source notification
 * resolved; `actions` lets the module hand back a fresh action set (e.g. an "Undo" button)
 * to replace the original — bounded the same way `notificationSchema.actions` is.
 */
export const moduleActionResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().max(500).optional(),
  resolve: z.boolean().optional(),
  actions: z.array(actionSchema).max(10).optional(),
});
export type ModuleActionResponse = z.infer<typeof moduleActionResponseSchema>;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/**
 * A compact relative age from a minute count: `34m` under an hour, `3h` under a day, else `2d`.
 * Minute resolution under an hour matters — bucketing everything recent to `0h` makes items
 * indistinguishable by recency (e.g. the AI chat couldn't tell which notification was newest).
 * Shared so the model-facing prompt and the user-facing citation chip format age identically.
 */
export function formatRelativeAge(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/**
 * A notification the AI chat may cite, carried in the chat stream's `sources` frame. The wire
 * contract between the server (which builds it from the trusted, audience-scoped grounding set) and
 * the client (which renders cited refs as action buttons). `ref` is a stable per-answer id ("n1"..).
 */
export interface ChatSource {
  ref: string;
  id: string;
  title: string;
  priority: NotificationPriority;
  ageMinutes: number;
  actions: NotificationAction[];
}

export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];
export type ActionMethod = (typeof ACTION_METHODS)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];
export type FeedSort = (typeof FEED_SORTS)[number];

/**
 * A notification as the feed *read* API returns it: the full publish contract plus
 * the two server-derived, per-viewer facts the UI needs — when the server received
 * it (`createdAt`, distinct from the module's own optional `timestamp`) and whether
 * *this* user has marked it read (`read`). These are NOT part of the publish
 * contract: producers never send them, and they don't exist until a notification is
 * persisted and viewed. Kept here because the frontend feed consumes this shape.
 */
export interface FeedNotification extends Notification {
  /** Server receive time (notifications.created_at), ISO 8601. Feed ordering key. */
  createdAt: string;
  /** Whether the requesting user has read this notification. */
  read: boolean;
}

/**
 * One keyset page of the feed. `nextCursor` is an opaque token to pass back as
 * `?cursor=` for the following (older) page; it is null once the oldest row is
 * reached. There is deliberately no total count — keyset paging never scans to one.
 */
export interface NotificationPage {
  items: FeedNotification[];
  nextCursor: string | null;
}

/**
 * Unread notification counts for the current user, aggregated server-side over the whole
 * dataset (not the loaded feed window). `unread` is the sum of `unreadByPriority`. Absolute
 * for now (ignores active filters); shaped to grow optional filter params later.
 *
 * A schema (not just a type) so the frontend can parse the response defensively — a malformed
 * or partial body must never poison the counts snapshot (a missing bucket would otherwise make
 * an optimistic delta compute NaN). All four buckets are required and non-negative.
 */
export const notificationCountsSchema = z.object({
  unread: z.number().int().nonnegative(),
  unreadByPriority: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    normal: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
});

export type NotificationCounts = z.infer<typeof notificationCountsSchema>;
