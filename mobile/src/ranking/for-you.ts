import type { EngagementAction, Post } from '@/data/types';

import { computeValueScores, DEFAULT_WEIGHTS, type CandidateScoringInputs, type PhoenixScores, type ValueModelWeights } from './value-model';

/**
 * The For You pipeline, shaped like x-algorithm's home-mixer:
 *   candidate sourcing (in-network + out-of-network) → pre-scoring filters →
 *   prediction → value-model scoring → top-K selection.
 *
 * Prediction is the one stand-in: X runs Phoenix, a transformer over the viewer's
 * engagement sequence. Until Tardy has enough engagement data to train one, `predict`
 * derives per-action probabilities from the same inputs (the viewer's engagement history,
 * follow graph, and post features) with transparent heuristics. Everything downstream of
 * prediction is the real value model.
 */

export type Viewer = {
  id: string;
  following: ReadonlySet<string>;
  mutuals: ReadonlySet<string>;
  /** Newest last. */
  history: readonly EngagementAction[];
};

export type RankOptions = {
  weights?: ValueModelWeights;
  /** Discount applied to out-of-network posts (0..1). */
  oonWeight?: number;
  /** Matches home-mixer's pre-scoring age filter. */
  maxAgeHours?: number;
  now?: number;
};

export type Ranked = { post: Post; score: number; inNetwork: boolean };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

type Affinity = { positive: number; negative: number; dwellMs: number };

/** Summarizes the viewer's history per author: the signal Phoenix learns from. */
export function authorAffinity(history: readonly EngagementAction[], posts: ReadonlyMap<string, Post>) {
  const byAuthor = new Map<string, Affinity>();
  const get = (authorId: string) => {
    let a = byAuthor.get(authorId);
    if (!a) byAuthor.set(authorId, (a = { positive: 0, negative: 0, dwellMs: 0 }));
    return a;
  };

  for (const action of history) {
    if (action.type === 'follow_author' || action.type === 'unfollow_author') {
      get(action.authorId).positive += action.type === 'follow_author' ? 3 : -3;
      continue;
    }
    if (!('postId' in action)) continue;
    const post = posts.get(action.postId);
    if (!post) continue;
    const a = get(post.authorId);
    switch (action.type) {
      case 'favorite': a.positive += 1; break;
      case 'unfavorite': a.positive -= 1; break;
      case 'reply': a.positive += 2; break;
      case 'share': case 'share_via_dm': case 'share_via_copy_link': a.positive += 2; break;
      case 'profile_click': case 'open_link': case 'video_open': case 'photo_expand': a.positive += 0.5; break;
      case 'vqv': a.positive += 1; break;
      case 'dwell': a.dwellMs += action.ms; break;
      case 'not_interested': a.negative += 1; break;
    }
  }
  return byAuthor;
}

export function predict(post: Post, viewer: Viewer, affinity: Affinity | undefined, now: number): PhoenixScores {
  const inNetwork = viewer.following.has(post.authorId);
  const ageHours = (now - Date.parse(post.createdAt)) / 3_600_000;
  const pop = Math.log10(1 + post.likeCount) / 5; // ~0..1
  const aff = affinity ? affinity.positive + affinity.dwellMs / 20_000 : 0;
  const neg = affinity?.negative ?? 0;

  // Base engagement propensity: relationship, learned affinity, popularity, freshness.
  const base = sigmoid(-2.2 + (inNetwork ? 1.1 : 0) + 0.45 * aff + 1.2 * pop - ageHours / 24 - 2 * neg);
  const isVideo = post.media[0]?.type === 'video';

  return {
    favorite: clamp01(base),
    reply: clamp01(base * (post.status === 'blocked' || post.status === 'needs_review' ? 0.35 : 0.08)),
    retweet: clamp01(base * 0.05),
    share: clamp01(base * 0.06),
    shareViaDm: clamp01(base * 0.03),
    shareViaCopyLink: clamp01(base * 0.004),
    photoExpand: post.format === 'carousel' || post.format === 'photo' ? clamp01(base * 0.4) : 0,
    videoOpen: isVideo ? clamp01(base * 0.5) : 0,
    vqv: isVideo ? clamp01(base * 0.6) : 0,
    openLink: post.links.length > 0 ? clamp01(base * 0.25) : 0,
    click: clamp01(base * 0.3),
    dwell: clamp01(0.3 + base * 0.6),
    dwellTime: 4 + base * 20,
    followAuthor: inNetwork ? 0 : clamp01(base * 0.04),
    postUnexplored: inNetwork ? 0.5 : 0,
    notInterested: clamp01(0.002 + 0.05 * neg),
    muteAuthor: clamp01(0.0005 + 0.02 * neg),
    blockAuthor: 0.0002,
    report: 0.00005,
    notDwelled: clamp01(1 - base),
  };
}

export function rankForYou(posts: readonly Post[], viewer: Viewer, options: RankOptions = {}): Ranked[] {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const oonWeight = options.oonWeight ?? 0.75;
  const maxAgeMs = (options.maxAgeHours ?? 48) * 3_600_000;
  const now = options.now ?? Date.now();

  const notInterested = new Set(
    viewer.history.flatMap((a) => (a.type === 'not_interested' ? [a.postId] : [])),
  );

  // Pre-scoring filters: own posts, too old, explicitly not interested.
  const candidates = posts.filter(
    (p) => p.authorId !== viewer.id && now - Date.parse(p.createdAt) <= maxAgeMs && !notInterested.has(p.id),
  );

  const byId = new Map(posts.map((p) => [p.id, p]));
  const affinity = authorAffinity(viewer.history, byId);

  const inputs: CandidateScoringInputs[] = candidates.map((post) => ({
    scores: predict(post, viewer, affinity.get(post.authorId), now),
    authorId: post.authorId,
    inNetwork: viewer.following.has(post.authorId),
    isMutualFollowAuthor: viewer.mutuals.has(post.authorId),
    vqvEligible: post.media[0]?.type === 'video' && post.media[0].durationMs >= 10_000,
  }));

  const { scores } = computeValueScores(weights, oonWeight, inputs);

  return candidates
    .map((post, i) => ({ post, score: scores[i], inNetwork: inputs[i].inNetwork === true }))
    .sort((a, b) => b.score - a.score);
}
