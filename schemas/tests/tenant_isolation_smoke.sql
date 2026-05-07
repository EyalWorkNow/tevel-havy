-- Tenant isolation smoke test for FCF-R3 RLS policies.
--
-- What this proves:
--   1. A row tagged tenant_id = 'tenant-alpha' is visible when the session
--      tenant is 'tenant-alpha' and invisible when it is 'tenant-bravo'.
--   2. A row with tenant_id IS NULL (legacy / shared) is visible to any tenant.
--
-- Prerequisites:
--   • Run 2026-05-05_fcf_r3_full_data_model.sql first (creates base tables).
--   • Run 2026-05-07_tenant_isolation.sql first (adds tenant_id + RLS).
--   • The role running this script must NOT be a superuser so RLS applies.
--
-- Run: psql -f schemas/tests/tenant_isolation_smoke.sql
-- Expected output: all "PASS" lines, no "FAIL" lines.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Seed two rows: one tagged alpha, one untagged (shared)
-- ─────────────────────────────────────────────────────────────────────────────
insert into fcf_r3_runs (
  run_id, case_id, generated_at,
  tenant_id,
  persistence_status, answer_status, route_mode, task_family,
  candidate_count, pruned_count, selected_count,
  context_chars, estimated_input_tokens,
  question, query_plan_json, audit_json,
  materialized_context, knowledge_snapshot, retrieval_artifacts_json,
  run_json
) values
  (
    'smoke-alpha-01', 'smoke-case', now(),
    'tenant-alpha',
    'pending', 'current-supported', 'full', 'qa',
    5, 0, 3, 1200, 400,
    'Alpha question', '{}'::jsonb, '{}'::jsonb,
    '', '', '{}'::jsonb, '{}'::jsonb
  ),
  (
    'smoke-shared-01', 'smoke-case', now() - interval '1 second',
    null,
    'pending', 'current-supported', 'full', 'qa',
    5, 0, 3, 1200, 400,
    'Shared question', '{}'::jsonb, '{}'::jsonb,
    '', '', '{}'::jsonb, '{}'::jsonb
  )
on conflict (run_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tenant-alpha session: should see both the alpha row and the shared row
-- ─────────────────────────────────────────────────────────────────────────────
select fcf_set_tenant('tenant-alpha');

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from fcf_r3_runs
   where run_id in ('smoke-alpha-01', 'smoke-shared-01');

  if v_count = 2 then
    raise notice 'PASS tenant-alpha sees own row + shared row (count=2)';
  else
    raise exception 'FAIL tenant-alpha expected 2 rows, got %', v_count;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tenant-bravo session: must NOT see alpha row, but MUST see shared row
-- ─────────────────────────────────────────────────────────────────────────────
select fcf_set_tenant('tenant-bravo');

do $$
declare
  v_alpha  int;
  v_shared int;
begin
  select count(*) into v_alpha
    from fcf_r3_runs where run_id = 'smoke-alpha-01';

  select count(*) into v_shared
    from fcf_r3_runs where run_id = 'smoke-shared-01';

  if v_alpha = 0 then
    raise notice 'PASS tenant-bravo cannot see tenant-alpha row';
  else
    raise exception 'FAIL tenant-bravo should not see alpha row, but count=%', v_alpha;
  end if;

  if v_shared = 1 then
    raise notice 'PASS tenant-bravo can see shared (tenant_id IS NULL) row';
  else
    raise exception 'FAIL tenant-bravo should see shared row, but count=%', v_shared;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. No-tenant session (GUC unset): shared rows visible, tagged rows blocked
--    current_setting('app.current_tenant', true) returns '' when unset,
--    so tenant_id = '' never matches any tagged row — only NULLs pass through.
-- ─────────────────────────────────────────────────────────────────────────────
select fcf_set_tenant('');

do $$
declare
  v_alpha  int;
  v_shared int;
begin
  select count(*) into v_alpha
    from fcf_r3_runs where run_id = 'smoke-alpha-01';

  select count(*) into v_shared
    from fcf_r3_runs where run_id = 'smoke-shared-01';

  if v_alpha = 0 then
    raise notice 'PASS unset-tenant cannot see tagged alpha row';
  else
    raise exception 'FAIL unset-tenant should not see tagged alpha row, count=%', v_alpha;
  end if;

  if v_shared = 1 then
    raise notice 'PASS unset-tenant can see shared (tenant_id IS NULL) row';
  else
    raise exception 'FAIL unset-tenant should see shared row, count=%', v_shared;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Clean up seed rows (idempotent teardown)
-- ─────────────────────────────────────────────────────────────────────────────

-- Switch back to admin/superuser context to bypass RLS for cleanup.
-- If running as a superuser this is a no-op; otherwise call reset_role first.
reset role;
select set_config('app.current_tenant', '', true);

delete from fcf_r3_runs where run_id in ('smoke-alpha-01', 'smoke-shared-01');

\echo 'Tenant isolation smoke test complete.'
