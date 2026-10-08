/**
 * Tardy's web links, and the client's mirror of the server's URL canonicalization
 * (`canonicalize_url` in `src/social.rs`). The server's answer always wins; the mock uses
 * this so shared links dedupe the same way in development.
 */

/** Where a tardy lives on the web. One source of truth for building and parsing it. */
export const TARDY_WEB = 'https://tardy.news';

export const tardyUrl = (postId: string) => `${TARDY_WEB}/viewer.html?id=${encodeURIComponent(postId)}`;

/** The tardy a URL points at, or null. Accepts the canonical form (no `www.`, any query). */
export function parseTardyUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (![TARDY_WEB, 'https://api.tardy.news'].includes(parsed.origin) || parsed.username || parsed.password) return null;
    if (parsed.pathname === '/viewer.html') {
      const ids = parsed.searchParams.getAll('id');
      return ids.length === 1 && ids[0] ? ids[0] : null;
    }
    const match = /^\/t\/([^/]+)\/?$/.exec(parsed.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

const TRACKING = new Set(['fbclid', 'gclid', 'si']);

/**
 * http(s) only; drops the fragment, a leading `www.`, `utm_*` and click-id params; lowercases
 * the host; sorts the remaining query. Throws on anything else, as the server returns 422.
 */
export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('invalid share URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error('share URL must be HTTP(S)');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !key.startsWith('utm_') && !TRACKING.has(key))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

/** A YouTube video id from a canonical URL (watch?v=, youtu.be/, shorts/), or null. */
export function youtubeId(canonical: string): string | null {
  const url = new URL(canonical);
  if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
  if (url.hostname !== 'youtube.com') return null;
  return url.searchParams.get('v') ?? /^\/shorts\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
}

/** Who to credit on a link card, from the canonical host. Mirrors the server's table exactly. */
export function linkProvider(canonical: string): string {
  const providers: Record<string, string> = {
    'instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'github.com': 'github',
  };
  return providers[new URL(canonical).hostname] ?? 'web';
}
