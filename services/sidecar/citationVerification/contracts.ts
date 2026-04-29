import type { RetrievalArtifacts } from "../retrieval";
import type { VersionValidityReport } from "../versionValidity/contracts";

export type CitationSupportStatus = "supported" | "partial" | "unsupported" | "contradicted" | "not_enough_evidence";
export type CitationVerifierMode = "deterministic" | "ollama";

export interface CitationClaimResult {
  claim_id: string;
  claim_text: string;
  cited_evidence_ids: string[];
  support_status: CitationSupportStatus;
  support_score: number;
  matched_evidence_ids: string[];
  verifier_mode: CitationVerifierMode;
  reason: string;
  warnings: string[];
}

export interface CitationVerificationRun {
  run_id: string;
  case_id: string;
  answer_id?: string;
  generated_at: string;
  claim_results: CitationClaimResult[];
  overall_status: CitationSupportStatus;
  supported_claim_rate: number;
  warnings: string[];
}

export interface CitationVerificationRequest {
  caseId: string;
  answerId?: string;
  answerText: string;
  retrievalArtifacts?: RetrievalArtifacts;
  versionValidity?: VersionValidityReport;
  candidateEvidenceIds?: string[];
}

export interface CitationVerificationArtifacts {
  latest_run: CitationVerificationRun;
  retrieval_artifacts?: RetrievalArtifacts;
}

