import { Asset } from 'expo-asset';

import type { MediaItem, PostStyle } from '../types';

type VideoMedia = Extract<MediaItem, { type: 'video' }>;

/**
 * The bundled reels, keyed by file name: one brag-style video per content format, each made from a
 * mock agent's status update, plus real tardy reels made with the `.claude/skills` reel pipeline
 * (see `assets/reels/CREDITS.txt`). Durations are those the reels were rendered at.
 */
const REELS = {
  news: { style: 'news', video: require('../../../assets/reels/news.mp4'), poster: require('../../../assets/reels/news.jpg'), durationMs: 12_000 },
  explainer: { style: 'explainer', video: require('../../../assets/reels/explainer.mp4'), poster: require('../../../assets/reels/explainer.jpg'), durationMs: 11_000 },
  podcast: { style: 'podcast', video: require('../../../assets/reels/podcast.mp4'), poster: require('../../../assets/reels/podcast.jpg'), durationMs: 12_000 },
  launch: { style: 'launch', video: require('../../../assets/reels/launch.mp4'), poster: require('../../../assets/reels/launch.jpg'), durationMs: 13_000 },
  ugc: { style: 'ugc', video: require('../../../assets/reels/ugc.mp4'), poster: require('../../../assets/reels/ugc.jpg'), durationMs: 11_000 },
  brainrot: { style: 'brainrot', video: require('../../../assets/reels/brainrot.mp4'), poster: require('../../../assets/reels/brainrot.jpg'), durationMs: 10_000 },
  // content/2026-10-01-clankercast-ep1: two robot hosts argue about the 20 PRs that built tardy
  'clankercast-ep1': {
    style: 'podcast',
    video: require('../../../assets/reels/clankercast-ep1.mp4'),
    poster: require('../../../assets/reels/clankercast-ep1.jpg'),
    durationMs: 32_500,
  },
} satisfies Record<string, { style: PostStyle; video: number; poster: number; durationMs: number }>;

export type ReelName = keyof typeof REELS;
export const REEL_NAMES = Object.keys(REELS) as ReelName[];

/** The content format a bundled reel was rendered in. */
export const reelStyle = (name: ReelName): PostStyle => REELS[name].style;

const uriOf = (module: number, what: string): string => {
  const { uri } = Asset.fromModule(module);
  if (!uri) throw new Error(`Bundled reel asset has no URI: ${what}`);
  return uri;
};

/** The bundled vertical reel `name`, as the string-URL media the app plays. */
export function bundledReel(name: ReelName): VideoMedia {
  const reel = REELS[name];
  if (!reel) throw new Error(`No bundled reel "${name}"`);
  return {
    type: 'video',
    url: uriOf(reel.video, `${name}.mp4`),
    posterUrl: uriOf(reel.poster, `${name}.jpg`),
    width: 1080,
    height: 1920,
    durationMs: reel.durationMs,
  };
}
