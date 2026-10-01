import type { Notification } from '@/data/types';

import { badgeText, groupNotifications, readThrough } from '../tray';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const n = (id: string, kind: Notification['kind'], hours: number, read = true): Notification => ({
  id,
  kind,
  actorId: 'a',
  text: id,
  createdAt: hoursAgo(hours),
  read,
});

describe('groupNotifications', () => {
  const list = [
    n('old-unread', 'blocked', 400, false),
    n('fresh-unread', 'like', 1, false),
    n('today', 'shipped', 5),
    n('week', 'mention', 50),
    n('earlier', 'follow', 300),
  ];

  it('puts every unread item in New, newest first, regardless of age', () => {
    const [first] = groupNotifications(list, 'all', NOW);
    expect(first.title).toBe('New');
    expect(first.items.map((x) => x.id)).toEqual(['fresh-unread', 'old-unread']);
  });

  it('buckets read items by age and drops empty sections', () => {
    const sections = groupNotifications(list, 'all', NOW);
    expect(sections.map((s) => [s.title, s.items.map((x) => x.id)])).toEqual([
      ['New', ['fresh-unread', 'old-unread']],
      ['Today', ['today']],
      ['This week', ['week']],
      ['Earlier', ['earlier']],
    ]);
  });

  it('filters to work kinds and to mentions', () => {
    const ids = (f: 'work' | 'mentions') => groupNotifications(list, f, NOW).flatMap((s) => s.items.map((x) => x.id));
    expect(ids('work')).toEqual(['old-unread', 'today']);
    expect(ids('mentions')).toEqual(['week']);
  });

  it('filters to what needs a human: blocked and review requests only', () => {
    const mixed = [...list, n('review', 'review_requested', 2), n('liked', 'like', 3, false)];
    const ids = groupNotifications(mixed, 'needs_you', NOW).flatMap((s) => s.items.map((x) => x.id));
    expect(ids).toEqual(['old-unread', 'review']);
  });

  it('returns no sections for an empty list', () => {
    expect(groupNotifications([], 'all', NOW)).toEqual([]);
  });
});

describe('readThrough', () => {
  it('is the newest notification time, or null when there are none', () => {
    expect(readThrough([n('a', 'like', 5), n('b', 'like', 1), n('c', 'like', 9)])).toBe(hoursAgo(1));
    expect(readThrough([])).toBeNull();
  });
});

describe('badgeText', () => {
  it('is empty at zero so the badge hides', () => {
    expect(badgeText(0)).toBeUndefined();
    expect(badgeText(-1)).toBeUndefined();
  });

  it('shows the count, capped at 99+', () => {
    expect(badgeText(3)).toBe('3');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});
