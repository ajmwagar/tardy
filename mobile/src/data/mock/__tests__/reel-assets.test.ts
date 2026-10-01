import type { Post, PostStyle } from '../../types';

const STYLES: PostStyle[] = ['news', 'podcast', 'launch', 'explainer', 'ugc', 'brainrot'];
/** Relative to this test file, as `jest.doMock` resolves it. */
const file = (name: string) => `../../../../assets/reels/${name}`;

/**
 * Jest turns every media `require` into the same placeholder, so give each bundled file
 * its own URI. A fixture reel then has to name the right file, not just any asset.
 */
let POSTS: Post[];
beforeAll(() => {
  for (const style of STYLES)
    for (const ext of ['mp4', 'jpg']) jest.doMock(file(`${style}.${ext}`), () => `bundled:${style}.${ext}`);
  jest.isolateModules(() => {
    ({ POSTS } = jest.requireActual('../fixtures'));
  });
});

describe('bundled mock reels', () => {
  it('ships a video and a poster for every style', () => {
    for (const style of STYLES)
      for (const ext of ['mp4', 'jpg']) expect(() => jest.requireActual(file(`${style}.${ext}`))).not.toThrow();
  });

  it('gives each of the six styles to exactly one fixture reel', () => {
    const styled = POSTS.filter((p) => p.style);
    expect(styled.map((p) => p.style).sort()).toEqual([...STYLES].sort());
  });

  it('resolves every fixture reel with a style to its bundled video and poster', () => {
    for (const post of POSTS.filter((p) => p.style)) {
      expect(post.format).toBe('reel');
      expect(post.media).toEqual([
        { type: 'video', url: `bundled:${post.style}.mp4`, posterUrl: `bundled:${post.style}.jpg`, width: 1080, height: 1920, durationMs: expect.any(Number) },
      ]);
    }
  });

  it('keeps bundled reels off posts without a style', () => {
    const bundled = POSTS.filter((p) => !p.style).flatMap((p) => p.media).filter((m) => m.url.startsWith('bundled:'));
    expect(bundled).toEqual([]);
  });
});
