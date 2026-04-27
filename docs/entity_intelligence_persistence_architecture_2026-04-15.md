# Entity Intelligence Persistence Architecture

## Goal

Replace the in-memory `entityIntelligence` case store with durable Postgres-backed persistence while keeping the existing `EntityIntelligenceCaseResult` contract stable for current UI consumers.

## Storage model

- PostgreSQL is the source of truth for normalized entity intelligence records.
- `entity_case_snapshots` is a read-model cache used to rehydrate the full case contract without recomputing every artifact from relational tables on every request.
- `entity_resolution_decisions` and `entity_summaries` preserve history:
  - every run writes a new `processing_job_id`
  - new resolution decisions are inserted with `is_current = true`
  - previous decisions for the same mention are marked `is_current = false`
  - summaries are fingerprinted per entity; unchanged summaries reuse the same row, changed summaries create a new version and mark the previous summary as not current
- `entity_review_actions` is append-only audit history for merge/split/manual actions.

## Write flow

1. Build grounded entity intelligence artifacts from sidecar extraction.
2. Recompute derived state:
   - timelines
   - flattened timeline items
   - conflicts
   - entity profiles
   - current summary records
3. Validate integrity before persistence:
   - every claim has evidence
   - every summary sentence has backing claim/event/relation ids
   - every mention has a resolution decision
   - relation endpoints exist
   - event participants reference existing entity/event rows
4. Upsert normalized tables in dependency order.
5. Update `is_current` flags for resolution decisions and summaries.
6. Upsert the full case snapshot for low-latency rehydration.

## Read flow

- `getCase(caseId)` uses `entity_case_snapshots`.
- entity-scoped read models use normalized tables:
  - mentions
  - claims
  - relations
  - timelines
  - conflicts
  - summaries
  - ambiguous mentions
  - case entity graph

## Idempotency rules

- Document versions use a stable hash over normalized text, not wall-clock time.
- Candidate matches, aliases, claim evidence, and event participants upsert on natural keys.
- Re-running the same case payload does not duplicate mentions, claims, relations, events, or current summaries.
- Processing jobs and review actions remain append-only for auditability.

## Runtime behavior

- The live repository defaults to Postgres via Supabase.
- Tests swap the repository to an in-memory implementation so regression coverage remains deterministic and network-independent.
- Output contracts remain additive and backward-compatible for current frontend consumers.
