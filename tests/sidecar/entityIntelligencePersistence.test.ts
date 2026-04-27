import assert from "node:assert/strict";
import test from "node:test";

import { buildEntityIntelligenceCase, regenerateEntitySummary } from "../../services/sidecar/entityIntelligence/service";
import {
  __resetEntityIntelligenceStoreForTests,
  getAmbiguousMentions,
  getCaseEntityGraph,
  getEntityById,
  getEntityClaims,
  getEntityConflicts,
  getEntityIntelligenceCase,
  getEntityMentions,
  getEntityRelations,
  getEntitySummary,
  mergeEntityRecords,
  splitEntityRecord,
} from "../../services/sidecar/entityIntelligence/store";
import { buildEntityIntelligenceFixtureCase } from "../fixtures/entityIntelligenceFixture";

const buildFixtureCase = async () => {
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
  return { fixture, result };
};

test.beforeEach(() => __resetEntityIntelligenceStoreForTests());

test("entity intelligence persistence roundtrips through repository read models", async () => {
  const { fixture, result } = await buildFixtureCase();
  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  assert.ok(david);

  const entity = await getEntityById(david.id);
  const mentions = await getEntityMentions(david.id);
  const claims = await getEntityClaims(david.id);
  const relations = await getEntityRelations(david.id);
  const summary = await getEntitySummary(david.id);
  const graph = await getCaseEntityGraph(fixture.caseId);
  const ambiguous = await getAmbiguousMentions(fixture.caseId);

  assert.ok(entity);
  assert.ok(mentions.length >= 5);
  assert.ok(claims.length >= 2);
  assert.ok(relations.length >= 1);
  assert.ok(summary);
  assert.ok(summary.summary_sentences.every((sentence) =>
    sentence.backing_claim_ids.length > 0 ||
    sentence.backing_event_ids.length > 0 ||
    sentence.backing_relation_ids.length > 0,
  ));
  assert.ok(graph);
  assert.equal(graph.entities.length, result.canonical_entities.length);
  assert.equal(Array.isArray(ambiguous), true);
});

test("entity intelligence reruns are idempotent for the same case payload", async () => {
  const { fixture, result: firstResult } = await buildFixtureCase();

  for (const payload of fixture.payloads) {
    await buildEntityIntelligenceCase({
      caseId: fixture.caseId,
      payload,
      knowledge: null,
    });
  }

  const secondResult = await getEntityIntelligenceCase(fixture.caseId);
  assert.ok(secondResult);
  assert.equal(secondResult.documents.length, firstResult.documents.length);
  assert.equal(secondResult.mentions.length, firstResult.mentions.length);
  assert.equal(secondResult.claims.length, firstResult.claims.length);
  assert.equal(secondResult.relationships.length, firstResult.relationships.length);
  assert.equal(secondResult.events.length, firstResult.events.length);
  assert.equal(secondResult.conflicts.length, firstResult.conflicts.length);
});

test("merge and split actions preserve referential integrity and audit history", async () => {
  const { fixture, result } = await buildFixtureCase();
  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  const yossi = result.canonical_entities.find((entity) => entity.canonical_name === "Yossi Amsalem");
  assert.ok(david);
  assert.ok(yossi);

  const merged = await mergeEntityRecords(fixture.caseId, david.id, yossi.id, "tester");
  assert.ok(merged);
  assert.ok(!merged.canonical_entities.some((entity) => entity.id === yossi.id));
  assert.ok(merged.claims.every((claim) => claim.subject_entity_id !== yossi.id && claim.object_entity_id !== yossi.id));
  assert.ok(merged.relationships.every((relation) => relation.source_entity_id !== yossi.id && relation.target_entity_id !== yossi.id));
  assert.ok(merged.event_participants.every((participant) => participant.entity_id !== yossi.id));
  assert.ok(merged.review_actions.some((action) => action.action === "merge_entities"));

  const split = await splitEntityRecord(fixture.caseId, david.id, david.mention_ids.slice(0, 2), "tester");
  assert.ok(split);
  const updatedDavid = split.canonical_entities.find((entity) => entity.id === david.id);
  assert.ok(updatedDavid);
  assert.equal(updatedDavid.review_state, "needs_split_review");
  assert.ok(split.review_actions.some((action) => action.action === "split_entity"));
});

test("summary provenance and conflict signals remain persisted after regeneration", async () => {
  const { fixture, result } = await buildFixtureCase();
  const david = result.canonical_entities.find((entity) => entity.canonical_name === "David Amsalem");
  assert.ok(david);

  const regenerated = await regenerateEntitySummary(fixture.caseId, david.id);
  assert.ok(regenerated);
  const summary = await getEntitySummary(david.id);
  const conflicts = await getEntityConflicts(david.id);

  assert.ok(summary);
  assert.ok(summary.summary_sentences.length > 0);
  assert.ok(summary.summary_sentences.every((sentence) =>
    sentence.backing_claim_ids.length > 0 ||
    sentence.backing_event_ids.length > 0 ||
    sentence.backing_relation_ids.length > 0,
  ));
  assert.ok(conflicts.some((conflict) => conflict.conflict_type === "contradictory_role"));
});
