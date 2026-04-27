# Milestone 2 Implementation

## Scope

Milestone 2 upgrades the Milestone 1 and 1.5 sidecar foundation from a deterministic first-pass candidate engine into a smart extraction path with:

- real parser integration for HTML and parser-ready files
- a hybrid extraction layer that combines existing fast rules with a spaCy-backed helper
- evidence-bearing relation, event, and claim-like outputs
- benchmark coverage for parsing and smart extraction latency

This milestone does **not** replace the existing browser analysis flow yet. The older path remains intact, and the sidecar lives behind isolated modules in `services/sidecar`.

## What Changed

### 1. Real ingestion adapters

- Added `services/sidecar/parsers.ts` to normalize source inputs into the repo-specific `SourceDocumentInput` contract.
- HTML input is now parsed through `trafilatura` via `scripts/sidecar_m2_helper.py`.
- File ingestion supports:
  - `.html` and `.htm` through `trafilatura`
  - `.txt`, `.md`, `.json`, and `.csv` through direct local read
  - a guarded Docling adapter for richer file parsing when `docling` is installed later
- `services/sidecar/pythonBridge.ts` provides the smallest possible synchronous bridge to the Python helper.

### 2. Stronger evidence-bearing contracts

- `services/sidecar/types.ts` now carries:
  - `source_parser`
  - `source_input_content`
  - event candidates
  - richer claim metadata
  - parser and extractor provenance on evidence records
- `services/sidecar/ingest.ts` preserves parser metadata while reusing the Milestone 1.5 normalization and offset mapping path.
- The fast pipeline in `services/sidecar/pipeline.ts` stays compatible and now exposes empty `event_candidates` plus parser metadata fields when present.

### 3. Hybrid smart extraction

- Added `services/sidecar/smartExtraction.ts` and `services/sidecar/smartPipeline.ts`.
- The smart pipeline:
  - parses source input
  - ingests and normalizes it with stable text units
  - runs the existing fast rule extractor
  - runs a spaCy-backed helper over normalized text
  - merges mentions
  - collapses mentions into entity records
  - emits explicit relation, event, and claim-like candidates
- The Python helper currently uses:
  - spaCy `EntityRuler`
  - spaCy `PhraseMatcher`
  - spaCy `Matcher`
  - sentence-level cue heuristics for `FUNDED`, `COMMUNICATED_WITH`, `MOVED_WITH`, `ASSOCIATED_WITH`
  - event scaffolds for communication, funding, movement, and cyber cues
  - claim-like scaffolds for reporting and request cues

### 4. Provenance integrity

- Raw-text Milestone 1.5 fidelity remains intact.
- For raw-text inputs, raw offsets and raw snippets still round-trip exactly to the original source text.
- For parsed HTML and file inputs, evidence spans are exact against the parser-produced text view, while the original source artifact is preserved separately in `source_input_content`.
- Parser metadata is attached to payloads and evidence objects so downstream code can distinguish `raw_text` from `parsed_text` views.

### 5. Tests and benchmark

- Added `tests/sidecar/smartPipeline.test.ts` for:
  - HTML parser integration
  - raw-text parser bypass when a source URI is present
  - structured relation, event, and claim output
  - Milestone 1.5 raw-source fidelity regression protection
  - noisy investigative text behavior
- Added `tests/fixtures/investigative_article.html` for parser/file coverage.
- Reworked `scripts/benchmark-sidecar.ts` to measure:
  - docs/sec
  - parse time/doc
  - extraction latency/doc
  - entities/doc
  - relations/doc
  - event and claim candidate counts
  - evidence coverage
  - raw evidence round-trip rate
  - memory footprint

## Current Benchmark

Command:

```bash
npm run bench:sidecar
```

Current run on the mixed raw/noisy/HTML/file sample corpus:

- corpus size: 31 docs
- parser mix: 26 `raw_text`, 5 `trafilatura`
- docs/sec: `0.73`
- parse latency/doc: `172.71 ms`
- extraction latency/doc: `1203.48 ms`
- end-to-end latency/doc: `1376.97 ms`
- entities/doc: `10.55`
- relations/doc: `36.9`
- event candidates/doc: `0.74`
- claim candidates/doc: `0.42`
- evidence coverage: `1.0`
- raw evidence round-trip rate: `1.0`
- memory RSS: `57.36 MB`

## Important Limitations

- The smart extractor is stronger than Milestone 1, but it is still heuristic-heavy.
- The current relation count is inflated by the retained co-mention scaffold from Milestone 1. Explicit relation candidates exist now, but co-mention relations still dominate the aggregate count.
- The Python helper is synchronous and invoked once per document, so extraction latency is currently dominated by Python/spaCy startup and processing overhead.
- The spaCy path is English-oriented today. This milestone does not claim multilingual model extraction.
- The Docling adapter is optional and only used when the package is installed locally.
- Parser-produced HTML/file views preserve the original source artifact separately, but they do **not** yet provide exact byte-level offsets back into the original HTML or binary document structure.
- Claim and event candidates are intentionally conservative and shallow. They are schema-bearing scaffolds, not full semantic understanding.

## Interface Notes

- `services/sidecar/index.ts` now exports parser, Python bridge, smart extraction, and smart pipeline modules.
- `migration_plan.md` was updated to record the Milestone 2 parser contract:
  - raw-text exact fidelity still applies to raw-text inputs
  - parsed-source evidence is exact against the parser-produced text view
  - original source artifacts are retained separately for later provenance work

## Deferred To Milestone 3

- promote the sidecar into the main application flow behind a compatibility layer
- replace co-mention-heavy relation scaffolding with narrower typed relations
- add lightweight model extraction beyond the current spaCy rule stack
- improve multilingual extraction behavior
- introduce parser-aware raw-source anchoring beyond parser text views
- add entity linking, cross-document stitching, and contradiction logic
- move retrieval and evidence-pack assembly deeper into the sidecar
- introduce smaller-LLM reasoning/fusion on top of structured evidence

## Recommendation

Milestone 3 can begin safely **only if** it treats the current parser contract honestly:

- raw-text provenance is production-safe for Milestone 2 outputs
- parsed HTML/file provenance is safe at the parser text-view level, not yet at original-document DOM/PDF coordinate level
- relation and claim/event schemas are ready for downstream consumers, but should still be treated as candidate layers rather than final truth
