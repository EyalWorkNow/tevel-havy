# Recommended Stack For This Repo

This recommendation is grounded in two realities of the current repository:

- the product today is a browser-first Vite/React app with Supabase persistence, not a backend-heavy platform
- the target architecture needs private local processing, exact evidence spans, and a fast first-pass extractor

## Recommended Core Stack

| Area | Recommendation | Milestone | Why it fits this repo | License / runtime / multilingual notes |
| --- | --- | --- | --- | --- |
| Sidecar host | Python sidecar service with a thin HTTP API | M2 | The strongest candidate parsing and IE tools converge on Python. Keeping the UI in TS while moving heavy extraction to a Python sidecar is the lowest-risk incremental path. | FastAPI/Uvicorn are a practical fit for local service hosting. Keep the current TS app as the client. |
| Parsing: rich docs | Docling | M2 | Best fit for hybrid corpora with PDFs, office docs, HTML, and layout-aware normalization. Better fit than browser-only ingestion. | Apache-2.0. Use for PDFs/DOCX/PPTX/HTML where structure matters. |
| Parsing: web pages / links | Trafilatura | M2 | `IngestionPanel` already accepts links. Trafilatura is lighter and cleaner than a heavier general parser when the source is web text. | Apache-2.0. Strong for HTML/article extraction; preserve UTF-8 text well. |
| Rule / gazetteer extraction | spaCy `EntityRuler` + `PhraseMatcher` + `Matcher` | M2 | Best ecosystem, mature matchers, good integration path with later `fastcoref`, and better maintainability than ad hoc regex growth. | MIT. Supports 70+ languages at the pipeline/tokenization level; rules are fully under our control. |
| High-volume exact dictionary matching | `pyahocorasick` | M2 | Better fit than keeping all gazetteers in regexes once watchlists, aliases, and location lists grow. | BSD-3-Clause. Very fast exact multi-pattern search; ideal for watchlists and aliases. |
| Lightweight model extraction | GLiNER multi-v2.1 | M2 | Best first practical model choice because this repo already contains mixed Hebrew/English data and needs multilingual recall without LLM calls. | Apache-2.0 model card. Multilingual. Use for mention span proposals, not final reasoning. |
| Coreference / mention stitching | fastcoref | M3 | Useful after exact spans exist, but not required for the first migration slice. | MIT. Works with char-index clusters; use selectively because multilingual quality is weaker than English. |
| Canonical store | Postgres in Supabase | M1-M3 | The repo already uses Supabase and the user explicitly prefers Postgres as the source of truth. | Existing system of record. Add normalized provenance tables instead of replacing it. |
| Dense retrieval store | Qdrant, optional | M3 | Add only if Postgres + lexical retrieval is not enough. Qdrant is the best later option when dense retrieval becomes necessary. | Apache-2.0. Good hybrid dense/sparse story; keep non-canonical. |
| Lexical search engine | Postgres FTS first, Tantivy later if needed | M2-M3 | Start with what the repo already has access to. Add Tantivy only if exact analyst evidence search becomes a measurable bottleneck. | Tantivy is MIT and strong, but do not add another storage/index system before proving need. |
| Inference acceleration | ONNX Runtime + Optimum | M3 | Best fit for taking span extraction models out of raw PyTorch when CPU latency matters. | ONNX Runtime is MIT; Optimum is Apache-2.0. Use after baseline correctness is proven. |
| Reasoning LLM serving | vLLM, optional | M3+ | Good fit only for second-stage reasoning/fusion, not for first-pass extraction. | Apache-2.0. Useful when local reasoning throughput becomes the bottleneck. |
| Offline analytics | DuckDB Postgres extension | M2 | Excellent for benchmark and regression analysis against the live Postgres corpus without building a separate analytics backend. | MIT. Great for local benchmark notebooks and batch evaluation. |
| Optional reranking | Sentence Transformers `CrossEncoder` | M3 | Best first reranker when retrieval quality needs improvement. Simpler and more incremental than jumping straight to ColBERT. | Apache-2.0. Use only after deterministic shortlist creation. |

## Why These Choices

### Docling over Unstructured OSS for the primary rich-document path

- Docling is the better fit when exact document structure matters and the goal is not just “text out” but “stable normalized representation for downstream extraction”.
- Unstructured OSS is powerful, but it brings a broader abstraction surface than this repo needs for the first real sidecar cut.

### Trafilatura alongside Docling, not instead of it

- Tevel needs hybrid corpora, not just PDFs.
- `components/IngestionPanel.tsx` already captures external links, so a dedicated web-text path is justified.
- Trafilatura is light enough to use for link ingestion without forcing every HTML page through the heavier parser path.

### spaCy + `pyahocorasick` over `flashtext2`

- spaCy matchers are the maintainable center of gravity for rules, entity labels, and later pipeline integration.
- `pyahocorasick` cleanly handles high-volume exact alias/watchlist matching.
- `flashtext2` does not add enough over that combination to justify becoming a core dependency in this repo.

### GLiNER multi-v2.1 over SpanMarker as the first model extractor

- This repo already mixes Hebrew and English examples, so multilingual support matters immediately.
- GLiNER multi-v2.1 gives flexible label-driven extraction without repeated LLM prompting.
- SpanMarker is strong for trained NER pipelines, but it is not the best zero-shot-first fit for this migration.

### Qdrant later, not now

- The current repo already uses Supabase/Postgres.
- Introducing Qdrant in Milestone 1 would create a second persistence/search system before the canonical evidence model exists.
- Qdrant becomes justified once dense retrieval is proven necessary over real corpora.

### Tantivy later, not now

- Exact lexical evidence search is important for analysts.
- But first prove the normalized evidence tables and Postgres retrieval contract.
- Tantivy is a good later upgrade if Postgres FTS and trigram search miss latency or quality targets.

### vLLM only for stage-two reasoning

- The user explicitly locked in that the LLM becomes a second-stage reasoning/fusion layer.
- vLLM is excellent for high-throughput reasoning serving, but it should not pull the system back into LLM-first extraction.

## Alternatives Evaluated And Rejected For Early Milestones

| Candidate | Decision | Why not first |
| --- | --- | --- |
| Unstructured OSS | Defer | Good parser, but heavier and less targeted than a Docling + Trafilatura split for this repo’s first real sidecar move. |
| `flashtext2` | Reject for core path | Lower leverage than spaCy + `pyahocorasick`; adds another matching abstraction without improving the long-term pipeline shape. |
| GLiNER2 | Evaluation lane only | Very promising because it can do entities and relations in one framework, but the repo’s immediate need is multilingual mention extraction with stable evidence. Start with GLiNER multi-v2.1, then test GLiNER2 against real corpora. |
| SpanMarker | Later / domain fine-tuning only | Better as a trained specialist model than as the first general extraction replacement. |
| GLinker | Later only | Interesting, but currently alpha and designed for a heavier multi-layer linking stack than this repo should adopt in the first migration. |
| LanceDB | Reject for canonical retrieval path | Would duplicate storage concerns away from the existing Postgres/Supabase core and is harder to justify incrementally here than Qdrant later. |
| Microsoft GraphRAG | Reject for M1-M2 | Too framework-heavy and too LLM-centric for the user’s stated constraints. |
| fast-graphrag | Reject for M1-M2 | Same problem in smaller form: useful ideas, wrong first move. |
| Apache AGE | Reject for M1 | The user explicitly asked not to start with a graph database when edge tables are enough. AGE is interesting later only if graph queries become truly dominant. |
| FlagEmbedding | Later | Strong retrieval tooling, but not necessary before basic deterministic + dense retrieval is benchmarked. |
| ColBERT | Later | Powerful, but operationally heavier than Tevel needs for the first practical retrieval upgrade. |

## Milestone Mapping

### Milestone 1

- Keep Postgres as canonical
- Introduce sidecar contracts
- Add deterministic text units with offsets
- Add rule-based mention extraction with evidence spans
- Add benchmark scaffolding

### Milestone 2

- Stand up the actual local sidecar service
- Add Docling + Trafilatura ingestion
- Add spaCy rules and `pyahocorasick` gazetteers
- Write normalized provenance tables
- Add lexical retrieval over evidence-bearing text units

### Milestone 3

- Add GLiNER multi-v2.1
- Evaluate ONNX Runtime / Optimum acceleration
- Add fastcoref where useful
- Add optional Qdrant dense retrieval
- Add optional CrossEncoder reranking

### Later

- Evaluate GLiNER2 relation extraction
- Evaluate GLinker for KB-backed linking workflows
- Add Tantivy only if lexical retrieval becomes a proven bottleneck
- Add vLLM for high-throughput reasoning serving only

## Repo-Specific Recommendation

The practical stack for this repository is:

1. Keep the React app and current `StudyService` compatibility layer.
2. Build a local sidecar next to it, not inside it.
3. Make Postgres the canonical evidence store.
4. Use deterministic and lightweight extraction first.
5. Let the smaller LLM operate only on curated evidence packs after retrieval.
