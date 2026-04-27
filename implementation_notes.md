# Tevel Sidecar Implementation Notes

This file summarizes the current state of the largest safe single-run milestone for Tevel's sidecar extraction path across Milestone 1, Milestone 1.5, and Milestone 2.

## Current Outcome

The repo now contains:

- a stable in-repo sidecar scaffold under `services/sidecar/`
- dual-offset provenance for raw-text inputs
- parser-backed HTML ingestion through Trafilatura
- additive smart extraction through a spaCy-backed helper
- structured relation, event, and claim-like candidate outputs
- focused tests, a mixed-corpus benchmark, and milestone-specific docs

The old fast pipeline remains intact and exportable for compatibility.

## Phase A: Provenance Fidelity Revision

### What changed

- normalization now emits `offset_map` and `normalization_steps`
- text units preserve both normalized and raw spans and text
- mentions, candidates, and evidence preserve `raw_*` and `normalized_*` offsets
- payloads preserve `raw_text`, `normalized_text`, and `source_input_content`

### Key files touched

- `services/sidecar/textUnits.ts`
- `services/sidecar/types.ts`
- `services/sidecar/ingest.ts`
- `tests/sidecar/textUnits.test.ts`
- `tests/sidecar/pipeline.test.ts`
- `milestone1_5_revision.md`

### What passed

- raw-to-normalized and normalized-to-raw mapping tests
- raw evidence slicing back to original source text
- regression protection for deterministic text units and evidence-bearing candidates

### What remains

- raw-text provenance is fully supported
- parsed-source provenance is still only guaranteed at the parser text-view layer

## Phase B: Real Ingestion Integration

### What changed

- added parser-backed source normalization for HTML and HTML files
- preserved original source artifacts separately in `source_input_content`
- recorded parser metadata in `source_parser`
- kept plain text on the raw-text path even when a source URI is present

### Key files touched

- `services/sidecar/parsers.ts`
- `services/sidecar/pythonBridge.ts`
- `scripts/sidecar_m2_helper.py`
- `requirements-sidecar.txt`
- `tests/fixtures/investigative_article.html`
- `tests/sidecar/smartPipeline.test.ts`

### What passed

- inline HTML parser integration
- HTML file ingestion
- raw-text parser bypass regression coverage

### What remains

- Trafilatura is the concrete parser integrated for this run
- Docling remains an optional guarded adapter rather than a required dependency
- original HTML/PDF coordinate fidelity is still deferred

## Phase C: Smart Extraction Upgrade

### What changed

- kept the existing fast rule extractor intact
- added a spaCy-backed smart extractor using `EntityRuler`, `PhraseMatcher`, `Matcher`, and sentence cue heuristics
- merged fast and smart mentions before duplicate collapse
- preserved parser and extractor metadata on smart mentions and evidence

### Key files touched

- `services/sidecar/smartExtraction.ts`
- `services/sidecar/smartPipeline.ts`
- `services/sidecar/types.ts`
- `scripts/sidecar_m2_helper.py`

### What passed

- structured smart extraction tests on a typed sample corpus
- noisy investigative text behavior
- Milestone 1 lexical retrieval behavior remains available through the sidecar payload index

### What remains

- the smart layer is heuristic-heavy and English-oriented
- GLiNER, coreference, and entity linking are still out of scope

## Phase D: Structured Relation, Event, And Claim Scaffolding

### What changed

- added explicit relation candidates with typed source/target ids and evidence
- added event-like records with trigger, actor, target, and location references
- added claim-like records with cue text and speaker/subject/object references when resolvable
- retained Milestone 1 co-mention relations for compatibility

### Key files touched

- `services/sidecar/smartExtraction.ts`
- `services/sidecar/smartPipeline.ts`
- `services/sidecar/types.ts`

### What passed

- typed relation extraction on the structured sample corpus
- event and claim candidate emission with evidence-bearing metadata

### What remains

- co-mention relations still dominate total relation counts
- event and claim scaffolds are conservative candidates, not full semantic reasoning

## Phase E: Verification, Benchmark, And Validation Docs

### What changed

- benchmark corpus now mixes clean raw text, noisy raw text, inline HTML, and file-backed HTML
- benchmark reports parser mix, parse latency, extraction latency, end-to-end latency, counts, evidence coverage, and raw round-trip fidelity
- milestone docs now reflect the actual implementation and current deferrals

### Key files touched

- `scripts/benchmark-sidecar.ts`
- `milestone1_5_revision.md`
- `milestone2_implementation.md`
- `milestone2_validation.md`
- `migration_plan.md`

### Latest recorded verification

- `npm run test:sidecar` passed with 15 tests
- `npm run bench:sidecar` passed on a 31-doc mixed corpus
- `npm run build` passed

Latest recorded benchmark snapshot:

- `docsPerSecond`: `0.73`
- `averageParseLatencyMsPerDoc`: `172.71`
- `averageExtractionLatencyMsPerDoc`: `1203.48`
- `averageEndToEndLatencyMsPerDoc`: `1376.97`
- `entitiesPerDoc`: `10.55`
- `relationsPerDoc`: `36.9`
- `eventCandidatesPerDoc`: `0.74`
- `claimCandidatesPerDoc`: `0.42`
- `evidenceCoverageRate`: `1`
- `rawEvidenceRoundTripRate`: `1`

## Deferred To Milestone 3

The following are still intentionally deferred:

- entity linking and cross-document identity resolution
- coreference
- contradiction/corroboration logic
- parser-aware raw HTML/PDF coordinate anchoring beyond parser text views
- retrieval-stack rebuild beyond the current lexical scaffold
- graph storage
- reasoning/fusion layer migration

## Practical Read On The Current State

The sidecar is now strong enough to act as a smart extraction foundation, but not yet as the final evidence or reasoning system.

What is production-safer today:

- raw-text provenance fidelity
- additive parser-backed HTML ingestion
- deterministic plus spaCy-backed structured extraction

What still needs another milestone:

- stronger typed relation quality
- richer parser-origin provenance
- lower-latency smart extraction packaging
- downstream linking and reasoning
