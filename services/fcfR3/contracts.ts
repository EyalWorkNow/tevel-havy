import type { CitationClaimResult, CitationSupportStatus, CitationVerificationRun } from "../sidecar/citationVerification/contracts";
import type { RetrievalArtifacts } from "../sidecar/retrieval";
import type {
  FcfR3AuditSummary,
  FcfR3EvidenceAtom,
  FcfR3QueryPlan,
  FcfR3ReadPathRun,
  FcfR3ScoreBreakdown,
} from "../fcfR3Service";

export type FcfR3PersistenceStatus = "pending" | "verified" | "no_claims";

export interface FcfR3RunRecord {
  run_id: string;
  case_id: string;
  query_id: string;
  question: string;
  generated_at: string;
  answer_id?: string;
  citation_run_id?: string;
  citation_status?: CitationSupportStatus;
  supported_claim_rate?: number;
  persistence_status: FcfR3PersistenceStatus;
  answer_status: FcfR3AuditSummary["answer_status"];
  route_mode: FcfR3AuditSummary["route_mode"];
  task_family: FcfR3AuditSummary["task_family"];
  candidate_count: number;
  pruned_count: number;
  selected_count: number;
  context_chars: number;
  estimated_input_tokens: number;
  query_plan: FcfR3QueryPlan;
  audit: FcfR3AuditSummary;
  materialized_context: string;
  knowledge_snapshot: string;
  retrieval_artifacts: RetrievalArtifacts;
}

export interface FcfR3SelectedEvidenceRecord {
  run_id: string;
  atom_id: string;
  evidence_id?: string;
  rank: number;
  score: number;
  reason_selected: string[];
  score_breakdown: FcfR3ScoreBreakdown;
  atom: FcfR3EvidenceAtom;
}

export interface FcfR3AnswerCitationRecord {
  run_id: string;
  answer_id?: string;
  claim_id: string;
  claim_text: string;
  cited_evidence_ids: string[];
  support_status: CitationClaimResult["support_status"];
  support_score: number;
  matched_evidence_ids: string[];
  verifier_mode: CitationClaimResult["verifier_mode"];
  reason: string;
  warnings: string[];
}

export interface FcfR3PersistedRun {
  run: FcfR3RunRecord;
  selected_evidence: FcfR3SelectedEvidenceRecord[];
  answer_citations: FcfR3AnswerCitationRecord[];
  citation_verification_run?: CitationVerificationRun;
}

export interface FcfR3PersistRequest {
  caseId: string;
  question: string;
  readPathRun: FcfR3ReadPathRun;
  answerId?: string;
  generatedAt?: string;
  citationRun?: CitationVerificationRun;
}

export interface FcfR3Repository {
  persistRun(run: FcfR3PersistedRun): Promise<FcfR3PersistedRun>;
  getRun(runId: string, tenantId?: string): Promise<FcfR3PersistedRun | null>;
  getLatestRun(caseId: string, tenantId?: string): Promise<FcfR3PersistedRun | null>;
}

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const claimToCitationRecord = (
  runId: string,
  answerId: string | undefined,
  claim: CitationClaimResult,
): FcfR3AnswerCitationRecord => ({
  run_id: runId,
  answer_id: answerId,
  claim_id: claim.claim_id,
  claim_text: claim.claim_text,
  cited_evidence_ids: claim.cited_evidence_ids,
  support_status: claim.support_status,
  support_score: claim.support_score,
  matched_evidence_ids: claim.matched_evidence_ids,
  verifier_mode: claim.verifier_mode,
  reason: claim.reason,
  warnings: claim.warnings,
});

export const buildFcfR3PersistedRun = ({
  caseId,
  question,
  readPathRun,
  answerId,
  generatedAt,
  citationRun,
}: FcfR3PersistRequest): FcfR3PersistedRun => {
  const queryId = `fcf_query_${stableHash(`${caseId}:${readPathRun.query_plan.normalized_query}`)}`;
  const runId = `fcf_r3_${stableHash(`${caseId}:${answerId || ""}:${question}:${readPathRun.knowledge_snapshot}`)}`;
  const generated_at = generatedAt || new Date().toISOString();
  const answerCitations = (citationRun?.claim_results || []).map((claim) => claimToCitationRecord(runId, answerId, claim));
  const persistenceStatus: FcfR3PersistenceStatus = citationRun
    ? answerCitations.length
      ? "verified"
      : "no_claims"
    : "pending";

  return {
    run: {
      run_id: runId,
      case_id: caseId,
      query_id: queryId,
      question,
      generated_at,
      answer_id: answerId,
      citation_run_id: citationRun?.run_id,
      citation_status: citationRun?.overall_status,
      supported_claim_rate: citationRun?.supported_claim_rate,
      persistence_status: persistenceStatus,
      answer_status: readPathRun.audit.answer_status,
      route_mode: readPathRun.audit.route_mode,
      task_family: readPathRun.audit.task_family,
      candidate_count: readPathRun.audit.candidate_count,
      pruned_count: readPathRun.audit.pruned_count,
      selected_count: readPathRun.audit.selected_count,
      context_chars: readPathRun.audit.context_chars,
      estimated_input_tokens: readPathRun.audit.estimated_input_tokens,
      query_plan: readPathRun.query_plan,
      audit: readPathRun.audit,
      materialized_context: readPathRun.materialized_context,
      knowledge_snapshot: readPathRun.knowledge_snapshot,
      retrieval_artifacts: readPathRun.retrieval_artifacts,
    },
    selected_evidence: readPathRun.selected.map((entry, index) => ({
      run_id: runId,
      atom_id: entry.atom.atom_id,
      evidence_id: entry.atom.evidence_id || entry.atom.citation_id,
      rank: index + 1,
      score: entry.score,
      reason_selected: entry.reason_selected,
      score_breakdown: entry.score_breakdown,
      atom: entry.atom,
    })),
    answer_citations: answerCitations,
    citation_verification_run: citationRun,
  };
};
