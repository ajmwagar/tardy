-- Recognition supplies evidence, not a license. Rust validates this output and
-- remains responsible for enforcing the hard rights invariants.
function decide(facts)
  if facts.matched then
    local review = "manual_review"
    if facts.confidence_millionths >= 850000 then
      review = "attribute_and_review"
    end
    return {
      recognition_status = "matched",
      rights_status = "pending",
      action = review,
    }
  end

  if facts.has_complete_creator_attestation then
    return {
      recognition_status = "no_match",
      rights_status = "cleared",
      action = "accept_creator_attestation",
    }
  end

  return {
    recognition_status = "no_match",
    rights_status = "pending",
    action = "manual_review",
  }
end
