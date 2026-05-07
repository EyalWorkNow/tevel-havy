export type ExtractionSource = "rule" | "gazetteer" | "model" | "linker" | "llm";
export type TextUnitKind =
  | "paragraph"
  | "sentence"
  | "hard_split"
  | "table_row"
  | "heading"
  | "emphasis_block"
  | "form_field";
export type CandidateMetadataValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];

export interface SourceDocumentMetadata {
  title?: string;
  source_type?: string;
  page_number?: number;
  section?: string;
  language?: string;
  [key: string]: CandidateMetadataValue | undefined;
}

export interface SourceDocumentInput {
  source_doc_id: string;
  raw_content: string;
  normalized_content?: string;
  source_input_content?: string;
  source_parser?: SourceParserInfo;
  metadata?: SourceDocumentMetadata;
}

export interface SourceParserInfo {
  parser_name: string;
  parser_version?: string;
  parser_input_kind: "raw_text" | "html" | "file";
  parser_view: "raw_text" | "parsed_text";
  source_uri?: string;
  source_mime_type?: string;
  source_filename?: string;
  title?: string;
  author?: string;
  hostname?: string;
  published_at?: string;
  language?: string;
}

export interface NormalizedCharSourceSpan {
  normalized_index: number;
  raw_start: number;
  raw_end: number;
}

export interface SourceOffsetMap {
  raw_length: number;
  normalized_length: number;
  raw_to_normalized: number[];
  normalized_to_raw: NormalizedCharSourceSpan[];
}

export interface IngestedSourceDocument {
  source_doc_id: string;
  raw_content: string;
  normalized_content: string;
  source_input_content?: string;
  source_parser?: SourceParserInfo;
  offset_map: SourceOffsetMap;
  normalization_steps: string[];
  metadata: SourceDocumentMetadata;
  text_units: SidecarTextUnit[];
}

export interface SidecarTextUnit {
  source_doc_id: string;
  text_unit_id: string;
  ordinal: number;
  kind: TextUnitKind;
  start: number;
  end: number;
  normalized_start: number;
  normalized_end: number;
  raw_start: number;
  raw_end: number;
  text: string;
  raw_text: string;
  char_length: number;
  token_estimate: number;
  stable_hash: string;
  metadata?: SourceDocumentMetadata;
}

export interface EvidenceSpan {
  evidence_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  start: number;
  end: number;
  normalized_start: number;
  normalized_end: number;
  raw_start: number;
  raw_end: number;
  raw_supporting_snippet: string;
  normalized_supporting_snippet: string;
  normalized_text: string;
  extraction_source: ExtractionSource;
  source_parser?: string;
  source_extractor?: string;
  confidence: number;
  timestamp?: string;
  corroborates?: string[];
  contradicts?: string[];
}

export interface SidecarExtractionCandidate {
  candidate_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  char_start: number;
  char_end: number;
  normalized_char_start: number;
  normalized_char_end: number;
  raw_char_start: number;
  raw_char_end: number;
  raw_text: string;
  normalized_text: string;
  label: string;
  candidate_type: string;
  extraction_source: ExtractionSource;
  confidence: number;
  metadata: Record<string, CandidateMetadataValue>;
  evidence: EvidenceSpan;
}

export interface SidecarMention extends SidecarExtractionCandidate {
  mention_id: string;
  entity_id?: string;
  mention_text: string;
  entity_type: string;
  role?: string;
  timestamp?: string;
}

export interface SidecarEntityRecord {
  entity_id: string;
  source_doc_id: string;
  canonical_name: string;
  normalized_name: string;
  entity_type: string;
  aliases: string[];
  mention_ids: string[];
  source_text_unit_ids: string[];
  extraction_sources: ExtractionSource[];
  confidence: number;
  timestamps: string[];
  corroborating_mention_ids: string[];
  contradicting_entity_ids: string[];
  canonical_ftm_id?: string;
  canonical_ftm_schema?: string;
  external_reference_ids?: string[];
}

export type RelationEvidenceStatus = "explicit" | "inferred" | "unsupported";

export interface SidecarRelationCandidate {
  relation_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  source_entity_id: string;
  target_entity_id: string;
  source_mention_ids: string[];
  target_mention_ids: string[];
  relation_type: string;
  normalized_text: string;
  extraction_source: ExtractionSource;
  confidence: number;
  timestamp?: string;
  metadata?: Record<string, CandidateMetadataValue>;
  evidence: EvidenceSpan;
  corroborates?: string[];
  contradicts?: string[];
  evidence_status?: RelationEvidenceStatus;
}

export interface SidecarEventCandidate {
  event_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  event_type: string;
  trigger_text: string;
  trigger_normalized_text: string;
  actor_entity_ids: string[];
  actor_mention_ids: string[];
  target_entity_ids: string[];
  target_mention_ids: string[];
  location_entity_ids: string[];
  location_mention_ids: string[];
  normalized_text: string;
  extraction_source: ExtractionSource;
  confidence: number;
  timestamp?: string;
  metadata?: Record<string, CandidateMetadataValue>;
  evidence: EvidenceSpan;
}

export interface SidecarClaimCandidate {
  claim_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  claim_type: string;
  cue_text?: string;
  speaker_entity_ids?: string[];
  speaker_mention_ids?: string[];
  subject_entity_ids?: string[];
  subject_mention_ids?: string[];
  object_entity_ids?: string[];
  object_mention_ids?: string[];
  claim_text: string;
  normalized_text: string;
  extraction_source: ExtractionSource;
  confidence: number;
  timestamp?: string;
  metadata?: Record<string, CandidateMetadataValue>;
  evidence: EvidenceSpan;
  corroborates?: string[];
  contradicts?: string[];
}

export interface SidecarExtractionStats {
  doc_char_length: number;
  text_unit_count: number;
  candidate_count: number;
  mention_count: number;
  entity_count: number;
  relation_count: number;
  event_count: number;
  claim_count: number;
  duplicate_collapse_rate: number;
  evidence_coverage_rate: number;
}

export type SidecarAdapterHealth = "active" | "configured" | "unavailable" | "disabled" | "skipped";

export interface SidecarRuntimeAdapterStatus {
  state: SidecarAdapterHealth;
  detail?: string;
}

export interface SidecarRuntimeDiagnostics {
  extractor_name: string;
  warnings: string[];
  adapter_status: Record<string, SidecarRuntimeAdapterStatus>;
}

export interface SidecarExtractionPayload {
  source_doc_id: string;
  raw_text: string;
  normalized_text: string;
  source_input_content?: string;
  source_parser?: SourceParserInfo;
  normalization_steps: string[];
  generated_at: string;
  pipeline_version: string;
  text_units: SidecarTextUnit[];
  candidates: SidecarExtractionCandidate[];
  mentions: SidecarMention[];
  entities: SidecarEntityRecord[];
  relation_candidates: SidecarRelationCandidate[];
  event_candidates: SidecarEventCandidate[];
  claim_candidates: SidecarClaimCandidate[];
  stats: SidecarExtractionStats;
  runtime_diagnostics?: SidecarRuntimeDiagnostics;
}

export interface LexicalSearchHit {
  hit_type: "text_unit" | "entity" | "mention";
  id: string;
  score: number;
  source_text_unit_id?: string;
  snippet: string;
  matched_terms: string[];
}

export interface SidecarLexicalIndex {
  source_doc_id: string;
  inverted_terms: Map<string, string[]>;
  record_text: Map<string, string>;
  record_type: Map<string, LexicalSearchHit["hit_type"]>;
  record_text_unit: Map<string, string | undefined>;
}
