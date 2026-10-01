import { useEffect, useState } from 'react';

import type { SharedLink } from '@/data/types';
import { api } from '@/state/store';

/** How often to re-read a link that is still enriching, and for how long at most. */
const POLL_MS = 1500;
const GIVE_UP_MS = 60_000;

const settled = (link: SharedLink) => link.status === 'ready' || link.status === 'failed';

/**
 * A shared link, re-read until enrichment settles (ready or failed) so its card fills in.
 * Stops after a minute: the card keeps whatever it has, and delivery never waits on this.
 */
export function useSharedLink(
  id: string | undefined,
  initial?: SharedLink | null,
): { link: SharedLink | null; error: string | null } {
  const [link, setLink] = useState<SharedLink | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const read = async () => {
      try {
        const next = await api.sharedLink(id);
        if (!live) return;
        setLink(next);
        setError(null);
        if (!settled(next) && Date.now() - started < GIVE_UP_MS) timer = setTimeout(read, POLL_MS);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);

  return { link, error };
}
