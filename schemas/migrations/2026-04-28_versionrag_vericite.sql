-- VersionRAG and VeriCite support tables.
-- Runtime remains dual-store: these tables are optional, with in-memory fallback when unavailable.

create table if not exists version_evidence_atoms (
  atom_id text primary key,
  case_id text not null,
  document_identity text not null,
  version_id text not null,
  source_doc_id text not null,
  source_text_unit_id text not null,
  evidence_id text,
  exact_pointer_json jsonb not null,
  text_hash text not null,
  text text not null,
  entity_anchors jsonb not null default '[]'::jsonb,
  time_anchors jsonb not null default '[]'::jsonb,
  source_trust double precision not null,
  task_family text not null,
  version_state text not null,
  validity_score double precision not null,
  version_edge_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null
);

create table if not exists version_edges (
  edge_id text primary key,
  case_id text not null,
  source_version_id text not null,
  target_version_id text,
  source_atom_id text,
  target_atom_id text,
  edge_type text not null,
  confidence double precision not null,
  evidence_text text not null,
  reason text not null,
  detected_from text not null,
  created_at timestamptz not null
);

create table if not exists version_validity_snapshots (
  case_id text primary key,
  document_identity text not null,
  generated_at timestamptz not null,
  current_version_id text not null,
  report_json jsonb not null
);

create table if not exists citation_verification_runs (
  run_id text primary key,
  case_id text not null,
  answer_id text,
  generated_at timestamptz not null,
  run_json jsonb not null
);

create table if not exists citation_claim_results (
  claim_id text not null,
  run_id text not null references citation_verification_runs(run_id) on delete cascade,
  case_id text not null,
  claim_text text not null,
  cited_evidence_ids jsonb not null default '[]'::jsonb,
  support_status text not null,
  support_score double precision not null,
  matched_evidence_ids jsonb not null default '[]'::jsonb,
  verifier_mode text not null,
  reason text not null,
  warnings jsonb not null default '[]'::jsonb,
  primary key (run_id, claim_id)
);

create index if not exists idx_version_evidence_atoms_case_document
  on version_evidence_atoms (case_id, document_identity, version_state);

create index if not exists idx_version_evidence_atoms_evidence_id
  on version_evidence_atoms (evidence_id);

create index if not exists idx_version_edges_case_type
  on version_edges (case_id, edge_type);

create index if not exists idx_citation_verification_runs_case
  on citation_verification_runs (case_id, generated_at desc);

create index if not exists idx_citation_claim_results_status
  on citation_claim_results (case_id, support_status);

