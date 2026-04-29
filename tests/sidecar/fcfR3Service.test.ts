import assert from "node:assert/strict";
import test from "node:test";

import type { IntelligencePackage } from "../../types";
import { buildFcfR3DeterministicAnswer, buildFcfR3ReadPath } from "../../services/fcfR3Service";

const makePackage = (overrides: Partial<IntelligencePackage> = {}): IntelligencePackage => ({
  clean_text: "Default clean text",
  raw_text: "Default raw text",
  word_count: 3,
  entities: [],
  relations: [],
  insights: [],
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
  reliability: 0.78,
  ...overrides,
});

test("FCF-R3 read path selects a compact evidence pack instead of raw corpus text", () => {
  const rawText = "raw-token-waste ".repeat(3000);
  const pkg = makePackage({
    clean_text: rawText,
    raw_text: rawText,
    entities: [{ id: "e1", name: "Jamal Zubeidi", type: "PERSON", confidence: 0.91, aliases: ["Zubeidi"] }],
    retrieval_artifacts: {
      backend: "hybrid_graph_ranker_v1",
      warnings: [],
      item_count: 1,
      contradiction_item_count: 0,
      bundle_count: 1,
      bundles: {
        case_brief: {
          bundle_id: "bundle_case",
          kind: "case_brief",
          title: "Case Brief",
          query: "Zubeidi payments",
          hits: [
            {
              item_id: "hit-1",
              item_type: "claim",
              source_doc_id: "doc-1",
              source_text_unit_id: "tu-1",
              evidence_id: "ev-zubeidi-1",
              snippet: "Jamal Zubeidi coordinated payments with Elias Haddad.",
              related_entities: ["Jamal Zubeidi", "Elias Haddad"],
              related_events: [],
              contradiction_ids: [],
              version_state: "current",
              validity_score: 0.94,
              source_trust: 0.87,
              version_edge_ids: [],
              confidence: 0.91,
              score: 0.92,
              matched_terms: ["zubeidi"],
              explanation: ["Exact entity overlap"],
            },
          ],
          cited_evidence_ids: ["ev-zubeidi-1"],
          related_entities: ["Jamal Zubeidi", "Elias Haddad"],
          related_events: [],
          contradictions: [],
          version_state: "current",
          validity_score: 0.94,
          confidence: 0.91,
          warnings: [],
        },
      },
    },
  });

  const run = buildFcfR3ReadPath("who is Zubeidi?", pkg, { maxContextChars: 2600, maxEvidenceItems: 4 });

  assert.equal(run.audit.answer_status, "current-supported");
  assert.equal(run.audit.selected_count, 1);
  assert.ok(run.materialized_context.includes("FCF-R3 READ PATH"));
  assert.ok(run.materialized_context.includes("[ev-zubeidi-1]"));
  assert.ok(run.materialized_context.length <= 2600);
  assert.ok(!run.materialized_context.includes("raw-token-waste raw-token-waste"));
  assert.equal(run.retrieval_artifacts.bundles.fcf_r3_selected.hits[0].evidence_id, "ev-zubeidi-1");
});

test("FCF-R3 read path prefers current evidence over stale evidence for current queries", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Policy Alpha", type: "OBJECT", confidence: 0.85 }],
    version_validity: {
      case_id: "case-version",
      document_identity: "policy-alpha",
      generated_at: "2026-04-29T08:00:00.000Z",
      current_version_id: "v2",
      documents: [],
      versions: [],
      edges: [],
      metrics: {
        atom_count: 2,
        current_atom_count: 1,
        historical_atom_count: 1,
        edge_count: 0,
        contradicted_atom_count: 0,
        average_validity_score: 0.7,
      },
      warnings: [],
      atoms: [
        {
          atom_id: "atom-old",
          document_identity: "policy-alpha",
          version_id: "v1",
          source_doc_id: "doc-old",
          source_text_unit_id: "tu-old",
          evidence_id: "ev-old",
          exact_pointer: {
            source_doc_id: "doc-old",
            source_text_unit_id: "tu-old",
            raw_start: 0,
            raw_end: 10,
            normalized_start: 0,
            normalized_end: 10,
          },
          text: "Policy Alpha is active under the old rule.",
          text_hash: "old",
          entity_anchors: ["Policy Alpha"],
          time_anchors: ["2025"],
          source_trust: 0.82,
          task_family: "policy",
          version_state: "superseded",
          validity_score: 0.25,
          version_edge_ids: ["edge-1"],
          created_at: "2025-01-01T00:00:00.000Z",
        },
        {
          atom_id: "atom-current",
          document_identity: "policy-alpha",
          version_id: "v2",
          source_doc_id: "doc-current",
          source_text_unit_id: "tu-current",
          evidence_id: "ev-current",
          exact_pointer: {
            source_doc_id: "doc-current",
            source_text_unit_id: "tu-current",
            raw_start: 0,
            raw_end: 10,
            normalized_start: 0,
            normalized_end: 10,
          },
          text: "Policy Alpha is currently inactive under the latest rule.",
          text_hash: "current",
          entity_anchors: ["Policy Alpha"],
          time_anchors: ["2026"],
          source_trust: 0.9,
          task_family: "policy",
          version_state: "current",
          validity_score: 0.95,
          version_edge_ids: [],
          created_at: "2026-04-29T00:00:00.000Z",
        },
      ],
    },
  });

  const run = buildFcfR3ReadPath("What is the current valid Policy Alpha rule?", pkg, {
    maxContextChars: 2600,
    maxEvidenceItems: 4,
  });

  assert.equal(run.audit.answer_status, "current-supported");
  assert.ok(run.audit.pruned_count >= 1);
  assert.ok(run.audit.selected_evidence_ids.includes("ev-current"));
  assert.ok(!run.audit.selected_evidence_ids.includes("ev-old"));
  assert.ok(run.materialized_context.includes("[ev-current]"));
});

test("FCF-R3 deterministic answer cites selected evidence when the local model is unavailable", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "ג'מאל זביידי", type: "PERSON", confidence: 0.91, aliases: ["זביידי"] }],
    insights: [{ type: "summary", importance: 1, text: "ג'מאל זביידי מופיע כרכז פיננסי בתיק המטרה." }],
  });

  const run = buildFcfR3ReadPath("מי הוא זביידי", pkg, { maxContextChars: 2200, maxEvidenceItems: 4 });
  const answer = buildFcfR3DeterministicAnswer("מי הוא זביידי", run);

  assert.match(answer, /סטטוס FCF-R3/);
  assert.match(answer, /ג.?מאל זביידי/);
  assert.match(answer, /\[fcf_/);
});

test("FCF-R3 deterministic answer can describe a cloud-engine fallback", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Policy Alpha", type: "OBJECT", confidence: 0.86 }],
    insights: [{ type: "summary", importance: 1, text: "Policy Alpha remains under review." }],
  });

  const run = buildFcfR3ReadPath("What is the current state of Policy Alpha?", pkg, {
    maxContextChars: 2200,
    maxEvidenceItems: 4,
  });
  const answer = buildFcfR3DeterministicAnswer("What is the current state of Policy Alpha?", run, {
    reasoningEngineSurface: "cloud",
    failureKind: "offline",
  });

  assert.match(answer, /cloud reasoning engine was unavailable/i);
});
