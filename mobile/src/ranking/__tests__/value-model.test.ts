import { computeValueScores, fuseHeads, NEGATIVE_SCORES_OFFSET, weights, type CandidateScoringInputs } from '../value-model';

// Mirrors `hand_computed_parity` in x-algorithm's xai-value-model/scoring.rs so the port
// stays numerically identical to the Rust original.
describe('value model parity with xai-value-model', () => {
  const w = weights({
    favorite: 2.0,
    reply: 4.0,
    retweet: 1.0,
    dwell: 0.5,
    vqv: 3.0,
    contDwellTime: 0.1,
    contClickDwellTime: 0.2,
    postUnexplored: 1.5,
    report: -100.0,
    notInterested: -10.0,
    bidirectionalFollowReplyWeightBoost: 1.0,
    bidirectionalFollowDwellWeightBoost: 0.5,
    enableAuthorDiversity: true,
    authorDiversityDecay: 0.5,
    authorDiversityFloor: 0.25,
    oonRescoreInNetworkRepliesRetweets: true,
  });

  const candidates: CandidateScoringInputs[] = [
    {
      scores: { favorite: 0.5, reply: 0.1, dwell: 0.4, dwellTime: 10.0, postUnexplored: 0.2 },
      authorId: '1',
      inNetwork: true,
      isMutualFollowAuthor: true,
    },
    {
      scores: { favorite: 0.2, vqv: 0.9, clickDwellTime: 5.0, postUnexplored: 0.2 },
      authorId: '2',
      inNetwork: false,
      vqvEligible: false,
    },
    {
      scores: { favorite: 0.05, vqv: 0.5, clickDwellTime: 5.0 },
      authorId: '1',
      inNetwork: true,
      vqvEligible: true,
    },
    {
      scores: { favorite: 0.01, report: 0.05 },
      authorId: '3',
      inNetwork: true,
      isReply: true,
      isMutualFollowAuthor: true,
    },
  ];

  const offset = NEGATIVE_SCORES_OFFSET;
  const negativeMagnitude = 10.0 + 100.0;
  const total = 2.0 + 4.0 + 1.0 + 0.5 + 3.0 + 1.5 + negativeMagnitude;

  const weightedMutual = 2.0 * 0.5 + (4.0 + 1.0) * 0.1 + (0.5 + 0.5) * 0.4 + 0.1 * 10.0 + 1.5 * 0.2 + offset;
  const weightedIneligibleVideo = 2.0 * 0.2 + 0.2 * 5.0 + offset;
  const weightedEligibleVideo = 2.0 * 0.05 + 3.0 * 0.5 + 0.2 * 5.0 + offset;
  const weightedReported = ((2.0 * 0.01 - 100.0 * 0.05 + negativeMagnitude) / total) * offset;
  const secondFromAuthor = (1.0 - 0.25) * 0.5 + 0.25;

  it('matches the hand-computed weighted and final scores', () => {
    const result = computeValueScores(w, 0.75, candidates);

    const expectedWeighted = [weightedMutual, weightedIneligibleVideo, weightedEligibleVideo, weightedReported];
    const expectedScores = [
      weightedMutual,
      weightedIneligibleVideo * 0.75,
      weightedEligibleVideo * secondFromAuthor,
      weightedReported * 0.75,
    ];

    result.weighted.forEach((got, i) => expect(got).toBeCloseTo(expectedWeighted[i], 12));
    result.scores.forEach((got, i) => expect(got).toBeCloseTo(expectedScores[i], 12));
    expect(fuseHeads(w, candidates[0])).toBeCloseTo(weightedMutual, 12);
  });
});
