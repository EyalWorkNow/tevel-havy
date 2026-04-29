# Tevel - Context Engine

Tevel is a production-grade OSINT and intelligence analysis platform designed for deep entity resolution, temporal evidence synthesis, and grounded reasoning. It transforms raw, unstructured data into high-fidelity knowledge graphs with verifiable provenance.

## 🧠 Intelligence Capabilities

- **High-Recall Entity Extraction**: Multi-pass analysis that breaks documents into overlapping units to ensure no actor, location, or organization is missed.
- **Advanced Entity Resolution**: A dedicated resolution layer that handles alias clustering, canonicalization, and salience assignment, ensuring the right actors remain prominent even in dense datasets.
- **Temporal Evidence Synthesis**: Automatic timeline reconstruction from extracted statements, mapping events with exact source-chunk provenance.
- **Grounded Strategic Reasoning**: Generates tactical assessments, executive summaries, and collection gaps backed by explicit evidence snippets.
- **Hybrid Retrieval Engine**: Combines lexical, structural, and semantic search (via local Ollama embeddings) for high-precision evidence discovery.

## 🏗 Architecture

Tevel uses a hybrid architecture designed for performance and local privacy:

- **Frontend (Vite/React)**: A modern investigative workspace featuring graph visualizations (D3), spatial mapping (MapLibre), and interactive entity/timeline explorers.
- **Intelligence Sidecar**: A dedicated extraction and analysis runtime that owns document normalization, text-unit generation, and mention stitching.
- **Local LLM Stack**: Fully integrated with [Ollama](https://ollama.com/) for local, private reasoning and embeddings.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v20+ recommended)
- **Ollama**: Running locally with the following models:
  - `ollama pull qwen3.5:4b` (Recommended chat model)
  - `ollama pull embeddinggemma` (Optional, for semantic retrieval)

### Installation

1. **Clone the repository and install dependencies**:
   ```bash
   npm install
   ```

2. **Setup the Sidecar Runtime**:
   The sidecar provides GLiNER-backed extraction and advanced entity intelligence.
   ```bash
   bash scripts/setup_sidecar_runtime.sh
   export TEVEL_PYTHON_BIN="$(pwd)/.venv-sidecar/bin/python"
   ```

3. **Run the Development Server**:
   ```bash
   npm run dev
   ```

## ⚙️ Configuration

Configure your environment via `.env.local` to override default settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_MODEL` | The chat model used for synthesis | `qwen3.5:4b` |
| `OLLAMA_BASE_URL` | Local Ollama API endpoint | `http://127.0.0.1:11434` |
| `TEVEL_ENABLE_FASTCOREF` | Enable coreference resolution | `0` |
| `TEVEL_ANALYSIS_CONCURRENCY` | Parallel extraction chunks | `2` |

## 📚 Deep Dives

For detailed technical specifications, refer to the following documentation:

- **[Reasoning Architecture](file:///REASONING_ARCHITECTURE.md)**: Details on the 7-stage analysis pipeline.
- **[Architecture Report](file:///architecture_report.md)**: Deep dive into the sidecar and data persistence model.
- **[Entity Intelligence](file:///docs/entity_intelligence_architecture_2026-04-15.md)**: Specifications for the resolution and canonicalization engine.
- **[Implementation Notes](file:///implementation_notes.md)**: Current state of the PoC and upcoming milestones.

---
*Built for high-stakes intelligence analysis with local-first privacy.*
