# Entity Intelligence Dev Guide

## Entry Points

- `services/sidecar/entityIntelligence/service.ts`
  - case-level orchestration
- `services/sidecar/entityIntelligence/store.ts`
  - in-memory case persistence and read APIs
- `vite.sidecar.ts`
  - local API bridge
- `services/analysisService.ts`
  - attaches `entity_intelligence` to `IntelligencePackage`

## Main Runtime Contract

`buildEntityIntelligenceCase({ caseId, payload, knowledge })`

Input:
- grounded `SidecarExtractionPayload`
- optional reference knowledge result

Output:
- normalized case-level entity graph artifacts
- entity profiles
- review queues
- metrics
- debug reports

## What Is Source Of Truth

- Case evidence remains the primary truth path.
- External knowledge stays in the separate `reference_knowledge` lane.
- Entity summaries are generated only from structured claims, events, and relationships.

## Useful APIs

- `POST /documents/:id/extract-mentions`
- `POST /api/resolution/run`
- `GET /api/cases/:id/entity-intelligence`
- `GET /api/entities/:id`
- `GET /api/entities/:id/timeline`
- `GET /api/entities/:id/claims`
- `GET /api/entities/:id/conflicts`
- `GET /api/entities/:id/candidate-decisions`
- `GET /api/entities/:id/debug-report`
- `POST /api/entities/:id/merge`
- `POST /api/entities/:id/split`
- `POST /api/entities/:id/regenerate-summary`

## Benchmarks And Tests

- `npm run test:sidecar`
- `npm run build`
- `npm run bench:entity-intelligence`

## Current Pragmatic Limits

- Store is in-memory in this repo; SQL migration is included for Postgres deployment.
- Background jobs are synchronous/idempotent records, not a live Redis worker queue.
- Mention extraction quality still depends on the existing smart sidecar extraction layer.
