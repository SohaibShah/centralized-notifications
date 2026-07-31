import { z } from "zod";

/**
 * Per-user preference contract — the cross-boundary shapes the settings page reads/writes and the
 * library enforces. Notification-domain prefs only (snooze/mute, grouping, summary opt-out, toast
 * control); identity attributes like timezone stay host-owned and are NOT part of this contract.
 *
 * Shared here (not core-only) because the Vue settings UI and the Fastify routes must agree on the
 * exact shapes — same reason the notification contract lives in this package.
 */

/** Which priorities pop the bottom-right critical toast. 'off' = none; 'critical' = critical only
 *  (today's default); 'high' = high + critical. Ordered least→most permissive is not implied. */
export const TOAST_MIN_PRIORITIES = ["off", "critical", "high"] as const;
export type ToastMinPriority = (typeof TOAST_MIN_PRIORITIES)[number];

/** A mute/snooze rule targets either a module (by registry id) or a category (free-form string). */
export const MUTE_TARGET_KINDS = ["module", "category"] as const;
export type MuteTargetKind = (typeof MUTE_TARGET_KINDS)[number];

/** Scalar per-user preferences. Defaults mirror the `user_preferences` column defaults. */
export const userPreferencesSchema = z.object({
  groupingEnabled: z.boolean(),
  summaryOptOut: z.boolean(),
  toastMinPriority: z.enum(TOAST_MIN_PRIORITIES),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/** PATCH body: any subset of the scalar prefs. */
export const preferencesPatchSchema = userPreferencesSchema.partial();
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

/** A single active snooze/mute rule. `mutedUntil` null = muted indefinitely; ISO ts = snoozed-until. */
export const muteRuleSchema = z.object({
  targetKind: z.enum(MUTE_TARGET_KINDS),
  target: z.string().min(1).max(100),
  mutedUntil: z.string().datetime({ offset: true }).nullable(),
});
export type MuteRule = z.infer<typeof muteRuleSchema>;

/** PUT /notifications/mutes/:kind/:target body. `until` null = mute; ISO datetime = snooze-until
 *  (the route additionally rejects a non-null value that is not in the future). */
export const putMuteBodySchema = z.object({
  until: z.string().datetime({ offset: true }).nullable(),
});
export type PutMuteBody = z.infer<typeof putMuteBodySchema>;

/** GET /notifications/preferences response: the scalars plus the active rule list. */
export const preferencesResponseSchema = userPreferencesSchema.extend({
  rules: z.array(muteRuleSchema),
});
export type PreferencesResponse = z.infer<typeof preferencesResponseSchema>;
