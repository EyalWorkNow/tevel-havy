-- Tevel Entity Intelligence normalized schema
-- PostgreSQL remains the source of truth. Snapshot tables are read-model helpers only.

create table if not exists entity_documents (
  id text primary key,
  case_id text not null,
  source_doc_id text not null,
  title text,
  source_identity text,
  language text,
  parser_name text,
  parser_version text,
  parser_confidence double precision,
  source_reliability double precision,
  ocr_flag boolean default false,
  ingested_at timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb
);

create table if not exists entity_document_versions (
  id text primary key,
  document_id text not null references entity_documents(id) on delete cascade,
  source_doc_id text not null,
  raw_text text not null,
  normalized_text text not null,
  source_input_content text,
  created_at timestamptz not null
);

create table if not exists entity_document_chunks (
  id text primary key,
  document_id text not null references entity_documents(id) on delete cascade,
  source_text_unit_id text not null,
  ordinal integer not null,
  kind text not null,
  raw_text text not null,
  normalized_text text not null,
  start_offset integer not null,
  end_offset integer not null,
  raw_start_offset integer not null,
  raw_end_offset integer not null,
  page integer,
  section text,
  block text
);

create table if not exists entity_evidence_spans (
  id text primary key,
  document_id text not null references entity_documents(id) on delete cascade,
  chunk_id text references entity_document_chunks(id) on delete set null,
  raw_text text not null,
  normalized_text text not null,
  start_offset integer not null,
  end_offset integer not null,
  raw_start_offset integer not null,
  raw_end_offset integer not null,
  page integer,
  section text,
  block text,
  extraction_method text not null,
  confidence double precision not null,
  created_at timestamptz not null
);

create table if not exists entity_mentions (
  id text primary key,
  document_id text not null references entity_documents(id) on delete cascade,
  evidence_span_id text not null references entity_evidence_spans(id) on delete cascade,
  source_text_unit_id text,
  text text not null,
  normalized_text text not null,
  canonical_text text not null,
  label text not null,
  subtype text,
  mention_type text not null,
  language text,
  sentence_id text,
  paragraph_id text,
  confidence double precision not null,
  extraction_method text not null,
  context_window_before text not null,
  context_window_after text not null,
  attributes_json jsonb not null default '{}'::jsonb
);

create table if not exists entity_mention_type_decisions (
  id text primary key,
  mention_id text not null references entity_mentions(id) on delete cascade,
  primary_label text not null,
  primary_confidence double precision not null,
  alternative_labels jsonb not null default '[]'::jsonb,
  decision_method text not null,
  explanation text not null,
  created_at timestamptz not null
);

create table if not exists entity_reference_links (
  id text primary key,
  source_mention_id text not null references entity_mentions(id) on delete cascade,
  target_mention_id text not null references entity_mentions(id) on delete cascade,
  link_type text not null,
  score double precision not null,
  features_json jsonb not null default '{}'::jsonb,
  decision_reason text not null
);

create table if not exists canonical_entities (
  id text primary key,
  case_id text not null,
  entity_type text not null,
  canonical_name text not null,
  normalized_name text not null,
  aliases_json jsonb not null default '[]'::jsonb,
  profile_text text not null,
  profile_embedding_ref text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  status text not null,
  confidence double precision not null,
  review_state text not null,
  attributes_json jsonb not null default '{}'::jsonb,
  source_counts_json jsonb not null default '{}'::jsonb
);

create table if not exists entity_aliases (
  entity_id text not null references canonical_entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null,
  source_count integer not null,
  confidence double precision not null,
  primary key (entity_id, normalized_alias)
);

create table if not exists entity_candidate_matches (
  mention_id text not null references entity_mentions(id) on delete cascade,
  candidate_entity_id text not null references canonical_entities(id) on delete cascade,
  rank integer not null,
  total_score double precision not null,
  lexical_score double precision not null,
  alias_score double precision not null,
  semantic_score double precision not null,
  id_match_score double precision not null,
  role_score double precision not null,
  temporal_score double precision not null,
  neighborhood_score double precision not null,
  conflict_penalty double precision not null,
  features_json jsonb not null default '{}'::jsonb,
  decision_state text not null,
  primary key (mention_id, candidate_entity_id)
);

create table if not exists entity_processing_jobs (
  id text primary key,
  case_id text not null,
  job_type text not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms integer,
  metrics_json jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb
);

create table if not exists entity_resolution_decisions (
  id text primary key,
  case_id text not null,
  mention_id text not null references entity_mentions(id) on delete cascade,
  resolution_state text not null,
  entity_id text not null references canonical_entities(id) on delete cascade,
  decision_key text not null,
  processing_job_id text references entity_processing_jobs(id) on delete set null,
  is_current boolean not null default true,
  final_score double precision not null,
  attach_threshold double precision not null,
  margin_threshold double precision not null,
  new_entity_threshold double precision not null,
  competing_candidate_ids jsonb not null default '[]'::jsonb,
  dominant_features jsonb not null default '[]'::jsonb,
  blocking_conflicts jsonb not null default '[]'::jsonb,
  explanation text not null,
  created_at timestamptz not null
);

create table if not exists entity_claims (
  id text primary key,
  case_id text not null,
  subject_entity_id text not null references canonical_entities(id) on delete cascade,
  predicate text not null,
  object_entity_id text references canonical_entities(id) on delete set null,
  object_literal text,
  claim_type text not null,
  modality text not null,
  polarity text not null,
  time_start timestamptz,
  time_end timestamptz,
  confidence double precision not null,
  source_reliability double precision,
  extraction_method text not null,
  supporting_evidence_count integer not null,
  conflicting_evidence_count integer not null,
  status text not null,
  attributes_json jsonb not null default '{}'::jsonb
);

create table if not exists entity_claim_evidence (
  claim_id text not null references entity_claims(id) on delete cascade,
  evidence_span_id text not null references entity_evidence_spans(id) on delete cascade,
  support_type text not null,
  score double precision not null,
  note text,
  primary key (claim_id, evidence_span_id)
);

create table if not exists entity_relationships (
  id text primary key,
  case_id text not null,
  source_entity_id text not null references canonical_entities(id) on delete cascade,
  target_entity_id text not null references canonical_entities(id) on delete cascade,
  relation_type text not null,
  directed boolean not null default true,
  confidence double precision not null,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  support_count integer not null,
  contradiction_count integer not null,
  attributes_json jsonb not null default '{}'::jsonb
);

create table if not exists entity_events (
  id text primary key,
  case_id text not null,
  event_type text not null,
  title text not null,
  description text not null,
  time_start timestamptz,
  time_end timestamptz,
  location_entity_id text references canonical_entities(id) on delete set null,
  location_literal text,
  confidence double precision not null,
  attributes_json jsonb not null default '{}'::jsonb
);

create table if not exists entity_event_participants (
  event_id text not null references entity_events(id) on delete cascade,
  entity_id text not null references canonical_entities(id) on delete cascade,
  role_in_event text not null,
  confidence double precision not null,
  primary key (event_id, entity_id, role_in_event)
);

create table if not exists entity_timeline_items (
  id text primary key,
  case_id text not null,
  entity_id text not null references canonical_entities(id) on delete cascade,
  event_id text not null references entity_events(id) on delete cascade,
  title text not null,
  event_type text not null,
  time_start timestamptz,
  time_end timestamptz,
  confidence double precision not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  source_document_ids jsonb not null default '[]'::jsonb,
  uncertainty_notes jsonb not null default '[]'::jsonb
);

create table if not exists entity_conflicts (
  id text primary key,
  case_id text not null,
  conflict_type text not null,
  entity_id text references canonical_entities(id) on delete cascade,
  claim_id text references entity_claims(id) on delete cascade,
  relation_id text references entity_relationships(id) on delete cascade,
  left_item_ref text not null,
  right_item_ref text not null,
  severity text not null,
  explanation text not null,
  status text not null
);

create table if not exists entity_summaries (
  id text primary key,
  entity_id text not null references canonical_entities(id) on delete cascade,
  case_id text not null,
  version integer not null,
  is_current boolean not null default true,
  generated_at timestamptz not null,
  processing_job_id text references entity_processing_jobs(id) on delete set null,
  canonical_name text not null,
  entity_type text not null,
  aliases jsonb not null default '[]'::jsonb,
  roles jsonb not null default '[]'::jsonb,
  affiliations jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  facts_by_confidence jsonb not null default '{}'::jsonb,
  strongest_claim_ids jsonb not null default '[]'::jsonb,
  active_relationship_ids jsonb not null default '[]'::jsonb,
  timeline_event_ids jsonb not null default '[]'::jsonb,
  conflict_ids jsonb not null default '[]'::jsonb,
  overall_confidence double precision not null,
  confidence_band text not null,
  gaps jsonb not null default '[]'::jsonb
);

create table if not exists entity_summary_sentences (
  summary_id text not null references entity_summaries(id) on delete cascade,
  entity_id text not null references canonical_entities(id) on delete cascade,
  sentence_index integer not null,
  sentence_text text not null,
  sentence_type text not null,
  confidence double precision not null,
  backing_claim_ids jsonb not null default '[]'::jsonb,
  backing_event_ids jsonb not null default '[]'::jsonb,
  backing_relation_ids jsonb not null default '[]'::jsonb,
  primary key (summary_id, sentence_index)
);

create table if not exists entity_review_tasks (
  id text primary key,
  case_id text not null,
  review_type text not null,
  entity_id text references canonical_entities(id) on delete cascade,
  mention_id text references entity_mentions(id) on delete cascade,
  candidate_entity_ids jsonb not null default '[]'::jsonb,
  status text not null,
  reason text not null
);

create table if not exists entity_review_actions (
  id text primary key,
  case_id text not null,
  action text not null,
  actor text not null,
  entity_id text references canonical_entities(id) on delete set null,
  mention_id text references entity_mentions(id) on delete set null,
  note text,
  status text,
  attributes_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table if not exists entity_case_snapshots (
  case_id text primary key,
  generated_at timestamptz not null,
  processing_job_id text references entity_processing_jobs(id) on delete set null,
  snapshot_json jsonb not null,
  debug_reports_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_entity_documents_case_id on entity_documents (case_id);
create index if not exists idx_entity_mentions_normalized_text on entity_mentions (normalized_text);
create index if not exists idx_entity_mentions_label on entity_mentions (label);
create index if not exists idx_entity_mentions_document_id on entity_mentions (document_id);
create index if not exists idx_entity_mention_type_decisions_mention_id on entity_mention_type_decisions (mention_id);
create index if not exists idx_canonical_entities_normalized_name on canonical_entities (normalized_name);
create index if not exists idx_canonical_entities_case_entity_type on canonical_entities (case_id, entity_type);
create index if not exists idx_entity_resolution_decisions_entity_id on entity_resolution_decisions (entity_id);
create index if not exists idx_entity_resolution_decisions_case_id on entity_resolution_decisions (case_id);
create unique index if not exists idx_entity_resolution_decisions_current_mention
  on entity_resolution_decisions (mention_id) where is_current = true;
create index if not exists idx_entity_claims_subject on entity_claims (subject_entity_id);
create index if not exists idx_entity_claims_case_id on entity_claims (case_id);
create index if not exists idx_entity_relationships_endpoints on entity_relationships (source_entity_id, target_entity_id);
create index if not exists idx_entity_relationships_case_id on entity_relationships (case_id);
create index if not exists idx_entity_events_case_id on entity_events (case_id);
create index if not exists idx_entity_events_time_start on entity_events (time_start);
create index if not exists idx_entity_timeline_items_entity_id on entity_timeline_items (entity_id, time_start);
create index if not exists idx_entity_conflicts_entity_id on entity_conflicts (entity_id);
create unique index if not exists idx_entity_summaries_current_entity on entity_summaries (entity_id) where is_current = true;
create index if not exists idx_entity_summaries_case_id on entity_summaries (case_id);
create index if not exists idx_entity_review_tasks_status on entity_review_tasks (case_id, status);
create index if not exists idx_entity_review_actions_case_id on entity_review_actions (case_id, created_at);
