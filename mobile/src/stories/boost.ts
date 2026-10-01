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

/**
 * Tray order (the server's rule; the mock applies it): boosted groups first, the one
 * boosted longest first and the soonest-expiring last; then everyone else in their
 * existing order. Ties keep their existing order. Does not mutate `groups`.
 */
export function orderStoryTray<G extends StoryGroup>(groups: readonly G[], now: number): G[] {
  const ends = groups.map((g) => groupBoostEnd(g, now));
  const boosted = groups.map((_, i) => i).filter((i) => ends[i] !== null);
  boosted.sort((a, b) => ends[b]! - ends[a]! || a - b);
  return [...boosted.map((i) => groups[i]), ...groups.filter((_, i) => ends[i] === null)];
}
