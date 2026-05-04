import assert from "node:assert/strict";
import test from "node:test";

import type { CitationVerificationRun } from "../../services/sidecar/citationVerification/contracts";
import type { IntelligencePackage } from "../../types";
import { buildFcfR3ReadPath } from "../../services/fcfR3Service";
import { buildFcfR3PersistedRun } from "../../services/fcfR3/contracts";
import { __resetFcfR3StoreForTests, getLatestFcfR3Run, persistFcfR3Run } from "../../services/fcfR3/store";

const makePackage = (overrides: Partial<IntelligencePackage> = {}): IntelligencePackage => ({
  clean_text: "Maya Cohen met Orion Logistics in Ashdod.",
  raw_text: "Maya Cohen met Orion Logistics in Ashdod.",
  word_count: 7,
  entities: [
    { id: "e1", name: "Maya Cohen", type: "PERSON", confidence: 0.9 },
    { id: "e2", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.88 },
  ],
  relations: [{ source: "Maya Cohen", target: "Orion Logistics", type: "MET_WITH", confidence: 0.82 }],
  insights: [{ type: "summary", importance: 1, text: "Maya Cohen met Orion Logistics in Ashdod." }],
  timeline: [],
  statements: [],
  intel_questions: [],
  intel_tasks: [],
  tactical_assessment: {
    ttps: [],
    recommendations: [],
    gaps: [],
  },
  context_cards: {},
  graph: {
    nodes: [],
    edges: [],
  },
  reliability: 0.82,
  ...overrides,
});

test("FCF-R3 persistence stores read-path audit, selected evidence, and answer citations", async () => {
  await __resetFcfR3StoreForTests();

  const readPathRun = buildFcfR3ReadPath("Who met Orion Logistics?", makePackage(), {
    maxContextChars: 2200,
    maxEvidenceItems: 4,
  });
  const citationRun: CitationVerificationRun = {
    run_id: "vericite-test",
    case_id: "case-fcf",
    answer_id: "answer-1",
    generated_at: "2026-04-29T10:00:00.000Z",
    overall_status: "supported",
    supported_claim_rate: 1,
    warnings: [],
    claim_results: [
      {
        claim_id: "claim-1",
        claim_text: "Maya Cohen met Orion Logistics in Ashdod.",
        cited_evidence_ids: readPathRun.audit.selected_evidence_ids,
        support_status: "supported",
        support_score: 0.91,
        matched_evidence_ids: readPathRun.audit.selected_evidence_ids,
        verifier_mode: "deterministic",
        reason: "Test citation is supported by selected evidence.",
        warnings: [],
      },
    ],
  };

  const persisted = await persistFcfR3Run(
    buildFcfR3PersistedRun({
      caseId: "case-fcf",
      answerId: "answer-1",
      question: "Who met Orion Logistics?",
      readPathRun,
      generatedAt: "2026-04-29T10:00:00.000Z",
      citationRun,
    }),
  );
  const latest = await getLatestFcfR3Run("case-fcf");

  assert.ok(latest);
  assert.equal(latest.run.run_id, persisted.run.run_id);
  assert.equal(latest.run.persistence_status, "verified");
  assert.equal(latest.run.citation_status, "supported");
  assert.equal(latest.selected_evidence.length, readPathRun.audit.selected_count);
  assert.equal(latest.answer_citations.length, 1);
  assert.equal(latest.answer_citations[0].support_status, "supported");
  assert.ok(latest.run.estimated_input_tokens < 700);
});
