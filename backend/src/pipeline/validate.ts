import { notificationSchema, type Notification } from "@notifications/shared";

export type ValidateResult = { ok: true; data: Notification } | { ok: false; error: string };

/**
 * The pipeline's boundary validation: parse an untrusted payload against the shared
 * notification contract. Pure — no I/O. On failure returns a compact error built from
 * issue *paths and codes only* (never the offending values), so the caller can log a
 * useful reason without echoing potentially sensitive payload content into logs.
 */
export function validate(raw: unknown): ValidateResult {
  const parsed = notificationSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const error = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}:${issue.code}`)
    .join(", ");
  return { ok: false, error };
}
