-- FCF-R3 Tenant Isolation — adds tenant_id to all query-facing tables,
-- enforces Row Level Security, and provides a helper for setting the
-- active tenant context in a session.
--
-- Prerequisites:
--   • The tables fcf_documents, fcf_r3_runs (or equivalent) already exist.
--   • The application connects as a role that is NOT a superuser so RLS applies.
-- Run with: psql -f 2026-05-07_tenant_isolation.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add tenant_id to fcf_r3_runs (the primary per-query answer table)
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists fcf_r3_runs
  add column if not exists tenant_id text;

create index if not exists idx_fcf_r3_runs_tenant
  on fcf_r3_runs (tenant_id, generated_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add tenant_id to atom-level tables so atoms can be scoped per tenant
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists fcf_atom_embeddings
  add column if not exists tenant_id text;

create index if not exists idx_fcf_atom_embeddings_tenant
  on fcf_atom_embeddings (tenant_id, atom_id);

alter table if exists fcf_atom_entities
  add column if not exists tenant_id text;

create index if not exists idx_fcf_atom_entities_tenant
  on fcf_atom_entities (tenant_id, entity);

alter table if exists fcf_atom_time_anchors
  add column if not exists tenant_id text;

create index if not exists idx_fcf_atom_time_anchors_tenant
  on fcf_atom_time_anchors (tenant_id, date_value);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper: set the active tenant for the current session
--    Usage: select fcf_set_tenant('tenant-alpha');
--    The GUC key used here ('app.current_tenant') must match what the
--    application sets before running queries.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function fcf_set_tenant(p_tenant_id text)
returns void
language plpgsql
security definer
as $$
begin
  perform set_config('app.current_tenant', p_tenant_id, true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Row Level Security — fcf_documents
--    Policy: a row is visible when:
--      • tenant_id is NULL  (shared / public record — legacy compat)
--      • tenant_id matches the current session tenant
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists fcf_documents
  enable row level security;

-- Drop and recreate so this script is idempotent.
drop policy if exists fcf_documents_tenant_isolation on fcf_documents;
create policy fcf_documents_tenant_isolation
  on fcf_documents
  as restrictive
  for all
  using (
    tenant_id is null
    or tenant_id = current_setting('app.current_tenant', true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security — fcf_r3_runs
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists fcf_r3_runs
  enable row level security;

drop policy if exists fcf_r3_runs_tenant_isolation on fcf_r3_runs;
create policy fcf_r3_runs_tenant_isolation
  on fcf_r3_runs
  as restrictive
  for all
  using (
    tenant_id is null
    or tenant_id = current_setting('app.current_tenant', true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Row Level Security — atom tables
--    All atoms inherit their tenant from the owning document.
--    The RLS policy allows any atom without a tenant tag (legacy) to be visible.
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists fcf_atom_embeddings
  enable row level security;

drop policy if exists fcf_atom_embeddings_tenant_isolation on fcf_atom_embeddings;
create policy fcf_atom_embeddings_tenant_isolation
  on fcf_atom_embeddings
  as restrictive
  for all
  using (
    tenant_id is null
    or tenant_id = current_setting('app.current_tenant', true)
  );

alter table if exists fcf_atom_entities
  enable row level security;

drop policy if exists fcf_atom_entities_tenant_isolation on fcf_atom_entities;
create policy fcf_atom_entities_tenant_isolation
  on fcf_atom_entities
  as restrictive
  for all
  using (
    tenant_id is null
    or tenant_id = current_setting('app.current_tenant', true)
  );

alter table if exists fcf_atom_time_anchors
  enable row level security;

drop policy if exists fcf_atom_time_anchors_tenant_isolation on fcf_atom_time_anchors;
create policy fcf_atom_time_anchors_tenant_isolation
  on fcf_atom_time_anchors
  as restrictive
  for all
  using (
    tenant_id is null
    or tenant_id = current_setting('app.current_tenant', true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Bypass policy for superusers / admin role
--    Superusers bypass RLS by default; add an explicit bypass for a named
--    admin role so service accounts can still do cross-tenant maintenance.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'fcf_admin') then
    alter table fcf_documents    force row level security;
    alter table fcf_r3_runs      force row level security;
    execute 'grant select, insert, update, delete on fcf_documents, fcf_r3_runs, '
         || 'fcf_atom_embeddings, fcf_atom_entities, fcf_atom_time_anchors '
         || 'to fcf_admin';
  end if;
end;
$$;
