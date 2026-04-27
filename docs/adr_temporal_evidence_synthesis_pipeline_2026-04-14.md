# ADR: Temporal Event + Evidence-Backed Synthesis Upgrade

Date: 2026-04-14
Status: Proposed

## Decision summary

Tevel will upgrade its current timeline and summarization path by introducing:

1. first-class event records
2. first-class temporal facts and temporal relations
3. additive evidence-backed summary panels
4. evidence-pack retrieval boundaries for future synthesis models

This upgrade will preserve the existing `IntelligencePackage` and `TimelineEvent[]` contract while making richer internal artifacts available to the UI.

## Why this change is needed

The current system already extracts event candidates, but the pipeline collapses them too early into flat timeline rows. Summaries are still built from entities/relations/date anchors rather than from explicit evidence bundles and temporal facts. This is not sufficient for an investigative product.

## Current weaknesses being addressed

- event candidates lose structure before reaching the UI
- timeline is reconstructed from dates instead of canonical event records
- no first-class temporal uncertainty model
- no contradiction-preserving temporal layer
- no typed summary outputs with cited evidence ids

## Selected stack and license posture

### Temporal extraction / normalization

- Preferred normalization layer:
  - `Microsoft Recognizers-Text`
  - MIT license on official GitHub repo【turn2view1†L374-L387】
- Optional parser branch:
  - `Duckling`
  - license file exists in official repo and should remain optional, not core default until deployment ergonomics are validated【turn2view2†L241-L247】

Decision:

- use a Tevel-owned adapter boundary for time normalization
- start with deterministic local normalization + adapter contract
- integrate `Recognizers-Text` first because license and packaging are safer for the current stack
- keep Duckling optional behind feature flags if richer relative parsing is needed later

### Event extraction

- Preferred by request: `EventPlus`
- Practical first implementation choice: adapter boundary with current sidecar event scaffolding plus optional `OmniEvent` path

Reason:

- current codebase already produces event scaffolds in `sidecar_m2_helper.py`
- `OmniEvent` is a verifiable open-source toolkit with MIT license【turn2view0†L297-L304】【turn2view0†L544-L546】
- EventPlus was requested, but until license/repo fit is verified cleanly for this codebase, it should not be wired as core without a safe fallback

Decision:

- introduce `TemporalEventRecord` contracts now
- keep extractor modular so EventPlus or OmniEvent can plug in later without changing UI contracts

### Summarization / synthesis

- Primary summarization design:
  - evidence-pack builder first
  - structured synthesis outputs second
- Preferred model adapter:
  - `PRIMERA` for multi-document summarization where infra permits
  - license on the referenced Hugging Face model page is Apache-2.0【turn0search2†L1-L4】
- Final synthesis model option if local infra supports:
  - `Qwen2.5-32B-Instruct`
  - Apache-2.0 indicated on current model references【turn1search4†L1-L4】
  - `Mistral Small 3.1 24B`
  - Apache-2.0 per Mistral model-weights documentation【turn1search0†L1-L4】

Decision:

- do not send raw corpus text directly to summarizers
- route synthesis through compact evidence packs with cited evidence ids, related entities, related events, contradiction notes, and timeline slice metadata

### Retrieval / memory

- keep lexical retrieval today
- design contracts so `BGE-M3 + bge-reranker-v2-m3 + pgvector` can be added cleanly next
- keep graph/memory layer additive and compatible with previous repo ADR

## Target architecture for this request

### Layer 1. Event records

Add a first-class `TemporalEventRecord` artifact with:

- canonical event id
- event type
- trigger text
- arguments
- place
- raw time expression
- normalized start/end
- precision
- explicit vs inferred
- supporting evidence ids
- confidence
- uncertainty notes
- contradiction refs

### Layer 2. Temporal relations

Add `TemporalRelationRecord` with:

- relation type (`before`, `after`, `overlap`, `contains`, `ongoing`)
- explicit vs inferred
- confidence
- evidence ids

### Layer 3. Evidence-backed summary panels

Add additive summary panel artifacts for:

- case brief
- entity brief
- relationship brief
- timeline summary
- contradiction summary
- update since last review

Each panel must include:

- summary text
- key findings
- cited evidence ids
- confidence
- uncertainty notes
- contradictions
- related entities
- related events
- timeline slice used

### Layer 4. Compatibility projection

Preserve:

- `IntelligencePackage.clean_text`
- `TimelineEvent[]`
- existing dashboard tabs

But project them from richer event/synthesis artifacts rather than the reverse.

## Migration strategy

### Step 1

- add new contracts and optional fields
- keep current UI untouched

### Step 2

- project sidecar event candidates into canonical event records
- generate legacy timeline rows from canonical events

### Step 3

- build deterministic evidence-backed summary panels
- keep existing `clean_text` as compatibility summary

### Step 4

- add retrieval adapters and model-backed summarization behind feature flags

## Risks and fallback paths

### Risk: temporal normalization coverage remains partial

Fallback:

- preserve `raw_time_expression`
- mark low-confidence normalizations as approximate
- never fake exact precision

### Risk: event extraction remains shallow in the first increment

Fallback:

- keep the current cue-based event scaffolding as baseline
- improve the event contract and projection first so better extractors can slot in later

### Risk: UI overload from richer JSON

Fallback:

- keep new fields additive
- project compact summary cards and timeline slices into the current dashboard first

## Exact files intended to change first

### Existing files

- `types.ts`
- `services/analysisService.ts`
- `services/sidecar/types.ts`
- `scripts/sidecar_m2_helper.py`
- `scripts/benchmark-sidecar.ts`

### New files

- `services/sidecar/temporal/contracts.ts`
- `services/sidecar/temporal/projector.ts`
- `services/sidecar/summarization/contracts.ts`
- `services/sidecar/summarization/evidencePack.ts`
- `tests/sidecar/temporalProjection.test.ts`
- `tests/sidecar/summarizationPanels.test.ts`

## First implementation increment

Implement only:

- richer event + temporal contracts
- deterministic projection from `event_candidates` to canonical event records
- evidence-backed summary panels from existing extraction payloads
- tests proving backward compatibility and stronger structured outputs
