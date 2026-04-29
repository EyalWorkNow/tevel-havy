-- FCF-R3 read-path persistence.
-- Keeps routing, selected evidence, and citation verification traces durable between sessions.

create table if not exists fcf_r3_runs (
  run_id text primary key,
  case_id text not null,
  query_id text not null,
  question text not null,
  generated_at timestamptz not null,
  answer_id text,
  citation_run_id text,
  citation_status text,
  supported_claim_rate double precision,
  persistence_status text not null,
  answer_status text not null,
  route_mode text not null,
  task_family text not null,
  candidate_count integer not null,
  pruned_count integer not null,
  selected_count integer not null,
  context_chars integer not null,
  estimated_input_tokens integer not null,
  query_plan_json jsonb not null,
  audit_json jsonb not null,
  materialized_context text not null,
  knowledge_snapshot text not null,
  retrieval_artifacts_json jsonb not null,
  citation_verification_run_json jsonb,
  run_json jsonb not null
);

create table if not exists fcf_r3_selected_evidence (
  run_id text not null references fcf_r3_runs(run_id) on delete cascade,
  atom_id text not null,
  evidence_id text,
  rank integer not null,
  score double precision not null,
  reason_selected jsonb not null default '[]'::jsonb,
  score_breakdown_json jsonb not null,
  atom_json jsonb not null,
  selected_json jsonb not null,
  primary key (run_id, atom_id)
);

create table if not exists fcf_r3_answer_citations (
  run_id text not null references fcf_r3_runs(run_id) on delete cascade,
  answer_id text,
  claim_id text not null,
  claim_text text not null,
  cited_evidence_ids jsonb not null default '[]'::jsonb,
  support_status text not null,
  support_score double precision not null,
  matched_evidence_ids jsonb not null default '[]'::jsonb,
  verifier_mode text not null,
  reason text not null,
  warnings jsonb not null default '[]'::jsonb,
  citation_json jsonb not null,
  primary key (run_id, claim_id)
);

create index if not exists idx_fcf_r3_runs_case_generated
  on fcf_r3_runs (case_id, generated_at desc);

create index if not exists idx_fcf_r3_runs_status
  on fcf_r3_runs (case_id, answer_status, citation_status);

create index if not exists idx_fcf_r3_selected_evidence_evidence_id
  on fcf_r3_selected_evidence (evidence_id);

create index if not exists idx_fcf_r3_answer_citations_status
  on fcf_r3_answer_citations (run_id, support_status);
