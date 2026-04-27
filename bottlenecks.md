# Current Bottlenecks In This Repo

## Top Latency Bottlenecks

### 1. Per-chunk LLM extraction is the dominant ingest cost

- Reference: `services/intelligenceService.ts:2170-2204`
- Why it matters: every chunk becomes a separate structured generation request. Large documents scale linearly with chunk count, and overlap causes partially repeated work.
- Estimated impact of fixing: high. Replacing first-pass chunk extraction with deterministic + lightweight-model extraction should cut end-to-end ingest latency by the largest margin, especially on multi-chunk reports.

### 2. Entity refinement adds another LLM loop after chunk extraction

- Reference: `services/intelligence/entityCreation.ts:145-229`
- Why it matters: after already paying for chunk extraction, the pipeline batches grouped entities and calls the model again for canonicalization. This compounds latency on entity-dense documents, exactly where Tevel needs to scale up.
- Estimated impact of fixing: high for dense corpora. Removing this as a mandatory pass should materially reduce ingest time and variance.

### 3. Strategic synthesis is a third mandatory LLM pass before the app can persist

- Reference: `services/intelligenceService.ts:2282-2367`
- Why it matters: the UI does not get a finished package until extraction, refinement, and synthesis all complete.
- Estimated impact of fixing: medium to high. Moving synthesis to a second-stage optional/follow-up step lowers ingest-to-usable latency.

### 4. Query-time reranking performs another LLM call during analyst questioning

- Reference: `services/intelligenceService.ts:1716-1825`
- Why it matters: even after analysis is complete, the app still invokes the model for reranking evidence candidates. This adds latency to every analyst question.
- Estimated impact of fixing: medium. A deterministic shortlist plus optional lightweight rerank should noticeably improve response time.

### 5. Embedding discovery and embedding calls are done at runtime from the client

- Reference: `services/intelligenceService.ts:1606-1697`
- Why it matters: model detection and embedding work happen inside the app runtime, not in a dedicated service. This increases answer latency and keeps model orchestration in the browser bundle.
- Estimated impact of fixing: medium. Moving this to a sidecar lowers UI coupling and simplifies caching.

### 6. The browser bundle currently carries the entire extraction / retrieval stack

- Reference: `services/intelligenceService.ts` overall, plus build output from `npm run build`
- Why it matters: the production bundle is already ~998 kB minified JS, and almost all extraction logic ships to the browser even though it belongs in a local service.
- Estimated impact of fixing: medium. Bundle size and cold-start UX improve once extraction/indexing move out of the client.

## Top Quality Bottlenecks

### 1. Chunking does not preserve exact source offsets

- Reference: `services/intelligenceService.ts:365-406`
- Why it matters: `splitIntoChunks` returns `{ index, content }` only. Once text is chunked, the system loses exact char positions in the original document.
- Consequence: exact evidence highlighting, contradiction tracing, and durable provenance are impossible.
- Estimated impact of fixing: very high. This is foundational for trustworthy investigative outputs.

### 2. Entity, relation, and statement types do not carry first-class evidence records

- Reference: `types.ts:21-69`
- Why it matters: entities store `evidence?: string[]` and `source_chunks?: number[]`, while relations only have `statement_id?`. No object preserves span ids, offsets, or snippet provenance.
- Consequence: the UI can show summaries, but not exact evidence-backed records suitable for auditing or prompt grounding.
- Estimated impact of fixing: very high.

### 3. Evidence reconstruction uses regex windows instead of stored spans

- Reference: `services/intelligenceService.ts:991-1020`
- Why it matters: `extractRelevantPassages` rescans raw text and builds approximate windows around search hits.
- Consequence: evidence shown later may differ from what the extractor actually used, and overlapping aliases can produce noisy windows.
- Estimated impact of fixing: high.

### 4. Entity normalization is mention-light and alias-heavy

- Reference: `services/intelligence/entityCreation.ts:131-250`
- Why it matters: the system groups candidate strings and asks the LLM to refine them, but it does not keep durable mention ids as the normalization substrate.
- Consequence: cross-document linking and contradiction analysis become brittle because provenance lives on grouped strings, not mention records.
- Estimated impact of fixing: high.

### 5. Persistence drops most provenance during normalization

- Reference: `services/studyService.ts:262-299`
- Why it matters: the normalized save path only writes entity name/type/role/confidence and relation source/target/type/confidence.
- Consequence: even if extraction quality improves, current storage would still discard the evidence needed later.
- Estimated impact of fixing: high.

### 6. The current schema cannot express corroboration or contradiction cleanly

- Reference: `types.ts:21-69`, `types.ts:181-205`
- Why it matters: there is no evidence-reference layer where two claim or mention records can point to each other as supporting or conflicting evidence.
- Consequence: “lead”, “contradiction”, and “subtext candidate” features have to be inferred late and opaquely instead of built atop stored evidence facts.
- Estimated impact of fixing: high for analyst trust.

## File-Level Reference Summary

- `App.tsx:218-277` shows UI-triggered synchronous analysis and persistence.
- `services/intelligenceService.ts:365-406` shows chunking without offsets.
- `services/intelligenceService.ts:1242-1258` shows the generic structured LLM call wrapper.
- `services/intelligenceService.ts:1267-1845` shows runtime retrieval, embeddings, and reranking in the client.
- `services/intelligenceService.ts:2163-2367` shows the three-stage LLM-heavy analysis path.
- `services/intelligence/entityCreation.ts:74-128` shows deterministic heuristics that are currently underused and offset-free.
- `services/intelligence/entityCreation.ts:145-229` shows LLM entity refinement batches.
- `services/studyService.ts:60-79` shows JSON-first persistence.
- `services/studyService.ts:262-299` shows provenance-thin normalized writes.
- `types.ts:21-69` shows the current structured types lacking span-level provenance.

## Priority Order

1. Preserve offsets and evidence ids
2. Remove first-pass LLM chunk extraction from the primary indexing path
3. Move extraction/indexing out of the browser bundle
4. Make Postgres store evidence-bearing normalized records
5. Relegate LLM usage to fusion and analyst reasoning only
