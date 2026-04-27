# Entity Intelligence Architecture

## Why This Layer Exists

Tevel already has grounded extraction, person/location resolution, temporal events, retrieval bundles, and evidence-backed summary panels. What is still missing is a case-level entity analysis layer that turns fragmented mentions into canonical entities with:

- explicit merge decisions
- claim and relationship attachment
- conflict tracking
- entity-centric timelines
- summary sentences backed by structured artifacts only

This layer sits above `SidecarExtractionPayload` and below the UI projections used by `analysisService.ts`.

## Scope

This phase implements a production-oriented minimum viable subsystem with:

- grounded document, chunk, and evidence projections
- mention normalization and structured mention records
- probabilistic reference links
- candidate generation against canonical case entities
- thresholded resolution decisions with explanations
- claim, relationship, and event attachment
- entity timelines
- contradiction and duplicate detection
- summary sentence generation from structured graph artifacts only
- in-memory case store plus Postgres-oriented SQL migration design
- JSON APIs and debug surfaces

It does **not** replace the existing smart extraction pipeline. It consumes it.

## Data Flow

1. `smartPipeline` or `pipeline` produces grounded mentions, relations, claims, and events.
2. `entityIntelligence` projects those artifacts into:
   - `DocumentRecord`
   - `DocumentVersionRecord`
   - `DocumentChunkRecord`
   - `EvidenceSpanRecord`
   - `EntityMentionRecord`
3. Mention normalization and reference chaining produce probabilistic `ReferenceLinkRecord`s.
4. Candidate generation scores each mention against current canonical entities.
5. Resolution engine decides:
   - attach to existing entity
   - create new entity
   - mark ambiguous
6. Claims, relationships, and events are aggregated onto canonical entities with supporting and contradictory evidence.
7. Conflict detection marks role/date/affiliation contradictions and risky duplicate merges.
8. Timeline builder produces entity-centric chronological event views.
9. Summary generator emits sentence-level provenance objects backed by claim/event/relation ids only.
10. `analysisService.ts` receives an additive `entity_intelligence` payload and optional UI-ready projections.

## Design Rules

- Never merge entities on exact-name match alone.
- Never emit unsupported summary sentences.
- Never convert allegations into facts.
- Never hide conflicts.
- Prefer `ambiguous` over false certainty.
- Keep evidence as `document_id + offsets + evidence_id`.

## Storage Strategy

- Runtime in this repo stays store-first with an in-memory case store and deterministic APIs.
- Postgres remains the intended source of truth; SQL migrations are added under `schemas/migrations/`.
- Neo4j is not required for truth storage. Graph projection remains optional.

## Modules

- `services/sidecar/entityIntelligence/types.ts`
- `services/sidecar/entityIntelligence/config.ts`
- `services/sidecar/entityIntelligence/grounding.ts`
- `services/sidecar/entityIntelligence/normalization.ts`
- `services/sidecar/entityIntelligence/referenceChaining.ts`
- `services/sidecar/entityIntelligence/candidateGeneration.ts`
- `services/sidecar/entityIntelligence/resolution.ts`
- `services/sidecar/entityIntelligence/claims.ts`
- `services/sidecar/entityIntelligence/events.ts`
- `services/sidecar/entityIntelligence/timeline.ts`
- `services/sidecar/entityIntelligence/conflicts.ts`
- `services/sidecar/entityIntelligence/summaries.ts`
- `services/sidecar/entityIntelligence/store.ts`
- `services/sidecar/entityIntelligence/jobs.ts`
- `services/sidecar/entityIntelligence/service.ts`

## Integration Points

- `services/analysisService.ts`
  - run entity intelligence after reference knowledge enrichment and before final context-card projection
- `vite.sidecar.ts`
  - add entity intelligence APIs
- `services/sidecarClient.ts`
  - add client helpers for those APIs
- `types.ts`
  - add additive `entity_intelligence` payload

## Threshold Policy

- hard trusted identifier match + no severe conflict: attach
- `top1 >= attach_threshold` and `(top1 - top2) >= margin_threshold`: attach
- `top1 <= new_entity_threshold`: create new entity
- otherwise: ambiguous

Default thresholds in this phase:

- `attach_threshold = 0.72`
- `margin_threshold = 0.12`
- `new_entity_threshold = 0.38`

## Confidence Bands

- `high`: `>= 0.8`
- `medium`: `>= 0.55`
- `low`: `< 0.55`
- `unresolved`: ambiguous or missing evidence coverage

## Known Pragmatic Limits In This Repo

- No live Redis job runner is present, so background jobs are modeled as idempotent synchronous jobs persisted in the in-memory case store.
- SQL migrations are provided, but the repo does not currently execute them automatically.
- Model-assisted mention extraction remains delegated to the existing smart sidecar pipeline; this subsystem focuses on canonical entity intelligence on top of those outputs.
