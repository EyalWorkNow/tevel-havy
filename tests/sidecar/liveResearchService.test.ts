import assert from "node:assert/strict";
import test from "node:test";

import type { IntelligencePackage, StudyItem } from "../../types";
import { PRIMARY_REASONING_ENGINE } from "../../services/intelligenceService";
import { askLiveResearchQuestion, buildLiveResearchCorpus } from "../../services/liveResearchService";
import { __resetFcfR3StoreForTests, getLatestFcfR3Run } from "../../services/fcfR3/store";

const makePackage = (
  overrides: Partial<IntelligencePackage> = {},
): IntelligencePackage => ({
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
  reliability: 0.6,
  ...overrides,
});

const makeStudy = (
  id: string,
  title: string,
  pkg: IntelligencePackage,
): StudyItem => ({
  id,
  title,
  date: "2026-04-29T08:00:00.000Z",
  source: "Report",
  status: "Approved",
  tags: [],
  intelligence: pkg,
  super_intelligence: {},
  knowledge_intelligence: {},
});

test("buildLiveResearchCorpus ranks relevant studies first and prefixes retrieval ids across the corpus", () => {
  const studyAlpha = makeStudy(
    "study-alpha",
    "Orion Port Finance",
    makePackage({
      clean_text: "Orion Logistics coordinated a payment at Pier 9.",
      entities: [
        { id: "e1", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.91, aliases: ["Orion"] },
        { id: "e2", name: "Pier 9", type: "LOCATION", confidence: 0.84 },
      ],
      relations: [
        { source: "Orion Logistics", target: "Pier 9", type: "MOVED_TO", confidence: 0.82 },
      ],
      insights: [{ type: "summary", importance: 1, text: "Orion Logistics used Pier 9 for transfer activity." }],
      intel_questions: [{ question_id: "q1", question_text: "Who approved the Orion transfer?", priority: "HIGH" }],
      retrieval_artifacts: {
        backend: "hybrid_graph_semantic_v1",
        warnings: [],
        item_count: 1,
        contradiction_item_count: 0,
        bundle_count: 1,
        bundles: {
          case_brief: {
            bundle_id: "bundle_alpha",
            kind: "case_brief",
            title: "Case Brief",
            query: "orion transfer",
            hits: [
              {
                item_id: "hit_alpha",
                item_type: "claim",
                source_doc_id: "doc_alpha",
                evidence_id: "ev_alpha",
                snippet: "Orion Logistics moved cargo through Pier 9 on the reported date.",
                related_entities: ["Orion Logistics", "Pier 9"],
                related_events: [],
                contradiction_ids: [],
                confidence: 0.91,
                score: 0.94,
                matched_terms: ["orion", "pier", "9"],
                explanation: ["Exact entity overlap"],
              },
            ],
            cited_evidence_ids: ["ev_alpha"],
            related_entities: ["Orion Logistics", "Pier 9"],
            related_events: [],
            contradictions: [],
            confidence: 0.9,
            warnings: [],
          },
        },
      },
    }),
  );

  const studyBravo = makeStudy(
    "study-bravo",
    "Warehouse Follow-Up",
    makePackage({
      clean_text: "Warehouse 12 received a follow-up request from Maya Cohen.",
      entities: [
        { id: "e3", name: "Maya Cohen", type: "PERSON", confidence: 0.88 },
        { id: "e4", name: "Warehouse 12", type: "LOCATION", confidence: 0.76 },
      ],
      relations: [
        { source: "Maya Cohen", target: "Warehouse 12", type: "COMMUNICATED_WITH", confidence: 0.73 },
      ],
      insights: [{ type: "summary", importance: 0.8, text: "Warehouse 12 remains under review." }],
    }),
  );

  const studyGamma = makeStudy(
    "study-gamma",
    "Unrelated Marine Insurance",
    makePackage({
      clean_text: "Marine insurance premiums changed after a civil tariff adjustment.",
      entities: [{ id: "e5", name: "Marine Insurance Board", type: "ORGANIZATION", confidence: 0.64 }],
      insights: [{ type: "summary", importance: 0.5, text: "No operational overlap is visible." }],
    }),
  );

  const corpus = buildLiveResearchCorpus("What evidence ties Orion Logistics to Pier 9?", [
    studyGamma,
    studyBravo,
    studyAlpha,
  ]);

  assert.equal(corpus.sources[0].id, "study-alpha");
  assert.ok(corpus.sources[0].matchedSignals.some((signal) => /Orion Logistics|Pier 9/.test(signal)));
  assert.ok(corpus.package.entities.some((entity) => entity.name === "Orion Logistics"));
  assert.ok(corpus.package.retrieval_artifacts);

  const bundleKeys = Object.keys(corpus.package.retrieval_artifacts!.bundles);
  assert.equal(bundleKeys.length, 1);
  assert.match(bundleKeys[0], /^study_[a-f0-9]{8}_case_brief$/);

  const prefixedBundle = corpus.package.retrieval_artifacts!.bundles[bundleKeys[0]];
  assert.ok(prefixedBundle.cited_evidence_ids[0].includes("ev_alpha"));
  assert.ok(prefixedBundle.hits[0].item_id.includes("hit_alpha"));
  assert.ok(prefixedBundle.hits[0].source_doc_id.includes("doc_alpha"));
});

test("buildLiveResearchCorpus respects explicit scope selection", () => {
  const studyAlpha = makeStudy(
    "study-alpha",
    "Orion Port Finance",
    makePackage({
      clean_text: "Orion Logistics coordinated a payment at Pier 9.",
      entities: [{ id: "e1", name: "Orion Logistics", type: "ORGANIZATION", confidence: 0.91 }],
    }),
  );

  const studyBravo = makeStudy(
    "study-bravo",
    "Warehouse Follow-Up",
    makePackage({
      clean_text: "Warehouse 12 received a follow-up request from Maya Cohen.",
      entities: [{ id: "e2", name: "Warehouse 12", type: "LOCATION", confidence: 0.76 }],
    }),
  );

  const corpus = buildLiveResearchCorpus(
    "Summarize the current scope.",
    [studyAlpha, studyBravo],
    ["study-bravo"],
  );

  assert.equal(corpus.scope.totalStudies, 2);
  assert.equal(corpus.scope.scopedStudies, 1);
  assert.equal(corpus.sources.length, 1);
  assert.equal(corpus.sources[0].id, "study-bravo");
  assert.ok(corpus.package.clean_text.includes("Warehouse Follow-Up"));
  assert.ok(!corpus.package.clean_text.includes("Orion Port Finance"));
});

test("buildLiveResearchCorpus keeps version-validity atoms available for FCF-R3 selection", () => {
  const study = makeStudy(
    "study-version",
    "Policy Alpha Update",
    makePackage({
      clean_text: "Policy Alpha is currently inactive under the latest rule.",
      entities: [{ id: "e1", name: "Policy Alpha", type: "OBJECT", confidence: 0.86 }],
      version_validity: {
        case_id: "case-policy-alpha",
        document_identity: "policy-alpha",
        generated_at: "2026-04-29T08:00:00.000Z",
        current_version_id: "v2",
        documents: [],
        versions: [],
        edges: [],
        metrics: {
          atom_count: 1,
          current_atom_count: 1,
          historical_atom_count: 0,
          edge_count: 0,
          contradicted_atom_count: 0,
          average_validity_score: 0.95,
        },
        warnings: [],
        atoms: [
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
    }),
  );

  const corpus = buildLiveResearchCorpus("What is the current Policy Alpha rule?", [study]);

  assert.ok(corpus.package.version_validity);
  assert.equal(corpus.package.version_validity.metrics.atom_count, 1);
  assert.match(corpus.package.version_validity.atoms[0].evidence_id || "", /^study_[a-f0-9]{8}:ev-current$/);
});

test("buildLiveResearchCorpus strongly prefers exact Hebrew entity matches with geresh-style names", () => {
  const targetStudy = makeStudy(
    "study-target",
    "Target Network Case",
    makePackage({
      clean_text: "ג'מאל זביידי coordinated payments with Elias Haddad.",
      entities: [
        { id: "e1", name: "ג'מאל זביידי", type: "PERSON", confidence: 0.93, aliases: ["ג׳מאל זביידי", "גמאל זביידי"] },
        { id: "e2", name: "אליאס חדאד", type: "PERSON", confidence: 0.82 },
      ],
      insights: [{ type: "summary", importance: 1, text: "ג'מאל זביידי appears as a financial coordinator." }],
    }),
  );

  const unrelatedA = makeStudy(
    "study-a",
    "Infrastructure Dust Report",
    makePackage({
      clean_text: "אבק מוליך שיבש רכיבי תשתית במספר אזורים.",
      entities: [{ id: "u1", name: "אבק מוליך", type: "OBJECT", confidence: 0.74 }],
    }),
  );

  const unrelatedB = makeStudy(
    "study-b",
    "Crop Pathology Findings",
    makePackage({
      clean_text: "ננו-חלקיקים פולימריים זוהו בשטח חקלאי.",
      entities: [{ id: "u2", name: "ננו-חלקיקים פולימריים", type: "OBJECT", confidence: 0.69 }],
    }),
  );

  const corpus = buildLiveResearchCorpus("מה אתה יכול לספר לי על ג׳אמל זביידי", [
    unrelatedA,
    targetStudy,
    unrelatedB,
  ]);

  assert.equal(corpus.sources[0].id, "study-target");
  assert.ok(corpus.sources[0].matchedSignals.some((signal) => /ג.?מאל זביידי/.test(signal)));
  assert.equal(corpus.sources.length, 1);
});

test("buildLiveResearchCorpus routes short Hebrew surname questions without matching question stopwords", () => {
  const targetStudy = makeStudy(
    "study-target",
    "Target Network Case",
    makePackage({
      clean_text: "ג'מאל זביידי coordinated payments with Elias Haddad. הרכב נזכר רק כרקע לוגיסטי.",
      entities: [
        { id: "e1", name: "ג'מאל זביידי", type: "PERSON", confidence: 0.93, aliases: ["ג׳מאל זביידי", "גמאל זביידי"] },
        { id: "e2", name: 'רכב "כמו שהוא"', type: "ASSET", confidence: 0.61 },
      ],
      insights: [{ type: "summary", importance: 1, text: "ג'מאל זביידי appears as a financial coordinator." }],
    }),
  );

  const unrelatedStudy = makeStudy(
    "study-unrelated",
    "Farm 7 Compound",
    makePackage({
      clean_text: "פשיטה על חווה 7 ללא אזכור זביידי.",
      entities: [{ id: "u1", name: "חווה 7", type: "LOCATION", confidence: 0.78 }],
    }),
  );

  const corpus = buildLiveResearchCorpus("מי הוא זביידי", [unrelatedStudy, targetStudy]);

  assert.equal(corpus.sources.length, 1);
  assert.equal(corpus.sources[0].id, "study-target");
  assert.ok(corpus.sources[0].matchedSignals.some((signal) => /זביידי/.test(signal)));
  assert.ok(!corpus.sources[0].matchedSignals.some((signal) => /כמו שהוא/.test(signal)));
});

test("askLiveResearchQuestion returns an entity-scoped fallback when the primary reasoning engine is offline", async () => {
  await __resetFcfR3StoreForTests();
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  globalThis.fetch = async () => {
    throw new Error("simulated local model outage");
  };
  console.error = () => {};

  try {
    const targetStudy = makeStudy(
      "study-target",
      "Target Network Case",
      makePackage({
        clean_text: "ג'מאל זביידי coordinated payments with Elias Haddad.",
        entities: [
          {
            id: "e1",
            name: "ג'מאל זביידי",
            type: "PERSON",
            confidence: 0.93,
            aliases: ["ג׳מאל זביידי", "גמאל זביידי"],
            evidence: ["ג'מאל זביידי coordinated payments with Elias Haddad."],
          },
        ],
        context_cards: {
          "ג'מאל זביידי": {
            entityName: "ג'מאל זביידי",
            type: "PERSON",
            summary: "גורם פיננסי שמופיע בתיק המטרה.",
            role_in_document: "רכז תשלומים",
            significance: "HIGH",
            status: "UNKNOWN",
            key_mentions: ["זביידי coordinated payments with Elias Haddad."],
          },
        },
      }),
    );

    const answer = await askLiveResearchQuestion("מי הוא זביידי", [targetStudy], []);

    assert.match(answer.answer, /ג.?מאל זביידי/);
    assert.match(
      answer.answer,
      PRIMARY_REASONING_ENGINE.surface === "cloud" ? /מנוע ההסקה בענן לא היה זמין/ : /המודל המקומי לא היה זמין/,
    );
    assert.equal(answer.engineTrace?.responseMode, "deterministic-fallback");
    assert.equal(answer.engineTrace?.engineSurface, PRIMARY_REASONING_ENGINE.surface);
    assert.equal(answer.fcfAudit?.reasoning_outcome, "deterministic-fallback");
    assert.ok((answer.fcfAudit?.supported_claim_rate || 0) >= 0.9);
    assert.match(answer.verificationNote || "", /100% supported claims/);
    assert.equal(answer.sources.length, 1);
    assert.equal(answer.sources[0].id, "study-target");
    assert.ok(answer.fcfAudit?.case_id);
    assert.ok(answer.fcfAudit.run_id);
    const persisted = await getLatestFcfR3Run(answer.fcfAudit.case_id);
    assert.ok(persisted);
    assert.equal(persisted.run.run_id, answer.fcfAudit.run_id);
    assert.equal(persisted.selected_evidence.length, answer.fcfAudit.selected_count);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("askLiveResearchQuestion can route the FCF-R3 reasoning pass through Gemini when selected", async () => {
  await __resetFcfR3StoreForTests();
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  let requestUrl = "";
  let apiKeyHeader = "";
  let promptBody = "";

  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    apiKeyHeader = String((init?.headers as Record<string, string> | undefined)?.["x-goog-api-key"] || "");
    const payload = JSON.parse(String(init?.body || "{}"));
    promptBody = payload.contents?.[0]?.parts?.[0]?.text || "";

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "זביידי מופיע כרכז פיננסי בתיק המטרה." }],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  console.error = () => {};

  try {
    const targetStudy = makeStudy(
      "study-target",
      "Target Network Case",
      makePackage({
        clean_text: "ג'מאל זביידי coordinated payments with Elias Haddad.",
        entities: [
          {
            id: "e1",
            name: "ג'מאל זביידי",
            type: "PERSON",
            confidence: 0.93,
            aliases: ["זביידי"],
            evidence: ["ג'מאל זביידי coordinated payments with Elias Haddad."],
          },
        ],
        insights: [{ type: "summary", importance: 1, text: "זביידי מופיע כרכז פיננסי בתיק המטרה." }],
      }),
    );

    const answer = await askLiveResearchQuestion("מי הוא זביידי", [targetStudy], [], undefined, {
      reasoningEngineId: "gemini-cloud",
      geminiApiKey: "test-gemini-key",
    });

    assert.match(requestUrl, /generativelanguage\.googleapis\.com/);
    assert.equal(apiKeyHeader, "test-gemini-key");
    assert.ok(promptBody.includes("FCF-R3 READ PATH"));
    assert.ok(promptBody.includes("SELECTED EXACT EVIDENCE"));
    assert.equal(answer.engineTrace?.engineId, "gemini-cloud");
    assert.equal(answer.engineTrace?.engineSurface, "cloud");
    assert.ok(!/Comms offline|לא היה זמין/.test(answer.answer));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("buildLiveResearchCorpus materializes a compact evidence pack instead of full uploaded text", () => {
  const giantRawText = "irrelevant-token-filler ".repeat(2500);
  const targetStudy = makeStudy(
    "study-target",
    "Target Network Case",
    makePackage({
      clean_text: giantRawText,
      raw_text: giantRawText,
      entities: [
        {
          id: "e1",
          name: "ג'מאל זביידי",
          type: "PERSON",
          confidence: 0.93,
          aliases: ["זביידי"],
          evidence: [
            "ג'מאל זביידי coordinated payments with Elias Haddad.",
            "זביידי appeared in the transfer ledger.",
            "Elias Haddad referenced Zubeidi in the payment thread.",
          ],
        },
      ],
      insights: [{ type: "summary", importance: 1, text: "זביידי מופיע כרכז פיננסי בתיק המטרה." }],
      context_cards: {
        "ג'מאל זביידי": {
          entityName: "ג'מאל זביידי",
          type: "PERSON",
          summary: "גורם פיננסי שמופיע בתיק המטרה.",
          role_in_document: "רכז תשלומים",
          significance: "HIGH",
          status: "UNKNOWN",
          key_mentions: ["זביידי appeared in the transfer ledger."],
        },
      },
    }),
  );

  const corpus = buildLiveResearchCorpus("מי הוא זביידי", [targetStudy]);

  assert.ok(corpus.package.clean_text.length < 1800);
  assert.ok(corpus.package.clean_text.includes("EXACT EVIDENCE PACK"));
  assert.ok(corpus.package.clean_text.includes("זביידי"));
  assert.ok(!corpus.package.clean_text.includes("irrelevant-token-filler irrelevant-token-filler"));
});

test("askLiveResearchQuestion sends a budgeted prompt to the primary reasoning engine", async () => {
  const giantRawText = "prompt-token-waste ".repeat(4000);
  const originalFetch = globalThis.fetch;
  let promptBody = "";
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body || "{}"));
    if (String(url).includes("generativelanguage.googleapis.com")) {
      promptBody = payload.contents?.[0]?.parts?.[0]?.text || "";
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "זביידי מופיע כרכז פיננסי בתיק המטרה." }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    promptBody = payload.messages?.find((message: { role?: string }) => message.role === "user")?.content || "";
    return new Response(JSON.stringify({ message: { content: "זביידי מופיע כרכז פיננסי בתיק המטרה." } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const targetStudy = makeStudy(
      "study-target",
      "Target Network Case",
      makePackage({
        clean_text: giantRawText,
        raw_text: giantRawText,
        entities: [
          {
            id: "e1",
            name: "ג'מאל זביידי",
            type: "PERSON",
            confidence: 0.93,
            aliases: ["זביידי"],
            evidence: [
              "ג'מאל זביידי coordinated payments with Elias Haddad.",
              "זביידי appeared in the transfer ledger.",
            ],
          },
        ],
        insights: [{ type: "summary", importance: 1, text: "זביידי מופיע כרכז פיננסי בתיק המטרה." }],
      }),
    );

    const answer = await askLiveResearchQuestion("מי הוא זביידי", [targetStudy], []);

    assert.ok(promptBody.length < 7000);
    assert.ok(promptBody.includes("FCF-R3 READ PATH"));
    assert.ok(promptBody.includes("SELECTED EXACT EVIDENCE"));
    assert.ok(!promptBody.includes("prompt-token-waste prompt-token-waste"));
    assert.equal(answer.engineTrace?.responseMode, "verified-synthesis");
    assert.ok((answer.fcfAudit?.supported_claim_rate || 0) >= 0.9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildLiveResearchCorpus caps routed study count to keep live research focused", () => {
  const studies = Array.from({ length: 7 }, (_, index) =>
    makeStudy(
      `study-${index}`,
      `Study ${index}`,
      makePackage({
        clean_text: `Shared signal around Orion node ${index}.`,
        entities: [{ id: `e-${index}`, name: `Orion Node ${index}`, type: "ORGANIZATION", confidence: 0.8 }],
        insights: [{ type: "summary", importance: 0.7, text: `Orion node ${index} remains active.` }],
      }),
    ),
  );

  const corpus = buildLiveResearchCorpus("Tell me about Orion", studies);

  assert.ok(corpus.sources.length <= 4);
  assert.equal(corpus.scope.selectedStudies, corpus.sources.length);
});
