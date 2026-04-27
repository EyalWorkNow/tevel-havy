<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1E6IfU5uiFIGEp-wRry1WjPhAsF0J0lCa

## Run Locally

**Prerequisites:** Node.js, and a local [Ollama](https://ollama.com/) instance with a pulled model.


1. Install dependencies:
   `npm install`
2. Make sure Ollama is running locally, for example:
   `ollama serve`
3. Make sure the default model exists locally:
   `ollama pull gemma4:e4b`
4. Optional but recommended for stronger retrieval and cross-linking:
   `ollama pull embeddinggemma`
4.1 Optional but strongly recommended for grounded sidecar extraction:
   `bash scripts/setup_sidecar_runtime.sh`
   `export TEVEL_PYTHON_BIN="$(pwd)/.venv-sidecar/bin/python"`
5. Optional: create `.env.local` to override the defaults:
   `OLLAMA_MODEL=gemma4:e4b`
   `OLLAMA_BASE_URL=http://127.0.0.1:11434`
   `OLLAMA_EMBED_MODEL=embeddinggemma`
   `TEVEL_ENABLE_FASTCOREF=1`
   `TEVEL_RELIK_API_URL=http://127.0.0.1:8000`
   `TEVEL_ANALYSIS_CONCURRENCY=2`
   `TEVEL_ENTITY_BATCH_SIZE=24`
   `TEVEL_RETRIEVAL_TOP_K=10`
6. Run the app:
   `npm run dev`
7. Validate the local reasoning stack:
   `npm run diagnose:ollama`

By default the app talks to `http://127.0.0.1:11434` and uses `gemma4:e4b`.
If an embeddings model such as `embeddinggemma` is available locally, the app automatically upgrades to hybrid lexical + semantic retrieval for better reasoning over links and evidence.
Large documents automatically use tighter chunking, adaptive evidence budgets, and controlled parallel extraction to keep recall high without overloading the local machine.
If the sidecar Python runtime is installed, the app upgrades its extraction path with GLiNER-backed entity extraction by default. Optional fastcoref mention expansion can be enabled with `TEVEL_ENABLE_FASTCOREF=1` for shorter, higher-latency reviews, and optional ReLiK relation extraction runs through a separately hosted ReLiK API (`TEVEL_RELIK_API_URL`), which keeps the local Python runtime free of incompatible `transformers` constraints.

## Intelligence architecture highlights

- No hard cap on extracted entities
- Dedicated entity resolution layer with alias clustering, canonicalization, source-chunk provenance, and evidence snippets
- Refined relations and statement-to-entity remapping before strategic synthesis
- Runtime hybrid retrieval over chunks, entities, relations, statements, communities, and timeline evidence
- Adaptive chunk sizing and controlled local concurrency for large-document extraction
- Relation-aware entity salience so graph hubs surface correctly even when the alias space is large
