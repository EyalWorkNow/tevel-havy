export type KnowledgeSourceNamespace =
  | "wikidata"
  | "openalex"
  | "yente"
  | "openaleph"
  | "graphiti";

export type CanonicalFtMSchema =
  | "Person"
  | "Organization"
  | "Location"
  | "Asset"
  | "Vehicle"
  | "Identifier"
  | "Event"
  | "Thing";

export type WatchlistStatus = "match" | "candidate" | "clear" | "unavailable";

export interface KnowledgeEntityInput {
  entity_id: string;
  name: string;
  type: string;
  description?: string;
  confidence?: number;
  aliases?: string[];
  evidence?: string[];
  document_ids?: string[];
}

export interface KnowledgeRelationInput {
  source: string;
  target: string;
  type: string;
  confidence: number;
}

export interface CanonicalFtMEntity {
  ftm_id: string;
  schema: CanonicalFtMSchema;
  caption: string;
  aliases: string[];
  properties: Record<string, string[]>;
  source_entity_ids: string[];
  source_document_ids: string[];
  relation_ids: string[];
  event_ids: string[];
  confidence: number;
  external_reference_ids: string[];
  merge_rationale: string[];
}

export interface ExternalReferenceLink {
  link_id: string;
  namespace: KnowledgeSourceNamespace;
  external_id: string;
  canonical_ftm_id: string;
  canonical_ftm_schema: CanonicalFtMSchema;
  label: string;
  description?: string;
  aliases: string[];
  source_url?: string;
  match_confidence: number;
  match_rationale: string[];
  retrieved_at: string;
  derived_from_case: false;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface ReferenceAssertion {
  assertion_id: string;
  subject_ftm_id: string;
  subject_entity_id: string;
  source_namespace: KnowledgeSourceNamespace;
  predicate: string;
  value: string;
  normalized_value?: string;
  confidence: number;
  source_label?: string;
  source_url?: string;
  retrieved_at: string;
  derived_from_case: false;
  external_reference_ids: string[];
}

export interface WatchlistHit {
  hit_id: string;
  canonical_ftm_id: string;
  entity_id: string;
  source_namespace: "yente";
  list_name: string;
  matched_name: string;
  status: Exclude<WatchlistStatus, "clear" | "unavailable">;
  score: number;
  score_breakdown: Record<string, number>;
  explanation: string[];
  source_url?: string;
  retrieved_at: string;
  external_reference_id?: string;
}

export interface KnowledgeSourceSnapshot {
  snapshot_id: string;
  namespace: KnowledgeSourceNamespace;
  cache_key: string;
  status: "fresh" | "cached" | "skipped" | "error";
  retrieved_at: string;
  record_count: number;
  warnings: string[];
  source_url?: string;
}

export interface ReferenceKnowledgeProfile {
  entity_id: string;
  canonical_name: string;
  ftm_id: string;
  ftm_schema: CanonicalFtMSchema;
  aliases: string[];
  descriptions: string[];
  affiliations: string[];
  source_labels: string[];
  assertions: ReferenceAssertion[];
  links: ExternalReferenceLink[];
  watchlist_hits: WatchlistHit[];
  warnings: string[];
  derived_from_case: false;
}

export interface KnowledgeEnrichmentRequest {
  caseId: string;
  documentId?: string;
  entities: KnowledgeEntityInput[];
  relations?: KnowledgeRelationInput[];
  eventIds?: string[];
}

export interface KnowledgeEnrichmentResult {
  case_id: string;
  canonical_entities: CanonicalFtMEntity[];
  reference_knowledge: Record<string, ReferenceKnowledgeProfile>;
  watchlist_hits: WatchlistHit[];
  knowledge_sources: KnowledgeSourceSnapshot[];
  reference_warnings: string[];
  generated_at: string;
}

export interface KnowledgeAdapterResult {
  assertions: ReferenceAssertion[];
  links: ExternalReferenceLink[];
  descriptions: string[];
  affiliations: string[];
  source_labels: string[];
  warnings: string[];
  watchlist_hits?: WatchlistHit[];
  snapshot?: KnowledgeSourceSnapshot;
}

