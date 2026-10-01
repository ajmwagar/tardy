use mlua::{Function, Lua, StdLib, Table};

const DEFAULT_POLICY: &str = include_str!("../policies/audio_recognition.lua");

#[derive(Debug, Clone, Copy)]
pub struct RecognitionFacts<'a> {
    pub provider: &'a str,
    pub matched: bool,
    pub confidence_millionths: i32,
    pub has_isrc: bool,
    pub has_complete_creator_attestation: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecognitionDecision {
    pub recognition_status: String,
    pub rights_status: String,
    pub action: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RecognitionPolicyError {
    #[error("invalid Lua recognition policy: {0}")]
    Lua(String),
    #[error("recognition policy returned an invalid decision: {0}")]
    Invalid(&'static str),
}

/// A narrow, deterministic policy boundary. Fingerprint generation and provider
/// calls stay in Rust workers; Lua sees facts and returns a proposed disposition.
#[derive(Clone)]
pub struct AudioRecognitionPolicy {
    source: String,
}

impl AudioRecognitionPolicy {
    pub fn default_policy() -> Result<Self, RecognitionPolicyError> {
        Self::new(DEFAULT_POLICY)
    }

    pub fn new(source: &str) -> Result<Self, RecognitionPolicyError> {
        let policy = Self {
            source: source.into(),
        };
        let lua = policy.load().map_err(lua_error)?;
        let _: Function = lua.globals().get("decide").map_err(lua_error)?;
        Ok(policy)
    }

    pub fn decide(
        &self,
        facts: RecognitionFacts<'_>,
    ) -> Result<RecognitionDecision, RecognitionPolicyError> {
        let lua = self.load().map_err(lua_error)?;
        let input = lua.create_table().map_err(lua_error)?;
        input.set("provider", facts.provider).map_err(lua_error)?;
        input.set("matched", facts.matched).map_err(lua_error)?;
        input
            .set("confidence_millionths", facts.confidence_millionths)
            .map_err(lua_error)?;
        input.set("has_isrc", facts.has_isrc).map_err(lua_error)?;
        input
            .set(
                "has_complete_creator_attestation",
                facts.has_complete_creator_attestation,
            )
            .map_err(lua_error)?;
        let decide: Function = lua.globals().get("decide").map_err(lua_error)?;
        let output: Table = decide.call(input).map_err(lua_error)?;
        let decision = RecognitionDecision {
            recognition_status: output.get("recognition_status").map_err(lua_error)?,
            rights_status: output.get("rights_status").map_err(lua_error)?,
            action: output.get("action").map_err(lua_error)?,
        };
        validate(&decision, facts)?;
        Ok(decision)
    }

    fn load(&self) -> Result<Lua, mlua::Error> {
        let lua = Lua::new_with(
            StdLib::TABLE | StdLib::STRING | StdLib::MATH,
            Default::default(),
        )?;
        lua.load(&self.source)
            .set_name("audio_recognition_policy")
            .exec()?;
        Ok(lua)
    }
}

fn lua_error(error: mlua::Error) -> RecognitionPolicyError {
    RecognitionPolicyError::Lua(error.to_string())
}

fn validate(
    decision: &RecognitionDecision,
    facts: RecognitionFacts<'_>,
) -> Result<(), RecognitionPolicyError> {
    if !matches!(decision.recognition_status.as_str(), "matched" | "no_match") {
        return Err(RecognitionPolicyError::Invalid(
            "unknown recognition status",
        ));
    }
    if !matches!(
        decision.rights_status.as_str(),
        "pending" | "cleared" | "blocked"
    ) {
        return Err(RecognitionPolicyError::Invalid("unknown rights status"));
    }
    if decision.action.trim().is_empty() {
        return Err(RecognitionPolicyError::Invalid("empty action"));
    }
    if facts.matched && decision.recognition_status != "matched" {
        return Err(RecognitionPolicyError::Invalid(
            "matched evidence cannot become no-match",
        ));
    }
    if !facts.matched && decision.recognition_status != "no_match" {
        return Err(RecognitionPolicyError::Invalid(
            "no-match evidence cannot become a match",
        ));
    }
    if decision.rights_status == "cleared"
        && (facts.matched || !facts.has_complete_creator_attestation)
    {
        return Err(RecognitionPolicyError::Invalid(
            "recognition cannot grant rights",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(matched: bool, attested: bool) -> RecognitionFacts<'static> {
        RecognitionFacts {
            provider: "test",
            matched,
            confidence_millionths: 900_000,
            has_isrc: matched,
            has_complete_creator_attestation: attested,
        }
    }

    #[test]
    fn default_policy_holds_matches_and_clears_attested_no_matches() {
        let policy = AudioRecognitionPolicy::default_policy().unwrap();
        assert_eq!(
            policy.decide(facts(true, true)).unwrap().rights_status,
            "pending"
        );
        assert_eq!(
            policy.decide(facts(false, true)).unwrap().rights_status,
            "cleared"
        );
    }

    #[test]
    fn rust_rejects_a_policy_that_uses_recognition_as_a_license() {
        let policy = AudioRecognitionPolicy::new(
            "function decide(_) return {recognition_status='matched', rights_status='cleared', action='trust'} end",
        )
        .unwrap();
        assert!(matches!(
            policy.decide(facts(true, true)),
            Err(RecognitionPolicyError::Invalid(
                "recognition cannot grant rights"
            ))
        ));
    }

    #[test]
    fn sandbox_does_not_expose_io_or_os() {
        let policy = AudioRecognitionPolicy::new(
            "function decide(_) return {recognition_status='no_match', rights_status='pending', action=tostring(io or os)} end",
        )
        .unwrap();
        let decision = policy.decide(facts(false, false)).unwrap();
        assert_eq!(decision.action, "nil");
    }
}
