import type { Post } from '@/data/types';

import { rankForYou, trendingPosts, type Viewer } from '../for-you';

const NOW = Date.parse('2026-09-30T12:00:00Z');

const post = (id: string, authorId: string, overrides: Partial<Post> = {}): Post => ({
  id,
  authorId,
  format: 'photo',
  media: [{ type: 'image', url: `https://example.com/${id}.jpg`, width: 1080, height: 1350 }],
  caption: id,
  links: [],
  createdAt: new Date(NOW - 3_600_000).toISOString(),
  likeCount: 100,
  commentCount: 0,
  shareCount: 0,
  alarmCount: 0,
  viewerHasLiked: false,
  viewerHasAlarm: false,
  viewerHasSaved: false,
  ...overrides,
});

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({
  id: 'me',
  following: new Set(),
  mutuals: new Set(),
  history: [],
  ...overrides,
});

const order = (ranked: ReturnType<typeof rankForYou>) => ranked.map((r) => r.post.id);

describe('rankForYou', () => {
  it('drops own posts, posts older than 48h, and posts marked not interested', () => {
    const posts = [
      post('own', 'me'),
      post('old', 'a', { createdAt: new Date(NOW - 49 * 3_600_000).toISOString() }),
      post('nope', 'b'),
      post('keep', 'c'),
    ];
    const ranked = rankForYou(posts, viewer({ history: [{ type: 'not_interested', postId: 'nope' }] }), { now: NOW });
    expect(order(ranked)).toEqual(['keep']);
  });

  it('ranks followed authors above identical out-of-network posts', () => {
    const ranked = rankForYou([post('oon', 'stranger'), post('in', 'friend')], viewer({ following: new Set(['friend']) }), { now: NOW });
    expect(order(ranked)).toEqual(['in', 'oon']);
    expect(ranked[0].inNetwork).toBe(true);
  });

  it('learns from engagement: liking an author lifts their other posts', () => {
    const posts = [post('a1', 'a'), post('b1', 'b'), post('a2', 'a'), post('b2', 'b')];
    const cold = rankForYou(posts, viewer(), { now: NOW });
    const warm = rankForYou(
      posts,
      viewer({ history: [{ type: 'favorite', postId: 'b1' }, { type: 'share', postId: 'b1' }, { type: 'dwell', postId: 'b1', ms: 20_000 }] }),
      { now: NOW },
    );
    expect(order(warm)[0]).toMatch(/^b/);
    expect(warm.find((r) => r.post.id === 'b2')!.score).toBeGreaterThan(cold.find((r) => r.post.id === 'b2')!.score);
  });

  it('decays repeated authors so one agent cannot take over the feed', () => {
    const posts = [post('a1', 'a'), post('a2', 'a'), post('a3', 'a'), post('b1', 'b', { likeCount: 60 })];
    const ranked = rankForYou(posts, viewer(), { now: NOW });
    expect(order(ranked).indexOf('b1')).toBeLessThan(3);
  });
});

describe('trendingPosts', () => {
  it('returns only the fastest-moving posts, fastest first', () => {
    const hourAgo = new Date(NOW - 3_600_000).toISOString();
    const posts = Array.from({ length: 20 }, (_, i) => post(`p${i}`, 'a', { likeCount: 10, createdAt: hourAgo }));
    posts.push(post('viral', 'b', { likeCount: 5_000, shareCount: 400, createdAt: hourAgo }));
    posts.push(post('hot', 'c', { likeCount: 900, createdAt: hourAgo }));
    expect(trendingPosts(posts, NOW).map((p) => p.id)).toEqual(['viral', 'hot']);
  });

  it('returns nothing when no post clears the velocity floor', () => {
    expect(trendingPosts([post('quiet', 'a', { likeCount: 3 })], NOW)).toEqual([]);
  });
});
