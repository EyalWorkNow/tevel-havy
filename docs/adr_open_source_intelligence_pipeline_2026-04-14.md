# ADR: Open-Source Intelligence Pipeline Upgrade for Tevel

Date: 2026-04-14
Status: Proposed

## Decision summary

Tevel will migrate from a mixed browser-heavy + sidecar-assisted intelligence flow to a production-grade open-source pipeline built around explicit artifacts:

1. canonical document model
2. evidence-bearing extraction model
3. canonical entity resolution layer
4. temporal relationship graph
5. hybrid retrieval layer
6. evidence-packed summarization layer

The migration will preserve the current `IntelligencePackage` UI contract as a compatibility envelope while new internal schemas become the source of truth.

## Why this ADR exists

The current repo can already:

- parse and normalize documents
- generate deterministic text units
- extract evidence-bearing mentions
- produce UI-ready entities/relations/timeline cards

But it cannot yet do the product-critical things reliably enough:

- resolve duplicate identities across noisy documents
- persist relationship memory across a case
- retrieve semantically related evidence beyond lexical overlap
- generate defensible multi-document summaries grounded in explicit evidence packs

## Architecture weaknesses being addressed

- name-based linking instead of canonical-ID-based linking
- shallow cross-document linking
- ephemeral retrieval state
- fragmented resolution logic
- graph built for rendering instead of investigation memory
- summary generation not strictly downstream of evidence packs
- incomplete contradiction and temporal modeling

## Selected tool strategy

### Chosen for the target implementation path

#### Document parsing

- Primary: `Docling`
  - Reason:
    - already partially integrated
    - good fit for messy PDFs/DOCX/PPTX/XLSX/HTML
    - MIT-licensed in the official repo
  - Source:
    - official GitHub repo states MIT license and document-processing scope【turn7search8†L1-L8】

- Secondary fallback:
  - `Apache Tika` adapter for hard parser edge cases
  - `Unstructured` only as optional parser fallback if Docling coverage is insufficient

Decision:
Docling remains primary because it aligns with the current Python sidecar and avoids introducing JVM-first complexity into the initial migration.

#### Entity / relation extraction

- Primary: `GLiNER2`
  - Reason:
    - already partially wired in
    - strong fit for zero-shot typed extraction in investigative domains
    - open-source, embeddable, local inference
- Deterministic support:
  - existing spaCy/rule/gazetteer path stays for high-precision identifiers and domain patterns

Decision:
move from “GLiNER as optional helper” to “GLiNER2-backed extraction as a first-class extractor adapter with deterministic companion rules.”

#### Entity linking / resolution

- Internal entity resolution:
  - `Splink`
  - fallback/benchmark comparator: `dedupe`
- External KB linking:
  - `REL`
  - optional adapter only for public-entity linking, not as the main internal resolution layer

Reason:

- Tevel’s primary need is cross-document identity resolution inside noisy case data, not only Wikipedia-style disambiguation.
- Splink is a better first fit for explainable probabilistic merging inside the case.
- REL is useful as an optional KB linker for public identities and enrichment.
- BELA is not selected for the first implementation increment because the repo needs stable internal resolution before external linking breadth.

License note:

- REL’s GitHub repository currently states MIT license【turn5view0†L467-L470】

#### Retrieval

- Primary vector store: `pgvector`
- Primary embeddings: `BGE-M3`
- Primary reranker: `BGE reranker v2 m3`
- Lexical retrieval:
  - retain current lexical inverted index as fallback and cheap baseline

Reason:

- Postgres/Supabase is already the persistence anchor in this repo.
- `pgvector` keeps transactional and analytical memory in one stack.
- BGE-M3 supports multilingual and multi-function retrieval better than the current lexical-only path.

#### Graph / knowledge layer

- Near-term storage: Postgres relational artifacts + graph-ready edge tables
- Graph extension path: `Apache AGE`
- Higher-level temporal graph orchestration:
  - Graphiti concepts adopted in schema design
  - Graphiti direct integration deferred behind an adapter boundary
- GraphRAG:
  - reserved for offline dossier/community summarization jobs, not the online extraction path

Reason:

- Graphiti is attractive and Apache-2.0 licensed【turn2view0†L326-L349】【turn2view0†L830-L832】, but its default operational model is more Python-service-centric and more LLM-provider-oriented than the current Tevel codebase is ready to absorb in one pass.
- GraphRAG is MIT-licensed【turn0search0†L1-L4】, but indexing cost and operational complexity make it a better phase-2/phase-3 indexing module rather than the first migration anchor.
- Apache AGE gives Tevel graph query power while staying close to Postgres and commercial-friendly licensing【turn6search0†L1-L4】.

Decision:
start with Tevel-owned typed graph artifacts in Postgres, design them to be AGE- and Graphiti-compatible, and add direct Graphiti/GraphRAG adapters later.

#### Multi-document summarization

- Primary evidence-packed summarization path:
  - extractive evidence pack builder + structured synthesis contract
- Model choice:
  - `PRIMERA` for long-document / multi-document case summarization where language/domain fit is acceptable
- Fallback:
  - existing local structured generator path on compressed evidence packs only

Reason:

- The most important design change is not “which summarizer,” but “summaries only from evidence packs, never from raw corpus dumps.”
- PRIMERA is suitable as a dedicated long-context summarization adapter, but it should sit behind a summarization interface with clear fallback behavior.

#### Explicitly deferred / not chosen for first implementation increment

- BELA as first-line internal resolution engine
- direct Graphiti ingestion as the system-of-record
- direct GraphRAG indexing as online retrieval path
- full contradiction reasoner
- full case-memory graph UX rewrite

## Licensing posture

Confirmed acceptable in principle from official project pages checked during planning:

- Docling: MIT【turn7search8†L1-L8】
- Graphiti: Apache-2.0【turn2view0†L326-L349】【turn2view0†L830-L832】
- GraphRAG: MIT【turn0search0†L1-L4】
- REL: MIT【turn5view0†L467-L470】
- Apache AGE: Apache-2.0【turn6search0†L1-L4】

Practical policy for implementation:

- do not wire a core dependency into the main pipeline until:
  - repo license is verified
  - weight/model license is checked separately where applicable
  - deployment mode is self-hostable

## Target internal architecture

### Layer 1. Canonical document model

New internal artifact:

- `CanonicalDocument`
- `CanonicalBlock`
- `CanonicalSection`
- `CanonicalChunk`

Minimum fields:

- document IDs
- parser metadata
- parser confidence / OCR flags
- page / section / block provenance
- raw offsets
- normalized offsets
- block type
- reading order

### Layer 2. Extraction artifacts

New explicit artifacts:

- entity mentions
- attribute mentions
- claim candidates
- relation candidates
- event candidates
- temporal expressions
- contradiction candidates

Every artifact must include:

- evidence span
- source doc ID
- source block/chunk ID
- parser provenance
- extractor name
- confidence

### Layer 3. Entity resolution

New explicit artifacts:

- canonical entities
- alias table
- merge candidates
- merge explanations
- unresolved conflicts

Resolution must preserve:

- no silent merge
- merge rationale
- type compatibility
- evidence references

### Layer 4. Relationship / graph layer

New typed graph artifacts:

- graph nodes
- graph edges
- evidence edge links
- validity windows
- contradiction edges
- confidence and derivation metadata

### Layer 5. Retrieval layer

New retrieval stack:

- lexical retrieval
- vector retrieval via pgvector + BGE-M3
- graph-aware expansion
- reranking via BGE reranker v2 m3

Supported query modes:

- entity-centric
- case-centric
- event-centric
- contradiction-centric
- source-evidence-centric

### Layer 6. Summary / synthesis layer

Summaries become first-class typed outputs:

- entity summary
- relationship summary
- timeline summary
- contradiction summary
- case brief
- investigation lead summary

Rules:

- no summary without evidence bundle
- no summary from raw full corpus prompt
- evidence snippets capped and deduplicated
- citation coverage score included

## What changes in the data flow

### Current

Ingestion -> mixed parse -> mixed extraction -> browser enrichment -> UI package -> ad hoc synthesis

### Target

Ingestion
-> canonical document artifacts
-> extraction artifacts
-> entity resolution
-> graph persistence
-> hybrid retrieval
-> evidence-pack builder
-> evidence-backed synthesis
-> compatibility projection into `IntelligencePackage`

## Provenance, confidence, and temporality preservation

### Provenance

Already-present sidecar evidence span design remains the base.

Will add:

- block-level provenance
- parser provenance
- resolution provenance
- summary citation bundles

### Confidence

Each layer gets its own confidence field:

- parser confidence
- extraction confidence
- merge confidence
- relation confidence
- retrieval score
- summary grounding score

### Temporality

Will add:

- temporal expressions as artifacts
- normalized validity windows on events/relations where possible
- contradiction state when same entity/edge has incompatible temporal facts

## Migration strategy

### Phase A. Stabilize schemas and compatibility envelope

- Add canonical internal schemas without breaking `IntelligencePackage`.
- Add projection layer from new internal artifacts to old UI contract.

### Phase B. Replace extraction internals first

- Upgrade sidecar extraction and resolution while leaving UI contracts stable.
- Keep browser fallback behind feature flags only.

### Phase C. Add durable retrieval and graph persistence

- Introduce Postgres-backed canonical stores and pgvector.
- Keep current local retrieval as fallback until parity is reached.

### Phase D. Move summarization behind evidence-pack builder

- Replace ad hoc summary calls with explicit evidence-packed summarization module.

### Phase E. Add evaluation and benchmarks

- Parsing robustness
- extraction quality
- duplicate collapse
- retrieval
- summary grounding
- contradiction capture

## Risks and fallback paths

### Risk: Docling variance on messy corpora

Fallback:

- keep `pypdf` / raw-text / HTML fallback
- add optional Tika adapter only where Docling is weak

### Risk: GLiNER2 recall/precision variance across languages

Fallback:

- preserve deterministic rule extractor
- gate GLiNER2 by feature flags and evaluation corpus

### Risk: Splink integration complexity

Fallback:

- start with deterministic candidate generation + smaller blocking rules
- layer Splink behind a resolution adapter

### Risk: Graph layer churn breaks UI

Fallback:

- keep `IntelligencePackage` projection adapter stable
- do not expose raw graph storage artifacts directly to the UI

### Risk: Summary quality regresses during migration

Fallback:

- preserve existing local summary path as compatibility fallback
- route all summary generation through evidence-pack builder first

## Exact files intended to change in the implementation phase

### Existing files expected to change

- `types.ts`
- `services/analysisService.ts`
- `services/sidecarClient.ts`
- `vite.sidecar.ts`
- `services/studyService.ts`
- `services/sidecar/types.ts`
- `services/sidecar/parsers.ts`
- `services/sidecar/ingest.ts`
- `services/sidecar/textUnits.ts`
- `services/sidecar/smartExtraction.ts`
- `services/sidecar/smartPipeline.ts`
- `services/sidecar/retrieval.ts`
- `services/sidecar/person/types.ts`
- `services/sidecar/person/resolver.ts`
- `services/sidecar/location/types.ts`
- `components/AnalysisDashboard.tsx`
- `components/GraphView.tsx`
- `components/SourceView.tsx`
- `components/FeedDashboard.tsx`
- `scripts/benchmark-sidecar.ts`
- `requirements-sidecar.txt`

### New files/directories planned

- `services/sidecar/config.ts`
- `services/sidecar/canonical/types.ts`
- `services/sidecar/canonical/projector.ts`
- `services/sidecar/extraction/contracts.ts`
- `services/sidecar/extraction/gliner2Adapter.ts`
- `services/sidecar/extraction/temporal.ts`
- `services/sidecar/resolution/entityResolution.ts`
- `services/sidecar/resolution/mergeRationale.ts`
- `services/sidecar/graph/contracts.ts`
- `services/sidecar/graph/projector.ts`
- `services/sidecar/retrieval/vectorIndex.ts`
- `services/sidecar/retrieval/reranker.ts`
- `services/sidecar/summarization/evidencePack.ts`
- `services/sidecar/summarization/contracts.ts`
- `services/sidecar/summarization/primeraAdapter.py`
- `services/sidecar/evaluation/metrics.ts`
- `tests/sidecar/canonicalModel.test.ts`
- `tests/sidecar/entityResolution.test.ts`
- `tests/sidecar/retrievalHybrid.test.ts`
- `tests/sidecar/summarizationGrounding.test.ts`
- `tests/fixtures/benchmark_corpus/*.json`
- `docs/pipeline_migration_notes.md`

## Implementation phases after this ADR

### Phase 1

- canonical document schema
- extraction contract cleanup
- `IntelligencePackage` projection adapter

### Phase 2

- GLiNER2-first extraction path
- Splink-backed identity resolution adapter
- cross-document alias table

### Phase 3

- typed graph edges and contradiction markers
- pgvector hybrid retrieval
- reranking

### Phase 4

- evidence-pack builder
- PRIMERA summarization adapter
- grounding evaluation suite

## Decision

Proceed with an incremental internal pipeline rewrite centered on:

- canonical artifacts
- evidence-backed extraction
- explainable resolution
- graph-ready persistence
- hybrid retrieval
- evidence-packed summarization

while preserving the current Tevel UI contract during migration.
