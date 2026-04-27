import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetRetrievalSemanticCacheForTests,
  buildRetrievalArtifactsFromPayload,
  buildRetrievalArtifactsFromPayloadWithSemanticSearch,
} from "../../services/sidecar/retrieval";
import { buildSummaryPanelsFromRetrievalArtifacts } from "../../services/sidecar/summarization/evidencePack";
import { buildTemporalEventRecords } from "../../services/sidecar/temporal/projector";
import type { SidecarExtractionPayload } from "../../services/sidecar/types";

const originalFetch = globalThis.fetch;

const buildPayload = (): SidecarExtractionPayload => ({
  source_doc_id: "case-9",
  raw_text:
    "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod. On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again. Analysts claimed Cedar Finance funded Orion Logistics.",
  normalized_text:
    "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod. On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again. Analysts claimed Cedar Finance funded Orion Logistics.",
  generated_at: "2026-04-14T00:00:00.000Z",
  pipeline_version: "test",
  normalization_steps: [],
  text_units: [
    {
      source_doc_id: "case-9",
      text_unit_id: "tu-1",
      ordinal: 0,
      kind: "sentence",
      start: 0,
      end: 57,
      normalized_start: 0,
      normalized_end: 57,
      raw_start: 0,
      raw_end: 57,
      text: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod.",
      raw_text: "On 2026-04-10 Maya Cohen met Orion Logistics in Ashdod.",
      char_length: 57,
      token_estimate: 10,
      stable_hash: "a1",
    },
    {
      source_doc_id: "case-9",
      text_unit_id: "tu-2",
      ordinal: 1,
      kind: "sentence",
      start: 58,
      end: 122,
      normalized_start: 58,
      normalized_end: 122,
      raw_start: 58,
      raw_end: 122,
      text: "On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
      raw_text: "On 12/04/2026 Maya Cohen met Orion Logistics in Ashdod again.",
      char_length: 64,
      token_estimate: 11,
      stable_hash: "a2",
    },
    {
      source_doc_id: "case-9",
      text_unit_id: "tu-3",
      ordinal: 2,
      kind: "sentence",
      start: 123,
      end: 176,
      normalized_start: 123,
      normalized_end: 176,
      raw_start: 123,
      raw_end: 176,
      text: "Analysts claimed Cedar Finance funded Orion Logistics.",
      raw_text: "Analysts claimed Cedar Finance funded Orion Logistics.",
      char_length: 53,
      token_estimate: 7,
      stable_hash: "a3",
    },
  ],
  candidates: [],
  mentions: [],
  entities: [
    {
      entity_id: "person-1",
      source_doc_id: "case-9",
      canonical_name: "Maya Cohen",
      normalized_name: "maya cohen",
      entity_type: "PERSON",
      aliases: ["M. Cohen"],
      mention_ids: [],
      source_text_unit_ids: ["tu-1", "tu-2"],
      extraction_sources: ["model"],
      confidence: 0.92,
      timestamps: ["2026-04-10", "2026-04-12"],
      corroborating_mention_ids: [],
      contradicting_entity_ids: [],
    },
    {
      entity_id: "org-1",
      source_doc_id: "case-9",
      canonical_name: "Orion Logistics",
      normalized_name: "orion logistics",
      entity_type: "ORGANIZATION",
      aliases: [],
      mention_ids: [],
      source_text_unit_ids: ["tu-1", "tu-2", "tu-3"],
      extraction_sources: ["model"],
      confidence: 0.91,
      timestamps: ["2026-04-10", "2026-04-12"],
      corroborating_mention_ids: [],
      contradicting_entity_ids: [],
    },
    {
      entity_id: "org-2",
      source_doc_id: "case-9",
      canonical_name: "Cedar Finance",
      normalized_name: "cedar finance",
      entity_type: "ORGANIZATION",
      aliases: ["Cedar Finance Group"],
      mention_ids: [],
      source_text_unit_ids: ["tu-3"],
      extraction_sources: ["model"],
      confidence: 0.88,
      timestamps: ["2026-04-12"],
      corroborating_mention_ids: [],
      contradicting_entity_ids: [],
    },
  ],
  relation_candidates: [
    {
      relation_id: "rel-1",
      source_doc_id: "case-9",
      source_text_unit_id: "tu-3",
      source_entity_id: "org-2",
      target_entity_id: "org-1",
      source_mention_ids: [],
      target_mention_ids: [],
      relation_type: "FUNDED",
      normalized_text: "Cedar Finance funded Orion Logistics",
      extraction_source: "model",
      confidence: 0.84,
      evidence: {
        evidence_id: "ev-rel-1",
        source_doc_id: "case-9",
        source_text_unit_id: "tu-3",
        start: 123,
        end: 176,
        normalized_start: 123,
        normalized_end: 176,
        raw_start: 123,
        raw_end: 176,
        raw_supporting_snippet: "Analysts claimed Cedar Finance funded Orion Logistics.",
        normalized_supporting_snippet: "Analysts claimed Cedar Finance funded Orion Logistics.",
        normalized_text: "Analysts claimed Cedar Finance funded Orion Logistics.",
        extraction_source: "model",
        confidence: 0.84,
      },
    },
  ],
  claim_candidates: [
    {
      claim_id: "claim-1",
      source_doc_id: "case-9",
      source_text_unit_id: "tu-3",
      claim_type: "ASSESSMENT",
      subject_entity_ids: ["org-2"],
      object_entity_ids: ["org-1"],
      claim_text: "Cedar Finance funded Orion Logistics.",
      normalized_text: "Cedar Finance funded Orion Logistics.",
      extraction_source: "model",
      confidence: 0.79,
      evidence: {
        evidence_id: "ev-claim-1",
        source_doc_id: "case-9",
        source_text_unit_id: "tu-3",
        start: 123,
        end: 176,
        normalized_start: 123,
        normalized_end: 176,
        raw_start: 123,
        raw_end: 176,
        raw_supporting_snippet: "Analysts claimed Cedar Finance funded Orion Logistics.",
        normalized_supporting_snippet: "Analysts claimed Cedar Finance funded Orion Logistics.",
        normalized_text: "Analysts claimed Cedar Finance funded Orion Logistics.",
        extraction_source: "model",
        confidence: 0.79,
      },
    },
  ],
  event_candidates: [
    {
      event_id: "event-1",
      source_doc_id: "case-9",
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
        source_doc_id: "case-9",
        source_text_unit_id: "tu-1",
        start: 0,
        end: 57,
        normalized_start: 0,
        normalized_end: 57,
        raw_start: 0,
        raw_end: 57,
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
      source_doc_id: "case-9",
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
        source_doc_id: "case-9",
        source_text_unit_id: "tu-2",
        start: 58,
        end: 122,
        normalized_start: 58,
        normalized_end: 122,
        raw_start: 58,
        raw_end: 122,
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
    doc_char_length: 176,
    text_unit_count: 3,
    candidate_count: 0,
    mention_count: 0,
    entity_count: 3,
    relation_count: 1,
    event_count: 2,
    claim_count: 1,
    duplicate_collapse_rate: 0,
    evidence_coverage_rate: 1,
  },
});

test("retrieval artifacts connect case, relationship, update, and contradiction bundles with evidence", () => {
  const payload = buildPayload();
  const eventRecords = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
    payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );
  const relations = [
    { source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED", confidence: 0.84 },
  ];

  const artifacts = buildRetrievalArtifactsFromPayload(
    payload,
    eventRecords,
    relations,
    (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );

  assert.equal(artifacts.bundle_count, 6);
  assert.ok(artifacts.bundles.relationship_brief.hits.some((hit) => hit.item_type === "relation"));
  assert.ok(artifacts.bundles.contradiction_summary.hits.some((hit) => hit.contradiction_ids.length > 0));
  assert.ok(artifacts.bundles.update_summary.temporal_window?.start);
  assert.ok(artifacts.bundles.case_brief.cited_evidence_ids.includes("ev-1"));
});

test("summary panels project retrieval bundles into UI-friendly cards", () => {
  const payload = buildPayload();
  const eventRecords = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
    payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );
  const relations = [
    { source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED", confidence: 0.84 },
  ];
  const artifacts = buildRetrievalArtifactsFromPayload(
    payload,
    eventRecords,
    relations,
    (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );
  const panels = buildSummaryPanelsFromRetrievalArtifacts(artifacts);

  assert.ok(panels.case_brief.retrieval_bundle_id);
  assert.ok(panels.relationship_brief.summary_text.includes("relationship evidence"));
  assert.ok(panels.update_summary.summary_text.includes("Most recent evidence slice"));
  assert.ok(panels.entity_brief.related_entities.includes("Maya Cohen"));
});

test("retrieval hits expose fused score breakdowns and runtime diagnostics", () => {
  const payload = buildPayload();
  payload.runtime_diagnostics = {
    extractor_name: "spacy_gliner_hybrid_v2",
    warnings: ["fastcoref expanded 1 linked mentions from 1 clusters."],
    adapter_status: {
      spacy: { state: "active", detail: "spaCy sentencizer and rule matchers are active." },
      gliner: { state: "configured", detail: "GLiNER is enabled but did not add accepted spans for this text." },
    },
  };

  const eventRecords = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
    payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );
  const artifacts = buildRetrievalArtifactsFromPayload(
    payload,
    eventRecords,
    [{ source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED", confidence: 0.84 }],
    (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
  );

  const topHit = artifacts.bundles.case_brief.hits[0];
  assert.equal(artifacts.backend, "hybrid_graph_ranker_v1");
  assert.ok(artifacts.warnings.some((warning) => warning.includes("fastcoref")));
  assert.ok(topHit.score_breakdown);
  assert.ok((topHit.score_breakdown?.fused_score || 0) > 0);
  assert.ok((topHit.score_breakdown?.structural_score || 0) > 0);
  assert.equal(artifacts.diagnostics?.semantic_enabled, false);
  assert.equal(artifacts.diagnostics?.adapter_status?.spacy?.state, "active");
});

test("semantic retrieval upgrade fuses embedding similarity when Ollama embeddings are available", async () => {
  __resetRetrievalSemanticCacheForTests();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/tags")) {
      return new Response(
        JSON.stringify({
          models: [{ name: "embeddinggemma", model: "embeddinggemma" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/embed")) {
      return new Response(
        JSON.stringify({
          embeddings: [
            [1, 0.9, 0.1],
            [1, 0.95, 0.05],
            [0.2, 0.1, 0.9],
            [0.25, 0.1, 0.85],
            [0.1, 0.2, 0.8],
            [0.15, 0.1, 0.82],
            [0.3, 0.25, 0.7],
            [0.28, 0.18, 0.74],
            [0.12, 0.08, 0.88],
            [0.11, 0.1, 0.87],
            [0.18, 0.22, 0.78],
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const payload = buildPayload();
    const eventRecords = buildTemporalEventRecords(payload.event_candidates, (entityId) =>
      payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
    );
    const artifacts = await buildRetrievalArtifactsFromPayloadWithSemanticSearch(
      payload,
      eventRecords,
      [{ source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED", confidence: 0.84 }],
      (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
    );

    assert.equal(artifacts.backend, "hybrid_graph_semantic_v1");
    assert.equal(artifacts.diagnostics?.semantic_enabled, true);
    assert.equal(artifacts.diagnostics?.embedding_model, "embeddinggemma");
    assert.ok(
      artifacts.bundles.case_brief.hits.some((hit) => (hit.score_breakdown?.semantic_score || 0) > 0),
    );
  } finally {
    globalThis.fetch = originalFetch;
    __resetRetrievalSemanticCacheForTests();
  }
});
