import assert from "node:assert/strict";
import test from "node:test";

import { refineAnswerWithCitationVerification, verifyAnswerCitations } from "../../services/sidecar/citationVerification/service";
import { __resetCitationVerificationStoreForTests } from "../../services/sidecar/citationVerification/store";
import type { RetrievalArtifacts } from "../../services/sidecar/retrieval";

const buildArtifacts = (snippet = "Maya Cohen met Orion Logistics in Ashdod."): RetrievalArtifacts => ({
  backend: "hybrid_graph_ranker_v1",
  warnings: [],
  item_count: 1,
  contradiction_item_count: 0,
  bundle_count: 1,
  diagnostics: {
    semantic_enabled: false,
    fusion_strategy: ["test"],
  },
  bundles: {
    case_brief: {
      bundle_id: "bundle_case",
      kind: "case_brief",
      title: "Case Brief",
      query: "Maya Orion",
      hits: [
        {
          item_id: "hit-1",
          item_type: "text_unit",
          source_doc_id: "doc-1",
          source_text_unit_id: "tu-1",
          evidence_id: "ev-1",
          snippet,
          related_entities: ["Maya Cohen", "Orion Logistics"],
          related_events: [],
          contradiction_ids: [],
          version_state: "current",
          validity_score: 0.92,
          source_trust: 0.9,
          version_edge_ids: [],
          confidence: 0.9,
          score: 0.9,
          matched_terms: ["maya"],
          explanation: ["test"],
        },
      ],
      cited_evidence_ids: ["ev-1"],
      related_entities: ["Maya Cohen", "Orion Logistics"],
      related_events: [],
      contradictions: [],
      version_state: "current",
      validity_score: 0.92,
      confidence: 0.9,
      warnings: [],
    },
  },
});

test("VeriCite marks claims as supported when exact retrieved evidence backs the citation", async () => {
  await __resetCitationVerificationStoreForTests();
  const run = await verifyAnswerCitations({
    caseId: "case-cite",
    answerId: "answer-1",
    answerText: "Maya Cohen met Orion Logistics in Ashdod [ev-1].",
    retrievalArtifacts: buildArtifacts(),
  });

  assert.equal(run.overall_status, "supported");
  assert.equal(run.claim_results[0].support_status, "supported");
  assert.ok(run.supported_claim_rate > 0.9);
});

test("VeriCite flags wrong citations and missing evidence", async () => {
  await __resetCitationVerificationStoreForTests();
  const wrong = await verifyAnswerCitations({
    caseId: "case-cite-wrong",
    answerText: "Cedar Finance funded Orion Logistics [ev-1].",
    retrievalArtifacts: buildArtifacts("Maya Cohen met Orion Logistics in Ashdod."),
  });
  const missing = await verifyAnswerCitations({
    caseId: "case-cite-missing",
    answerText: "Cedar Finance funded Orion Logistics.",
  });

  assert.equal(wrong.claim_results[0].support_status, "unsupported");
  assert.equal(missing.claim_results[0].support_status, "not_enough_evidence");
});

test("VeriCite refinement removes unsupported claims and keeps supported claims", async () => {
  await __resetCitationVerificationStoreForTests();
  const answer = "Maya Cohen met Orion Logistics in Ashdod. Cedar Finance funded Orion Logistics.";
  const run = await verifyAnswerCitations({
    caseId: "case-cite-refine",
    answerText: answer,
    retrievalArtifacts: buildArtifacts(),
  });
  const refined = refineAnswerWithCitationVerification(answer, run);

  assert.match(refined, /Maya Cohen met Orion Logistics/);
  assert.doesNotMatch(refined, /Cedar Finance funded Orion Logistics\./);
  assert.match(refined, /Citation verification:/);
});

