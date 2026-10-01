/**
 * TypeScript port of the X For You value model (`xai-value-model/` in
 * https://github.com/xai-org/x-algorithm, Apache-2.0, (c) X Corp.).
 *
 * Modified: ported from Rust, trimmed to the heads Tardy uses, and wired to the
 * engagement actions this app logs. The math (weighted head fusion, negative-score
 * offset, author-diversity decay, out-of-network discount) matches the original and is
 * pinned by the parity test in `__tests__/value-model.test.ts`.
 *
 * This runs on-device only to rank the mock feed. The real feed is ranked server side
 * (the Rust `xai-value-model` crate can be used directly there); the client's job is to
 * log the engagement actions the model learns from — see `src/state/engagement.ts`.
 *
 * Weights multiply the viewer's *predicted probability* of each action, never raw
 * engagement counts, so e.g. report = -234 vs favorite = 0.5 does not mean
 * "one report cancels 468 likes".
 */

export const NEGATIVE_SCORES_OFFSET = 0.001;

/** Predicted probability (or, for dwell times, a continuous value) per action head. */
export type PhoenixScores = Partial<{
  favorite: number;
  reply: number;
  retweet: number;
  photoExpand: number;
  videoOpen: number;
  click: number;
  openLink: number;
  profileClick: number;
  vqv: number;
  share: number;
  shareViaDm: number;
  shareViaCopyLink: number;
  dwell: number;
  quote: number;
  quotedClick: number;
  quotedVqv: number;
  followAuthor: number;
  notInterested: number;
  blockAuthor: number;
  muteAuthor: number;
  report: number;
  notDwelled: number;
  postUnexplored: number;
  dwellTime: number;
  clickDwellTime: number;
}>;

export type ValueModelWeights = {
  favorite: number;
  reply: number;
  retweet: number;
  photoExpand: number;
  videoOpen: number;
  click: number;
  openLink: number;
  profileClick: number;
  vqv: number;
  share: number;
  shareViaDm: number;
  shareViaCopyLink: number;
  dwell: number;
  quote: number;
  quotedClick: number;
  quotedVqv: number;
  followAuthor: number;
  postUnexplored: number;
  notInterested: number;
  blockAuthor: number;
  muteAuthor: number;
  report: number;
  notDwelled: number;
  contDwellTime: number;
  contClickDwellTime: number;
  bidirectionalFollowReplyWeightBoost: number;
  bidirectionalFollowDwellWeightBoost: number;
  enableAuthorDiversity: boolean;
  authorDiversityDecay: number;
  authorDiversityFloor: number;
  oonRescoreInNetworkRepliesRetweets: boolean;
};

const ZERO_WEIGHTS: ValueModelWeights = {
  favorite: 0, reply: 0, retweet: 0, photoExpand: 0, videoOpen: 0, click: 0, openLink: 0,
  profileClick: 0, vqv: 0, share: 0, shareViaDm: 0, shareViaCopyLink: 0, dwell: 0, quote: 0,
  quotedClick: 0, quotedVqv: 0, followAuthor: 0, postUnexplored: 0, notInterested: 0,
  blockAuthor: 0, muteAuthor: 0, report: 0, notDwelled: 0, contDwellTime: 0,
  contClickDwellTime: 0, bidirectionalFollowReplyWeightBoost: 0,
  bidirectionalFollowDwellWeightBoost: 0, enableAuthorDiversity: false,
  authorDiversityDecay: 1, authorDiversityFloor: 1, oonRescoreInNetworkRepliesRetweets: false,
};

export function weights(overrides: Partial<ValueModelWeights>): ValueModelWeights {
  return { ...ZERO_WEIGHTS, ...overrides };
}

/**
 * Production defaults from `home-mixer/params/param.rs`. X ships author diversity
 * disabled in the value model (it is applied elsewhere in their pipeline); Tardy turns it
 * on here because a feed of a few agents would otherwise be dominated by one of them.
 */
export const DEFAULT_WEIGHTS: ValueModelWeights = weights({
  favorite: 0.5,
  reply: 5.0,
  bidirectionalFollowReplyWeightBoost: 15.0,
  bidirectionalFollowDwellWeightBoost: 0.0,
  retweet: 1.0,
  photoExpand: 0.05,
  videoOpen: 0.07,
  click: 0.3,
  openLink: 0.2,
  profileClick: 0.0,
  vqv: 0.0,
  share: 2.0,
  shareViaDm: 5.0,
  shareViaCopyLink: 20.0,
  dwell: 0.05,
  quote: 5.0,
  quotedClick: 0.05,
  quotedVqv: 0.0,
  followAuthor: 4.0,
  postUnexplored: 0.02,
  contDwellTime: 0.004,
  contClickDwellTime: 0.4,
  notInterested: -47.52,
  blockAuthor: -31.2,
  muteAuthor: -58.8,
  report: -234.0,
  notDwelled: -0.02,
  enableAuthorDiversity: true,
  authorDiversityDecay: 0.5,
  authorDiversityFloor: 0.25,
});

export type CandidateScoringInputs = {
  scores: PhoenixScores;
  authorId: string;
  /** True when the viewer follows the author; undefined when unknown. */
  inNetwork?: boolean;
  isReply?: boolean;
  isRetweet?: boolean;
  isMutualFollowAuthor?: boolean;
  vqvEligible?: boolean;
  quotedVqvEligible?: boolean;
};

function positiveSum(w: ValueModelWeights): number {
  return (
    w.favorite + w.reply + w.retweet + w.photoExpand + w.videoOpen + w.click + w.openLink +
    w.profileClick + w.vqv + w.share + w.shareViaDm + w.shareViaCopyLink + w.dwell + w.quote +
    w.quotedClick + w.quotedVqv + w.followAuthor + w.postUnexplored
  );
}

export function negativeSum(w: ValueModelWeights): number {
  return -(w.notInterested + w.blockAuthor + w.muteAuthor + w.report + w.notDwelled);
}

export function totalSum(w: ValueModelWeights): number {
  return positiveSum(w) + negativeSum(w);
}

function bidirectionalBoostEligible(c: CandidateScoringInputs): boolean {
  return !c.isReply && !c.isRetweet && c.isMutualFollowAuthor === true;
}

function replyWeightFor(w: ValueModelWeights, c: CandidateScoringInputs): number {
  return w.bidirectionalFollowReplyWeightBoost !== 0 && bidirectionalBoostEligible(c)
    ? w.reply + w.bidirectionalFollowReplyWeightBoost
    : w.reply;
}

function dwellWeightFor(w: ValueModelWeights, c: CandidateScoringInputs): number {
  return w.bidirectionalFollowDwellWeightBoost !== 0 && bidirectionalBoostEligible(c)
    ? w.dwell + w.bidirectionalFollowDwellWeightBoost
    : w.dwell;
}

export function computeWeightedScore(w: ValueModelWeights, c: CandidateScoringInputs): number {
  const s = c.scores;
  const apply = (score: number | undefined, weight: number) => (score ?? 0) * weight;

  return [
    apply(s.favorite, w.favorite),
    apply(s.reply, replyWeightFor(w, c)),
    apply(s.retweet, w.retweet),
    apply(s.photoExpand, w.photoExpand),
    apply(s.videoOpen, w.videoOpen),
    apply(s.click, w.click),
    apply(s.openLink, w.openLink),
    apply(s.profileClick, w.profileClick),
    apply(s.vqv, c.vqvEligible ? w.vqv : 0),
    apply(s.share, w.share),
    apply(s.shareViaDm, w.shareViaDm),
    apply(s.shareViaCopyLink, w.shareViaCopyLink),
    apply(s.dwell, dwellWeightFor(w, c)),
    apply(s.quote, w.quote),
    apply(s.quotedClick, w.quotedClick),
    apply(s.quotedVqv, c.quotedVqvEligible ? w.quotedVqv : 0),
    apply(s.dwellTime, w.contDwellTime),
    apply(s.clickDwellTime, w.contClickDwellTime),
    apply(s.followAuthor, w.followAuthor),
    apply(s.notInterested, w.notInterested),
    apply(s.blockAuthor, w.blockAuthor),
    apply(s.muteAuthor, w.muteAuthor),
    apply(s.report, w.report),
    apply(s.notDwelled, w.notDwelled),
    apply(s.postUnexplored, c.inNetwork === true ? w.postUnexplored : 0),
  ].reduce((sum, x) => sum + x, 0);
}

/** Keeps every score positive while preserving order: negatives squash into (0, offset). */
export function offsetScore(combined: number, w: ValueModelWeights): number {
  const total = totalSum(w);
  if (total === 0) return Math.max(combined, 0);
  if (combined < 0) return ((combined + negativeSum(w)) / total) * NEGATIVE_SCORES_OFFSET;
  return combined + NEGATIVE_SCORES_OFFSET;
}

export function fuseHeads(w: ValueModelWeights, c: CandidateScoringInputs): number {
  return offsetScore(computeWeightedScore(w, c), w);
}

export function diversityMultiplier(decay: number, floor: number, exponent: number): number {
  return (1 - floor) * Math.pow(decay, exponent) + floor;
}

/** For each candidate, how many higher-scored candidates share its author. */
export function authorPoolCounts(authorIds: string[], orderingScores: number[]): number[] {
  const order = orderingScores.map((s, i) => [i, s] as const).sort((a, b) => b[1] - a[1]);
  const counts = new Array<number>(authorIds.length).fill(0);
  const seen = new Map<string, number>();
  for (const [index] of order) {
    const k = seen.get(authorIds[index]) ?? 0;
    counts[index] = k;
    seen.set(authorIds[index], k + 1);
  }
  return counts;
}

function oonApplies(w: ValueModelWeights, c: CandidateScoringInputs): boolean {
  if (c.inNetwork === false) return true;
  if (c.inNetwork === true) return w.oonRescoreInNetworkRepliesRetweets && (!!c.isReply || !!c.isRetweet);
  return false;
}

export type ValueScores = { weighted: number[]; scores: number[] };

/**
 * Scores a whole candidate set: fused head score, then author-diversity decay and the
 * out-of-network discount (`effectiveOonWeight`, 0..1).
 */
export function computeValueScores(
  w: ValueModelWeights,
  effectiveOonWeight: number,
  candidates: CandidateScoringInputs[],
): ValueScores {
  const weighted = candidates.map((c) => fuseHeads(w, c));
  const diversity = w.enableAuthorDiversity
    ? authorPoolCounts(candidates.map((c) => c.authorId), weighted).map((k) =>
        diversityMultiplier(w.authorDiversityDecay, w.authorDiversityFloor, k),
      )
    : candidates.map(() => 1);

  const scores = weighted.map(
    (s, i) => s * diversity[i] * (oonApplies(w, candidates[i]) ? effectiveOonWeight : 1),
  );
  return { weighted, scores };
}
