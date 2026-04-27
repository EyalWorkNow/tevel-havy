import test from "node:test";
import assert from "node:assert/strict";

import { buildTemporalEventRecords, buildTemporalRelations, projectTimelineEvents } from "../../services/sidecar/temporal/projector";
import { normalizeTemporalExpression } from "../../services/sidecar/temporal/normalizer";
import { buildSummaryPanelsFromPayload } from "../../services/sidecar/summarization/evidencePack";
import type { SidecarExtractionPayload } from "../../services/sidecar/types";

const buildPayload = (): SidecarExtractionPayload => ({
  source_doc_id: "doc-1",
  raw_text: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod. On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
  normalized_text: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod. On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
  generated_at: "2026-04-14T00:00:00.000Z",
  pipeline_version: "test",
  normalization_steps: [],
  text_units: [],
  candidates: [],
  mentions: [],
  entities: [
    {
      entity_id: "person-1",
      source_doc_id: "doc-1",
      canonical_name: "Maya Cohen",
      normalized_name: "maya cohen",
      entity_type: "PERSON",
      aliases: [],
      mention_ids: [],
      source_text_unit_ids: ["tu-1"],
      extraction_sources: ["model"],
      confidence: 0.92,
      timestamps: [],
      corroborating_mention_ids: [],
      contradicting_entity_ids: [],
    },
    {
      entity_id: "org-1",
      source_doc_id: "doc-1",
      canonical_name: "Orion Logistics",
      normalized_name: "orion logistics",
      entity_type: "ORGANIZATION",
      aliases: [],
      mention_ids: [],
      source_text_unit_ids: ["tu-1"],
      extraction_sources: ["model"],
      confidence: 0.91,
      timestamps: [],
      corroborating_mention_ids: [],
      contradicting_entity_ids: [],
    },
  ],
  relation_candidates: [],
  claim_candidates: [],
  event_candidates: [
    {
      event_id: "event-1",
      source_doc_id: "doc-1",
      source_text_unit_id: "tu-1",
      event_type: "MEETING_EVENT",
      trigger_text: "met",
      trigger_normalized_text: "met",
      actor_entity_ids: ["person-1"],
      actor_mention_ids: [],
      target_entity_ids: ["org-1"],
      target_mention_ids: [],
      location_entity_ids: [],
      location_mention_ids: [],
      normalized_text: "Maya Cohen met Orion Logistics in Ashdod.",
      extraction_source: "model",
      confidence: 0.81,
      evidence: {
        evidence_id: "ev-1",
        source_doc_id: "doc-1",
        source_text_unit_id: "tu-1",
        start: 0,
        end: 44,
        normalized_start: 0,
        normalized_end: 44,
        raw_start: 0,
        raw_end: 44,
        raw_supporting_snippet: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod.",
        normalized_supporting_snippet: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod.",
        normalized_text: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod.",
        extraction_source: "model",
        confidence: 0.81,
      },
      metadata: {},
      timestamp: "2026-04-10",
    },
    {
      event_id: "event-2",
      source_doc_id: "doc-1",
      source_text_unit_id: "tu-2",
      event_type: "MEETING_EVENT",
      trigger_text: "met",
      trigger_normalized_text: "met",
      actor_entity_ids: ["person-1"],
      actor_mention_ids: [],
      target_entity_ids: ["org-1"],
      target_mention_ids: [],
      location_entity_ids: [],
      location_mention_ids: [],
      normalized_text: "Maya Cohen met Orion Logistics in Ashdod again.",
      extraction_source: "model",
      confidence: 0.83,
      evidence: {
        evidence_id: "ev-2",
        source_doc_id: "doc-1",
        source_text_unit_id: "tu-2",
        start: 45,
        end: 97,
        normalized_start: 45,
        normalized_end: 97,
        raw_start: 45,
        raw_end: 97,
        raw_supporting_snippet: "On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
        normalized_supporting_snippet: "On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
        normalized_text: "On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
        extraction_source: "model",
        confidence: 0.83,
      },
      metadata: {},
      timestamp: "12/04/2026",
    },
  ],
  stats: {
    doc_char_length: 120,
    text_unit_count: 2,
    candidate_count: 0,
    mention_count: 0,
    entity_count: 2,
    relation_count: 0,
    event_count: 2,
    claim_count: 0,
    duplicate_collapse_rate: 0,
    evidence_coverage_rate: 1,
  },
});

test("temporal projector preserves event structure and normalizes explicit dates", () => {
  const payload = buildPayload();
  const records = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
    payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );

  assert.equal(records.length, 2);
  assert.equal(records[0].normalized_start, "2026-04-10");
  assert.equal(records[1].normalized_start, "2026-04-12");
  assert.equal(records[0].actor_entities[0], "Maya Cohen");
  assert.equal(records[0].target_entities[0], "Orion Logistics");
});

test("temporal projector emits inferred ordering and contradiction markers when the same event pattern has conflicting dates", () => {
  const payload = buildPayload();
  const records = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
    payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );
  const relations = buildTemporalRelations(records);

  assert.ok(records.every((record) => record.contradiction_ids.length === 1));
  assert.equal(relations[0]?.relation_type, "before");
});

test("summary panels are evidence-backed and timeline-derived", () => {
  const payload = buildPayload();
  const records = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
    payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );
  const panels = buildSummaryPanelsFromPayload(payload, records, [], (entityId) => entityId);
  const timeline = projectTimelineEvents(records);

  assert.ok(panels.case_brief.summary_text.includes("evidence-backed events"));
  assert.deepEqual(panels.timeline_summary.cited_evidence_ids.sort(), ["ev-1", "ev-2"]);
  assert.ok(panels.entity_brief.retrieval_bundle_id);
  assert.ok(panels.update_summary.summary_text.includes("Most recent evidence slice"));
  assert.equal(timeline[0].date, "2026-04-10");
});

test("temporal normalizer resolves relative expressions against a reference date", () => {
  const normalized = normalizeTemporalExpression("last week", "2026-04-14");

  assert.equal(normalized.normalized_start, "2026-04-06");
  assert.equal(normalized.normalized_end, "2026-04-12");
  assert.equal(normalized.precision, "approximate");
  assert.equal(normalized.assertion_mode, "explicit");
});

test("temporal normalizer preserves fuzzy year expressions without fake precision", () => {
  const normalized = normalizeTemporalExpression("early 2025", "2026-04-14");

  assert.equal(normalized.normalized_start, "2025");
  assert.equal(normalized.precision, "approximate");
  assert.ok(normalized.confidence < 0.7);
});
