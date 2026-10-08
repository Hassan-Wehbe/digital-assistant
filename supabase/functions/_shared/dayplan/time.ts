// Local wall-clock times ("2026-10-09T16:30" in a time zone) and the moments they stand for, for the
// day planner's providers (Mapbox wants a departure moment, NWS answers with offsets).

/** "2026-10-09T21:05:00Z" (any moment Date.parse reads) as the local "2026-10-09T17:05" in tz. */
export function localTime(moment: string | number, tz: string): string | undefined {
  const t = typeof moment === "number" ? moment : Date.parse(moment);
  if (!Number.isFinite(t)) return undefined;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * The moment (ms since 1970) of the local time "2026-10-09T16:30" in tz. On the night clocks go back
 * the earlier of the two is used; a time skipped when clocks go forward lands an hour earlier (for a
 * departure, the safe side).
 */
export function momentOf(local: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (!Number.isFinite(wall)) return null;
  const offsetAt = (t: number) => {
    const l = localTime(t, tz);
    return l ? Date.parse(`${l}:00Z`) - t : 0;
  };
  // Two rounds settle the offset, daylight-saving days included.
  let t = wall - offsetAt(wall - 12 * 3_600_000);
  t = wall - offsetAt(t);
  return t;
}
