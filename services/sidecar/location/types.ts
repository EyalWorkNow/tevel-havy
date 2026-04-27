export type LocationMentionType =
  | "address_like"
  | "poi_or_facility"
  | "locality_or_admin_area"
  | "ambiguous_text_toponym";

export type LocationResolutionMethod =
  | "pelias_direct"
  | "pelias_structured"
  | "pelias_after_libpostal"
  | "pelias_after_mordecai3"
  | "heuristic_fallback";

export type LocationPinConfidence = "high" | "medium" | "low";

export interface LocationMentionInput {
  mention_id: string;
  raw_text: string;
  sentence_text: string;
  document_id: string;
  page_number?: number;
  surrounding_entities: string[];
  language?: string;
  source_confidence?: number;
}

export interface NormalizedAddressResult {
  normalized_query: string;
  components: Record<string, string>;
  source: "libpostal" | "heuristic";
  confidence: number;
}

export interface AmbiguousToponymHint {
  text: string;
  country?: string;
  region?: string;
  locality?: string;
  confidence: number;
  source: "mordecai3" | "heuristic";
}

export interface PeliasCandidate {
  canonical_name: string;
  normalized_query: string;
  lat: number | null;
  lon: number | null;
  bbox?: [number, number, number, number] | null;
  country?: string;
  region?: string;
  locality?: string;
  neighbourhood?: string;
  source: string;
  gid?: string;
  wof_id?: string;
  geonameid?: string;
  confidence: number;
  match_label: string;
  raw_payload?: Record<string, unknown>;
}

export interface ResolvedLocationRecord {
  location_id: string;
  canonical_name: string;
  raw_text: string;
  normalized_query: string;
  lat: number | null;
  lon: number | null;
  bbox?: [number, number, number, number] | null;
  country?: string;
  region?: string;
  locality?: string;
  neighbourhood?: string;
  source: string;
  gid?: string;
  wof_id?: string;
  geonameid?: string;
  wikidata_id?: string;
  external_reference_ids?: string[];
  alias_surface?: string[];
  confidence: number;
  pin_confidence: LocationPinConfidence;
  resolution_method: LocationResolutionMethod;
  mention_type: LocationMentionType;
  evidence_mentions: string[];
  candidate_count: number;
  warning?: string;
}

export interface LocationCandidateSet {
  mention_id: string;
  mention_type: LocationMentionType;
  candidates: ResolvedLocationRecord[];
  accepted_location_id?: string;
  unresolved_reason?: string;
}

export interface LocationResolutionResponse {
  case_id: string;
  resolved_locations: ResolvedLocationRecord[];
  candidate_sets: LocationCandidateSet[];
  fallback_mode: "pelias" | "heuristic";
  generated_at: string;
}

export interface CaseMapResponse {
  case_id: string;
  resolved_locations: ResolvedLocationRecord[];
  unresolved_candidates: LocationCandidateSet[];
  generated_at: string;
}
