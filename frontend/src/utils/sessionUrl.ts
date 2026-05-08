// Helpers for permanent session URLs of the form /chat/<slug>?sid=<id>.
//
// The slug is derived from the session title; the sid query param is the
// canonical identifier. If the slug drifts (rename), the sid still locks
// onto the right session — so any old bookmark keeps working.

const _SLUG_BAD = /[^a-zA-Z0-9-]+/g;
const _DASHES = /-+/g;

export function slugify(s: string | undefined | null): string {
  const out = (s || "")
    .trim()
    .replace(_SLUG_BAD, "-")
    .replace(_DASHES, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return out.slice(0, 60) || "session";
}

export function chatPath(title: string | undefined | null, sessionId: string): string {
  return `/chat/${slugify(title)}?sid=${encodeURIComponent(sessionId)}`;
}

/** Pull a session id out of legacy and current URL shapes:
 *   /chat/<slug>?sid=ID    (current)
 *   /?sid=ID
 *   /?session=ID           (legacy hash/query)
 *   #session=ID            (legacy hash)
 *   ?slot=ID               (legacy meshclaw style)
 */
export function readSessionIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const fromQuery = sp.get("sid") || sp.get("session") || sp.get("slot");
  if (fromQuery) return fromQuery;
  const hash = window.location.hash || "";
  const m = hash.match(/(?:^|[#&])(?:sid|session)=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
