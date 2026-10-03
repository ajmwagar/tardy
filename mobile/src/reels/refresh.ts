import type { Post } from '@/data/types';

/** Keep a pull-to-refresh from reopening on the exact reel the viewer just left. */
export function freshReelOrder(posts: readonly Post[], previousId: string | undefined): Post[] {
  const next = [...posts];
  if (next.length > 1 && next[0].id === previousId) next.push(next.shift()!);
  return next;
}
