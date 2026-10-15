/** The server stores naive UTC timestamps (`datetime.utcnow().isoformat()`,
 *  no offset). `new Date()` reads those as LOCAL time, which shifts every
 *  displayed time by the viewer's UTC offset (and makes ages negative west
 *  of UTC). Treat offset-less as UTC. Numbers are epoch seconds or ms. */
export function parseServerTime(ts: string | number | null | undefined): Date {
  if (ts == null || ts === "") return new Date(NaN);
  if (typeof ts === "number") return new Date(ts < 1e12 ? ts * 1000 : ts);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(ts);
  const isDateTime = /^\d{4}-\d{2}-\d{2}T/.test(ts);
  return new Date(isDateTime && !hasZone ? ts + "Z" : ts);
}

/** Epoch ms, or 0 when missing/unparseable (sorts last). */
export function serverTimeMs(ts: string | number | null | undefined): number {
  const t = parseServerTime(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
}
