import type { Story, StoryGroup } from '@/data/types';

/**
 * Paid story boosts, derived from `Story.boostedUntil` (see its doc in `data/types.ts`).
 * Boosted-ness is never stored: it is computed against `now` at the point of use, so an
 * expired boost stops counting without anyone clearing it.
 */

/** When the story's boost ends (ms since epoch), or null if it was never boosted. Throws on a malformed time. */
function boostEnd(story: Pick<Story, 'id' | 'boostedUntil'>): number | null {
  if (story.boostedUntil === undefined) return null;
  const end = Date.parse(story.boostedUntil);
  if (Number.isNaN(end)) throw new Error(`Story ${story.id} has a malformed boostedUntil: "${story.boostedUntil}"`);
  return end;
}

/** A story is boosted while its `boostedUntil` is in the future. */
export function isStoryBoosted(story: Pick<Story, 'id' | 'boostedUntil'>, now: number): boolean {
  const end = boostEnd(story);
  return end !== null && end > now;
}

/** When the group's live boost ends (the latest of its stories' live boosts), or null if none is boosted. */
export function groupBoostEnd(group: StoryGroup, now: number): number | null {
  let latest: number | null = null;
  for (const story of group.stories) {
    const end = boostEnd(story);
    if (end !== null && end > now && (latest === null || end > latest)) latest = end;
  }
  return latest;
}

/** A group is boosted if any of its stories is. */
export function isGroupBoosted(group: StoryGroup, now: number): boolean {
  return groupBoostEnd(group, now) !== null;
}

/** A group is seen once every story in it is. An empty group has nothing watched, so it isn't. */
export function isGroupSeen(group: StoryGroup, isSeen: (story: Story) => boolean = (s) => s.seen): boolean {
  return group.stories.length > 0 && group.stories.every(isSeen);
}

/**
 * Tray order (the server's rule; the mock applies it, and the client re-applies it with
 * what it has watched locally, so a group moves back the moment you finish it):
 * 1. unseen boosted groups, boosted longest first, soonest-expiring last;
 * 2. other unseen groups, in their existing order;
 * 3. seen groups (boosted or not) at the back, in their existing order.
 * Ties keep their existing order. Does not mutate `groups`.
 */
export function orderStoryTray<G extends StoryGroup>(
  groups: readonly G[],
  now: number,
  isSeen: (story: Story) => boolean = (s) => s.seen,
): G[] {
  const indexes = groups.map((_, i) => i);
  const seen = groups.map((g) => isGroupSeen(g, isSeen));
  const ends = groups.map((g) => groupBoostEnd(g, now));
  const boosted = indexes.filter((i) => !seen[i] && ends[i] !== null);
  boosted.sort((a, b) => ends[b]! - ends[a]! || a - b);
  const rest = indexes.filter((i) => !seen[i] && ends[i] === null);
  const back = indexes.filter((i) => seen[i]);
  return [...boosted, ...rest, ...back].map((i) => groups[i]);
}

/** The disclosure shown on paid boosts, wherever a boosted group appears (tray and viewer). */
export const BOOSTED_LABEL = 'Boosted';

/**
 * VoiceOver label for a tray bubble. Says "Boosted" for paid placements (a ring color is
 * not a disclosure) and whether there is anything new to watch.
 */
export function storyBubbleLabel(handle: string | undefined, { boosted, seen }: { boosted: boolean; seen: boolean }): string {
  return [`${handle ?? 'Someone'}'s story`, boosted ? BOOSTED_LABEL : null, seen ? 'seen' : 'new'].filter(Boolean).join(', ');
}
