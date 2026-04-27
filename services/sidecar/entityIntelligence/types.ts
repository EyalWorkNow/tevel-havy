import type { SidecarClaimCandidate, SidecarEventCandidate, SidecarExtractionPayload, SidecarMention, SidecarRelationCandidate } from "../types";
import type { KnowledgeEnrichmentResult } from "../knowledge/contracts";

export type EntityMentionLabel =
  | "PERSON"
  | "ORG"
  | "LOCATION"
  | "GPE"
  | "FACILITY"
  | "EVENT"
  | "EMAIL"
  | "PHONE"
  | "URL"
  | "HANDLE"
  | "USERNAME"
  | "ID_NUMBER"
  | "REGISTRATION_NUMBER"
  | "ROLE"
  | "TITLE"
  | "OTHER";

export type MentionType = "named" | "nominal" | "pronoun" | "alias" | "structured-id";
export type ReferenceLinkType = "full_name_to_short" | "title_to_person" | "pronoun" | "org_short_form" | "alias" | "structured_id";
export type ResolutionDecisionState = "attached" | "created" | "ambiguous" | "review";
export type ConfidenceBand = "high" | "medium" | "low" | "unresolved";
export type ClaimModality = "asserted" | "alleged" | "denied" | "inferred" | "quoted" | "reported_by_third_party";
export type ClaimSupportType = "direct" | "indirect" | "contextual" | "contradictory";
export type ConflictSeverity = "low" | "medium" | "high";
export type ReviewState = "clear" | "pending_review" | "needs_merge_review" | "needs_split_review" | "conflicted";

export interface DocumentRecord {
  id: string;
  case_id: string;
  source_doc_id: string;
  title?: string;
  source_identity?: string;
  language?: string;
  parser_name?: string;
  parser_version?: string;
  parser_confidence?: number;
  source_reliability?: number;
  ocr_flag?: boolean;
  ingested_at: string;
  metadata_json: Record<string, unknown>;
}

export interface DocumentVersionRecord {
  id: string;
  document_id: string;
  source_doc_id: string;
  raw_text: string;
  normalized_text: string;
  source_input_content?: string;
  created_at: string;
}

export interface DocumentChunkRecord {
  id: string;
  document_id: string;
  source_text_unit_id: string;
  ordinal: number;
  kind: string;
  raw_text: string;
  normalized_text: string;
  start_offset: number;
  end_offset: number;
  raw_start_offset: number;
  raw_end_offset: number;
  page?: number;
  section?: string;
  block?: string;
}

export interface EvidenceSpanRecord {
  id: string;
  document_id: string;
  chunk_id: string | null;
  raw_text: string;
  normalized_text: string;
  start_offset: number;
  end_offset: number;
  raw_start_offset: number;
  raw_end_offset: number;
  page?: number;
  section?: string;
  block?: string;
  extraction_method: string;
  confidence: number;
  created_at: string;
}

export interface EntityMentionRecord {
  id: string;
  document_id: string;
  evidence_span_id: string;
  source_text_unit_id?: string;
  text: string;
  normalized_text: string;
  canonical_text: string;
  label: EntityMentionLabel;
  subtype?: string;
  mention_type: MentionType;
  language?: string;
  sentence_id?: string;
  paragraph_id?: string;
  confidence: number;
  extraction_method: string;
  context_window_before: string;
  context_window_after: string;
  attributes_json: Record<string, unknown>;
}

export interface MentionTypeDecisionRecord {
  id: string;
  mention_id: string;
  primary_label: EntityMentionLabel;
  primary_confidence: number;
  alternative_labels: Array<{ label: EntityMentionLabel; confidence: number }>;
  decision_method: string;
  explanation: string;
  created_at: string;
}

export interface ReferenceLinkRecord {
  id: string;
  source_mention_id: string;
  target_mention_id: string;
  link_type: ReferenceLinkType;
  score: number;
  features_json: Record<string, number | string | boolean>;
  decision_reason: string;
}

export interface CandidateMatchRecord {
  mention_id: string;
  candidate_entity_id: string;
  rank: number;
  total_score: number;
  lexical_score: number;
  alias_score: number;
  semantic_score: number;
  id_match_score: number;
  role_score: number;
  temporal_score: number;
  neighborhood_score: number;
  conflict_penalty: number;
  features_json: Record<string, unknown>;
  decision_state: "accepted" | "rejected" | "ambiguous" | "pending_review";
}

export interface ResolutionDecisionRecord {
  id: string;
  mention_id: string;
  resolution_state: ResolutionDecisionState;
  entity_id: string;
  decision_key?: string;
  processing_job_id?: string;
  is_current?: boolean;
  final_score: number;
  attach_threshold: number;
  margin_threshold: number;
  new_entity_threshold: number;
  competing_candidate_ids: string[];
  dominant_features: string[];
  blocking_conflicts: string[];
  explanation: string;
  created_at: string;
}

export interface CanonicalEntityRecord {
  id: string;
  case_id: string;
  entity_type: string;
  canonical_name: string;
  normalized_name: string;
  aliases_json: string[];
  profile_text: string;
  profile_embedding_ref?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  status: "active" | "inactive" | "unknown";
  confidence: number;
  review_state: ReviewState;
  attributes_json: Record<string, unknown>;
  source_counts_json: Record<string, number>;
  mention_ids: string[];
}

export interface EntityAliasRecord {
  entity_id: string;
  alias: string;
  normalized_alias: string;
  alias_type: string;
  source_count: number;
  confidence: number;
}

export interface ClaimRecord {
  id: string;
  subject_entity_id: string;
  predicate: string;
  object_entity_id?: string;
  object_literal?: string;
  claim_type: string;
  modality: ClaimModality;
  polarity: "positive" | "negative" | "unknown";
  time_start?: string;
  time_end?: string;
  confidence: number;
  source_reliability?: number;
  extraction_method: string;
  supporting_evidence_count: number;
  conflicting_evidence_count: number;
  status: "validated" | "tentative" | "conflicted";
  attributes_json: Record<string, unknown>;
}

export interface ClaimEvidenceRecord {
  claim_id: string;
  evidence_span_id: string;
  support_type: ClaimSupportType;
  score: number;
  note?: string;
}

export interface RelationshipRecord {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  directed: boolean;
  confidence: number;
  first_seen_at?: string;
  last_seen_at?: string;
  support_count: number;
  contradiction_count: number;
  attributes_json: Record<string, unknown>;
  supporting_claim_ids: string[];
  supporting_evidence_ids: string[];
}

export interface EventRecord {
  id: string;
  event_type: string;
  title: string;
  description: string;
  time_start?: string;
  time_end?: string;
  location_entity_id?: string;
  location_literal?: string;
  confidence: number;
  attributes_json: Record<string, unknown>;
  supporting_evidence_ids: string[];
}

export interface EventParticipantRecord {
  event_id: string;
  entity_id: string;
  role_in_event: string;
  confidence: number;
}

export interface ConflictRecord {
  id: string;
  conflict_type: string;
  entity_id?: string;
  claim_id?: string;
  relation_id?: string;
  left_item_ref: string;
  right_item_ref: string;
  severity: ConflictSeverity;
  explanation: string;
  status: "open" | "reviewed" | "dismissed";
}

export interface EntityTimelineItem {
  id?: string;
  entity_id: string;
  event_id: string;
  title: string;
  event_type: string;
  time_start?: string;
  time_end?: string;
  confidence: number;
  evidence_ids: string[];
  source_document_ids: string[];
  uncertainty_notes: string[];
}

export interface TimelineItemRecord extends EntityTimelineItem {
  id: string;
}

export interface EntitySummaryRecord {
  id: string;
  entity_id: string;
  case_id: string;
  version: number;
  is_current: boolean;
  generated_at: string;
  processing_job_id?: string;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
  roles: string[];
  affiliations: string[];
  locations: string[];
  facts_by_confidence: Record<ConfidenceBand, string[]>;
  strongest_claim_ids: string[];
  active_relationship_ids: string[];
  timeline_event_ids: string[];
  conflict_ids: string[];
  overall_confidence: number;
  confidence_band: ConfidenceBand;
  gaps: string[];
}

export interface SummarySentenceRecord {
  summary_id?: string;
  sentence_index?: number;
  entity_id: string;
  sentence_text: string;
  sentence_type: string;
  confidence: number;
  backing_claim_ids: string[];
  backing_event_ids: string[];
  backing_relation_ids: string[];
}

export interface EntityProfileRecord {
  entity_id: string;
  summary_id?: string;
  summary_version?: number;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
  roles: string[];
  affiliations: string[];
  locations: string[];
  facts_by_confidence: Record<ConfidenceBand, string[]>;
  strongest_claim_ids: string[];
  active_relationship_ids: string[];
  timeline_event_ids: string[];
  conflict_ids: string[];
  summary_sentences: SummarySentenceRecord[];
  overall_confidence: number;
  confidence_band: ConfidenceBand;
  gaps: string[];
}

export interface ReviewTaskRecord {
  id: string;
  case_id: string;
  review_type: "ambiguous_mention" | "low_confidence_merge" | "possible_duplicate" | "conflicting_claim";
  entity_id?: string;
  mention_id?: string;
  candidate_entity_ids: string[];
  status: "open" | "closed";
  reason: string;
}

export interface ManualReviewAuditRecord {
  id: string;
  case_id: string;
  action:
    | "approve_attach"
    | "reject_attach"
    | "create_new_entity"
    | "merge_entities"
    | "split_entity"
    | "mark_claim_false"
    | "mark_claim_tentative"
    | "pin_canonical_alias"
    | "set_trusted_identifier";
  actor: string;
  entity_id?: string;
  mention_id?: string;
  note?: string;
  created_at: string;
}

export interface ReviewActionRecord extends ManualReviewAuditRecord {
  status?: "applied" | "queued";
  attributes_json?: Record<string, unknown>;
}

export interface ProcessingJobRecord {
  id: string;
  case_id: string;
  job_type: "entity_intelligence_run" | "entity_summary_regeneration" | "entity_merge" | "entity_split";
  status: "queued" | "running" | "completed" | "failed";
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  metrics_json: Record<string, number>;
  warnings: string[];
}

export interface EntityIntelligenceMetrics {
  mention_count: number;
  entity_count: number;
  ambiguous_mention_count: number;
  claim_count: number;
  relationship_count: number;
  event_count: number;
  conflict_count: number;
  provenance_coverage_rate: number;
  unsupported_summary_rate: number;
}

export interface EntityIntelligenceDebugReport {
  case_id: string;
  entity_id: string;
  resolution_explanations: string[];
  candidate_decisions: CandidateMatchRecord[];
  conflicts: ConflictRecord[];
  summary_support: SummarySentenceRecord[];
}

export interface EntityIntelligenceCaseResult {
  case_id: string;
  generated_at: string;
  documents: DocumentRecord[];
  document_versions: DocumentVersionRecord[];
  document_chunks: DocumentChunkRecord[];
  evidence_spans: EvidenceSpanRecord[];
  mentions: EntityMentionRecord[];
  mention_type_decisions: MentionTypeDecisionRecord[];
  reference_links: ReferenceLinkRecord[];
  candidate_matches: CandidateMatchRecord[];
  resolution_decisions: ResolutionDecisionRecord[];
  canonical_entities: CanonicalEntityRecord[];
  entity_aliases: EntityAliasRecord[];
  claims: ClaimRecord[];
  claim_evidence: ClaimEvidenceRecord[];
  relationships: RelationshipRecord[];
  events: EventRecord[];
  event_participants: EventParticipantRecord[];
  timeline_items: TimelineItemRecord[];
  entity_timelines: Record<string, EntityTimelineItem[]>;
  conflicts: ConflictRecord[];
  entity_summaries: EntitySummaryRecord[];
  entity_profiles: Record<string, EntityProfileRecord>;
  review_tasks: ReviewTaskRecord[];
  review_actions: ReviewActionRecord[];
  manual_audit_log: ManualReviewAuditRecord[];
  processing_jobs: ProcessingJobRecord[];
  metrics: EntityIntelligenceMetrics;
  warnings: string[];
}

export interface EntityIntelligenceBuildInput {
  caseId: string;
  payload: SidecarExtractionPayload;
  knowledge?: KnowledgeEnrichmentResult | null;
}

export interface EntityIntelligenceServiceResult {
  result: EntityIntelligenceCaseResult;
  debug_reports: Record<string, EntityIntelligenceDebugReport>;
}

export interface MentionResolutionWorkspace {
  mentions: EntityMentionRecord[];
  canonical_entities: CanonicalEntityRecord[];
  aliases: EntityAliasRecord[];
  reference_links: ReferenceLinkRecord[];
}

export type MentionCarrier = {
  mention: SidecarMention;
  payload: SidecarExtractionPayload;
};

export type StructuredArtifactCarrier = {
  payload: SidecarExtractionPayload;
  claims: SidecarClaimCandidate[];
  relations: SidecarRelationCandidate[];
  events: SidecarEventCandidate[];
};
