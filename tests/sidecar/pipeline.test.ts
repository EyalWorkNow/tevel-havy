import assert from "node:assert/strict";
import test from "node:test";

import { ingestSourceDocument } from "../../services/sidecar/ingest";
import { runFastExtractionPipeline, searchPipelinePayload } from "../../services/sidecar/pipeline";

const SAMPLE_TEXT = `On 2026-04-12, Maya Cohen emailed ops@orion.example about Orion Logistics at Pier 9.
Orion Logistics moved crates to Eilat through Warehouse 12 while Cedar Finance Group funded Falcon Brokers.`;

const RAW_PROVENANCE_TEXT = ` \r\nOn 2026-04-12,\tMaya  Cohen emailed ops@orion.example about Orion Logistics.\r\n`;

test("ingestSourceDocument normalizes content and emits deterministic text units", () => {
  const ingested = ingestSourceDocument({
    source_doc_id: "doc-ingest",
    raw_content: `  INCIDENT REPORT\n\n${SAMPLE_TEXT}\n`,
    metadata: { source_type: "REPORT", page_number: 2 },
  });

  assert.equal(ingested.source_doc_id, "doc-ingest");
  assert.ok(ingested.normalized_content.startsWith("INCIDENT REPORT"));
  assert.ok(ingested.text_units.length > 0);
  assert.equal(ingested.normalization_steps.length > 0, true);
  assert.equal(ingested.offset_map.raw_length, ingested.raw_content.length);
  assert.equal(ingested.offset_map.normalized_length, ingested.normalized_content.length);
  assert.equal(ingested.text_units[0].metadata?.source_type, "REPORT");
  assert.equal(ingested.text_units[0].metadata?.page_number, 2);
});

test("pipeline attaches exact mention evidence and derives timestamps", () => {
  const payload = runFastExtractionPipeline("doc-pipeline", SAMPLE_TEXT, { textUnit: { maxChars: 120 } });
  const dateMention = payload.mentions.find((mention) => mention.entity_type === "DATE");

  assert.ok(dateMention);
  assert.equal(dateMention?.mention_text, "2026-04-12");
  assert.equal(dateMention?.timestamp, "2026-04-12");
  assert.equal(
    payload.normalized_text.slice(dateMention!.evidence.normalized_start, dateMention!.evidence.normalized_end),
    dateMention!.mention_text,
  );
  assert.equal(
    payload.raw_text.slice(dateMention!.evidence.raw_start, dateMention!.evidence.raw_end),
    dateMention!.raw_text,
  );
  assert.ok(dateMention?.evidence.raw_supporting_snippet.includes("Maya Cohen"));
  assert.equal(dateMention?.char_start, dateMention?.evidence.normalized_start);
  assert.equal(dateMention?.char_end, dateMention?.evidence.normalized_end);
});

test("pipeline collapses duplicate mentions into entity records and emits relation candidates", () => {
  const payload = runFastExtractionPipeline("doc-entities", SAMPLE_TEXT, { textUnit: { maxChars: 120 } });
  const orionEntity = payload.entities.find((entity) => entity.canonical_name === "Orion Logistics");

  assert.ok(orionEntity);
  assert.ok((orionEntity?.mention_ids.length ?? 0) >= 2);
  assert.ok(payload.relation_candidates.length > 0);
  assert.ok(
    payload.relation_candidates.every(
      (relation) => relation.evidence.normalized_end > relation.evidence.normalized_start && relation.evidence.raw_end > relation.evidence.raw_start,
    ),
  );
  assert.ok(payload.stats.duplicate_collapse_rate > 0);
});

test("pipeline emits structured extraction candidates with evidence metadata", () => {
  const payload = runFastExtractionPipeline("doc-candidates", SAMPLE_TEXT, {
    textUnit: { maxChars: 120, metadata: { source_type: "REPORT" } },
  });
  const candidate = payload.candidates[0];
  const mention = payload.mentions.find((item) => item.candidate_id === candidate?.candidate_id);

  assert.ok(candidate);
  assert.ok(mention);
  assert.equal(payload.stats.candidate_count, payload.candidates.length);
  assert.equal(candidate.source_doc_id, "doc-candidates");
  assert.ok(candidate.source_text_unit_id);
  assert.ok(candidate.char_end > candidate.char_start);
  assert.equal(payload.normalized_text.slice(candidate.normalized_char_start, candidate.normalized_char_end), mention!.mention_text);
  assert.equal(payload.raw_text.slice(candidate.raw_char_start, candidate.raw_char_end), candidate.raw_text);
  assert.ok(candidate.normalized_text.length > 0);
  assert.ok(candidate.label.length > 0);
  assert.equal(candidate.candidate_type, "entity_mention");
  assert.equal(candidate.extraction_source, "rule");
  assert.equal(candidate.metadata.source_type, "REPORT");
  assert.equal(candidate.evidence.normalized_start, candidate.char_start);
  assert.equal(candidate.evidence.normalized_end, candidate.char_end);
  assert.equal(candidate.evidence.raw_start, candidate.raw_char_start);
  assert.equal(candidate.evidence.raw_end, candidate.raw_char_end);
});

test("pipeline supports lexical retrieval over text units, mentions, and entities", () => {
  const payload = runFastExtractionPipeline("doc-search", SAMPLE_TEXT, { textUnit: { maxChars: 120 } });
  const hits = searchPipelinePayload(payload, "Orion Eilat", 5);

  assert.ok(hits.length > 0);
  assert.ok(hits.some((hit) => hit.snippet.includes("Orion Logistics")));
});

test("pipeline preserves raw-source evidence fidelity across normalization changes", () => {
  const payload = runFastExtractionPipeline("doc-raw-fidelity", RAW_PROVENANCE_TEXT, { textUnit: { maxChars: 120 } });
  const mayaMention = payload.mentions.find((mention) => mention.mention_text === "Maya Cohen");
  const emailMention = payload.mentions.find((mention) => mention.mention_text === "ops@orion.example");

  assert.ok(mayaMention);
  assert.ok(emailMention);
  assert.equal(payload.normalization_steps.length > 0, true);

  assert.equal(
    payload.raw_text.slice(mayaMention!.raw_char_start, mayaMention!.raw_char_end),
    "Maya  Cohen",
  );
  assert.equal(
    payload.normalized_text.slice(mayaMention!.normalized_char_start, mayaMention!.normalized_char_end),
    "Maya Cohen",
  );
  assert.ok(mayaMention!.evidence.raw_supporting_snippet.includes("\tMaya  Cohen emailed"));
  assert.ok(mayaMention!.evidence.normalized_supporting_snippet.includes("Maya Cohen emailed"));

  assert.equal(
    payload.raw_text.slice(emailMention!.evidence.raw_start, emailMention!.evidence.raw_end),
    emailMention!.raw_text,
  );
  assert.equal(
    payload.normalized_text.slice(emailMention!.evidence.normalized_start, emailMention!.evidence.normalized_end),
    emailMention!.mention_text,
  );
});
