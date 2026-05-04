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
  const verboseRun = buildFcfR3ReadPath("who is Zubeidi?", pkg, {
    maxContextChars: 2600,
    maxEvidenceItems: 4,
    contextProfile: "verbose",
  });

  assert.equal(run.audit.answer_status, "current-supported");
  assert.equal(run.audit.selected_count, 1);
  assert.ok(run.materialized_context.includes("FCF-R3 READ PATH"));
  assert.ok(run.materialized_context.includes("[ev-zubeidi-1]"));
  assert.ok(run.materialized_context.length <= 2600);
  assert.ok(run.materialized_context.length < verboseRun.materialized_context.length);
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

test("FCF-R3 broad entity-context analysis synthesizes clustered evidence instead of listing hits", () => {
  const pkg = makePackage({
    entities: [
      { id: "e1", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.92, aliases: ["Orion"] },
      { id: "e2", name: "Cedar Finance", type: "ORGANIZATION", confidence: 0.88 },
      { id: "e3", name: "Maya Cohen", type: "PERSON", confidence: 0.86 },
    ],
    relations: [
      { source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED", confidence: 0.84 },
      { source: "Maya Cohen", target: "Orion Logistics", type: "MET_WITH", confidence: 0.82 },
    ],
    timeline: [
      { date: "2026-04-10", event: "Maya Cohen met Orion Logistics in Ashdod." },
      { date: "2026-04-12", event: "Cedar Finance funded Orion Logistics after the Ashdod meeting." },
    ],
    statements: [
      {
        statement_id: "stmt-1",
        statement_text: "Analysts assess Orion Logistics is a coordination node between Maya Cohen and Cedar Finance.",
        knowledge: "ASSESSMENT",
        category: "TACTICAL",
        confidence: 0.78,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Orion Logistics", "Maya Cohen", "Cedar Finance"],
      },
      {
        statement_id: "stmt-eei",
        statement_text: "Hypothesis / EEI: Orion Logistics may be acting as a logistics cutout; requires ownership collection before confirmation.",
        knowledge: "HYPOTHESIS",
        category: "COLLECTION",
        confidence: 0.52,
        assumption_flag: true,
        intelligence_gap: true,
        impact: "MEDIUM",
        operational_relevance: "MEDIUM",
        related_entities: ["Orion Logistics"],
      },
    ],
    insights: [
      { type: "summary", importance: 0.82, text: "Orion Logistics appears in both meeting and finance context." },
    ],
  });

  const run = buildFcfR3ReadPath("What does Orion Logistics mean in the network, and what is supported versus speculative?", pkg, {
    maxContextChars: 4200,
    maxEvidenceItems: 7,
  });
  const answer = buildFcfR3DeterministicAnswer("What does Orion Logistics mean in the network, and what is supported versus speculative?", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.query_plan.mode, "entity_context_analysis");
  assert.equal(run.query_plan.broad_entity_context, true);
  assert.ok(run.query_plan.expanded_terms.includes("Orion Logistics"));
  assert.ok(run.evidence_clusters.length >= 2);
  assert.ok(run.audit.direct_evidence_count && run.audit.direct_evidence_count > 0);
  assert.ok(run.selected.find((entry) => entry.evidence_type === "hypothesis_eei"));
  assert.ok(run.selected.findIndex((entry) => entry.evidence_type === "hypothesis_eei") > 0);
  assert.match(answer, /Executive synthesis:/);
  assert.match(answer, /Evidence clusters and interpretation:/);
  assert.match(answer, /Validation gaps \/ EEIs:/);
  assert.match(answer, /Bottom-line assessment:/);
  assert.match(answer, /Core meaning:/);
  assert.match(answer, /status=confirmed_direct|status=hypothesis_eei/);
  assert.match(answer, /confidence=high|confidence=medium|confidence=low/);
  assert.match(answer, /\[[^\]]+\]/);
  assert.doesNotMatch(answer, /^Evidence-grounded answer:/m);
});

test("FCF-R3 entity-context selection gates evidence to the queried entity before cluster diversity", () => {
  const pkg = makePackage({
    entities: [
      { id: "e1", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.92, aliases: ["Orion"] },
      { id: "e2", name: "Cedar Finance", type: "ORGANIZATION", confidence: 0.88 },
      { id: "e3", name: "TNT", type: "OBJECT", confidence: 0.74 },
      { id: "e4", name: "Ibrahim Karmi", type: "PERSON", confidence: 0.78 },
    ],
    relations: [
      { source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED_BY", confidence: 0.88, statement_id: "stmt-orion" },
      { source: "הודה כי קיבל", target: "רכב", type: "MOVED_TO", confidence: 0.91 },
      { source: "TNT", target: "בלוני לחץ", type: "USED_IN", confidence: 0.9 },
      { source: "של אבו-סאלח", target: "איברהים כרמי", type: "USED_IN", confidence: 0.9 },
    ],
    statements: [
      {
        statement_id: "stmt-orion",
        statement_text: "Cedar Finance transferred funds to Orion Logistics after the Ashdod meeting.",
        knowledge: "FACT",
        category: "FINANCE",
        confidence: 0.86,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Cedar Finance", "Orion Logistics"],
      },
      {
        statement_id: "stmt-noise",
        statement_text: "TNT appeared in a separate weapons inventory unrelated to Orion Logistics.",
        knowledge: "FACT",
        category: "WEAPONS",
        confidence: 0.82,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "MEDIUM",
        operational_relevance: "MEDIUM",
        related_entities: ["TNT", "Ibrahim Karmi"],
      },
    ],
    timeline: [
      { date: "2026-04-12", event: "Orion Logistics received a finance transfer from Cedar Finance." },
      { date: "2026-04-13", event: "TNT and pressure cylinders were cataloged in a separate section." },
    ],
    insights: [{ type: "summary", importance: 0.94, text: "Pressure cylinders dominated the weapons section." }],
  });

  const run = buildFcfR3ReadPath("Analyze the entity context and meaning around Orion Logistics.", pkg, {
    maxContextChars: 4200,
    maxEvidenceItems: 8,
  });
  const answer = buildFcfR3DeterministicAnswer("Analyze the entity context and meaning around Orion Logistics.", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.audit.answer_status, "current-supported");
  assert.ok(run.selected.length > 0);
  assert.ok(run.selected.every((entry) => entry.entity_grounded));
  assert.ok(run.evidence_clusters.every((cluster) => cluster.related_entities.some((entity) => /orion/i.test(entity))));
  assert.ok(run.selected.every((entry) => !/הודה כי קיבל|בלוני לחץ|של אבו-סאלח/.test(entry.atom.text)));
  assert.doesNotMatch(answer, /Relationship:/);
  assert.match(answer, /Cedar Finance transferred funds to Orion Logistics|Orion Logistics received a finance transfer/);
});

test("FCF-R3 malformed or ungrounded relation triples cannot create confident entity synthesis", () => {
  const pkg = makePackage({
    entities: [
      { id: "e1", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.9, aliases: ["Orion"] },
      { id: "e2", name: "TNT", type: "OBJECT", confidence: 0.86 },
      { id: "e3", name: "Ibrahim Karmi", type: "PERSON", confidence: 0.81 },
    ],
    relations: [
      { source: "הודה כי קיבל", target: "רכב", type: "MOVED_TO", confidence: 0.94 },
      { source: "TNT", target: "בלוני לחץ", type: "USED_IN", confidence: 0.93 },
      { source: "של אבו-סאלח", target: "איברהים כרמי", type: "USED_IN", confidence: 0.91 },
    ],
    insights: [{ type: "summary", importance: 0.98, text: "Weapons inventory suggests operational capability." }],
  });

  const run = buildFcfR3ReadPath("What does Orion Logistics mean in the network?", pkg, {
    maxContextChars: 3000,
    maxEvidenceItems: 6,
  });
  const answer = buildFcfR3DeterministicAnswer("What does Orion Logistics mean in the network?", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.audit.answer_status, "no-evidence");
  assert.equal(run.selected.length, 0);
  assert.match(answer, /No sufficient evidence survived selection|לא נמצאו ראיות מספיקות/);
  assert.doesNotMatch(answer, /Core meaning:/);
  assert.doesNotMatch(answer, /Relationship:/);
});

test("FCF-R3 insufficient entity evidence stays cautious and does not promote weak relation-only clusters", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.9, aliases: ["Orion"] }],
    relations: [{ source: "Cedar Finance", target: "Orion Logistics", type: "FUNDED_BY", confidence: 0.89 }],
    insights: [{ type: "summary", importance: 0.9, text: "The case contains broad financial activity." }],
  });

  const run = buildFcfR3ReadPath("Analyze Orion Logistics entity context and explain what it means.", pkg, {
    maxContextChars: 3000,
    maxEvidenceItems: 5,
  });
  const answer = buildFcfR3DeterministicAnswer("Analyze Orion Logistics entity context and explain what it means.", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.audit.answer_status, "insufficient-evidence");
  assert.ok(run.selected.every((entry) => entry.entity_grounded));
  assert.ok(run.selected.every((entry) => entry.evidence_type === "weak_noisy_evidence" || entry.atom.kind === "entity_context"));
  assert.match(answer, /Not enough direct evidence mentions the queried entity/);
  assert.match(answer, /No strong evidence layer supports a firm analytical conclusion/);
  assert.doesNotMatch(answer, /Core meaning:/);
  assert.doesNotMatch(answer, /connecting or coordination role/);
});

test("FCF-R3 exhaustive entity-context queries run coverage pass across major context types", () => {
  const turkeyStatements = [
    ["stmt-command", "Turkey strategic command issued guidance to the external network.", "COMMAND"],
    ["stmt-control", "Turkey operational control cell directed field activity through a handler.", "CONTROL"],
    ["stmt-finance", "Turkey financing cell transferred payments through a commercial account.", "FINANCE"],
    ["stmt-tech", "A Turkish technology vendor supplied drone equipment and sensors to the network.", "TECH"],
    ["stmt-logistics", "Turkey logistics route moved supplies through a vehicle corridor.", "LOGISTICS"],
    ["stmt-geo", "Istanbul and Ankara formed the proxy geography for Turkey-linked activity.", "GEOGRAPHY"],
    ["stmt-operator", "A Turkey direct operator recruited a human asset for the activity.", "OPERATORS"],
    ["stmt-comms", "Turkey communications relay used a phone and Telegram channel.", "COMMS"],
    ["stmt-doctrine", "Turkey doctrine and tactics emphasized compartmented proxy tradecraft.", "TACTICS"],
    ["stmt-institution", "Turkey institutional actors included an intelligence agency and ministry liaison.", "INSTITUTION"],
  ] as const;
  const pkg = makePackage({
    entities: [
      {
        id: "e1",
        name: "Turkey",
        type: "LOCATION",
        confidence: 0.94,
        aliases: ["Turkish", "Ankara", "Istanbul", "MIT"],
      },
    ],
    statements: turkeyStatements.map(([statement_id, statement_text, category]) => ({
      statement_id,
      statement_text,
      knowledge: "FACT",
      category,
      confidence: 0.84,
      assumption_flag: false,
      intelligence_gap: false,
      impact: "HIGH",
      operational_relevance: "HIGH",
      related_entities: ["Turkey"],
    })),
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey and explain the full entity context.", pkg);
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey and explain the full entity context.", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.query_plan.wants_exhaustive_context, true);
  assert.equal(run.audit.second_pass_retrieval, true);
  assert.ok((run.audit.found_context_types || []).length >= 8);
  assert.ok(run.audit.found_context_types?.includes("strategic_command"));
  assert.ok(run.audit.found_context_types?.includes("operational_control"));
  assert.ok(run.audit.found_context_types?.includes("finance"));
  assert.ok(run.audit.found_context_types?.includes("technology_equipment"));
  assert.ok(run.audit.found_context_types?.includes("proxy_geography"));
  assert.ok(run.audit.found_context_types?.includes("human_operators"));
  assert.ok(run.audit.found_context_types?.includes("institutional_actors"));
  assert.ok(run.selected.every((entry) => entry.entity_grounded));
  assert.match(answer, /Coverage validation found broad coverage|The following central contexts were found/);
  assert.doesNotMatch(answer, /all contexts found/i);
});

test("FCF-R3 marks exhaustive entity-context coverage as partial when available context types are missed by budget", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.94, aliases: ["Turkish", "Ankara", "Istanbul"] }],
    statements: [
      "Turkey strategic command issued guidance.",
      "Turkey financing cell transferred payments.",
      "Turkish technology vendor supplied drone equipment.",
      "Turkey logistics route moved supplies.",
      "Istanbul and Ankara formed proxy geography.",
      "Turkey communications relay used a Telegram channel.",
    ].map((statement_text, index) => ({
      statement_id: `stmt-partial-${index}`,
      statement_text,
      knowledge: "FACT",
      category: "CONTEXT",
      confidence: 0.82,
      assumption_flag: false,
      intelligence_gap: false,
      impact: "HIGH",
      operational_relevance: "HIGH",
      related_entities: ["Turkey"],
    })),
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey.", pkg, { maxEvidenceItems: 3, maxContextChars: 2600 });
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey.", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.query_plan.wants_exhaustive_context, true);
  assert.equal(run.audit.coverage_complete, false);
  assert.ok((run.audit.missing_context_types || []).length > 0);
  assert.match(answer, /Coverage is partial, so this should not be read as all contexts/);
  assert.doesNotMatch(answer, /Coverage validation found broad coverage/);
});

test("FCF-R3 ranks direct command/control above weak infrastructure indicators", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.94, aliases: ["Turkish", "MIT"] }],
    statements: [
      {
        statement_id: "stmt-logo",
        statement_text: "A Turkish logo appeared on an indirect support website footer.",
        knowledge: "INDICATOR",
        category: "INFRASTRUCTURE",
        confidence: 0.42,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "LOW",
        operational_relevance: "LOW",
        related_entities: ["Turkey"],
      },
      {
        statement_id: "stmt-control-direct",
        statement_text: "MIT direct operator controlled the field team through a command handler.",
        knowledge: "FACT",
        category: "CONTROL",
        confidence: 0.9,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Turkey", "MIT"],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey.", pkg);
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey.", run, { includeFallbackNotice: false });

  assert.equal(run.selected[0].atom.evidence_id, "stmt-control-direct");
  assert.equal(run.selected[0].cluster_priority, 1);
  assert.match(answer, /MIT direct operator controlled/);
  assert.ok(answer.indexOf("MIT direct operator controlled") < answer.indexOf("logo appeared"));
});

test("FCF-R3 keeps indirect TIKA-style indicators as possible indications and ranks direct finance above them", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.94, aliases: ["Turkish", "TIKA"] }],
    statements: [
      {
        statement_id: "stmt-tika-logo",
        statement_text: "A TIKA logo was identified at a compound labeled as foreign-funded infrastructure.",
        knowledge: "INDICATOR",
        category: "INFRASTRUCTURE",
        confidence: 0.61,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "MEDIUM",
        operational_relevance: "MEDIUM",
        related_entities: ["Turkey", "TIKA"],
      },
      {
        statement_id: "stmt-direct-finance",
        statement_text: "Bank transfer records show Turkey financing cell transferred cryptocurrency payments to the farm wallet.",
        knowledge: "FACT",
        category: "FINANCE",
        confidence: 0.91,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Turkey"],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey.", pkg);
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey.", run, { includeFallbackNotice: false });

  assert.equal(run.selected[0].atom.evidence_id, "stmt-direct-finance");
  assert.ok(run.selected.find((entry) => entry.atom.evidence_id === "stmt-tika-logo" && entry.evidence_type === "indirect_evidence"));
  assert.match(answer, /Possible indication:.*TIKA logo/i);
  assert.doesNotMatch(answer, /TIKA financed the farm|confirmed financing.*TIKA/i);
});

test("FCF-R3 phrases indirect indicators cautiously instead of confirmed involvement", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.94, aliases: ["Turkish"] }],
    statements: [
      {
        statement_id: "stmt-indirect",
        statement_text: "Analysts suspected the Turkish phone prefix may indicate access to a support network.",
        knowledge: "ASSESSMENT",
        category: "COMMUNICATIONS",
        confidence: 0.64,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "MEDIUM",
        operational_relevance: "MEDIUM",
        related_entities: ["Turkey"],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Analyze Turkey entity context.", pkg);
  const answer = buildFcfR3DeterministicAnswer("Analyze Turkey entity context.", run, { includeFallbackNotice: false });

  assert.ok(run.selected.some((entry) => entry.evidence_type === "indirect_evidence" || entry.evidence_type === "corroborating_evidence"));
  assert.match(answer, /Possible indication|Corroborates the assessment/);
  assert.doesNotMatch(answer, /confirmed financing|confirmed control|document confirms/i);
});

test("FCF-R3 separates negative or alternative-actor evidence from positive entity links", () => {
  const pkg = makePackage({
    entities: [
      { id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.94, aliases: ["Turkish"] },
      { id: "e2", name: "Hamas", type: "ORGANIZATION", confidence: 0.86 },
    ],
    statements: [
      {
        statement_id: "stmt-boundary",
        statement_text: "The transfer was not funded by Turkey; instead Hamas financed the purchase.",
        knowledge: "QUALIFICATION",
        category: "FINANCE",
        confidence: 0.88,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Turkey", "Hamas"],
      },
      {
        statement_id: "stmt-positive",
        statement_text: "Turkey communications relay used a Telegram channel.",
        knowledge: "FACT",
        category: "COMMS",
        confidence: 0.83,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "MEDIUM",
        operational_relevance: "HIGH",
        related_entities: ["Turkey"],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey.", pkg);
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey.", run, { includeFallbackNotice: false });

  assert.ok(run.selected.some((entry) => entry.context_type === "limiting_evidence"));
  assert.ok(run.selected.some((entry) => entry.evidence_polarity === "alternative_actor" || entry.evidence_polarity === "boundary_of_involvement"));
  assert.match(answer, /Boundaries \/ alternative actors:/);
  assert.match(answer, /does not prove direct involvement by the queried entity|clarifies the boundary of involvement/);
});

test("FCF-R3 coverage checklist marks missing major categories as not found", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.94 }],
    statements: [
      {
        statement_id: "stmt-finance-only",
        statement_text: "Turkey financing cell transferred cryptocurrency payments.",
        knowledge: "FACT",
        category: "FINANCE",
        confidence: 0.84,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Turkey"],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey.", pkg);
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey.", run, { includeFallbackNotice: false });

  assert.equal(run.audit.coverage_checklist?.finance, "found");
  assert.equal(run.audit.coverage_checklist?.operational_control, "not_found");
  assert.equal(run.audit.coverage_checklist?.technology_equipment, "not_found");
  assert.match(answer, /Coverage checklist: no strong evidence was found for/);
  assert.match(answer, /Coverage is partial, so this should not be read as all contexts/);
});

test("FCF-R3 strict source scope excludes unrelated report evidence before clustering", () => {
  const pkg = makePackage({
    entities: [
      { id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.92, aliases: ["Turkish"] },
      { id: "e2", name: "Cyprus", type: "LOCATION", confidence: 0.86 },
    ],
    retrieval_artifacts: {
      backend: "hybrid_graph_ranker_v1",
      warnings: [],
      item_count: 2,
      contradiction_item_count: 0,
      bundle_count: 2,
      bundles: {
        active_doc: {
          bundle_id: "active_doc",
          kind: "case_brief",
          title: "Active Turkey Report",
          query: "Turkey context",
          hits: [
            {
              item_id: "hit-active",
              item_type: "claim",
              source_doc_id: "active-report",
              evidence_id: "ev-active",
              snippet: "Turkey appears in the active report as a logistics coordination node.",
              related_entities: ["Turkey"],
              related_events: [],
              contradiction_ids: [],
              confidence: 0.91,
              score: 0.93,
              matched_terms: ["turkey"],
              explanation: ["Exact entity overlap"],
            },
          ],
          cited_evidence_ids: ["ev-active"],
          related_entities: ["Turkey"],
          related_events: [],
          contradictions: [],
          confidence: 0.9,
          warnings: [],
        },
        unrelated_doc: {
          bundle_id: "unrelated_doc",
          kind: "case_brief",
          title: "Quartz Strategy Cyprus",
          query: "Turkey context",
          hits: [
            {
              item_id: "hit-noise",
              item_type: "claim",
              source_doc_id: "other-report",
              evidence_id: "ev-noise",
              snippet: "Quartz Strategy, Blue Meridian, DockPilot and Cyprus contain generic regional signals unrelated to the active report.",
              related_entities: ["Cyprus", "Quartz Strategy", "Blue Meridian", "DockPilot"],
              related_events: [],
              contradiction_ids: [],
              confidence: 0.88,
              score: 0.95,
              matched_terms: ["context"],
              explanation: ["Weak lexical overlap"],
            },
          ],
          cited_evidence_ids: ["ev-noise"],
          related_entities: ["Cyprus"],
          related_events: [],
          contradictions: [],
          confidence: 0.88,
          warnings: [],
        },
      },
    },
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey in this document.", pkg, {
    allowedSourceDocIds: ["active-report"],
    maxEvidenceItems: 6,
  });
  const answer = buildFcfR3DeterministicAnswer("Find all contexts for Turkey in this document.", run, {
    includeFallbackNotice: false,
  });

  assert.equal(run.audit.source_consistent, true);
  assert.deepEqual(run.audit.source_doc_ids, ["active-report"]);
  assert.ok(run.selected.every((entry) => entry.atom.source_doc_id === "active-report"));
  assert.doesNotMatch(run.materialized_context, /Quartz Strategy|Blue Meridian|DockPilot|Cyprus/);
  assert.doesNotMatch(answer, /Quartz Strategy|Blue Meridian|DockPilot|Cyprus/);
});

test("FCF-R3 mixed source evidence without cross-source approval blocks current-supported synthesis", () => {
  const pkg = makePackage({
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.92, aliases: ["Turkish"] }],
    retrieval_artifacts: {
      backend: "hybrid_graph_ranker_v1",
      warnings: [],
      item_count: 2,
      contradiction_item_count: 0,
      bundle_count: 1,
      bundles: {
        mixed: {
          bundle_id: "mixed",
          kind: "case_brief",
          title: "Mixed Reports",
          query: "Turkey contexts",
          hits: ["doc-a", "doc-b"].map((source_doc_id, index) => ({
            item_id: `hit-${index}`,
            item_type: "claim" as const,
            source_doc_id,
            evidence_id: `ev-${index}`,
            snippet:
              index === 0
                ? "Turkey appears in the selected report as a finance node."
                : "Turkey appears in another report as an unrelated logistics node.",
            related_entities: ["Turkey"],
            related_events: [],
            contradiction_ids: [],
            confidence: 0.9,
            score: 0.9 - index * 0.01,
            matched_terms: ["turkey"],
            explanation: ["Exact entity overlap"],
          })),
          cited_evidence_ids: ["ev-0", "ev-1"],
          related_entities: ["Turkey"],
          related_events: [],
          contradictions: [],
          confidence: 0.9,
          warnings: [],
        },
      },
    },
  });

  const run = buildFcfR3ReadPath("Find all contexts for Turkey in this document.", pkg, { maxEvidenceItems: 6 });

  assert.equal(run.audit.source_consistent, false);
  assert.equal(run.audit.answer_status, "insufficient-evidence");
  assert.ok(run.audit.warnings.some((warning) => /source consistency/i.test(warning)));
});

test("FCF-R3 low traceability blocks current-supported status", () => {
  const pkg = makePackage({
    document_metadata: {
      document_id: "active-report",
      title: "Active Report",
      classification: "test",
      author: "test",
      source_orgs: "test",
      language: "en",
    },
    entities: [
      {
        id: "e1",
        name: "Turkey",
        type: "LOCATION",
        confidence: 0.92,
        aliases: ["Turkish"],
        evidence: ["Turkey is mentioned in a profile note without a source span."],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Analyze all contexts for Turkey in this document.", pkg, {
    allowedSourceDocIds: ["active-report"],
    maxEvidenceItems: 4,
  });

  assert.equal(run.audit.traceability_rate, 0);
  assert.equal(run.audit.answer_status, "insufficient-evidence");
});

test("FCF-R3 final answer hides internal/debug cluster labels", () => {
  const pkg = makePackage({
    document_metadata: {
      document_id: "active-report",
      title: "Active Report",
      classification: "test",
      author: "test",
      source_orgs: "test",
      language: "en",
    },
    entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.92, aliases: ["Turkish"] }],
    statements: [
      {
        statement_id: "stmt-turkey",
        statement_text: "Turkey is described as an operational coordination node in the active report.",
        knowledge: "FACT",
        category: "TACTICAL",
        confidence: 0.88,
        assumption_flag: false,
        intelligence_gap: false,
        impact: "HIGH",
        operational_relevance: "HIGH",
        related_entities: ["Turkey"],
      },
    ],
  });

  const run = buildFcfR3ReadPath("Analyze all contexts for Turkey in this document.", pkg, {
    allowedSourceDocIds: ["active-report"],
    maxEvidenceItems: 4,
  });
  const answer = buildFcfR3DeterministicAnswer("Analyze all contexts for Turkey in this document.", run, {
    includeFallbackNotice: false,
  });

  assert.doesNotMatch(answer, /Version validity|Entity profile|sidecar_rel|stmt_rel|Institutional actors/);
});
