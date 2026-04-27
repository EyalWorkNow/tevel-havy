# Entity Intelligence Debug Report Example

This is the intended shape of a per-entity debug report.

```json
{
  "case_id": "case_entity_intelligence_fixture",
  "entity_id": "entity_a1b2c3d4",
  "resolution_explanations": [
    "Attached via trusted identifier match with no severe conflicts.",
    "Attached because top candidate cleared attach threshold and margin thresholds.",
    "Top candidates were too close or insufficiently strong, so the mention remained ambiguous."
  ],
  "candidate_decisions": [
    {
      "mention_id": "m_david_3",
      "candidate_entity_id": "entity_a1b2c3d4",
      "rank": 1,
      "total_score": 0.79,
      "lexical_score": 0.5,
      "alias_score": 0.72,
      "semantic_score": 0.66,
      "id_match_score": 0,
      "role_score": 0.1,
      "temporal_score": 0.5,
      "neighborhood_score": 0.7,
      "conflict_penalty": 0,
      "decision_state": "accepted"
    }
  ],
  "conflicts": [
    {
      "conflict_type": "contradictory_role",
      "severity": "medium",
      "explanation": "Entity has multiple incompatible role claims with comparable confidence."
    }
  ],
  "summary_support": [
    {
      "sentence_type": "supported_claim",
      "sentence_text": "David Amsalem is described as role Interior Minister.",
      "backing_claim_ids": ["claim_david_role_1"],
      "backing_event_ids": [],
      "backing_relation_ids": []
    }
  ]
}
```
