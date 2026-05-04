import type { CandidateMetadataValue, SidecarExtractionPayload } from "../types";

export type VersionEdgeType = "supersedes" | "amends" | "cancels" | "replaces" | "contradicts" | "confirms";
export type VersionValidityState =
  | "current"
  | "historical"
  | "superseded"
  | "amended"
  | "cancelled"
  | "contradicted"
  | "unknown";

export interface ExactEvidencePointer {
  source_doc_id: string;
  source_text_unit_id: string;
  raw_start: number;
  raw_end: number;
  normalized_start: number;
  normalized_end: number;
}

export interface VersionDocumentRecord {
  document_identity: string;
  source_doc_id: string;
  title?: string;
  source_uri?: string;
  source_filename?: string;
  source_type?: string;
  metadata: Record<string, CandidateMetadataValue>;
}

export interface DocumentVersionRecord {
  version_id: string;
  document_identity: string;
  source_doc_id: string;
  version_label: string;
  effective_date?: string;
  created_at: string;
  text_hash: string;
  text_unit_count: number;
}

export interface EvidenceAtom {
  atom_id: string;
  document_identity: string;
  version_id: string;
  source_doc_id: string;
  source_text_unit_id: string;
  evidence_id?: string;
  exact_pointer: ExactEvidencePointer;
  text: string;
  text_hash: string;
  entity_anchors: string[];
  time_anchors: string[];
  source_trust: number;
  task_family: string;
  version_state: VersionValidityState;
  validity_score: number;
  version_edge_ids: string[];
  created_at: string;
}

export interface VersionEdge {
  edge_id: string;
  source_version_id: string;
  target_version_id?: string;
  source_atom_id?: string;
  target_atom_id?: string;
  edge_type: VersionEdgeType;
  confidence: number;
  evidence_text: string;
  reason: string;
  detected_from: "explicit_cue" | "diff" | "claim_conflict" | "manual";
  created_at: string;
}

export interface VersionValidityMetrics {
  atom_count: number;
  current_atom_count: number;
  historical_atom_count: number;
  edge_count: number;
  contradicted_atom_count: number;
  average_validity_score: number;
}

export interface VersionValidityReport {
  case_id: string;
  document_identity: string;
  generated_at: string;
  current_version_id: string;
  documents: VersionDocumentRecord[];
  versions: DocumentVersionRecord[];
  atoms: EvidenceAtom[];
  edges: VersionEdge[];
  metrics: VersionValidityMetrics;
  warnings: string[];
}

export interface VersionValidityBuildInput {
  caseId: string;
  payload: SidecarExtractionPayload;
  previousReport?: VersionValidityReport | null;
}

export type VersionValidityArtifacts = VersionValidityReport;

