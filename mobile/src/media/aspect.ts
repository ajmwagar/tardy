import type { MediaItem } from '@/data/types';

/**
 * How media fits its frame, one rule for every surface and device: feed cards, reels, the
 * native player. A video or photo shows at its real shape; nothing is stretched, and only a
 * near-match is cropped.
 */

/** Feed frames follow the media's shape between Instagram's limits: 4:5 tall to 1.91:1 wide. */
export const FEED_MIN_RATIO = 4 / 5;
export const FEED_MAX_RATIO = 1.91;

/**
 * How far the media's shape may differ from its frame and still fill it (cropping the
 * difference). Beyond this it is shown whole ("contain") over a blurred copy of itself.
 * Matches the native player's `fillTolerance` (`modules/tardy-video`).
 */
export const FILL_TOLERANCE = 0.25;

/** Width over height. Throws on missing dimensions: the contract requires them. */
export function mediaRatio(media: Pick<MediaItem, 'width' | 'height'>): number {
  if (!(media.width > 0 && media.height > 0)) throw new Error(`Media has no dimensions: ${media.width}x${media.height}`);
  return media.width / media.height;
}

/** The feed frame for a post: the first item's shape, clamped to the feed's limits. */
export function feedFrameRatio(media: readonly Pick<MediaItem, 'width' | 'height'>[]): number {
  if (media.length === 0) return FEED_MIN_RATIO;
  return Math.min(FEED_MAX_RATIO, Math.max(FEED_MIN_RATIO, mediaRatio(media[0])));
}

/** Fill the frame when the shapes nearly match; otherwise show the whole thing. */
export function fitFor(mediaRatioValue: number, frameRatio: number): 'cover' | 'contain' {
  return Math.abs(mediaRatioValue - frameRatio) / frameRatio <= FILL_TOLERANCE ? 'cover' : 'contain';
}
