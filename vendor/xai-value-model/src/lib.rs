// Vendored from https://github.com/xai-org/x-algorithm (xai-value-model/lib.rs),
// commit b79b947ce9283c786822274ef8fe208c33c585b2. Apache-2.0, see ../LICENSE and ../NOTICE.
//
// Modified: the upstream `mod proto;` (conversions to/from the unpublished
// `xai_vm_ranker_proto` gRPC types) is omitted. Every other module is byte-for-byte upstream.

// Upstream files are kept byte-identical, so rustfmt must not rewrite them.
#[rustfmt::skip]
mod inputs;
#[rustfmt::skip]
mod phoenix_scores;
#[rustfmt::skip]
mod scoring;
#[rustfmt::skip]
mod weights;

pub use inputs::{CandidateScoringInputs, QueryScoringContext};
pub use phoenix_scores::PhoenixScores;
pub use scoring::{
    PostFusionMultiplier, ValueScores, apply_cold_start_decisions, author_pool_counts,
    compute_value_scores, compute_value_scores_with_adjustment, compute_weighted_score,
    diversity_multiplier, fuse_heads, offset_score, post_fusion_multipliers,
};
pub use weights::{NEGATIVE_SCORES_OFFSET, ValueModelWeights};
