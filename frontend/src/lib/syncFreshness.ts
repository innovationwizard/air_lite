/**
 * How the live pages talk about an hourly Odoo sync.
 *
 * A failed attempt must not be the badge. The numbers on screen are the last
 * run that finished (success, or partial when it finished with errors). One
 * missed hour leaves that badge as it was. After three hours — two missed
 * hourly runs — the same badge goes amber and says how old the data is.
 * "failed" stays off the page: Wilmer and Alexis cannot fix a 502, and the
 * next hour retries on its own.
 */
export const SYNC_FRESH_MS = 3 * 60 * 60 * 1000;

export const GOOD_SYNC_STATUSES = ['success', 'partial'] as const;

export function syncAgeMs(finishedAt: string | null | undefined, now = Date.now()): number | null {
  if (!finishedAt) return null;
  const t = new Date(finishedAt).getTime();
  if (Number.isNaN(t)) return null;
  return now - t;
}

export function syncIsStale(finishedAt: string | null | undefined, now = Date.now()): boolean {
  const age = syncAgeMs(finishedAt, now);
  return age != null && age >= SYNC_FRESH_MS;
}

/** "hace 4 h" once the last finished run is at least three hours old. */
export function syncAgeLabel(finishedAt: string | null | undefined, now = Date.now()): string | null {
  const age = syncAgeMs(finishedAt, now);
  if (age == null || age < SYNC_FRESH_MS) return null;
  const hours = Math.floor(age / (60 * 60 * 1000));
  return `hace ${hours} h`;
}
