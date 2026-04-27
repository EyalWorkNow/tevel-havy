import { performance } from "node:perf_hooks";

import { buildEntityIntelligenceCase } from "../services/sidecar/entityIntelligence/service";
import { __resetEntityIntelligenceStoreForTests } from "../services/sidecar/entityIntelligence/store";
import { buildEntityIntelligenceFixtureCase } from "../tests/fixtures/entityIntelligenceFixture";

const fixture = buildEntityIntelligenceFixtureCase();

await __resetEntityIntelligenceStoreForTests();

const startedAt = performance.now();
let lastResult = null as Awaited<ReturnType<typeof buildEntityIntelligenceCase>> | null;

for (const payload of fixture.payloads) {
  lastResult = await buildEntityIntelligenceCase({
    caseId: fixture.caseId,
    payload,
    knowledge: null,
  });
}

const totalMs = performance.now() - startedAt;
const result = lastResult?.result;

console.log(
  JSON.stringify(
    {
      case_id: fixture.caseId,
      total_ms: Number(totalMs.toFixed(2)),
      document_count: result?.documents.length || 0,
      canonical_entity_count: result?.canonical_entities.length || 0,
      ambiguous_mention_count: result?.metrics.ambiguous_mention_count || 0,
      claim_count: result?.claims.length || 0,
      relationship_count: result?.relationships.length || 0,
      event_count: result?.events.length || 0,
      conflict_count: result?.conflicts.length || 0,
      provenance_coverage_rate: result?.metrics.provenance_coverage_rate || 0,
      unsupported_summary_rate: result?.metrics.unsupported_summary_rate || 0,
    },
    null,
    2,
  ),
);
