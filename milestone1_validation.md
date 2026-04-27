# Milestone 1 Validation Report

## Scope And Method

- Validated the current workspace implementation of the Milestone 1 sidecar scaffold.
- Re-ran:
  - `npm run test:sidecar`
  - `npm run bench:sidecar`
  - `npm run build`
- Expanded the benchmark corpus from 3 clean samples to 26 synthetic clean/noisy documents in `scripts/benchmark-sidecar.ts`.
- Important caveat: this workspace is not a git repository, so "added vs changed" can only be confirmed from the current file footprint and cross-references, not from a true diff.

## Confirmed Milestone 1 File Footprint

### Planning and implementation notes present

- `architecture_report.md`
- `bottlenecks.md`
- `recommended_stack.md`
- `migration_plan.md`
- `milestone1_plan.md`
- `implementation_notes.md`

### Code and test footprint present

- `services/sidecar/types.ts`
- `services/sidecar/textUnits.ts`
- `services/sidecar/ingest.ts`
- `services/sidecar/extraction.ts`
- `services/sidecar/retrieval.ts`
- `services/sidecar/pipeline.ts`
- `services/sidecar/index.ts`
- `scripts/benchmark-sidecar.ts`
- `tests/sidecar/textUnits.test.ts`
- `tests/sidecar/pipeline.test.ts`
- `package.json`
- `package-lock.json`

## Claimed Vs Actual Implementation

| Claim | Actual status | Validation |
| --- | --- | --- |
| Deterministic text-unit generation exists | True | `createTextUnits` normalizes text, splits into paragraph/sentence/hard-split units, and emits deterministic ids from `sourceDocId`, ordinal, and normalized `start-end` offsets. |
| Stable offsets exist | True, with an important caveat | Offsets are exact against the normalized document string, not the original raw upload. |
| Structured extraction payloads exist | True | `SidecarExtractionCandidate`, `SidecarMention`, `SidecarEntityRecord`, and `SidecarRelationCandidate` are defined and emitted by the pipeline. |
| Every candidate carries evidence | True for current emitted candidates | `payload.candidates` is derived from mentions only, and every mention is created through `buildEvidence`. |
| Fast first-pass extractor exists | True | Regex rules plus title-case heuristics extract mentions without LLM calls. |
| Duplicate collapse exists | True | Mentions collapse into entities by `entity_type + normalized_text` within one document. |
| Relation extraction exists | Partially true | Only a minimal co-mention scaffold exists. Relations are not semantic; they are same-text-unit co-mentions. |
| Lexical retrieval exists | True, but minimal | In-memory term-overlap search runs over text units, entities, and mentions for one payload at a time. |
| Benchmark scaffold exists | True | Benchmark now runs against 26 synthetic clean/noisy documents. |
| Focused tests exist | True | 7 sidecar tests pass. Coverage is focused but narrow. |

## Mismatches Between Summary And Actual Code

### 1. Evidence is exact against normalized text, not raw source text

This is the biggest mismatch.

- `normalizeSourceDocumentContent` removes carriage returns, converts tabs to spaces, collapses repeated spaces, collapses 3+ newlines, and trims the full document.
- `ingestSourceDocument` stores both `raw_content` and `normalized_content`, but the pipeline extracts against `normalized_content`.
- `runFastExtractionPipeline` passes `document.normalized_content` into extraction.
- `buildEvidence` slices `raw_supporting_snippet` from the same normalized string that extraction used.

Result:

- `char_start` / `char_end` are exact only for the normalized representation.
- `raw_supporting_snippet` is not truly raw source text if normalization changed whitespace or line endings.

### 2. "Stable" text-unit ids are deterministic, but only within the same normalization and chunking configuration

The ids are deterministic for the same normalized input and `maxChars`, but they are not stable across:

- normalization rule changes
- different `maxChars`
- different split heuristics

This is acceptable for Milestone 1, but it is not a final durability contract yet.

### 3. Relation output is narrower than a casual reading of the summary might suggest

The current relation path is only:

- same document
- same text unit
- grouped co-mentions
- emitted as `CO_MENTION_SAME_TEXT_UNIT`

There is no typed relation understanding beyond proximity.

## How Duplicate Collapse Currently Works

Duplicate collapse is implemented in `collapseMentionsToEntities`.

1. Every mention already has:
   - `entity_type`
   - `mention_text`
   - `normalized_text`
2. `normalized_text` comes from `normalizeLookupText`, which:
   - applies `NFKC`
   - lowercases
   - strips quotes
   - removes bracket characters
   - converts separators like `-`, `_`, `/` into spaces
   - removes most punctuation
   - collapses whitespace
3. Collapse key is:
   - ``${mention.entity_type}:${mention.normalized_text}``
4. For each key, the code aggregates:
   - all `mention_id`s
   - all `source_text_unit_id`s
   - all raw aliases
   - extraction sources
   - timestamps
   - average confidence across mentions
5. The longest mention text becomes `canonical_name`.
6. A per-document entity id is created as:
   - ``${sourceDocId}:e:${stableHash(key)}``
7. Mentions are then rewritten with that `entity_id`.

Important limitations of this collapse logic:

- no cross-document collapse
- no alias reasoning beyond normalized string equality
- no fuzzy matching
- no linker or coreference
- no merge between `"Orion Logistics"` and `"Orion Logistics LLC"` unless they normalize identically
- no merge across different extracted entity types

## How Evidence Span Attachment Currently Works

Evidence attachment is implemented through `buildMention` and `buildEvidence`.

1. The extractor finds a regex or title-case match inside one `textUnit.text`.
2. Match-relative offsets are converted to document offsets as:
   - `start = textUnit.start + relativeStart`
   - `end = textUnit.start + relativeEnd`
3. `buildMention` creates the candidate/mention record with:
   - `source_doc_id`
   - `source_text_unit_id`
   - `char_start`
   - `char_end`
   - `raw_text`
   - `normalized_text`
   - `label`
   - `candidate_type`
   - `extraction_source`
   - `confidence`
   - `metadata`
4. `buildEvidence` creates `EvidenceSpan` with:
   - `evidence_id = ${sourceDocId}:ev:${start}-${end}`
   - the same `source_doc_id`
   - the same `source_text_unit_id`
   - `start` / `end`
   - `normalized_text`
   - `extraction_source`
   - `confidence`
   - optional derived `timestamp`
   - empty `corroborates` / `contradicts`
5. The supporting snippet is a bounded local window:
   - start at `max(textUnit.start, mentionStart - 90)`
   - end at `min(textUnit.end, mentionEnd + 90)`
   - slice that range from the normalized document string
   - trim the result

Important limitations:

- snippet is normalized, not original raw text
- snippet window is capped to the text unit
- evidence ids are offset-based, so upstream offset changes will change ids
- corroboration and contradiction fields are placeholders only

## How Lexical Retrieval Currently Works

Lexical retrieval is implemented in `buildLexicalIndex` and `searchLexicalIndex`.

### Index build

The index is per-payload and in-memory only.

It stores records for:

- every text unit: unit text
- every entity: canonical name plus aliases
- every mention: mention text plus supporting snippet

Each record is tokenized by:

- `normalizeLookupText`
- split on whitespace
- discard one-character tokens
- deduplicate terms per record

The index holds:

- `inverted_terms: Map<string, string[]>`
- `record_text`
- `record_type`
- `record_text_unit`

### Search

1. Normalize and tokenize the query.
2. Look up matching record ids for each term.
3. Add one score point per matched query term.
4. Final score is:
   - `matched_terms / total_query_terms`
5. Sort by:
   - descending score
   - then `hit_type` lexicographically
6. Return:
   - `hit_type`
   - `id`
   - `score`
   - `source_text_unit_id`
   - a 240-char snippet
   - `matched_terms`

Important limitations:

- no BM25
- no phrase matching
- no stemming
- no proximity scoring
- no field weighting
- no cross-document retrieval
- no persistence
- index rebuilds for each payload

## Benchmark Validation

### Current benchmark result

Current synthetic benchmark run after expanding the sample set:

- corpus size: 26 docs
- docs/sec: 1933.96
- text units/sec: 5504.35
- extraction candidates found: 261
- entities/doc: 9.5
- mentions/doc: 10.04
- relations/doc: 23.77
- average extraction latency/doc: 0.52 ms
- average retrieval latency: 0.2023 ms
- duplicate collapse rate: 0.0412
- evidence coverage rate: 1
- memory RSS: 60.91 MB

### Benchmark caveats

- Corpus is still synthetic and small.
- Documents are noisier than before, but still far simpler than real hybrid corpora.
- Retrieval is measured on one in-memory payload at a time, not a corpus-scale shared index.
- Evidence coverage rate is structural, not semantic. It only checks whether spans exist and are non-empty.
- Very fast timings here do not predict future model-assisted or parser-assisted Milestone 2 timings.
- The benchmark currently favors the implementation because the corpus is small enough to stay hot in memory.

## Technical Debt Introduced By Milestone 1

- Provenance is anchored to normalized text rather than original raw source offsets.
- Text-unit ids are deterministic but config-sensitive.
- Rule patterns and title-case heuristics are embedded directly in code rather than externalized into configurable rule sets.
- Relation candidates are proximity-based scaffolds that may look more meaningful than they are.
- Lexical retrieval is intentionally simplistic and would not scale as-is.
- The "sidecar" is still a module boundary, not a process or transport boundary.
- Tests are focused but do not cover adversarial false positives, multilingual edge cases, or persistence integration.

## Current Limitations

- no HTTP sidecar or background worker process
- no parser integration for PDFs, HTML, or Office docs
- no raw-source offset preservation after normalization
- no Postgres provenance writes
- no cross-document entity linking
- no coreference
- no contradiction logic
- no semantic relation extraction
- no hybrid or dense retrieval
- no schema validation beyond TypeScript and tests
- no quality benchmark against gold annotations

## Blockers Before Milestone 2

### 1. Provenance contract needs one revision first

Before parser integration or database writes, the project needs a clear decision on whether canonical offsets are:

- raw-source offsets
- normalized-text offsets
- or both with a mapping layer

Right now the code assumes normalized-text offsets.

### 2. Sidecar boundary is still conceptual

Milestone 2 cannot proceed cleanly until there is a real transport and failure model for:

- request/response
- job status
- fallback behavior
- sidecar availability

### 3. Persistence contract is still missing

The current scaffold emits good objects in memory, but there is still no write path for:

- text units
- mentions
- evidence spans
- entity records
- relation candidates

### 4. Benchmarking needs a next tier before feature expansion

Before adding model extraction, the project should define:

- larger synthetic corpora
- real sample corpora
- gold or semi-gold inspection sets
- acceptable false-positive ceilings for the rule path

## Recommendation

`revise`

Reason:

Milestone 1 is real and useful, and the summary is mostly accurate. The scaffold, tests, and benchmark all exist and pass. The one issue that should be corrected before building Milestone 2 on top of it is the provenance contract: current "exact" evidence spans are exact against normalized text, not the original raw source. That is a meaningful distinction for an investigative system and should be resolved before parser integration, storage design, or UI evidence highlighting gets deeper.
