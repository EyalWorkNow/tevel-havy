export interface StructuredSummaryPanel {
  summary_id: string;
  kind:
    | "case_brief"
    | "entity_brief"
    | "relationship_brief"
    | "timeline_summary"
    | "contradiction_summary"
    | "update_summary";
  title: string;
  summary_text: string;
  key_findings: string[];
  cited_evidence_ids: string[];
  version_state?: import("../versionValidity/contracts").VersionValidityState;
  validity_score?: number;
  citation_status?: import("../citationVerification/contracts").CitationSupportStatus;
  confidence: number;
  evidence_clusters?: import("../retrieval").RetrievalEvidenceCluster[];
  analytical_synthesis?: string;
  bottom_line?: string;
  uncertainty_notes: string[];
  contradictions: string[];
  related_entities: string[];
  related_events: string[];
  timeline_slice: {
    start?: string;
    end?: string;
    event_ids: string[];
  };
  retrieval_bundle_id?: string;
  retrieval_query?: string;
  reference_context?: {
    summary_text: string;
    source_labels: string[];
    external_reference_ids: string[];
  };
}
