import { feedFrameRatio, fitFor, FEED_MAX_RATIO, FEED_MIN_RATIO, mediaRatio } from '../aspect';

const m = (width: number, height: number) => ({ width, height });

describe('feedFrameRatio', () => {
  it('follows the media between 4:5 and 1.91:1', () => {
    expect(feedFrameRatio([m(1080, 1080)])).toBe(1);
    expect(feedFrameRatio([m(1920, 1080)])).toBeCloseTo(16 / 9);
    expect(feedFrameRatio([m(1080, 1920)])).toBe(FEED_MIN_RATIO); // 9:16 portrait clamps to 4:5
    expect(feedFrameRatio([m(3000, 1000)])).toBe(FEED_MAX_RATIO); // panorama clamps to 1.91:1
  });

  it('uses the first item for the whole carousel', () => {
    expect(feedFrameRatio([m(1080, 1080), m(1920, 1080)])).toBe(1);
  });
});

describe('fitFor', () => {
  it('fills near-matches and shows the rest whole', () => {
    expect(fitFor(16 / 9, 16 / 9)).toBe('cover');
    expect(fitFor(9 / 16, 4 / 5)).toBe('contain'); // portrait video in a 4:5 feed frame: shown whole
    expect(fitFor(9 / 16, 1170 / 2532)).toBe('cover'); // portrait video on a tall phone reel: fills
    expect(fitFor(16 / 9, 1170 / 2532)).toBe('contain'); // landscape reel: whole, over blur
    expect(fitFor(3 / 4, 1640 / 2360)).toBe('cover'); // 3:4 on an iPad portrait screen
  });
});

describe('mediaRatio', () => {
  it('fails loudly without dimensions', () => {
    expect(() => mediaRatio(m(0, 100))).toThrow(/no dimensions/);
  });
});
