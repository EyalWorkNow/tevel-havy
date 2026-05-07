import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../supabaseClient";
import type {
  FcfR3AnswerCitationRecord,
  FcfR3PersistedRun,
  FcfR3Repository,
  FcfR3RunRecord,
  FcfR3SelectedEvidenceRecord,
} from "./contracts";
import type { CitationVerificationRun } from "../sidecar/citationVerification/contracts";

type RunRow = {
  run_id: string;
  case_id: string;
  generated_at: string;
  run_json: FcfR3RunRecord;
  citation_verification_run_json?: CitationVerificationRun | null;
};

type SelectedEvidenceRow = {
  run_id: string;
  atom_id: string;
  rank: number;
  selected_json: FcfR3SelectedEvidenceRecord;
};

type AnswerCitationRow = {
  run_id: string;
  claim_id: string;
  citation_json: FcfR3AnswerCitationRecord;
};

const ensure = async <T,>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>): Promise<T> => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || "FCF-R3 Postgres operation failed");
  return data as T;
};

const rowFromRun = (payload: FcfR3PersistedRun) => ({
  run_id: payload.run.run_id,
  case_id: payload.run.case_id,
  query_id: payload.run.query_id,
  question: payload.run.question,
  generated_at: payload.run.generated_at,
  tenant_id: payload.run.query_plan.tenant_id || null,
  answer_id: payload.run.answer_id || null,
  citation_run_id: payload.run.citation_run_id || null,
  citation_status: payload.run.citation_status || null,
  supported_claim_rate: payload.run.supported_claim_rate ?? null,
  persistence_status: payload.run.persistence_status,
  answer_status: payload.run.answer_status,
  route_mode: payload.run.route_mode,
  task_family: payload.run.task_family,
  candidate_count: payload.run.candidate_count,
  pruned_count: payload.run.pruned_count,
  selected_count: payload.run.selected_count,
  context_chars: payload.run.context_chars,
  estimated_input_tokens: payload.run.estimated_input_tokens,
  query_plan_json: payload.run.query_plan,
  audit_json: payload.run.audit,
  materialized_context: payload.run.materialized_context,
  knowledge_snapshot: payload.run.knowledge_snapshot,
  retrieval_artifacts_json: payload.run.retrieval_artifacts,
  citation_verification_run_json: payload.citation_verification_run || null,
  run_json: payload.run,
});

const selectedRowsFromRun = (payload: FcfR3PersistedRun) =>
  payload.selected_evidence.map((entry) => ({
    run_id: entry.run_id,
    atom_id: entry.atom_id,
    evidence_id: entry.evidence_id || null,
    rank: entry.rank,
    score: entry.score,
    reason_selected: entry.reason_selected,
    score_breakdown_json: entry.score_breakdown,
    atom_json: entry.atom,
    selected_json: entry,
  }));

const citationRowsFromRun = (payload: FcfR3PersistedRun) =>
  payload.answer_citations.map((entry) => ({
    run_id: entry.run_id,
    answer_id: entry.answer_id || null,
    claim_id: entry.claim_id,
    claim_text: entry.claim_text,
    cited_evidence_ids: entry.cited_evidence_ids,
    support_status: entry.support_status,
    support_score: entry.support_score,
    matched_evidence_ids: entry.matched_evidence_ids,
    verifier_mode: entry.verifier_mode,
    reason: entry.reason,
    warnings: entry.warnings,
    citation_json: entry,
  }));

export class PostgresFcfR3Repository implements FcfR3Repository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  async persistRun(run: FcfR3PersistedRun): Promise<FcfR3PersistedRun> {
    await ensure<RunRow[]>(
      this.client.from("fcf_r3_runs").upsert([rowFromRun(run)], { onConflict: "run_id" }).select("*"),
    );

    await ensure<SelectedEvidenceRow[]>(
      this.client.from("fcf_r3_selected_evidence").delete().eq("run_id", run.run.run_id).select("*"),
    );
    if (run.selected_evidence.length) {
      await ensure<SelectedEvidenceRow[]>(
        this.client.from("fcf_r3_selected_evidence").insert(selectedRowsFromRun(run)).select("*"),
      );
    }

    await ensure<AnswerCitationRow[]>(
      this.client.from("fcf_r3_answer_citations").delete().eq("run_id", run.run.run_id).select("*"),
    );
    if (run.answer_citations.length) {
      await ensure<AnswerCitationRow[]>(
        this.client.from("fcf_r3_answer_citations").insert(citationRowsFromRun(run)).select("*"),
      );
    }

    return run;
  }

  async getRun(runId: string, tenantId?: string): Promise<FcfR3PersistedRun | null> {
    let query = this.client.from("fcf_r3_runs").select("*").eq("run_id", runId);
    if (tenantId) query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message || "FCF-R3 Postgres operation failed");
    return data ? this.hydrateRun(data as RunRow) : null;
  }

  async getLatestRun(caseId: string, tenantId?: string): Promise<FcfR3PersistedRun | null> {
    let query = this.client.from("fcf_r3_runs").select("*").eq("case_id", caseId);
    if (tenantId) query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    const { data, error } = await query.order("generated_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message || "FCF-R3 Postgres operation failed");
    const row = (data as RunRow[] | null)?.[0];
    return row ? this.hydrateRun(row) : null;
  }

  private async hydrateRun(row: RunRow): Promise<FcfR3PersistedRun> {
    const [selectedRows, citationRows] = await Promise.all([
      ensure<SelectedEvidenceRow[]>(
        this.client.from("fcf_r3_selected_evidence").select("*").eq("run_id", row.run_id).order("rank", { ascending: true }),
      ),
      ensure<AnswerCitationRow[]>(
        this.client.from("fcf_r3_answer_citations").select("*").eq("run_id", row.run_id).order("claim_id", { ascending: true }),
      ),
    ]);

    return {
      run: row.run_json,
      selected_evidence: selectedRows.map((entry) => entry.selected_json),
      answer_citations: citationRows.map((entry) => entry.citation_json),
      citation_verification_run: row.citation_verification_run_json || undefined,
    };
  }
}

export const createPostgresFcfR3Repository = (): PostgresFcfR3Repository => new PostgresFcfR3Repository();
