# Milestone 1 Plan

Milestone 1 is intentionally narrow. Its purpose is to create the stable substrate the sidecar will need later, not to ship the whole future system in one run.

## Scope

### In scope

- stable text-unit generation with exact offsets
- structured extraction payloads
- evidence span attachment
- fast candidate extraction path
- simple relation-candidate scaffolding
- benchmark scaffolding
- tests

### Out of scope

- full parser integration
- GLiNER integration
- coreference
- graph database work
- replacing the UI flow
- replacing `analyzeDocument` end-to-end

## Files To Add / Modify

### Add

- `services/sidecar/types.ts`
- `services/sidecar/textUnits.ts`
- `services/sidecar/extraction.ts`
- `services/sidecar/retrieval.ts`
- `services/sidecar/pipeline.ts`
- `services/sidecar/index.ts`
- `scripts/benchmark-sidecar.ts`
- `tests/sidecar/textUnits.test.ts`
- `tests/sidecar/pipeline.test.ts`

### Modify

- `package.json`
- `package-lock.json`

## Interfaces To Introduce

### Document / text-unit layer

- `SidecarTextUnit`
- `createTextUnits(sourceDocId, text, options)`

### Evidence layer

- `EvidenceSpan`
- `SidecarMention`
- `SidecarEntityRecord`
- `SidecarRelationCandidate`

### Pipeline layer

- `runFastExtractionPipeline({ sourceDocId, text })`

### Retrieval scaffolding

- `buildLexicalIndex(payload)`
- `searchLexicalIndex(index, query, limit)`

## Benchmark Script To Add

Add `scripts/benchmark-sidecar.ts` that measures at least:

- docs/sec
- text units/sec
- entities/doc
- relations/doc
- average extraction latency/doc
- retrieval latency
- duplicate collapse rate
- evidence coverage rate
- memory footprint

For Milestone 1, the benchmark should be explicit that it is measuring the deterministic fast path only. Quantization / ONNX / runtime acceleration should be marked as future comparison points, not claimed wins.

## Test Coverage To Add

### `tests/sidecar/textUnits.test.ts`

- preserves exact substring recovery from `start` / `end`
- keeps deterministic ids and ordering
- splits long inputs without losing coverage

### `tests/sidecar/pipeline.test.ts`

- attaches exact evidence spans to extracted mentions
- derives timestamps from date mentions when possible
- collapses duplicate mentions into entity records
- creates relation candidates from co-mentioned entities
- supports basic lexical retrieval over the resulting payload

## Acceptance Criteria

Milestone 1 is done when:

1. A deterministic extraction payload can be produced from raw text without LLM calls.
2. Every extracted mention contains exact source offsets and a raw supporting snippet.
3. Text units are stable and test-covered.
4. Duplicate mention collapse is benchmarked.
5. A benchmark script prints the required core metrics.
6. Tests run locally and pass.
7. The scaffold is isolated enough that a future sidecar HTTP process can adopt it without rewriting the UI first.

## Repo-Specific Success Condition

The real success condition for this repo is not “replace everything”. It is:

- prove we can generate exact, evidence-bearing extraction objects outside the current LLM-heavy path
- do it with a small enough change set that `App.tsx`, `AnalysisDashboard`, and `StudyService` do not need to be rewritten yet
