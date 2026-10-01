//! For You ranking with X's open-source value model (`xai-value-model` from
//! <https://github.com/xai-org/x-algorithm>, Apache-2.0, vendored under
//! `vendor/xai-value-model`).
//!
//! X's home-mixer ranks in two steps: Phoenix, a transformer over the viewer's engagement
//! sequence, predicts the probability of each action (favorite, reply, share, block,
//! report, ...), then the value model fuses those predictions with fixed weights, applies
//! an out-of-network discount and author-diversity decay, and sorts.
//!
//! **Phoenix is not available.** Its weights are not public and Tardy has no training
//! data yet. [`predict`] stands in for it with a transparent heuristic over facts the store
//! already has: per-reel engagement counts, freshness, whether the viewer follows the
//! author, and the viewer's own engagement history with that author. Everything after
//! prediction is X's code, called unmodified: [`xai_value_model::compute_value_scores`]
//! with X's production default weights. The heuristic mirrors the app's on-device port
//! (`mobile/src/ranking/for-you.ts`) so both sides rank the same way.
//!
//! Like the Lua ranker, this only orders candidates the trust boundary already admitted;
//! it never filters, and currently-live sessions stay pinned first.

use super::RankingError;
use crate::domain::{EngagementCounts, FeedItem, LiveStatus, RankingSignals};
use std::cmp::Ordering;
use std::collections::HashMap;
use uuid::Uuid;
use xai_value_model::{
    CandidateScoringInputs, PhoenixScores, QueryScoringContext, ValueModelWeights,
    compute_value_scores,
};

/// Discount applied to posts from authors the viewer does not follow
/// (`QueryScoringContext::effective_oon_weight`), matching the app's port.
pub const OON_WEIGHT: f64 = 0.75;
/// Each additional post from the same author is multiplied by `(1 - floor) * decay^k + floor`.
pub const AUTHOR_DIVERSITY_DECAY: f64 = 0.5;
pub const AUTHOR_DIVERSITY_FLOOR: f64 = 0.25;
/// `rust_home_mixer_min_video_duration_ms`: videos must be longer than this for VQV.
pub const MIN_VIDEO_DURATION_MS: i32 = 10_000;

/// X's production defaults from `home-mixer/params/param.rs`.
///
/// X ships author diversity disabled inside the value model (it applies diversity elsewhere
/// in home-mixer); Tardy enables it here, as the app does, because a feed of a handful of
/// agents would otherwise be dominated by whichever one posts most.
pub fn production_weights() -> ValueModelWeights {
    ValueModelWeights {
        favorite: 0.5,
        reply: 5.0,
        retweet: 1.0,
        photo_expand: 0.05,
        video_open: 0.07,
        click: 0.3,
        open_link: 0.2,
        profile_click: 0.0,
        vqv: 0.0,
        share: 2.0,
        share_via_dm: 5.0,
        share_via_copy_link: 20.0,
        dwell: 0.05,
        quote: 5.0,
        quoted_click: 0.05,
        quoted_vqv: 0.0,
        follow_author: 4.0,
        post_unexplored: 0.02,
        not_interested: -47.52,
        block_author: -31.2,
        mute_author: -58.8,
        report: -234.0,
        not_dwelled: -0.02,
        cont_dwell_time: 0.004,
        cont_click_dwell_time: 0.4,
        min_video_duration_ms: MIN_VIDEO_DURATION_MS,
        enable_quoted_vqv_duration_check: false,
        bidirectional_follow_reply_weight_boost: 15.0,
        bidirectional_follow_dwell_weight_boost: 0.0,
        enable_author_diversity: true,
        author_diversity_decay: AUTHOR_DIVERSITY_DECAY,
        author_diversity_floor: AUTHOR_DIVERSITY_FLOOR,
        oon_rescore_in_network_replies_retweets: false,
        multiplier_pre_offset: false,
    }
}

pub struct XValueModelRanker {
    weights: ValueModelWeights,
    context: QueryScoringContext,
}

impl Default for XValueModelRanker {
    fn default() -> Self {
        Self {
            weights: production_weights(),
            context: QueryScoringContext {
                effective_oon_weight: OON_WEIGHT,
            },
        }
    }
}

impl XValueModelRanker {
    /// Orders candidates: currently-live sessions first (newest first), then everything else
    /// by value-model score, ties broken by recency and id like the Lua ranker.
    pub fn rank(
        &self,
        items: Vec<FeedItem>,
        signals: &RankingSignals,
        now_ms: u64,
    ) -> Result<Vec<FeedItem>, RankingError> {
        let scores = self.scores(&items, signals, now_ms)?;
        let mut scored: Vec<(bool, f64, FeedItem)> = items
            .into_iter()
            .zip(scores)
            .map(|(item, score)| (is_live_now(&item), score, item))
            .collect();
        scored.sort_by(
            |(left_live, left_score, left), (right_live, right_score, right)| {
                right_live
                    .cmp(left_live)
                    .then_with(|| {
                        right_score
                            .partial_cmp(left_score)
                            .unwrap_or(Ordering::Equal)
                    })
                    .then_with(|| right.published_at_ms().cmp(&left.published_at_ms()))
                    .then_with(|| left.id().cmp(&right.id()))
            },
        );
        Ok(scored.into_iter().map(|(_, _, item)| item).collect())
    }

    /// Final value-model scores (after OON discount and author diversity), one per item.
    pub fn scores(
        &self,
        items: &[FeedItem],
        signals: &RankingSignals,
        now_ms: u64,
    ) -> Result<Vec<f64>, RankingError> {
        let inputs = self.inputs(items, signals, now_ms);
        let scores = compute_value_scores(&self.weights, &self.context, &inputs).scores;
        if scores.iter().any(|score| !score.is_finite()) {
            return Err(RankingError::InvalidScore);
        }
        Ok(scores)
    }

    fn inputs(
        &self,
        items: &[FeedItem],
        signals: &RankingSignals,
        now_ms: u64,
    ) -> Vec<CandidateScoringInputs> {
        // The value model keys author diversity on a u64; number authors densely in
        // candidate order so the mapping is deterministic and collision-free.
        let mut author_ids: HashMap<Uuid, u64> = HashMap::new();
        items
            .iter()
            .map(|item| {
                let author = item.profile_id();
                let next_id = author_ids.len() as u64;
                let author_id = *author_ids.entry(author).or_insert(next_id);
                let in_network = signals
                    .followed_profiles
                    .as_ref()
                    .map(|followed| followed.contains(&author));
                let counts = match item {
                    FeedItem::Reel(reel) => signals
                        .reel_engagement
                        .get(&reel.id)
                        .copied()
                        .unwrap_or_default(),
                    FeedItem::Live(_) => EngagementCounts::default(),
                };
                let vqv_eligible = match item {
                    FeedItem::Reel(reel) => reel.duration_ms > MIN_VIDEO_DURATION_MS as u64,
                    FeedItem::Live(_) => false,
                };
                CandidateScoringInputs {
                    phoenix_scores: predict(Facts {
                        in_network,
                        age_ms: now_ms.saturating_sub(item.published_at_ms()),
                        counts,
                        viewer_history: signals.viewer_history_by_author.get(&author),
                    }),
                    author_id,
                    in_network,
                    vqv_eligible,
                    ..Default::default()
                }
            })
            .collect()
    }
}

fn is_live_now(item: &FeedItem) -> bool {
    matches!(item, FeedItem::Live(live) if live.status == LiveStatus::Live)
}

/// Everything the Phoenix stand-in looks at for one candidate.
#[derive(Debug, Clone, Copy)]
pub struct Facts<'a> {
    /// `Some(true)` when the viewer follows the author; `None` when the follow graph is unknown.
    pub in_network: Option<bool>,
    pub age_ms: u64,
    /// Unique engagements on this post across all viewers.
    pub counts: EngagementCounts,
    /// The viewer's own engagements with this author's posts, if any.
    pub viewer_history: Option<&'a EngagementCounts>,
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Heuristic stand-in for Phoenix. NOT a learned model: per-action probabilities are fixed
/// fractions of one engagement propensity, which rises with following the author, the
/// viewer's past positive engagement with them, the post's popularity, and freshness, and
/// falls when the viewer keeps skipping this author. Constants mirror the app's
/// `predict` in `mobile/src/ranking/for-you.ts`.
pub fn predict(facts: Facts<'_>) -> PhoenixScores {
    let in_network = facts.in_network == Some(true);
    let age_hours = facts.age_ms as f64 / 3_600_000.0;
    let counts = facts.counts;
    // log10 of weighted engagement, ~0 for a new post and 1 at ~1,000 weighted actions.
    let popularity = ((1.0
        + counts.likes as f64
        + 2.0 * counts.shares as f64
        + 0.5 * counts.completed_views as f64)
        .log10()
        / 3.0)
        .min(1.0);
    let (affinity, negative) = facts.viewer_history.map_or((0.0, 0.0), affinity);

    let base = sigmoid(
        -2.2 + if in_network { 1.1 } else { 0.0 } + 0.45 * affinity + 1.2 * popularity
            - age_hours / 24.0
            - 2.0 * negative,
    );
    PhoenixScores {
        favorite_score: Some(base),
        reply_score: Some(base * 0.08),
        retweet_score: Some(base * 0.05),
        share_score: Some(base * 0.06),
        share_via_dm_score: Some(base * 0.03),
        share_via_copy_link_score: Some(base * 0.004),
        // Every reel is a video; no photos or outbound links to expand or open.
        photo_expand_score: Some(0.0),
        video_open_score: Some(base * 0.5),
        vqv_score: Some(base * 0.6),
        open_link_score: Some(0.0),
        click_score: Some(base * 0.3),
        dwell_score: Some(0.3 + base * 0.6),
        dwell_time: Some(4.0 + base * 20.0),
        follow_author_score: Some(if in_network { 0.0 } else { base * 0.04 }),
        post_unexplored_score: Some(if in_network { 0.5 } else { 0.0 }),
        not_interested_score: Some((0.002 + 0.05 * negative).min(1.0)),
        mute_author_score: Some((0.0005 + 0.02 * negative).min(1.0)),
        block_author_score: Some(0.0002),
        report_score: Some(0.000_05),
        not_dwelled_score: Some(1.0 - base),
        ..Default::default()
    }
}

/// `(positive, negative)` affinity from the viewer's history with one author.
/// Positive: likes, double-weighted shares, and completed views, capped at 10.
/// Negative (0..1): the share of views left unfinished, once the viewer has seen at least
/// three posts from this author without liking or sharing any of them.
fn affinity(history: &EngagementCounts) -> (f64, f64) {
    let positive =
        (history.likes as f64 + 2.0 * history.shares as f64 + history.completed_views as f64)
            .min(10.0);
    let negative = if history.views >= 3 && history.likes + history.shares == 0 {
        history.views.saturating_sub(history.completed_views) as f64 / history.views as f64
    } else {
        0.0
    };
    (positive, negative)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{LiveSession, Reel, Visibility};
    use std::collections::HashSet;
    use xai_value_model::{NEGATIVE_SCORES_OFFSET, fuse_heads};

    const HOUR: u64 = 3_600_000;
    const NOW: u64 = 100 * HOUR;

    /// X's `scoring::tests::hand_computed_parity` (xai-value-model/scoring.rs), run against
    /// the crate exactly as this module calls it: hand-derived expectations for head
    /// fusion, the bidirectional-follow boosts, VQV eligibility, the negative-score
    /// offset, the OON discount, and author-diversity decay.
    #[test]
    fn hand_computed_parity() {
        let weights = ValueModelWeights {
            favorite: 2.0,
            reply: 4.0,
            retweet: 1.0,
            dwell: 0.5,
            vqv: 3.0,
            cont_dwell_time: 0.1,
            cont_click_dwell_time: 0.2,
            post_unexplored: 1.5,
            report: -100.0,
            not_interested: -10.0,
            bidirectional_follow_reply_weight_boost: 1.0,
            bidirectional_follow_dwell_weight_boost: 0.5,
            enable_author_diversity: true,
            author_diversity_decay: 0.5,
            author_diversity_floor: 0.25,
            oon_rescore_in_network_replies_retweets: true,
            ..Default::default()
        };
        let ctx = QueryScoringContext {
            effective_oon_weight: 0.75,
        };

        let mutual_original = CandidateScoringInputs {
            phoenix_scores: PhoenixScores {
                favorite_score: Some(0.5),
                reply_score: Some(0.1),
                dwell_score: Some(0.4),
                dwell_time: Some(10.0),
                post_unexplored_score: Some(0.2),
                ..Default::default()
            },
            author_id: 1,
            in_network: Some(true),
            is_mutual_follow_author: true,
            ..Default::default()
        };
        let ineligible_video_oon = CandidateScoringInputs {
            phoenix_scores: PhoenixScores {
                favorite_score: Some(0.2),
                vqv_score: Some(0.9),
                click_dwell_time: Some(5.0),
                post_unexplored_score: Some(0.2),
                ..Default::default()
            },
            author_id: 2,
            in_network: Some(false),
            vqv_eligible: false,
            ..Default::default()
        };
        let eligible_video_same_author = CandidateScoringInputs {
            phoenix_scores: PhoenixScores {
                favorite_score: Some(0.05),
                vqv_score: Some(0.5),
                click_dwell_time: Some(5.0),
                ..Default::default()
            },
            author_id: 1,
            in_network: Some(true),
            vqv_eligible: true,
            ..Default::default()
        };
        let reported_in_network_reply = CandidateScoringInputs {
            phoenix_scores: PhoenixScores {
                favorite_score: Some(0.01),
                report_score: Some(0.05),
                ..Default::default()
            },
            author_id: 3,
            in_network: Some(true),
            is_reply: true,
            is_mutual_follow_author: true,
            ..Default::default()
        };
        let candidates = [
            mutual_original,
            ineligible_video_oon,
            eligible_video_same_author,
            reported_in_network_reply,
        ];

        let offset = 0.001;
        let positive_weight_sum = 2.0 + 4.0 + 1.0 + 0.5 + 3.0 + 1.5;
        let negative_weight_magnitude = 10.0 + 100.0;
        let total_weight_sum = positive_weight_sum + negative_weight_magnitude;

        let boosted_reply_weight = 4.0 + 1.0;
        let boosted_dwell_weight = 0.5 + 0.5;
        let weighted_mutual_original = 2.0 * 0.5
            + boosted_reply_weight * 0.1
            + boosted_dwell_weight * 0.4
            + 0.1 * 10.0
            + 1.5 * 0.2
            + offset;
        let weighted_ineligible_video_oon = 2.0 * 0.2 + 0.2 * 5.0 + offset;
        let weighted_eligible_video_same_author = 2.0 * 0.05 + 3.0 * 0.5 + 0.2 * 5.0 + offset;
        let net_reported_reply = 2.0 * 0.01 - 100.0 * 0.05;
        let weighted_reported_reply =
            (net_reported_reply + negative_weight_magnitude) / total_weight_sum * offset;
        let diversity_second_from_author = (1.0 - 0.25) * 0.5 + 0.25;

        let expected_scores = [
            weighted_mutual_original,
            weighted_ineligible_video_oon * 0.75,
            weighted_eligible_video_same_author * diversity_second_from_author,
            weighted_reported_reply * 0.75,
        ];
        let expected_weighted = [
            weighted_mutual_original,
            weighted_ineligible_video_oon,
            weighted_eligible_video_same_author,
            weighted_reported_reply,
        ];

        assert_eq!(NEGATIVE_SCORES_OFFSET, offset);
        let result = compute_value_scores(&weights, &ctx, &candidates);
        for (i, (got, want)) in result.scores.iter().zip(expected_scores).enumerate() {
            assert!(
                (got - want).abs() < 1e-12,
                "candidate {i}: got {got} want {want}"
            );
        }
        for (i, (got, want)) in result.weighted.iter().zip(expected_weighted).enumerate() {
            assert!(
                (got - want).abs() < 1e-12,
                "weighted {i}: got {got} want {want}"
            );
        }
        assert!((fuse_heads(&weights, &candidates[0]) - weighted_mutual_original).abs() < 1e-12);
    }

    #[test]
    fn production_weights_match_home_mixer_defaults() {
        let weights = production_weights();
        let applied = weights.applied_weights_map();
        for (head, want) in [
            ("favorite", 0.5),
            ("reply", 5.0),
            ("retweet", 1.0),
            ("share", 2.0),
            ("share_via_dm", 5.0),
            ("share_via_copy_link", 20.0),
            ("dwell", 0.05),
            ("follow_author", 4.0),
            ("not_interested", -47.52),
            ("block_author", -31.2),
            ("mute_author", -58.8),
            ("report", -234.0),
            ("boost.bidirectional_follow_reply", 15.0),
            ("gate.min_video_duration_ms", 10_000.0),
        ] {
            assert_eq!(applied[head], want, "{head}");
        }
        assert!(weights.enable_author_diversity);
        assert_eq!(
            (
                weights.author_diversity_decay,
                weights.author_diversity_floor
            ),
            (0.5, 0.25)
        );
        assert_eq!(
            XValueModelRanker::default().context.effective_oon_weight,
            0.75
        );
    }

    fn reel(author: Uuid, published_at_ms: u64) -> Reel {
        Reel {
            id: Uuid::new_v4(),
            profile_id: author,
            caption: String::new(),
            media_url: "https://media.test/reel.mp4".into(),
            poster_url: None,
            duration_ms: 15_000,
            visibility: Visibility::Public,
            published_at_ms,
        }
    }

    fn counts(views: u64, completed_views: u64, likes: u64, shares: u64) -> EngagementCounts {
        EngagementCounts {
            views,
            completed_views,
            likes,
            shares,
        }
    }

    fn rank(items: Vec<Reel>, signals: &RankingSignals) -> Vec<Uuid> {
        XValueModelRanker::default()
            .rank(
                items.into_iter().map(FeedItem::Reel).collect(),
                signals,
                NOW,
            )
            .unwrap()
            .iter()
            .map(FeedItem::id)
            .collect()
    }

    #[test]
    fn followed_author_ranks_above_an_identical_stranger() {
        let (followed, stranger) = (Uuid::new_v4(), Uuid::new_v4());
        let (followed_reel, stranger_reel) =
            (reel(followed, NOW - HOUR), reel(stranger, NOW - HOUR));
        let mut signals = RankingSignals {
            followed_profiles: Some(HashSet::from([followed])),
            ..Default::default()
        };
        for item in [&followed_reel, &stranger_reel] {
            signals
                .reel_engagement
                .insert(item.id, counts(40, 20, 10, 2));
        }
        // Candidate order must not matter: put the stranger first.
        let ranked = rank(vec![stranger_reel.clone(), followed_reel.clone()], &signals);
        assert_eq!(ranked, vec![followed_reel.id, stranger_reel.id]);

        let scores = XValueModelRanker::default()
            .scores(
                &[FeedItem::Reel(followed_reel), FeedItem::Reel(stranger_reel)],
                &signals,
                NOW,
            )
            .unwrap();
        assert!(
            scores[0] > scores[1] / OON_WEIGHT,
            "beyond the OON discount alone"
        );
    }

    #[test]
    fn unknown_follow_graph_applies_no_oon_discount() {
        let item = FeedItem::Reel(reel(Uuid::new_v4(), NOW - HOUR));
        let ranker = XValueModelRanker::default();
        let unknown = ranker
            .scores(&[item.clone()], &RankingSignals::default(), NOW)
            .unwrap();
        let follows_nobody = ranker
            .scores(
                &[item],
                &RankingSignals {
                    followed_profiles: Some(HashSet::new()),
                    ..Default::default()
                },
                NOW,
            )
            .unwrap();
        assert!((follows_nobody[0] - unknown[0] * OON_WEIGHT).abs() < 1e-12);
    }

    #[test]
    fn repeated_author_decays_below_a_slightly_weaker_new_author() {
        let (prolific, other) = (Uuid::new_v4(), Uuid::new_v4());
        let first = reel(prolific, NOW - HOUR);
        let second = reel(prolific, NOW - HOUR);
        let weaker = reel(other, NOW - HOUR);
        let mut signals = RankingSignals::default();
        signals
            .reel_engagement
            .insert(first.id, counts(60, 30, 20, 4));
        signals
            .reel_engagement
            .insert(second.id, counts(60, 30, 20, 4));
        signals
            .reel_engagement
            .insert(weaker.id, counts(50, 25, 15, 3));

        let ranked = rank(
            vec![first.clone(), second.clone(), weaker.clone()],
            &signals,
        );
        assert_eq!(ranked, vec![first.id, weaker.id, second.id]);

        let mut without_diversity = XValueModelRanker::default();
        without_diversity.weights.enable_author_diversity = false;
        let undiversified: Vec<Uuid> = without_diversity
            .rank(
                [&first, &second, &weaker]
                    .map(|item| FeedItem::Reel(item.clone()))
                    .to_vec(),
                &signals,
                NOW,
            )
            .unwrap()
            .iter()
            .map(FeedItem::id)
            .collect();
        assert_eq!(undiversified[2], weaker.id);

        let scores = XValueModelRanker::default()
            .scores(
                &[FeedItem::Reel(first), FeedItem::Reel(second)],
                &signals,
                NOW,
            )
            .unwrap();
        let ratio = scores.iter().cloned().fold(f64::INFINITY, f64::min)
            / scores.iter().cloned().fold(0.0, f64::max);
        assert!((ratio - ((1.0 - 0.25) * 0.5 + 0.25)).abs() < 1e-12);
    }

    #[test]
    fn negative_history_sinks_an_otherwise_stronger_post() {
        let (skipped, neutral) = (Uuid::new_v4(), Uuid::new_v4());
        let skipped_reel = reel(skipped, NOW - HOUR);
        let neutral_reel = reel(neutral, NOW - HOUR);
        let mut signals = RankingSignals::default();
        signals
            .reel_engagement
            .insert(skipped_reel.id, counts(200, 100, 80, 10));
        signals
            .reel_engagement
            .insert(neutral_reel.id, counts(20, 10, 5, 1));
        let before = rank(vec![skipped_reel.clone(), neutral_reel.clone()], &signals);
        assert_eq!(before, vec![skipped_reel.id, neutral_reel.id]);

        // The viewer opened four posts from this author and finished none.
        signals
            .viewer_history_by_author
            .insert(skipped, counts(4, 0, 0, 0));
        let after = rank(vec![skipped_reel.clone(), neutral_reel.clone()], &signals);
        assert_eq!(after, vec![neutral_reel.id, skipped_reel.id]);
    }

    #[test]
    fn positive_history_and_freshness_lift_a_post() {
        let (liked, other) = (Uuid::new_v4(), Uuid::new_v4());
        let liked_reel = reel(liked, NOW - HOUR);
        let other_reel = reel(other, NOW - HOUR);
        let mut signals = RankingSignals::default();
        signals
            .viewer_history_by_author
            .insert(liked, counts(3, 3, 2, 1));
        assert_eq!(
            rank(vec![other_reel.clone(), liked_reel.clone()], &signals),
            vec![liked_reel.id, other_reel.id]
        );

        let stale = reel(other, NOW - 30 * HOUR);
        let fresh = reel(liked, NOW - HOUR);
        assert_eq!(
            rank(
                vec![stale.clone(), fresh.clone()],
                &RankingSignals::default()
            ),
            vec![fresh.id, stale.id]
        );
    }

    #[test]
    fn live_sessions_stay_pinned_first() {
        let popular = reel(Uuid::new_v4(), NOW - HOUR);
        let live = FeedItem::Live(LiveSession {
            id: Uuid::new_v4(),
            profile_id: Uuid::new_v4(),
            title: "coding".into(),
            repository_url: "https://github.com/example/repo".into(),
            playback_url: "https://live.test/session.m3u8".into(),
            visibility: Visibility::Public,
            status: LiveStatus::Live,
            started_at_ms: NOW - 20 * HOUR,
            ended_at_ms: None,
            latest_sequence: 0,
        });
        let mut signals = RankingSignals::default();
        signals
            .reel_engagement
            .insert(popular.id, counts(900, 500, 400, 90));
        let ranked = XValueModelRanker::default()
            .rank(vec![FeedItem::Reel(popular), live.clone()], &signals, NOW)
            .unwrap();
        assert_eq!(ranked[0], live);
    }
}
