# Tevel Extraction / Analysis Architecture Report

## Current Pipeline Summary

The current extraction engine runs almost entirely inside the browser bundle.

- `App.tsx:218-277` calls `analyzeDocument(text)` directly from the UI thread when a user submits material.
- `services/intelligenceService.ts:2163-2367` performs the full ingest pipeline in-process: normalize text, split into overlapping chunks, run chunk extraction with the chat model, merge results, run entity refinement, run strategic synthesis, and return the final `IntelligencePackage`.
- `services/intelligence/entityCreation.ts:131-250` adds another structured LLM pass over grouped entity candidates for canonicalization and salience assignment.
- `services/intelligenceService.ts:1267-1845` also builds the runtime retrieval index in memory and does embedding + LLM reranking at query time.
- `services/studyService.ts:60-79` persists the result primarily as a JSON blob in `studies`, with best-effort entity/relation upserts in parallel.
- `types.ts:50-205` shows the current application payload shape. It keeps `Entity.evidence` as raw strings and `Entity.source_chunks` as chunk numbers, but does not preserve exact char offsets, text-unit ids, or durable evidence ids.

In practice, the current pipeline is:

1. Browser ingestion
2. Browser chunking
3. LLM extraction per chunk
4. LLM entity refinement across batches
5. LLM strategic synthesis
6. Browser persistence
7. Query-time browser retrieval, embeddings, and LLM reranking

That shape is serviceable for a PoC, but it is not production-practical for large hybrid corpora or exact evidence work.

## Proposed Local Sidecar Architecture

The new architecture should introduce a local sidecar service that owns deterministic ingestion, extraction, indexing preparation, and provenance capture. The browser app should become a client of that sidecar, not the runtime home of the extraction stack.

### High-Level Shape

- App: intake UI, analyst workflows, dashboards, chat surfaces, saved-study browsing
- Local sidecar: parsing, normalization, text-unit generation, candidate extraction, mention stitching, indexing prep, evidence pack construction
- Postgres: canonical source of truth for documents, text units, mentions, entity tables, relation tables, and sidecar run metadata
- Small local LLM layer: fusion, contradiction synthesis, lead generation, analyst Q&A from structured evidence packs only

### Component Boundaries

#### What remains in the app

- Auth, session state, dashboards, case navigation, and analyst interactions from `App.tsx` and `components/*`
- Study list and review experience currently backed by `StudyService`
- Final visualization objects such as graph rendering, timeline rendering, and context-card display
- Small LLM prompts for analyst-facing reasoning once evidence packs already exist

#### What moves to the sidecar

- All document parsing and normalization now implied by `IngestionPanel` uploads and link capture
- Chunking and overlap logic currently in `services/intelligenceService.ts:344-442`
- Fast extraction now split between `services/intelligenceService.ts:2170-2204` and `services/intelligence/entityCreation.ts:74-128`
- Entity grouping / mention normalization / alias mapping now handled in `services/intelligence/entityCreation.ts:145-250`
- Query-time retrieval preparation now built in `services/intelligenceService.ts:1267-1845`
- Exact evidence span attachment, which does not exist today

#### What is removed or deprecated

- Browser-resident chunk extraction in `services/intelligenceService.ts:2176-2204`
- Browser-resident LLM entity refinement loops in `services/intelligence/entityCreation.ts:155-229`
- Regex-window evidence reconstruction via `KnowledgeFusionEngine.extractRelevantPassages` in `services/intelligenceService.ts:991-1020`
- Query-time LLM reranking as a default path in `services/intelligenceService.ts:1716-1825`
- JSON-only provenance storage in `types.ts:50-69` and `services/studyService.ts:262-299`

## Ingestion Flow

1. App submits raw source material to the sidecar instead of sending only `text` into `analyzeDocument`.
2. Sidecar parses source types into a canonical document text plus parser metadata.
3. Sidecar generates stable text units with exact `start` / `end` char offsets against the canonical text.
4. Sidecar stores:
   - source document record
   - parser metadata
   - canonical text
   - text units
   - extraction run metadata
5. App receives a lightweight job/result object and continues polling or awaits the response directly for Milestone 1.

For this repo, the safest integration seam is to replace the single `analyzeDocument(text)` call in `App.tsx:218-223` with a sidecar client call that can still return the current `IntelligencePackage` shape plus a new provenance payload id.

## Extraction Flow

1. Deterministic text-unit generator emits paragraph/sentence-like units with stable ids and offsets.
2. Fast extractor runs first:
   - regex / identifier patterns
   - gazetteer and matcher rules
   - lightweight mention normalization
3. Lightweight model extractor runs second:
   - multilingual entity span proposals
   - relation candidates where practical
4. Mention stitcher/coref runs only after exact mention spans already exist.
5. Small LLM layer is explicitly not used for first-pass indexing.

The critical design change is that the unit of truth becomes the mention span, not the chunk summary.

## Indexing Flow

Milestone target:

- Postgres remains canonical
- Sidecar writes normalized tables
- Secondary indexes stay optional until proven necessary

Recommended canonical tables:

- `source_documents`
- `source_document_versions`
- `text_units`
- `mention_spans`
- `entity_records`
- `entity_mentions`
- `relation_candidates`
- `claim_candidates`
- `analysis_runs`

Secondary index outputs, built by the sidecar but not canonical:

- lexical index artifacts
- dense vectors
- graph-community summaries

## Evidence Flow

Every mention, relation candidate, and claim-like object should carry:

- `source_doc_id`
- `source_text_unit_id`
- `start`
- `end`
- `raw_supporting_snippet`
- `normalized_text`
- `extraction_source`
- `confidence`
- `timestamp` when derivable
- `corroborates` / `contradicts` refs when available

Today the repo only keeps evidence as free-text strings on entities and a loose `statement_id` on relations (`types.ts:50-69`). The sidecar should make evidence records first-class, then let the app render summaries from those evidence records.

## Retrieval Flow

Retrieval should become a sidecar responsibility in two stages:

### Stage 1

- exact lexical search over text units and mention spans
- entity-aware backfill from mention tables
- simple relation / co-mention lookups

### Stage 2

- optional dense retrieval over text units and entity evidence
- optional reranking only after deterministic shortlist creation
- graph-aware evidence pack assembly

This is a better fit for Tevel than the current runtime rebuild approach in `services/intelligenceService.ts:1267-1845`, which reconstructs evidence structures in memory from a flattened application payload.

## Reasoning Flow

The smaller LLM layer should operate only on:

- retrieved evidence packs
- merged timelines
- contradiction / corroboration candidates
- entity and relation summaries already grounded by span-level evidence

It should be used for:

- executive/fusion summaries
- contradiction and subtext synthesis
- lead generation
- analyst Q&A

It should not be used for:

- first-pass entity extraction
- primary relation extraction
- evidence span generation
- broad index construction

## What Remains in the App

- `components/IngestionPanel.tsx` remains the analyst-facing intake surface
- `AnalysisDashboard` remains the investigative workspace
- `StudyService` remains the short-term compatibility layer for reading/writing studies
- Graph and timeline visualization remain in the client

## What Moves to the Sidecar

- current chunking engine
- current entity extraction and refinement path
- current retrieval index construction
- future document parsers for files and links
- future lexical/vector index creation

## What Is Removed or Deprecated

- LLM-per-chunk primary extraction
- LLM alias clustering as the main normalization step
- regex-based evidence window reconstruction
- client-only normalized persistence that drops provenance

## Recommended Integration Path For This Repo

Because this repo is a Vite/React frontend with no true backend service layer, the practical path is:

1. Introduce sidecar contracts and deterministic extraction scaffolding in-repo first.
2. Add a local sidecar HTTP process next, keeping `StudyService` and the UI intact.
3. Move `analyzeDocument` from “full pipeline” to “fallback adapter”.
4. Keep the current `IntelligencePackage` return shape until the UI is ready to consume richer provenance objects.
