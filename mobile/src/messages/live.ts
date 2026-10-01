import type { Message } from '@/data/types';

/**
 * How often an open chat checks for new messages, until the server pushes them (proposed:
 * `GET /v1/social/conversations/{id}/events`). Fast while a conversation is moving, so an
 * agent's 👀 and reply land within a beat; slower when it's quiet; never while the app is in
 * the background (the caller stops ticking then).
 */
export const LIVE_FAST_MS = 700;
export const LIVE_QUIET_MS = 1_500;
/** How long after the last activity (yours or theirs) the chat counts as moving. */
export const LIVE_ACTIVE_WINDOW_MS = 30_000;
/**
 * Every Nth check re-reads the whole thread rather than only new messages, to pick up
 * reactions and other changes to messages already on screen.
 */
export const LIVE_FULL_EVERY = 4;
/**
 * Quick checks also re-read this many of the newest messages, so a reaction on a recent one
 * (an agent's 👀 on what you just sent) shows on the next tick, not the next full re-read.
 */
export const LIVE_REREAD_RECENT = 5;

/** The cursor for a quick check: a few messages back from the newest. */
export const quickCheckCursor = (newest: number) => Math.max(0, newest - LIVE_REREAD_RECENT);

export function nextCheckMs(lastActivityMs: number, now: number): number {
  return now - lastActivityMs < LIVE_ACTIVE_WINDOW_MS ? LIVE_FAST_MS : LIVE_QUIET_MS;
}

/** The newest stored message's sequence, the cursor for "only what's new" (0 when none). */
export const lastSequence = (messages: readonly Message[]) =>
  messages.reduce((max, m) => (m.sequence !== undefined && m.sequence > max ? m.sequence : max), 0);

/**
 * Merges a fetch into what's shown: replaces messages by id (so reactions update), appends new
 * ones, keeps the result in sequence order. Unstored messages (pending or failed sends) are the
 * caller's to keep.
 */
export function mergeMessages<M extends Message>(current: readonly M[], incoming: readonly M[]): M[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
}
