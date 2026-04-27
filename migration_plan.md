# Migration Plan

## Rollout Strategy

The migration should be incremental and reversible. The current repo has a single high-risk seam: `App.tsx:218-223` calls one browser-side analysis entrypoint and expects one `IntelligencePackage` back. That seam is exactly where the sidecar path should be introduced.

## Milestones

### Milestone 0: Contracts And Measurement

- Add offset-preserving text-unit and extraction payload contracts
- Add deterministic fast extraction scaffold
- Add benchmark harness and tests
- Do not change the existing UI flow yet

### Milestone 1: Shadow Extraction Path

- Introduce a sidecar-style extraction module or HTTP adapter
- Run deterministic extraction in parallel with the current browser path on selected documents
- Persist the sidecar payload separately from the user-facing intelligence package
- Compare counts, latency, and evidence coverage

### Milestone 2: Real Local Sidecar

- Move parsing, text-unit generation, rule extraction, and lightweight model extraction into the sidecar
- Keep the UI contract stable by returning the current `IntelligencePackage` plus a provenance payload id
- Keep the current browser `analyzeDocument` as fallback only

Milestone 2 interface note:

- Sidecar payloads may now carry `source_parser` and `source_input_content` alongside the normalized analysis text view
- For raw-text inputs, Milestone 1.5 exact raw-offset fidelity still holds end to end
- For parsed HTML/file inputs, evidence offsets are exact against the parser-produced text view while the original source artifact is retained separately in `source_input_content`

### Milestone 3: Retrieval And Reasoning Transition

- Move lexical retrieval and evidence-pack assembly into the sidecar
- Replace `extractRelevantPassages` and most of the in-browser retrieval index code
- Limit the LLM to fusion and analyst reasoning

## Smallest Safe First Step

The smallest safe first step in this repo is:

1. Add a sidecar extraction contract that preserves offsets and evidence spans.
2. Implement a rule-based text-unit and mention path in isolation.
3. Benchmark it locally.
4. Leave `App.tsx` and `StudyService` behavior unchanged for now.

That step is safe because it does not force UI rewrites, does not require schema migration on day one, and gives an immediate baseline for latency and evidence quality.

## Validation Strategy

### Functional validation

- Golden tests for text-unit boundaries and char offsets
- Golden tests for mention spans and evidence snippets
- Schema validation for extraction payload objects

### Comparative validation

- Run current `analyzeDocument` and the new sidecar scaffold on the same sample corpus
- Compare:
  - docs/sec
  - text units/sec
  - entities/doc
  - relations/doc
  - average extraction latency/doc
  - duplicate collapse rate
  - evidence coverage rate
  - memory footprint

### Analyst validation

- Spot-check 10-20 documents
- Verify whether entities and snippets are easier to trust
- Measure whether contradictions and leads become easier to inspect because evidence ids exist

## Rollback Strategy

- Keep `services/intelligenceService.ts:2163-2367` as a fallback analysis path until the sidecar path is proven
- Gate the new path behind an environment flag or sidecar availability check
- Keep `StudyService` reading the existing `studies` JSON blob during the transition
- If sidecar extraction fails, fall back to current browser analysis without breaking the UI

## Data Migration Considerations

### Current state

- Canonical user-facing data is effectively the `studies.intelligence` JSON blob (`services/studyService.ts:228-255`)
- The normalized tables only store thin entity and relation rows (`services/studyService.ts:262-299`)

### Required future state

- Add normalized provenance tables for text units, mentions, relations, and claims
- Keep `studies.intelligence` as a compatibility view for the existing UI
- Store a sidecar run id on each study so the UI can fetch richer evidence later without breaking current reads

### Backfill constraints

- Rows that only have `clean_text` and no `raw_text` cannot recover exact original offsets
- Existing studies with `raw_text` can be backfilled into text units and mention tables
- Because `Entity.evidence` is only free text today, legacy entities should be treated as display data, not canonical provenance

## Interface Compatibility Considerations

### Current UI contract

The app expects:

- `IntelligencePackage.entities`
- `IntelligencePackage.relations`
- `IntelligencePackage.timeline`
- `IntelligencePackage.context_cards`
- `IntelligencePackage.graph`

### Recommended compatibility layer

Keep returning the current package shape, but attach sidecar-native payloads behind new optional fields or a separate fetch path:

- `analysis_version`
- `sidecar_run_id`
- `provenance_summary`

This avoids forcing immediate UI changes in `AnalysisDashboard`, `ManagementDashboard`, and `FeedDashboard`.

## Suggested Database Evolution

### Keep

- `studies`
- existing entity/relation summary tables for compatibility

### Add

- `source_documents`
- `text_units`
- `mention_spans`
- `entity_records`
- `entity_mentions`
- `relation_candidates`
- `claim_candidates`
- `analysis_runs`

### Do not add yet

- a graph database
- a mandatory vector database
- a framework-heavy GraphRAG layer

## Repo-Specific Cutover Recommendation

1. Finish the Milestone 1 scaffold in-repo.
2. Add a thin sidecar client next.
3. Shadow the new path while still persisting current `IntelligencePackage` blobs.
4. Promote the sidecar to primary extraction only after latency and evidence coverage improve on benchmark data.
