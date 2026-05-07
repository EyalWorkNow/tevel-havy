-- FCF-R3 Full Data Model — missing tables per architecture spec.
-- These complement the existing version_evidence_atoms and version_edges tables.
-- All tables use "if not exists" so they are safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Document
--    Source of truth for every ingested document.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists fcf_documents (
  document_id       text primary key,
  source_type       text not null,          -- 'txt' | 'pdf' | 'docx' | 'html' | 'manual'
  title             text not null,
  owner             text,
  authority_level   text not null default 'unknown', -- 'official' | 'verified' | 'open_source' | 'unknown'
  source_uri        text,
  tenant_id         text,
  acl_scope         text not null default 'internal', -- 'public' | 'internal' | 'restricted' | 'secret'
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_fcf_documents_tenant
  on fcf_documents (tenant_id, acl_scope);

create index if not exists idx_fcf_documents_source_uri
  on fcf_documents (source_uri);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DocumentVersion
--    One row per version of a document. Supports "as-of" queries.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists fcf_document_versions (
  version_id      text primary key,
  document_id     text not null references fcf_documents(document_id) on delete cascade,
  version_label   text not null,           -- e.g. 'v1', 'v2', '2026-04-01'
  effective_date  date,                    -- when this version became authoritative
  snapshot_uri    text,                    -- URI to the stored verbatim snapshot
  text_hash       text not null,           -- SHA-256 of the canonical text at ingest
  created_at      timestamptz not null default now()
);

create index if not exists idx_fcf_document_versions_document
  on fcf_document_versions (document_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AtomEmbedding
--    Dense vector for each evidence atom. One row per (atom_id, model_name).
--    The embedding column is stored as a float array; if pgvector is available
--    it can be cast to vector(N) for ANN search.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists fcf_atom_embeddings (
  atom_id       text not null,
  model_name    text not null,             -- e.g. 'nomic-embed-text', 'text-embedding-3-small'
  embedding     float8[] not null,
  created_at    timestamptz not null default now(),
  primary key (atom_id, model_name)
);

create index if not exists idx_fcf_atom_embeddings_atom
  on fcf_atom_embeddings (atom_id);

-- If pgvector extension is available, add an IVFFlat index:
-- create index if not exists idx_fcf_atom_embeddings_vec
--   on fcf_atom_embeddings using ivfflat (embedding::vector(768) vector_cosine_ops)
--   with (lists = 64);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AtomEntity
--    Named entities extracted from or anchored to an evidence atom.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists fcf_atom_entities (
  atom_id       text not null,
  entity        text not null,
  entity_type   text not null,             -- 'PERSON' | 'ORG' | 'LOCATION' | 'EVENT' | ...
  confidence    float8 not null default 0.7,
  primary key (atom_id, entity)
);

create index if not exists idx_fcf_atom_entities_entity
  on fcf_atom_entities (entity, entity_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AtomTimeAnchor
--    Temporal anchors extracted from an evidence atom (e.g. dates of events).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists fcf_atom_time_anchors (
  atom_id       text not null,
  date_value    text not null,             -- ISO-8601 or partial (e.g. '2025', '2025-Q1')
  date_role     text not null default 'event_date', -- 'event_date' | 'publication_date' | 'effective_date' | 'reference_date'
  confidence    float8 not null default 0.8,
  primary key (atom_id, date_value, date_role)
);

create index if not exists idx_fcf_atom_time_anchors_atom
  on fcf_atom_time_anchors (atom_id);

create index if not exists idx_fcf_atom_time_anchors_date
  on fcf_atom_time_anchors (date_value, date_role);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Add cost_estimate_usd to fcf_r3_runs
--    Allows per-answer cost tracking for budget monitoring.
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists fcf_r3_runs
  add column if not exists cost_estimate_usd float8,
  add column if not exists model_used text,
  add column if not exists latency_ms integer;

-- Index for cost and latency analysis.
create index if not exists idx_fcf_r3_runs_model_cost
  on fcf_r3_runs (model_used, generated_at desc);
