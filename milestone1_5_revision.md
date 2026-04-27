# Milestone 1.5 Provenance Revision

## Goal

Milestone 1.5 fixes the provenance mismatch identified in `milestone1_validation.md`:

- extracted spans are no longer only exact against normalized text
- evidence now preserves both normalized and raw-source offsets
- `raw_supporting_snippet` now comes from the original uploaded source text

This revision does not broaden extraction logic or introduce Milestone 2 features.

## What Changed

### 1. Raw-to-normalized mapping was added at ingest time

The ingest step now normalizes directly from `raw_content` and emits:

- `normalized_content`
- `offset_map`
- `normalization_steps`

The offset map contains:

- `raw_to_normalized`
- `normalized_to_raw`

This mapping is then reused by text-unit generation and evidence construction.

### 2. Text units now preserve both raw and normalized spans

Each text unit now carries:

- normalized `start` / `end`
- explicit `normalized_start` / `normalized_end`
- explicit `raw_start` / `raw_end`
- normalized `text`
- raw-source `raw_text`

This means text units can now be traced both to the normalized working text and to the original upload.

### 3. Candidates and evidence now preserve both offset spaces

Each extracted candidate now carries:

- `normalized_char_start`
- `normalized_char_end`
- `raw_char_start`
- `raw_char_end`

Each evidence object now carries:

- `normalized_start`
- `normalized_end`
- `raw_start`
- `raw_end`
- `raw_supporting_snippet`
- `normalized_supporting_snippet`

For backward compatibility inside the current scaffold:

- `char_start` / `char_end` remain normalized offsets
- `evidence.start` / `evidence.end` remain normalized offsets

### 4. Payloads now preserve both document forms

The extraction payload now includes:

- `raw_text`
- `normalized_text`
- `normalization_steps`

This removes the old ambiguity where `raw_text` actually held normalized content.

### 5. Provenance-focused tests were added

The test suite now proves round-trip fidelity for:

- normalized span -> raw span
- raw span -> normalized span
- evidence slicing back into original raw text
- evidence slicing back into normalized working text

### 6. Benchmark notes were updated

The benchmark now includes:

- `rawEvidenceRoundTripRate`

This is a structural fidelity metric that checks whether candidate raw offsets round-trip back to the original source text.

## How The Mapping Works

The mapping is intentionally simple and local to the current raw-text pipeline.

### Normalization model

Normalization still performs the Milestone 1 steps:

1. remove carriage returns
2. replace tabs with single spaces
3. collapse repeated spaces and non-breaking spaces
4. collapse runs of 3 or more newlines to 2 newlines
5. trim leading and trailing whitespace

### Offset model

During normalization, the code tracks:

- for each raw boundary: how many normalized characters exist after consuming that raw prefix
- for each normalized character: which raw span produced it

That gives two practical mapping directions:

- raw span -> normalized span
- normalized span -> raw span

This is enough for the current use case because extraction still runs on normalized text, but evidence needs to resolve back to the original upload.

## Assumptions That Still Remain

### 1. The canonical source is still a single raw text string

This revision assumes ingestion begins from one raw string and that normalization happens in-process before extraction.

### 2. The current reverse mapping is designed for this normalization layer only

The offset map is correct for the current whitespace and line-ending normalization rules. If those rules change, ids and offsets will change too.

### 3. Backward-compatible normalized offsets remain in place

To avoid widening scope, normalized offsets still occupy:

- `char_start` / `char_end`
- `evidence.start` / `evidence.end`

That contract should be revisited later if the broader app begins consuming sidecar-native evidence directly.

## Limitations Still Present

- no parser-level mapping for PDFs, OCR structure, HTML DOM cleanup, or Office extraction
- no persistence layer for offset maps or evidence records yet
- no cross-document provenance model
- no UI evidence highlighting path yet
- no guarantee that future parser transforms will preserve this contract automatically
- text-unit ids are still deterministic but config-sensitive

## Latest Validation Outcome

This provenance revision remained intact after the Milestone 2 smart-extraction upgrade.

Latest validation in the full single-run milestone:

- `npm run test:sidecar` passes with 15 focused tests
- `npm run bench:sidecar` passes on the mixed 31-doc raw/noisy/HTML/file corpus
- `npm run build` passes

Latest benchmark snapshot relevant to provenance:

- `corpusSize`: 31
- `parserCounts.raw_text`: 26
- `parserCounts.trafilatura`: 5
- `evidenceCoverageRate`: 1
- `rawEvidenceRoundTripRate`: 1

The key interpretation is:

- raw-text inputs still round-trip exactly from evidence offsets back into the original uploaded source text
- parsed HTML/file inputs preserve the original artifact separately, but evidence offsets are exact against the parser-produced text view, not original HTML/PDF coordinates

These numbers are benchmark outputs from the current synthetic sidecar corpus, not product-wide performance claims.

## What This Means After Milestone 2

Milestone 2 was safe to begin because it preserved the dual-offset provenance contract instead of collapsing back to normalized-only offsets.

The contract that now remains in force is:

- extraction may operate on normalized working text
- every emitted evidence-bearing record still preserves raw and normalized offsets
- raw-text provenance is production-safe for this run
- parser-backed provenance is safe at the parser text-view layer and is explicitly deferred for deeper raw-document anchoring later
