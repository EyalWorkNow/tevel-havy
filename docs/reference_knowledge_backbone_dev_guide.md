# Reference Knowledge Backbone: Developer Guide

## What shipped
Tevel now has a dedicated open-source reference knowledge lane that sits beside case evidence instead of mixing into it.

New top-level payload fields on `IntelligencePackage`:

- `canonical_entities`
- `reference_knowledge`
- `watchlist_hits`
- `knowledge_sources`
- `reference_warnings`

Additive entity/context-card fields:

- `Entity.ftm_schema`
- `Entity.ftm_id`
- `Entity.external_refs`
- `Entity.reference_confidence`
- `Entity.watchlist_status`
- `ContextCard.referenceProfile`

## Sidecar APIs

- `POST /api/knowledge/enrich`
- `GET /api/entities/:id/reference`
- `GET /api/cases/:id/knowledge`

## Runtime behavior

1. Tevel resolves case entities as before.
2. The frontend asks the sidecar to enrich those entities with external reference knowledge.
3. The sidecar projects entities into canonical FtM-style records.
4. Wikidata / OpenAlex / yente adapters enrich the canonical entity.
5. Retrieval may use that knowledge as expansion context only.
6. Summary panels expose that extra material via `reference_context`.
7. The UI renders it in a dedicated `Reference Knowledge` surface.

## Important safety rule

External assertions must never become primary case evidence.

That means:

- no reference-only timeline rows
- no reference-only citations in `cited_evidence_ids`
- no silent blending into case findings

## Config

Optional environment variables:

- `TEVEL_YENTE_API_BASE`
- `TEVEL_GRAPHITI_SINK_ENABLED`
- `TEVEL_GRAPHITI_SINK_URL`
- `TEVEL_REFERENCE_STORE_MODE`
- `TEVEL_REFERENCE_CASE_TABLE`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If these are not set, Tevel falls back safely:

- watchlist lookups are skipped
- Graphiti sink is skipped
- reference knowledge stays in memory for local development

## Migration notes

### Backend
- Existing extraction payloads stay valid.
- `SidecarEntityRecord` now optionally accepts:
  - `canonical_ftm_id`
  - `canonical_ftm_schema`
  - `external_reference_ids`

### Frontend
- Existing components remain compatible because all new fields are optional.
- `AnalysisDashboard` now expects optional `reference_knowledge` and `watchlist_hits` but still renders older payloads without them.

### Retrieval / summarization
- Retrieval bundles can now contain `reference_only` hits.
- Summary panels can now expose `reference_context`.
- Existing consumers of `summary_text`, `key_findings`, and `cited_evidence_ids` remain valid.

## Recommended next step

If operator-owned knowledge sources become available, point `TEVEL_YENTE_API_BASE` and the optional Graphiti sink at those services first. The UI and payload contracts are already ready for them.

