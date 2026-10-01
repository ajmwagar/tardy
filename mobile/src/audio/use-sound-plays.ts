import { useEffect, useRef } from 'react';

import { uuidV4 } from '@/data/ids';
import type { Post } from '@/data/types';
import { api, reportError } from '@/state/store';

import { duePlayEvents, type PlayKind } from './plays';

const TICK_MS = 500;

/**
 * Reports plays of a reel's sound while it is on screen and audible. Each time the reel
 * becomes active is one view, and each play event gets its own id (the server dedupes on it).
 * Muted time never counts.
 */
export function useSoundPlays(post: Post, active: boolean, muted: boolean) {
  const view = useRef<{ audibleMs: number; sent: Set<PlayKind> } | null>(null);

  useEffect(() => {
    if (!active) view.current = null; // leaving the reel ends the view
  }, [active]);

  useEffect(() => {
    const sound = post.sound;
    if (!sound || !active || muted) return;
    view.current ??= { audibleMs: 0, sent: new Set() };
    const current = view.current;
    const timer = setInterval(() => {
      current.audibleMs += TICK_MS;
      for (const kind of duePlayEvents(sound.durationMs, current.audibleMs, current.sent)) {
        current.sent.add(kind);
        // One attempt per kind per view: a failure is reported once, not retried every tick.
        api
          .logSoundPlay(sound.trackId, { eventId: uuidV4(), postId: post.id, kind, listenMs: current.audibleMs })
          .catch((e: unknown) => reportError(`Couldn't count a play: ${e instanceof Error ? e.message : String(e)}`));
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [post.id, post.sound, active, muted]);
}
