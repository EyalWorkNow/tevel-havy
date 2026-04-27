# ADR: Reference Knowledge Backbone for Tevel

## Status
Accepted and implemented incrementally on 2026-04-15.

## Context
Tevel already had evidence-backed extraction, person/location resolution, temporal events, retrieval bundles, and UI-facing `IntelligencePackage` contracts. What it still lacked was a durable canonical knowledge backbone and a safe way to enrich entities with open reference knowledge without contaminating case evidence.

The product problem was not “find more facts anywhere.” It was:

- stabilize entity identity across cases
- add canonical IDs and alias expansion
- support external reference lookups safely
- keep provenance, confidence, and analyst trust intact

## Decision
Tevel now uses a FtM-first canonical projection layer for case entities, while keeping external knowledge in a separate `Reference Knowledge` lane.

### Backbone
- `FollowTheMoney` concepts are represented through Tevel-owned TypeScript contracts and stable FtM-style IDs.
- Canonical entities are emitted as `canonical_entities`.
- Case evidence remains primary and separate.

### External sources
- `Wikidata` is the default open reference source for cross-lingual labels, aliases, descriptions, and stable external IDs.
- `OpenAlex` is used only when research-domain cues are strong enough to avoid low-quality enrichment.
- `yente` is supported as an operator-configured watchlist / registry adapter only.
- `OpenAleph` is supported through an FtM-compatible export adapter, not as an online runtime dependency.
- `Graphiti` is an optional sink boundary behind configuration, not the online source of truth.

### Product rule
External reference facts are never silently blended into case evidence, case timelines, or primary findings.

Instead they are rendered through:
- `reference_knowledge`
- `watchlist_hits`
- `knowledge_sources`
- `reference_warnings`

## License notes
Commercially safe choices for this phase:

- Wikidata: CC0
- OpenAlex: CC0
- FollowTheMoney: MIT
- OpenAleph: MIT
- Recognizers-Text: MIT
- Duckling: BSD
- Graphiti: Apache-2.0
- GraphRAG: MIT
- yente: MIT code

Important guardrail:
- hosted OpenSanctions data is not bundled by default because its data licensing may require separate commercial terms.

## Data flow
1. Tevel extracts and resolves case entities as before.
2. Entities are projected into canonical FtM records.
3. Reference adapters enrich them with external IDs, aliases, descriptions, affiliations, and watchlist hits.
4. The enrichment result is cached and exposed via sidecar APIs.
5. Retrieval can use reference knowledge as context expansion only.
6. Summaries can expose `reference_context`, but case findings still cite uploaded evidence IDs only.

## UI impact
The analyst experience now gets:

- `Reference Knowledge` inside the entity side panel
- `Watchlist / Registry Hits` as a distinct surface
- `Reference context` inside evidence workbench panels
- `Reference links` in pipeline overview

The existing UI contracts remain backward-compatible because all new fields are additive.

## Migration strategy
- no destructive schema rewrite
- additive changes to `Entity`, `ContextCard`, and `IntelligencePackage`
- sidecar endpoints added alongside existing APIs
- retrieval and summary layers upgraded in place

## Risks and mitigations
- False positive external matches:
  mitigated by explicit confidence, match rationale, and a separate reference lane.
- Research-source overreach:
  mitigated by strong OpenAlex gating and source-specific warnings.
- Runtime dependency on public APIs:
  mitigated by local caching and optional operator-owned watchlist configuration.
- Timeline pollution:
  mitigated by keeping external assertions out of primary event/timeline generation.

