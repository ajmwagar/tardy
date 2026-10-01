/**
 * When a sound's play counts, for the audio usage ledger (`POST /v1/audio/tracks/{id}/usage`).
 * The server records what the client reports, so the rule lives here, once:
 *
 * - `play_started`: the sound became audible (muted time never counts).
 * - `qualified_play`: heard for 10 s, or half the clip if it is shorter than 20 s.
 * - `play_completed`: heard for 95% of the clip.
 *
 * Each kind is reported at most once per view. Trending scores these (see `soundScore`).
 */

export type PlayKind = 'play_started' | 'qualified_play' | 'play_completed';

const QUALIFY_MS = 10_000;
const COMPLETE_FRACTION = 0.95;

/** The play events now due for a view, given audible time so far and what was already sent. */
export function duePlayEvents(clipMs: number, audibleMs: number, sent: ReadonlySet<PlayKind>): PlayKind[] {
  const due: PlayKind[] = [];
  if (audibleMs > 0) due.push('play_started');
  if (audibleMs >= Math.min(QUALIFY_MS, clipMs / 2)) due.push('qualified_play');
  if (clipMs > 0 && audibleMs >= clipMs * COMPLETE_FRACTION) due.push('play_completed');
  return due.filter((k) => !sent.has(k));
}

/** The server's 24-hour trending score, mirrored for the mock and for display. */
export const soundScore = ({ uses, qualified, completed }: { uses: number; qualified: number; completed: number }) =>
  uses * 100 + qualified * 10 + completed * 20;

/** `1.2K uses`, `1 use`. */
export const usesLabel = (n: number) =>
  `${n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : n} use${n === 1 ? '' : 's'}`;
