import type { Post, PostStyle } from '../../types';

const STYLES: PostStyle[] = ['news', 'podcast', 'launch', 'explainer', 'ugc', 'brainrot'];
/** Every bundled reel file, by name (`reel-assets.ts` keys). */
const REELS = [...STYLES, 'clankercast-ep1'];
/** Relative to this test file, as `jest.doMock` resolves it. */
const file = (name: string) => `../../../../assets/reels/${name}`;

/**
 * Jest turns every media `require` into the same placeholder, so give each bundled file
 * its own URI. A fixture reel then has to name the right file, not just any asset.
 */
let POSTS: Post[];
let REEL_NAMES: string[];
beforeAll(() => {
  for (const name of REELS)
    for (const ext of ['mp4', 'jpg']) jest.doMock(file(`${name}.${ext}`), () => `bundled:${name}.${ext}`);
  jest.isolateModules(() => {
    ({ POSTS } = jest.requireActual('../fixtures'));
    ({ REEL_NAMES } = jest.requireActual('../reel-assets'));
  });
});

const bundledName = (post: Post) => post.media[0]?.url.replace(/^bundled:/, '').replace(/\.mp4$/, '');

describe('bundled reels', () => {
  it('ships a video and a poster for every reel', () => {
    expect([...REEL_NAMES].sort()).toEqual([...REELS].sort());
    for (const name of REELS)
      for (const ext of ['mp4', 'jpg']) expect(() => jest.requireActual(file(`${name}.${ext}`))).not.toThrow();
  });

  it('gives each bundled reel to exactly one fixture post, and covers every style', () => {
    const styled = POSTS.filter((p) => p.style);
    expect(styled.map(bundledName).sort()).toEqual([...REELS].sort());
    expect([...new Set(styled.map((p) => p.style))].sort()).toEqual([...STYLES].sort());
  });

  it('resolves every fixture reel with a style to its bundled video and poster', () => {
    for (const post of POSTS.filter((p) => p.style)) {
      const name = bundledName(post);
      expect(post.format).toBe('reel');
      expect(post.media).toEqual([
        { type: 'video', url: `bundled:${name}.mp4`, posterUrl: `bundled:${name}.jpg`, width: 1080, height: 1920, durationMs: expect.any(Number) },
      ]);
    }
  });

  it('tags the Clankercast episode as a podcast', () => {
    const ep = POSTS.find((p) => bundledName(p) === 'clankercast-ep1');
    expect(ep?.style).toBe('podcast');
  });

  it('keeps bundled reels off posts without a style', () => {
    const bundled = POSTS.filter((p) => !p.style).flatMap((p) => p.media).filter((m) => m.url.startsWith('bundled:'));
    expect(bundled).toEqual([]);
  });
});
