import type { Story, StoryGroup } from '@/data/types';

import { groupBoostEnd, isGroupBoosted, isGroupSeen, isStoryBoosted, orderStoryTray } from '../boost';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const story = (id: string, boostedUntil?: string): Story => ({
  id,
  authorId: id.split('-')[0],
  media: { type: 'image', url: `https://img/${id}`, width: 1080, height: 1920 },
  createdAt: at(-1),
  seen: false,
  ...(boostedUntil === undefined ? {} : { boostedUntil }),
});

const group = (authorId: string, ...boosts: (string | undefined)[]): StoryGroup => ({
  authorId,
  stories: boosts.map((b, i) => story(`${authorId}-${i}`, b)),
});

describe('isStoryBoosted', () => {
  it('is boosted while boostedUntil is in the future', () => {
    expect(isStoryBoosted(story('a', at(2)), NOW)).toBe(true);
  });

  it('is not boosted without boostedUntil, once it has passed, or at the instant it ends', () => {
    expect(isStoryBoosted(story('a'), NOW)).toBe(false);
    expect(isStoryBoosted(story('a', at(-2)), NOW)).toBe(false);
    expect(isStoryBoosted(story('a', at(0)), NOW)).toBe(false);
  });

  it('throws on a malformed time instead of quietly treating it as unboosted', () => {
    expect(() => isStoryBoosted(story('a', 'next tuesday'), NOW)).toThrow(/a.*malformed boostedUntil/);
  });
});

describe('group boosts', () => {
  it('a group is boosted if any story is, and ends with its latest live boost', () => {
    const g = group('a', undefined, at(3), at(-1), at(5));
    expect(isGroupBoosted(g, NOW)).toBe(true);
    expect(groupBoostEnd(g, NOW)).toBe(Date.parse(at(5)));
  });

  it('a group with only expired or no boosts is not boosted', () => {
    expect(isGroupBoosted(group('a', undefined, at(-1)), NOW)).toBe(false);
    expect(groupBoostEnd(group('a'), NOW)).toBeNull();
  });
});

describe('orderStoryTray', () => {
  it('puts boosted groups first, soonest-expiring last, then the rest in their existing order', () => {
    const groups = [
      group('plain1', undefined),
      group('soon', at(1)),
      group('plain2', undefined, at(-3)),
      group('later', undefined, at(10)),
      group('plain3', undefined),
    ];
    expect(orderStoryTray(groups, NOW).map((g) => g.authorId)).toEqual(['later', 'soon', 'plain1', 'plain2', 'plain3']);
  });

  it('keeps existing order between boosts that end at the same time', () => {
    const groups = [group('x', at(4)), group('y', at(4))];
    expect(orderStoryTray(groups, NOW).map((g) => g.authorId)).toEqual(['x', 'y']);
  });

  it('is the identity when nothing is boosted, and does not mutate its input', () => {
    const groups = [group('a'), group('b', at(-1)), group('c')];
    const copy = structuredClone(groups);
    expect(orderStoryTray(groups, NOW)).toEqual(copy);
    expect(groups).toEqual(copy);
  });

  it('drops a group back into place once its boost expires', () => {
    const groups = [group('a'), group('b', at(1))];
    expect(orderStoryTray(groups, NOW).map((g) => g.authorId)).toEqual(['b', 'a']);
    expect(orderStoryTray(groups, NOW + 2 * 3_600_000).map((g) => g.authorId)).toEqual(['a', 'b']);
  });
});

describe('seen groups move to the back', () => {
  const seenAll = (g: StoryGroup): StoryGroup => ({ ...g, stories: g.stories.map((st) => ({ ...st, seen: true })) });

  it('orders unseen boosted, then unseen, then seen (boosted or not), keeping order within each', () => {
    const groups = [
      seenAll(group('seen1', undefined)),
      group('plain', undefined),
      seenAll(group('seenBoost', at(8))),
      group('boost', at(2)),
      seenAll(group('seen2', undefined)),
    ];
    expect(orderStoryTray(groups, NOW).map((g) => g.authorId)).toEqual(['boost', 'plain', 'seen1', 'seenBoost', 'seen2']);
  });

  it("uses the caller's notion of seen, so locally watched stories move back immediately", () => {
    const groups = [group('a', undefined), group('b', undefined), group('c', at(1))];
    const watched = new Set(['a-0', 'c-0']);
    expect(orderStoryTray(groups, NOW, (st) => st.seen || watched.has(st.id)).map((g) => g.authorId)).toEqual(['b', 'a', 'c']);
  });

  it('a group is seen only when every story is', () => {
    const g = group('a', undefined, undefined);
    expect(isGroupSeen(g, (st) => st.id === 'a-0')).toBe(false);
    expect(isGroupSeen(g, () => true)).toBe(true);
  });
});
