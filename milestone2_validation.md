# Milestone 2 Validation

## Scope Of Validation

This report validates the current Tevel sidecar state after completing:

- Milestone 1 foundation
- Milestone 1.5 provenance revision
- Milestone 2 parser-backed smart extraction upgrade

Validation was grounded in the current implementation, test suite, and benchmark runner in this repository.

## Claimed Vs Actual Implementation

### Provenance fidelity

Claimed:

- raw and normalized offsets exist together
- raw evidence snippets come from original source text
- normalization trace metadata is preserved

Actual:

- true for the raw-text path
- candidates, mentions, text units, and evidence all carry raw and normalized spans
- `offset_map`, `normalization_steps`, `raw_text`, and `normalized_text` are preserved through the sidecar payload
- raw evidence round-trip remains `1.0` on the current benchmark corpus

Important caveat:

- for parsed HTML/file inputs, offsets are exact against the parser-produced text view, not against original HTML/PDF structure

### Real ingestion integration

Claimed:

- at least one real parser path is integrated

Actual:

- `trafilatura` is integrated for inline HTML and HTML-file ingestion
- plain text-like files still use direct local reads
- Docling is present as an optional guarded fallback, not as a required active dependency for this run

### Smart extraction upgrade

Claimed:

- extraction is stronger than rules-only
- deterministic extraction is preserved
- a stronger model-light layer is added

Actual:

- true
- the old fast rule path remains intact
- the smart path adds a spaCy-backed layer using `EntityRuler`, `PhraseMatcher`, `Matcher`, and sentence cue heuristics
- smart mentions are merged with fast mentions before duplicate collapse

Not implemented:

- GLiNER
- multilingual model extraction
- any LLM-based extraction

### Relation / event / claim scaffolding

Claimed:

- small but real structured outputs beyond entity mentions

Actual:

- true
- explicit typed relation candidates exist
- event-like records exist with actors, targets, locations, trigger text, and evidence
- claim-like records exist with cue text and linked speaker/subject/object references when resolvable

Important caveat:

- relation totals are still heavily influenced by the retained co-mention scaffold from Milestone 1

## Latest Verification

Latest recorded command results:

- `npm run test:sidecar` passed with 15 tests
- `npm run bench:sidecar` passed
- `npm run build` passed

Latest recorded benchmark output:

- `pipelineVersion`: `milestone2-spacy-parser-hybrid-v1`
- `corpusSize`: `31`
- `parserCounts.raw_text`: `26`
- `parserCounts.trafilatura`: `5`
- `docsPerSecond`: `0.73`
- `totalTextUnitsProduced`: `79`
- `averageParseLatencyMsPerDoc`: `172.71`
- `averageExtractionLatencyMsPerDoc`: `1203.48`
- `averageEndToEndLatencyMsPerDoc`: `1376.97`
- `mentionsPerDoc`: `11.61`
- `entitiesPerDoc`: `10.55`
- `relationsPerDoc`: `36.9`
- `eventCandidatesPerDoc`: `0.74`
- `claimCandidatesPerDoc`: `0.42`
- `averageLexicalRetrievalLatencyMs`: `0.1731`
- `duplicateCollapseRate`: `0.0651`
- `evidenceCoverageRate`: `1`
- `rawEvidenceRoundTripRate`: `1`
- `memoryRssMb`: `57.36`

## Benchmark Caveats

- the benchmark corpus is synthetic and repo-local, not a production corpus
- parser-backed docs are limited to HTML and one HTML fixture file in the current run
- extraction latency is dominated by synchronous Python/spaCy invocation per document
- relation counts overstate semantic relation quality because co-mention compatibility relations are still included
- the benchmark proves current behavior, not future optimized throughput

## Technical Debt Introduced Or Left In Place

- synchronous Python bridge means higher per-document latency and no batching
- parser-backed provenance stops at parser text views rather than original document coordinates
- parser logic and extractor logic currently share one helper script, which is practical but not yet modular
- the smart extractor remains heuristic-heavy and English-biased
- relation quality is mixed because compatibility scaffolding and typed relations share the same aggregate output
- Docling support is optional rather than exercised in the default test/benchmark path

## Blockers Before Milestone 3

- decide whether Milestone 3 will treat parser-view provenance as sufficient for some source types or require richer raw-document anchoring first
- reduce or separate co-mention relation volume so typed relation outputs can be evaluated more honestly
- decide whether the Python smart extractor stays as a process-per-call bridge or moves to a warmer sidecar runtime
- define how sidecar-native payloads map into the current UI contract without breaking the old browser path

These are blockers for clean Milestone 3 execution, but not blockers for closing Milestone 2.

## Recommendation

`proceed`

Rationale:

- the run meets the required Milestone 1.5 and Milestone 2 outcomes within the chosen scope
- raw-text provenance fidelity is now correct and benchmarked
- a real parser path exists and is exercised
- extraction is materially stronger than rules-only
- relation/event/claim scaffolds exist as structured evidence-bearing outputs

Proceed with two explicit constraints:

- keep the parser-view provenance caveat visible until deeper raw-document anchoring is built
- treat current relation totals as compatibility-heavy until co-mention outputs are narrowed or separated
