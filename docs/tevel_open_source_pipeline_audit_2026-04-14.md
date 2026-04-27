# Tevel Open-Source Pipeline Repo Audit

Date: 2026-04-14

## Scope audited

- Ingestion and parsing
- Chunking / text-unit generation
- Extraction and linking
- Person and location resolution
- Retrieval and ranking
- Graph construction
- Summarization / synthesis
- Storage and API boundaries
- Frontend contracts

## Current pipeline map

### 1. Browser intake

- `components/IngestionPanel.tsx`
  - Collects analyst text, links, and uploaded files.
  - Calls `parseUploadedFileWithSidecar()` when local sidecar is available.
  - Maintains a preview text area for analyst-visible content and a hidden full analysis payload.
- `App.tsx`
  - Calls `analyzeDocument()` directly in the browser process.
  - Persists resulting `StudyItem` objects through `StudyService`.

### 2. Sidecar entrypoints

- `vite.sidecar.ts`
  - Vite middleware currently acts as the backend/sidecar boundary.
  - Exposes parse, smart-extract, geocode, and person endpoints.
  - Stores person/location outputs in process-memory stores.

### 3. Parsing and document normalization

- `services/sidecar/parsers.ts`
  - Supports:
    - raw text passthrough
    - HTML parsing via `trafilatura`
    - file parsing via `pypdf` and `docling`
  - Produces `SourceDocumentInput`.
- `services/sidecar/ingest.ts`
  - Builds normalized content and offset maps.
- `services/sidecar/textUnits.ts`
  - Creates deterministic text units with raw/normalized offsets.

### 4. Extraction

- `services/sidecar/pipeline.ts`
  - Milestone 1 rule-only pipeline.
- `services/sidecar/smartPipeline.ts`
  - Milestone 2 hybrid pipeline:
    - rule mentions
    - Python smart extractor proposals
    - relation/event/claim scaffolding
- `services/sidecar/smartExtraction.ts`
  - Converts normalized proposals into evidence-bearing mentions and structured candidates.
- `scripts/sidecar_m2_helper.py`
  - Current Python extraction helper.
  - Already includes partial adapters for:
    - spaCy
    - GLiNER
    - fastcoref
    - ReLiK TODO marker
    - Outlines TODO marker

### 5. Entity understanding and resolution

- `services/intelligence/entityCreation.ts`
  - Browser-side heuristic entity grouping and refinement.
  - Uses heuristic matching plus optional structured generator callback.
- `services/sidecar/person/resolver.ts`
  - Person-only mention clustering and dossier building.
  - Current merge logic is mostly alias similarity + surname + org compatibility.
- `identity-resolution/*`
  - Analyst UI for person identity review exists.
  - Mostly fed from current `StudyItem` outputs, not from a persistent canonical backend graph.

### 6. Retrieval

- `services/sidecar/retrieval.ts`
  - Lexical inverted index over text units, mentions, and entities.
- `services/geminiService.ts`
  - Builds a runtime reasoning index over chunks, entities, communities, and relations.
  - Uses local LLM/Ollama-oriented reasoning and ad hoc retrieval.
  - Retrieval is not yet durable, vector-backed, or case-persistent.

### 7. Graph and synthesis

- `services/analysisService.ts`
  - Main browser orchestration.
  - Merges sidecar payloads into `IntelligencePackage`.
  - Builds context cards, derived statements, timeline, insights, and graph.
- `services/geminiService.ts`
  - Secondary synthesis / briefing / Q&A / cross-reference layer.
  - Still mixes runtime retrieval, local model prompting, and summary generation in one large service.
- `components/AnalysisDashboard.tsx`
  - Consumes `IntelligencePackage`, `context_cards`, `graph`, timeline, questions/tasks, and dossiers.

### 8. Persistence

- `services/studyService.ts`
  - Stores `StudyItem` blobs in Supabase when available and in local cache otherwise.
  - Best-effort normalized writes for `entities` and `relations`, but no durable canonical graph layer.
- `services/supabaseClient.ts`
  - Postgres/Supabase connection only.

## Current strengths

- Deterministic text-unit generation with raw/normalized span fidelity already exists.
- Evidence spans are first-class in the sidecar payload.
- Hybrid extraction entrypoint already exists and is wired into the UI path.
- Person and location sidecars already exist as separate subsystems.
- The frontend already has clear investigative rendering surfaces:
  - context cards
  - graph
  - timeline
  - evidence highlights
  - person dossiers
  - map
- Benchmark and regression infrastructure already exists.

## Current weaknesses by layer

### Ingestion / parsing weaknesses

- No canonical block-level document model beyond text units.
- Parsed documents lose layout semantics needed for:
  - tables
  - lists
  - headers
  - section hierarchy
  - reading-order explanations
- Page/block provenance is optional and weak.
- Parser output is normalized into plain text too early for richer extraction.
- There is no parser confidence or OCR-quality flag in the main UI contract.

### Extraction weaknesses

- The current extraction contract is solid, but the actual extraction stack is still shallow:
  - heavy use of rule patterns
  - GLiNER integrated only partially via helper
  - relation/event extraction mostly scaffolded from local sentence cues
- Claims, contradictions, and event validity are not modeled deeply enough.
- The Python helper mixes production logic, optional adapters, and TODO placeholders in one file.

### Entity understanding / identity resolution weaknesses

- Canonical resolution is fragmented:
  - heuristic entity grouping in `entityCreation.ts`
  - person-only clustering in `person/resolver.ts`
  - no shared cross-type resolution layer
- No durable alias table.
- No merge rationale artifact persisted for the UI.
- No strong cross-document deduplication engine yet.
- KB linking is absent.

### Graph weaknesses

- The graph is currently UI-oriented, not storage-oriented.
- `Relation.source` and `Relation.target` are often names, not stable canonical IDs.
- Graph nodes are keyed by display names.
- This causes:
  - brittle linking
  - self-link artifacts
  - weak graph traversal semantics
- No temporal validity window on edges.
- Contradictions are not modeled as first-class graph artifacts.

### Retrieval weaknesses

- Sidecar retrieval is lexical only.
- `geminiService.ts` builds a runtime reasoning index, but it is:
  - ephemeral
  - in-process
  - not case-persistent
  - not vector-backed
- No true hybrid lexical + vector + graph retrieval pipeline.
- No reranker stage in the persistent path.

### Summarization weaknesses

- Summaries are built from mixed sources:
  - deterministic browser heuristics
  - sidecar payloads
  - local model prompts in `geminiService.ts`
- No strict evidence-pack contract before summary generation.
- No dedicated multi-document summarization module.
- No contradiction summary artifact.
- No per-summary citation coverage score.

### Storage / schema weaknesses

- `StudyItem.intelligence` is still the dominant storage shape.
- Separate persistent artifacts for mentions, entities, claims, relations, events, and summaries do not exist yet.
- No canonical case memory schema.
- No graph-friendly relational schema beyond best-effort `entities` / `relations` writes.
- Type inconsistencies exist:
  - UI `EntityType` includes `ORG`
  - actual pipelines emit `ORGANIZATION`
  - `RelationshipType` enum and emitted relation labels are inconsistent

### UI contract weaknesses

- `IntelligencePackage` is renderable, but mixes:
  - source facts
  - derived facts
  - summaries
  - graph view models
  - temporary runtime enrichments
- `context_cards` are keyed by entity name, not canonical ID.
- Evidence rendering is possible, but not consistently enforced at all summary surfaces.
- Cross-document linking is mostly inferred in the client by string matching.

## Specific failure modes observed in current code

### Duplicate entities

- Entity identity is often name-based instead of canonical-ID-based.
- Merge behavior is distributed across:
  - `entityCreation.ts`
  - `analysisService.ts`
  - sidecar person resolver
- Cross-document duplicate collapse is weak and not explainable.

### Missing cross-document links

- Cross-study links are currently driven largely by `isEntityMatch()` string heuristics.
- No vector/entity/graph-aware case memory exists.
- Links are not stored as reusable canonical graph edges.

### Weak summaries

- Summaries are not always generated from curated evidence packs.
- Multi-document summaries are not a first-class pipeline stage.
- Summary generation and retrieval are still overly entangled in `geminiService.ts`.

### Source attribution gaps

- The sidecar payload has evidence spans, but many derived UI artifacts do not preserve them explicitly enough.
- Context cards are evidence-first in some places, but not consistently represented as structured citation bundles.

### Lack of temporal modeling

- Dates are extracted, but temporal expressions are not unified into event validity.
- There is no stable event/time model with start/end/precision/status.
- Graph edges do not carry validity windows.

### Contradiction handling gaps

- Contradiction fields exist in evidence and candidate structures, but the pipeline barely populates them.
- No contradiction queue or contradiction summary artifact exists.

## UI contracts that must remain stable or be migrated carefully

Primary render contracts in use today:

- `types.ts`
  - `IntelligencePackage`
  - `Entity`
  - `Relation`
  - `ContextCard`
  - `TimelineEvent`
  - `GraphData`
- `components/AnalysisDashboard.tsx`
  - expects entity-centric cards, graph, timeline, statements, tasks/questions
- `components/FeedDashboard.tsx`
  - expects cross-study linking from `StudyItem.intelligence.entities`
- `components/MapView.tsx`
  - expects location entities plus backend resolution artifacts
- `identity-resolution/*`
  - expects person-centric canonical records, candidate explanations, unresolved queues

Conclusion:
the next architecture must preserve `IntelligencePackage` as a compatibility surface during migration, while introducing stronger internal canonical artifacts underneath it.

## Audit conclusion

Tevel already has useful groundwork:

- deterministic provenance-aware ingestion
- structured extraction payloads
- sidecar boundaries
- early person/location resolution
- UI components for investigative rendering

But it is not yet a production-grade intelligence pipeline because:

- extraction, resolution, retrieval, graph, and summarization are still too fragmented
- canonical persistence is missing
- retrieval is shallow
- cross-document linking is heuristic
- summary generation is not yet evidence-pack-driven by design

The correct next move is not another heuristic patch.
It is a layered internal pipeline with:

- canonical document artifacts
- explicit extracted artifacts
- durable entity resolution outputs
- typed graph edges with provenance
- hybrid retrieval
- evidence-packed summarization

That architecture can be added incrementally without breaking the current UI contract.
