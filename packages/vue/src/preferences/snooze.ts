import type { MuteRule } from "@notifications/shared";

/** The snooze durations offered in the UI. Relative options are timezone-independent; only
 *  "tomorrow-morning" (08:00 the next local day) uses the user's timezone. */
export type SnoozeOption = "1h" | "4h" | "tomorrow-morning" | "1w";

export const SNOOZE_OPTIONS: { value: SnoozeOption; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "tomorrow-morning", label: "Until tomorrow morning" },
  { value: "1w", label: "1 week" },
];

const HOUR = 3_600_000;
const MORNING_HOUR = 8; // 08:00 local

/** The display status for a module/category given its current rule (undefined = no rule):
 *  "Active" (nothing set), "Muted" (indefinite), or "Snoozed · Nh left" (time-boxed). A snooze whose
 *  time has already passed reads as "Active" — the server filter treats it as expired too. */
export function muteStatusLabel(rule: MuteRule | undefined, now: Date): string {
  if (!rule) return "Active";
  if (rule.mutedUntil === null) return "Muted";
  const leftMs = new Date(rule.mutedUntil).getTime() - now.getTime();
  if (leftMs <= 0) return "Active";
  const minutes = Math.round(leftMs / 60_000);
  if (minutes < 60) return `Snoozed · ${minutes}m left`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Snoozed · ${hours}h left`;
  return `Snoozed · ${Math.round(hours / 24)}d left`;
}

/** The timezone's UTC offset (ms) at a given instant — positive east of UTC. Handles half-hour and
 *  three-quarter-hour zones (e.g. +05:30, +05:45). */
function offsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(instant).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - instant.getTime();
}

/** Resolve a snooze option to the ISO instant it un-snoozes at. Relative options add to `now`;
 *  "tomorrow-morning" is 08:00 on the next calendar day in `timeZone`. */
export function resolveSnoozeUntil(option: SnoozeOption, now: Date, timeZone: string): string {
  if (option === "1h") return new Date(now.getTime() + HOUR).toISOString();
  if (option === "4h") return new Date(now.getTime() + 4 * HOUR).toISOString();
  if (option === "1w") return new Date(now.getTime() + 7 * 24 * HOUR).toISOString();

  // tomorrow-morning: find the local Y-M-D of `now` in the zone, roll to the next day, and resolve
  // 08:00 of that local day back to a UTC instant (one offset correction — exact except at the DST
  // seam, which is acceptable for a snooze).
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1)); // UTC date arithmetic rolls month/year
  const guess = Date.UTC(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth(),
    tomorrow.getUTCDate(),
    MORNING_HOUR,
    0,
    0,
  );
  return new Date(guess - offsetMs(new Date(guess), timeZone)).toISOString();
}
