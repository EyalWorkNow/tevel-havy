export type TemporalPrecision = "day" | "month" | "year" | "approximate" | "unknown";
export type TemporalRelationType = "before" | "after" | "overlap" | "contains" | "ongoing";
export type TemporalAssertionMode = "explicit" | "inferred";

export interface TemporalAnchor {
  raw_text?: string;
  normalized_start?: string;
  normalized_end?: string;
  precision: TemporalPrecision;
  assertion_mode: TemporalAssertionMode;
  confidence: number;
}

export interface TemporalEventRecord {
  event_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  event_type: string;
  title: string;
  trigger_text: string;
  actor_entities: string[];
  target_entities: string[];
  location_entities: string[];
  time_expression_raw?: string;
  normalized_start?: string;
  normalized_end?: string;
  temporal_precision: TemporalPrecision;
  assertion_mode: TemporalAssertionMode;
  temporal_confidence: number;
  confidence: number;
  uncertainty_notes: string[];
  contradiction_ids: string[];
  supporting_evidence_ids: string[];
}

export interface TemporalRelationRecord {
  relation_id: string;
  source_event_id: string;
  target_event_id: string;
  relation_type: TemporalRelationType;
  assertion_mode: TemporalAssertionMode;
  confidence: number;
  supporting_evidence_ids: string[];
}
