export interface EntityResolutionThresholds {
  attach_threshold: number;
  margin_threshold: number;
  new_entity_threshold: number;
}

export interface EntityIntelligenceConfig {
  thresholds: EntityResolutionThresholds;
  candidate_limit: number;
  summary_sentence_limit: number;
  evidence_context_chars: number;
}

export const DEFAULT_ENTITY_INTELLIGENCE_CONFIG: EntityIntelligenceConfig = {
  thresholds: {
    attach_threshold: 0.72,
    margin_threshold: 0.12,
    new_entity_threshold: 0.38,
  },
  candidate_limit: 5,
  summary_sentence_limit: 12,
  evidence_context_chars: 120,
};
