import assert from "node:assert/strict";
import test from "node:test";

import { buildEntityIntelligenceCase } from "../../services/sidecar/entityIntelligence/service";
import {
  __resetEntityIntelligenceStoreForTests,
  getEntityCandidateDecisions,
  getEntityClaims,
  getEntityConflicts,
  getEntityIntelligenceCase,
  getEntityTimeline,
} from "../../services/sidecar/entityIntelligence/store";
import { buildEntityIntelligenceFixtureCase } from "../fixtures/entityIntelligenceFixture";

test.beforeEach(() => {
  return __resetEntityIntelligenceStoreForTests();
});

test("entity intelligence grounds mentions into evidence-backed canonical entities across documents", async () => {
  const fixture = buildEntityIntelligenceFixtureCase();
  for (const payload of fixture.payloads) {
    await buildEntityIntelligenceCase({
      caseId: fixture.caseId,
      payload,
      knowledge: null,
    });
  }

  const result = await getEntityIntelligenceCase(fixture.caseId);
  assert.ok(result);
  assert.equal(result.documents.length, 3);
  assert.ok(result.evidence_spans.length >= 8);
  assert.ok(result.mentions.every((mention) => mention.document_id && mention.evidence_span_id));

  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  assert.ok(david);
  assert.ok(david.mention_ids.length >= 5);
  assert.ok(david.aliases_json.includes("Minister Amsalem"));
  assert.ok(david.aliases_json.includes("Amsalem"));

  const yossi = result.canonical_entities.find((entity) => entity.canonical_name === "Yossi Amsalem");
  assert.ok(yossi);
  assert.notEqual(david.id, yossi.id);
});

test("entity intelligence emits reference links, candidate decisions, and abstains from silent bad merges", async () => {
  const fixture = buildEntityIntelligenceFixtureCase();
  for (const payload of fixture.payloads) {
    await buildEntityIntelligenceCase({
      caseId: fixture.caseId,
      payload,
      knowledge: null,
    });
  }

  const result = await getEntityIntelligenceCase(fixture.caseId);
  assert.ok(result);
  assert.ok(result.reference_links.some((link) => link.link_type === "title_to_person"));
  assert.ok(result.reference_links.some((link) => link.link_type === "full_name_to_short"));

  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  assert.ok(david);
  const decisions = await getEntityCandidateDecisions(david.id);
  assert.ok(decisions.length > 0);
  assert.ok(decisions.some((decision) => decision.total_score >= 0.72));

  const yossi = result.canonical_entities.find((entity) => entity.canonical_name === "Yossi Amsalem");
  assert.ok(yossi);
  assert.ok(
    !(await getEntityCandidateDecisions(yossi.id)).some(
      (decision) => decision.candidate_entity_id === david.id && decision.decision_state === "accepted",
    ),
  );
});

test("entity intelligence keeps role contradictions visible and builds entity timelines from events", async () => {
  const fixture = buildEntityIntelligenceFixtureCase();
  for (const payload of fixture.payloads) {
    await buildEntityIntelligenceCase({
      caseId: fixture.caseId,
      payload,
      knowledge: null,
    });
  }

  const result = await getEntityIntelligenceCase(fixture.caseId);
  assert.ok(result);
  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  assert.ok(david);

  const davidClaims = await getEntityClaims(david.id);
  assert.ok(davidClaims.some((claim) => claim.object_literal?.includes("Interior Minister")));
  assert.ok(davidClaims.some((claim) => claim.object_literal?.includes("Logistics Coordinator")));

  const davidConflicts = await getEntityConflicts(david.id);
  assert.ok(davidConflicts.some((conflict) => conflict.conflict_type === "contradictory_role"));

  const davidTimeline = await getEntityTimeline(david.id);
  assert.equal(davidTimeline.length, 2);
  assert.equal(davidTimeline[0].time_start, "2026-04-10");
  assert.equal(davidTimeline[1].time_start, "2026-04-12");
});

test("entity intelligence summaries remain provenance-backed and confidence-aware", async () => {
  const fixture = buildEntityIntelligenceFixtureCase();
  for (const payload of fixture.payloads) {
    await buildEntityIntelligenceCase({
      caseId: fixture.caseId,
      payload,
      knowledge: null,
    });
  }

  const result = await getEntityIntelligenceCase(fixture.caseId);
  assert.ok(result);

  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  assert.ok(david);
  const profile = result.entity_profiles[david.id];
  assert.ok(profile);
  assert.ok(profile.summary_sentences.length > 0);
  assert.ok(profile.summary_sentences.some((sentence) => sentence.backing_claim_ids.length > 0));
  assert.ok(profile.summary_sentences.some((sentence) => sentence.backing_event_ids.length > 0));
  assert.ok(["high", "medium", "low", "unresolved"].includes(profile.confidence_band));
  assert.ok(result.metrics.provenance_coverage_rate >= 1);
  assert.equal(result.metrics.unsupported_summary_rate, 0);
});
