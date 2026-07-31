/** One candidate for scheduled generation. Identity-free — the host supplies these rows. */
export interface DueUser {
  userKey: string;
  timezone: string;
  lastGeneratedAt: string | null;
}

/** Local calendar date ('YYYY-MM-DD') + minutes-since-midnight for `now` in `timeZone`. */
function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // en-CA hour12:false yields "24" for midnight in some ICU builds — normalize to 0.
  const hour = get("hour") === "24" ? 0 : Number(get("hour"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

function toMinutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * The subset of `users` whose summary is due: in the user's own timezone, the local time is at/after
 * `summaryTime` today AND they have not been generated yet today (no prior summary, or the prior one
 * was on an earlier local date). Fires at the first tick after local `summaryTime`, recovers if a tick
 * was missed earlier that local day, and never double-fires within a local day.
 */
export function computeDueSummaries<T extends DueUser>(input: {
  users: T[];
  now: Date;
  summaryTime: string;
}): T[] {
  const target = toMinutes(input.summaryTime);
  return input.users.filter((u) => {
    const { date, minutes } = localParts(input.now, u.timezone);
    if (minutes < target) return false;
    if (!u.lastGeneratedAt) return true;
    return localParts(new Date(u.lastGeneratedAt), u.timezone).date < date;
  });
}
