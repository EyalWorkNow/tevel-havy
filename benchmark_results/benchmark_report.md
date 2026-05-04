# TEVEL FCF/Gemini Benchmark Report

Generated: 2026-04-30T07:50:45.519Z

## Query Tested

Find all entity-contexts for Turkey in this corpus. Cover command/control, explicit Turkish agencies, Hamas-Turkey communications, finance, technology/equipment, logistics, proxy geography, human operators, communications, doctrine/tactics, TIKA indicators, SADAT/EEI, and limiting or alternative-actor evidence. Start with synthesis, cite evidence IDs, distinguish confirmed facts from indirect indicators and hypotheses, and state what it means.

## Execution

- Command: `npm run bench:tevel-gemini`
- Runs per mode: 3
- Gemini model: gemini-2.5-flash
- GEMINI_API_KEY present: yes
- Corpus: local repeatable benchmark fixture with command/control, communications, finance, technology/logistics, TIKA indirect indicator, SADAT EEI, proxy geography, and limiting evidence.

## Modes

- `gemini_with_fcf`: Gemini receives the FCF-R3 materialized read path, selected evidence audit, and analytical generation instructions.
- `gemini_without_fcf`: Gemini receives the same corpus as a direct raw-context dump, without FCF retrieval, clustering, evidence typing, or audit metadata.
- `tevel_architecture`: TEVEL runs askLiveResearchQuestion end-to-end: study scoping, FCF-R3 read path, model call, citation verification, and deterministic fallback when the model path fails.

## Summary

| Mode | Runs | Successes | Skipped | Success Rate | Avg Duration ms | Avg Prompt Tokens | Avg Total Tokens | Avg Quality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gemini_with_fcf | 3 | 1 | 0 | 33% | 4925 | 1003 | 3809 | 6/7 |
| gemini_without_fcf | 3 | 1 | 0 | 33% | 6350 | 871 | 4856 | 6/7 |
| tevel_architecture | 3 | 3 | 0 | 100% | 478 | n/a | n/a | 7/7 |

## Per-Run Results

| Mode | Iteration | Success | Skipped | Duration ms | Quality | Error |
| --- | ---: | --- | --- | ---: | ---: | --- |
| gemini_with_fcf | 1 | yes | no | 13971 | 6/7 |  |
| gemini_with_fcf | 2 | no | no | 412 | 0/7 | Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","sta |
| gemini_with_fcf | 3 | no | no | 393 | 0/7 | Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","sta |
| gemini_without_fcf | 1 | no | no | 398 | 0/7 | Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","sta |
| gemini_without_fcf | 2 | no | no | 455 | 0/7 | Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","sta |
| gemini_without_fcf | 3 | yes | no | 18196 | 6/7 |  |
| tevel_architecture | 1 | yes | no | 550 | 7/7 |  |
| tevel_architecture | 2 | yes | no | 435 | 7/7 |  |
| tevel_architecture | 3 | yes | no | 449 | 7/7 |  |

## Quality Comparison

The quality score is a deterministic inspection heuristic for this fixture. It checks whether the answer covers direct command/control, direct communication, finance, cautious TIKA wording, SADAT as EEI/hypothesis, citations/evidence IDs, and bottom-line meaning.

### gemini_with_fcf
- Mode: Gemini receives the FCF-R3 materialized read path, selected evidence audit, and analytical generation instructions.
- Best quality score: 6/7
- Main gaps: No visible evidence IDs/citations were detected.
- Representative answer excerpt:

> **Executive Synthesis:** Turkey is directly implicated in several facets of support and interaction with the Gaza logistics cell and Hamas external liaison, ranging from operational oversight and financial transactions to the provision of technology and logistical pathways. Confirmed evidence indicates a Turkish intelligence (MIT) handler in Ankara approved a Hamas meeting agenda, a Turkish operator managed a crypto wallet used for transfers to the Gaza logistics cell, and Turkish-made drone components were procured. Istanbul serves as a confirmed proxy geography for non-military cargo movement. Communications between Hamas and a Turkish contact are also confirmed. Indirect indicators sugges...

### gemini_without_fcf
- Mode: Gemini receives the same corpus as a direct raw-context dump, without FCF retrieval, clustering, evidence typing, or audit metadata.
- Best quality score: 6/7
- Main gaps: No visible evidence IDs/citations were detected.
- Representative answer excerpt:

> Turkey demonstrates confirmed involvement in command/control, communications, finance, and logistics supporting the Gaza logistics cell, primarily through state and non-state actors. This includes direct approval of Hamas operational planning by a Turkish state agency, financial transfers by a Turkish operator, and the use of Istanbul as a logistical hub. While direct weapons procurement by the identified Turkish contact is explicitly excluded, indicators suggest potential Turkish origins for operational doctrine and the presence of a Turkish state agency (TIKA) at a logistics site, though its direct involvement in supporting the cell is unconfirmed. An intelligence requirement exists regard...

### tevel_architecture
- Mode: TEVEL runs askLiveResearchQuestion end-to-end: study scoping, FCF-R3 read path, model call, citation verification, and deterministic fallback when the model path fails.
- Best quality score: 7/7
- Main gaps: No heuristic gaps detected.
- Representative answer excerpt:

> FCF-R3 status: current-supported Executive synthesis: Coverage validation found broad coverage of selected evidence contexts: Finance, Operational control, Doctrine / tactics, Technology / equipment, Communications, Boundary / alternative actor, Logistics. Coverage checklist: no strong evidence was found for Strategic command, Institutional actors, Proxy / geography, Human operators. Core meaning: the entity functions as a command/control axis, finance node, communications coordination node, technology/equipment axis, proxy/geography context in the case. This is supported by diverse direct clusters, led by Finance: crypto wallet TR-884 / Gaza logistics cell. [fcf_insight_8_881bcd17] [fcf_ins...

## Failures and Warnings

- gemini_with_fcf run 1: ["Second-pass retrieval added evidence for missing entity-context types."]
- gemini_with_fcf run 2: Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"description":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field."}]}]}}
- gemini_with_fcf run 3: Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"description":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field."}]}]}}
- gemini_without_fcf run 1: Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"description":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field."}]}]}}
- gemini_without_fcf run 2: Gemini HTTP 400: {"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"description":"Invalid JSON payload received. Unknown name \"systemInstruction\": Cannot find field."}]}]}}
- tevel_architecture run 1: ["Citation-ready retrieval artifacts are unavailable for the selected scope.","Second-pass retrieval added evidence for missing entity-context types.","Comms offline: unable to reach the cloud reasoning engine."]
- tevel_architecture run 2: ["Citation-ready retrieval artifacts are unavailable for the selected scope.","Second-pass retrieval added evidence for missing entity-context types.","Comms offline: unable to reach the cloud reasoning engine."]
- tevel_architecture run 3: ["Citation-ready retrieval artifacts are unavailable for the selected scope.","Second-pass retrieval added evidence for missing entity-context types.","Comms offline: unable to reach the cloud reasoning engine."]

## Conclusions and Recommendation

Recommended mode: tevel_architecture. It produced the strongest observed quality/token tradeoff in this run; review raw_results.json for full-answer inspection before treating the result as statistically stable.

## Rerun Instructions

1. Set a Gemini key when cloud modes are required: `export GEMINI_API_KEY=...`
2. Optional: set `GEMINI_MODEL=gemini-2.5-flash` and `BENCHMARK_RUNS=3`.
3. Rerun with one command: `npm run bench:tevel-gemini`

Full answers, token metadata when available, FCF audit details, TEVEL engine traces, and warnings are stored in `benchmark_results/raw_results.json`.
