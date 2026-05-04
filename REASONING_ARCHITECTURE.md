# TEVEL Reasoning Architecture: Multi-Layer Local Intelligence

TEVEL implements a sophisticated, hybrid reasoning architecture optimized for local execution on commodity hardware (specifically Apple Silicon). It balances "Fast Extraction" (heuristic/specialized models) with "Deep Reasoning" (Large Language Models) to manage memory pressure while maintaining intelligence-grade recall.

## 1. The Multi-Layer Extraction Pipeline

### Layer 1: Fast Sidecar Extraction (Heuristic & Specialized)
- **Engine**: Python-based Sidecar utilizing **GLiNER** (Generalist Model for Named Entity Recognition).
- **Function**: Performs initial, high-speed entity and relation extraction without hitting the main LLM.
- **Benefit**: Processes large documents (up to 180,000 chars) in seconds. It identifies actors, locations, and organizations with high precision, providing the "Skeleton" for the knowledge graph.

### Layer 2: LLM Refinement & Knowledge Fusion
- **Engine**: Local LLM (default: `qwen3.5:4b`).
- **Function**: Takes the sidecar "skeleton" and performs deep semantic analysis. It canonicalizes entities, resolves aliases, identifies complex TTPs (Tactics, Techniques, and Procedures), and generates intelligence tasks.
- **Deduplication**: Strategic synthesis passes ensure that evidence from multiple chunks is merged into a unified intelligence package.

---

## 2. Live Research: The FCF-R3 Pipeline

When a user asks a question in the "Live Research Studio," TEVEL does not dump the entire corpus into the LLM. Instead, it uses the **FCF-R3 (Fast Context Fusion & Retrieval-Reasoning-Read)** pipeline:

1. **Context Distillation**: Heuristically identifies the most relevant snippets from the knowledge graph and raw text.
2. **Context Packaging**: Merges knowledge snapshots (entities/relations) with retrieval artifacts.
3. **Semantic Cropping**: Limits input to a strictly controlled window (default: ~2048-3200 tokens) to prevent system-wide memory swapping on 16GB RAM devices.
4. **Deterministic Fallback**: If the local LLM times out or is unreachable, the system generates a deterministic answer directly from the evidence cards, ensuring "zero-dark" operations.

---

## 3. Operational Optimization for Local Silicon (M1/M2/M3)

To maintain stability on 16GB RAM machines, the following constraints are enforced:

- **Model Selection**: `qwen3.5:4b` is the balanced default.
- **Memory Guardrails**:
    - `num_ctx: 2048`: Prevents KV-cache from expanding into disk-swap territory.
    - `think: false`: Disables internal hidden reasoning tokens to maximize visible output speed.
    - `repeat_penalty: 1.15`: Mitigates the "looping hallucination" common in small models during complex multi-lingual analysis.
- **Sidecar Parallelism**: Document ingestion uses a `TEVEL_ANALYSIS_CONCURRENCY` (default: 2) to prevent CPU starvation while the LLM is loading.

---

## 4. Performance Benchmarks (Mac M1 16GB)

| Metric | Sidecar (Fast Layer) | LLM (Deep Layer - 4B) |
| :--- | :--- | :--- |
| **Speed (Tokens/s)** | ~400-600 tok/s | ~15-28 tok/s |
| **RAM Footprint** | ~1.5 GB | ~3.8 GB - 5.5 GB |
| **Latency (Inquiry)** | N/A | < 1s initial / 15s avg response |
| **Max Context** | 180,000+ chars | 2,048 tokens |

### Scaling Efficiency
- **Ingestion**: A 20,000-token document is indexed in < 15 seconds via the Sidecar.
- **Chat**: Complex reasoning over a 50-document study set completes in < 25 seconds by utilizing R3 context pruning.

---

## 5. Deployment Guide

### Recommended Models (Ollama)
- **Primary Reasoning**: `qwen3.5:4b`
- **Fast Reasoning (RAM constrained)**: `qwen2.5:1.5b`
- **Embeddings**: `embeddinggemma:latest`

### Key Environment Variables
- `OLLAMA_MODEL`: Target chat model.
- `TEVEL_ANALYSIS_CONCURRENCY`: Number of parallel sidecar tasks.
- `TEVEL_RETRIEVAL_TOP_K`: Number of evidence hits used in R3 synthesis.
