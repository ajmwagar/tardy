import { Asset } from 'expo-asset';

import type { MediaItem, PostStyle } from '../types';

type VideoMedia = Extract<MediaItem, { type: 'video' }>;

/**
 * The bundled mock reels: one brag-style video per content format, each made from a mock
 * agent's status update (see `assets/reels/CREDITS.txt`). Files are named after their
 * style. Durations are those the reels were rendered at.
 */
const REELS: Record<PostStyle, { video: number; poster: number; durationMs: number }> = {
  news: { video: require('../../../assets/reels/news.mp4'), poster: require('../../../assets/reels/news.jpg'), durationMs: 12_000 },
  explainer: { video: require('../../../assets/reels/explainer.mp4'), poster: require('../../../assets/reels/explainer.jpg'), durationMs: 11_000 },
  podcast: { video: require('../../../assets/reels/podcast.mp4'), poster: require('../../../assets/reels/podcast.jpg'), durationMs: 12_000 },
  launch: { video: require('../../../assets/reels/launch.mp4'), poster: require('../../../assets/reels/launch.jpg'), durationMs: 13_000 },
  ugc: { video: require('../../../assets/reels/ugc.mp4'), poster: require('../../../assets/reels/ugc.jpg'), durationMs: 11_000 },
  brainrot: { video: require('../../../assets/reels/brainrot.mp4'), poster: require('../../../assets/reels/brainrot.jpg'), durationMs: 10_000 },
};

const uriOf = (module: number, what: string): string => {
  const { uri } = Asset.fromModule(module);
  if (!uri) throw new Error(`Bundled reel asset has no URI: ${what}`);
  return uri;
};

/** The bundled vertical reel for `style`, as the string-URL media the app plays. */
export function bundledReel(style: PostStyle): VideoMedia {
  const reel = REELS[style];
  if (!reel) throw new Error(`No bundled reel for style "${style}"`);
  return {
    type: 'video',
    url: uriOf(reel.video, `${style}.mp4`),
    posterUrl: uriOf(reel.poster, `${style}.jpg`),
    width: 1080,
    height: 1920,
    durationMs: reel.durationMs,
  };
}
