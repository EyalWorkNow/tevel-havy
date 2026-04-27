# TEVEL Reasoning Architecture

This project now uses a multi-layer local reasoning stack designed for high-recall entity extraction, stronger cross-linking, and better insight generation.

## Core pipeline

1. Chunked extraction
   The source document is split into overlapping chunks and each chunk is analyzed independently for entities, relations, insights, timeline events, and structured statements. Large documents automatically switch to tighter chunking for better recall.

2. Fusion layer
   Chunk outputs are merged with relation deduplication, statement aggregation, and graph metrics as a first-pass knowledge graph.

3. Entity resolution and refinement
   A dedicated entity creation engine combines raw chunk entities, deterministic signals from the source text, alias clustering, source-chunk provenance, and evidence snippets. A second structured pass canonicalizes names, preserves aliases, assigns salience, and remaps relations and statements to the final entity set. Relation-aware salience boosts hub entities so the graph keeps the right actors prominent even in dense documents.

4. Strategic synthesis
   A second synthesis pass turns the refined graph into executive summary, tactical assessment, collection gaps, intelligence questions, and tasks.

5. Runtime reasoning index
   At query time, the app builds contextual chunks, graph communities, entity evidence nodes, relation edges, statements, insights, and timeline evidence for hybrid retrieval.

6. Hybrid retrieval
   Evidence is scored lexically, structurally, and semantically when a local Ollama embeddings model is available. Query-linked entity boosts and graph-aware backfill keep relevant evidence discoverable even when explicit keyword overlap is weak.

7. Reranking
   Top evidence candidates are reranked by the local chat model before answering.

## Design goals

- No fixed cap on extracted entities
- Canonical entities with alias memory, provenance, evidence, and salience
- Better multi-hop linking between entities, relations, and communities
- Better answer grounding for chat, briefs, and cross-study fusion
- Graceful fallback when embeddings are not installed locally
- Controlled parallel extraction tuned for local Ollama deployments

## Recommended local models

- Chat / reasoning: `gemma4:e4b`
- Embeddings: `embeddinggemma`

## Optional environment variables

- `OLLAMA_MODEL`
- `OLLAMA_BASE_URL`
- `OLLAMA_EMBED_MODEL`
- `TEVEL_ANALYSIS_CONCURRENCY`
- `TEVEL_ENTITY_BATCH_SIZE`
- `TEVEL_RETRIEVAL_TOP_K`
