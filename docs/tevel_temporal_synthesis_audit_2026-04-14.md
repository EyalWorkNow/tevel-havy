# Tevel Temporal + Evidence-Backed Synthesis Audit

Date: 2026-04-14

## Scope audited

- sidecar extraction payloads
- timeline construction
- temporal parsing / normalization
- evidence preservation
- retrieval and reranking
- summarization and synthesis
- graph / relationship persistence
- frontend rendering contracts

## Current pipeline map

### 1. Ingestion and normalization

- `components/IngestionPanel.tsx`
  - browser intake and sidecar handoff
- `vite.sidecar.ts`
  - local sidecar boundary
- `services/sidecar/parsers.ts`
  - raw text / HTML / file parsing
- `services/sidecar/ingest.ts`
  - normalization and offset maps
- `services/sidecar/textUnits.ts`
  - deterministic text-unit generation with dual offsets

### 2. Structured extraction

- `services/sidecar/smartPipeline.ts`
  - prepares ingested docs and builds extraction payloads
- `services/sidecar/smartExtraction.ts`
  - converts Python helper output into mentions / entities / relations / events / claims
- `scripts/sidecar_m2_helper.py`
  - current event extraction is sentence-cue based
  - emits `events` with trigger, actor spans, target spans, and location spans

### 3. Browser orchestration

- `services/analysisService.ts`
  - projects sidecar payloads into `IntelligencePackage`
  - currently maps `event_candidates` into legacy `TimelineEvent[]`
  - later enriches entities, timeline, statements, insights, tasks, and summaries

### 4. Retrieval and synthesis

- `services/sidecar/retrieval.ts`
  - lexical retrieval only
- `services/geminiService.ts`
  - runtime retrieval/reranking/synthesis layer
  - mixes retrieval, summarization, cross-study reasoning, and answer generation

### 5. Frontend contracts

- `types.ts`
  - main UI contract is still `IntelligencePackage`
- `components/AnalysisDashboard.tsx`
  - renders timeline, context cards, graph, workbench, Synapse, and evidence surfaces

## What works today

- Evidence spans already exist in the sidecar payload.
- `event_candidates` already exist and carry evidence, confidence, and extraction source.
- The UI already has timeline, insights, context cards, and cross-study panels that can render richer structured outputs.
- Backward-compatible `IntelligencePackage` gives us a migration envelope.

## Current weaknesses

### Timeline construction is still not event-native enough

- `services/analysisService.ts` maps sidecar events directly into flat `TimelineEvent` strings.
- `buildTimeline()` then falls back to scanning raw sentences for dates and synthesizing pseudo-events from relation strings.
- Result:
  - event arguments are lost
  - event uncertainty is lost
  - temporal precision is flattened
  - timeline is effectively date-led, not event-led

### Temporal normalization is weak

- Dates are extracted by heuristic detection in browser code.
- No first-class temporal artifact exists for:
  - exact vs approximate
  - explicit vs inferred
  - normalized start/end
  - temporal relation types (`before`, `after`, `overlap`, `ongoing`)
  - conflicting temporal evidence

### Summaries are not evidence-pack-driven by design

- `buildSummary()` in `analysisService.ts` concatenates top entities, top relations, and earliest timeline item.
- `geminiService.ts` does retrieval-aware synthesis, but the output contract is still mostly plain text and not guaranteed to include explicit cited evidence IDs.
- No stable summary panel artifact exists for:
  - case brief
  - entity brief
  - relationship brief
  - timeline summary
  - contradiction summary
  - update since last review

### Contradictions are not preserved strongly enough

- Sidecar evidence types already allow `corroborates` / `contradicts`.
- The current pipeline barely projects contradiction state into UI-facing artifacts.
- Timeline and summaries do not preserve conflicting dates as first-class outputs.

### Retrieval is not yet suited for context-aware synthesis

- `services/sidecar/retrieval.ts` is lexical-only.
- `geminiService.ts` has runtime reranking logic, but it is not a durable retrieval layer and not organized as evidence-pack retrieval for case/timeline synthesis.

### UI JSON is hard to extend cleanly

- `IntelligencePackage.timeline` is simple and renderable, but too lossy.
- Richer event/temporal artifacts need to be additive, not destructive, so the UI can evolve without breaking current tabs.

## Concrete failure points in current code

### `services/analysisService.ts`

- `eventToTimeline()` converts event candidates into plain `{ date, event }`
- `buildTimeline()` reconstructs a timeline from `detectDates(sentence)` and relation snippets
- `buildSummary()` is not grounded in explicit evidence bundles

### `scripts/sidecar_m2_helper.py`

- Events are cue-based and useful as scaffolding, but no temporal-normalization pass follows them
- Event outputs do not yet become durable event records with normalized temporal fields

### `services/geminiService.ts`

- Retrieval and synthesis are entangled
- No stable evidence-pack contract before summary generation
- Cross-study reasoning is useful but not yet shaped into typed, UI-friendly, citation-first outputs

## Existing contracts that should be preserved carefully

- `types.ts -> IntelligencePackage`
- `types.ts -> TimelineEvent`
- `ContextCard`
- `Statement`
- `IntelQuestion`
- `IntelTask`
- graph and dashboard rendering surfaces in `AnalysisDashboard.tsx`

## Recommended migration path for this request

### Phase 1

- Add additive temporal/event/synthesis contracts
- Project sidecar events into rich event records while preserving legacy `TimelineEvent[]`

### Phase 2

- Add temporal normalization layer
- Add contradiction-aware event ordering
- Build summary panels from evidence bundles, not ad hoc strings

### Phase 3

- Add hybrid retrieval + reranker interfaces
- Route timeline summary / case brief / update summary through evidence-pack builder

### Phase 4

- Add evaluation fixtures for explicit dates, relative dates, fuzzy dates, conflicting dates, multi-doc cases, OCR noise, and long-context cases

## Exact files most relevant to change

- `types.ts`
- `services/analysisService.ts`
- `services/sidecar/types.ts`
- `services/sidecar/smartExtraction.ts`
- `services/sidecar/smartPipeline.ts`
- `services/sidecar/retrieval.ts`
- `services/geminiService.ts`
- `scripts/sidecar_m2_helper.py`
- `components/AnalysisDashboard.tsx`
- `scripts/benchmark-sidecar.ts`

## New files recommended

- `services/sidecar/temporal/contracts.ts`
- `services/sidecar/temporal/projector.ts`
- `services/sidecar/summarization/contracts.ts`
- `services/sidecar/summarization/evidencePack.ts`
- `tests/sidecar/temporalProjection.test.ts`
- `tests/sidecar/summarizationPanels.test.ts`
- `docs/temporal_synthesis_migration_notes.md`
