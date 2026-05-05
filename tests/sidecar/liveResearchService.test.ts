import assert from "node:assert/strict";
import test from "node:test";

import type { IntelligencePackage, StudyItem } from "../../types";
import { PRIMARY_REASONING_ENGINE } from "../../services/intelligenceService";
import { askLiveResearchQuestion, buildLiveResearchCorpus, buildLiveResearchQuestionBenchmark } from "../../services/liveResearchService";
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

test("buildLiveResearchCorpus uses uploaded SEC source text for finance document questions", () => {
  const secStudy = makeStudy(
    "study-sec",
    "Acme Form 10-K",
    makePackage({
      clean_text: "Finance profile summary.",
      raw_text:
        "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K. Acme Corp reported revenue of USD 120 million, operating income of USD 18 million, cash flow from operations of USD 22 million, and total debt of USD 45 million.",
      research_profile: "FINANCE",
      entities: [{ id: "e1", name: "USD 120 million", type: "AMOUNT", confidence: 0.9 }],
      insights: [{ type: "summary", importance: 0.9, text: "Revenue and debt were reported in the filing." }],
    }),
  );
  const unrelatedStudy = makeStudy(
    "study-unrelated",
    "Haifa-Akko Shipping Note",
    makePackage({
      clean_text: "Haifa-Akko, a Cyprus company, and Quartz Strategy appear in an unrelated logistics case.",
      entities: [
        { id: "u1", name: "Haifa-Akko", type: "LOCATION", confidence: 0.8 },
        { id: "u2", name: "Quartz Strategy", type: "ORGANIZATION", confidence: 0.8 },
      ],
    }),
  );

  const corpus = buildLiveResearchCorpus("financial analysis of the uploaded SEC documents: revenue, cash flow, debt", [
    unrelatedStudy,
    secStudy,
  ]);

  assert.deepEqual(corpus.sources.map((source) => source.id), ["study-sec"]);
  assert.match(corpus.sources[0].evidencePreview.join("\n"), /FORM 10-K|revenue of USD 120 million|cash flow/i);
  assert.doesNotMatch(corpus.package.clean_text, /Haifa-Akko|Quartz Strategy|Cyprus/);
});

test("buildLiveResearchQuestionBenchmark measures compression for SEC finance prompts", () => {
  const rawText = [
    "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K.",
    "Revenue was USD 120 million. Operating income was USD 18 million. Cash flow from operations was USD 22 million.",
    "Total debt was USD 45 million. Liquidity risk increased.",
    "boilerplate ".repeat(1200),
  ].join(" ");
  const secStudy = makeStudy(
    "study-sec",
    "Acme Form 10-K",
    makePackage({
      clean_text: "Finance profile summary.",
      raw_text: rawText,
      research_profile: "FINANCE",
    }),
  );

  const benchmark = buildLiveResearchQuestionBenchmark(
    "זו משימת ניתוח פיננסי של מסמכי SEC. ענה בעברית פשוטה בלבד, בלי קודי מערכת, בלי מזהי ראיות, בלי FCF, בלי timeline, בלי entity, ובלי communicated_with.",
    [secStudy],
  );

  assert.equal(benchmark.route, "source-grounded");
  assert.ok(benchmark.rawSourceEstimatedTokens > benchmark.selectedContextEstimatedTokens);
  assert.ok(benchmark.promptEstimatedTokens >= benchmark.selectedContextEstimatedTokens);
  assert.ok(benchmark.compressionRatio < 1);
  assert.ok(benchmark.outputExclusions.includes("FCF"));
  assert.ok(benchmark.outputExclusions.includes("entity"));
});

test("buildLiveResearchCorpus defaults entity-context questions to the active/current document instead of global DB mixing", () => {
  const activeStudy = makeStudy(
    "study-active",
    "Active Turkey Report",
    makePackage({
      clean_text: "Turkey appears in the active report as a communications node.",
      entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.92, aliases: ["Turkish"] }],
      insights: [{ type: "summary", importance: 0.9, text: "Turkey communications node is scoped to the active report." }],
    }),
  );
  const unrelatedStudy = makeStudy(
    "study-unrelated",
    "Cyprus Quartz Strategy",
    makePackage({
      clean_text: "Cyprus, Quartz Strategy, Blue Meridian, DockPilot and BluePilot appear in another case file.",
      entities: [
        { id: "e2", name: "Cyprus", type: "LOCATION", confidence: 0.86 },
        { id: "e3", name: "Quartz Strategy", type: "ORGANIZATION", confidence: 0.84 },
      ],
      insights: [{ type: "summary", importance: 1, text: "Blue Meridian and DockPilot are unrelated matched signals." }],
    }),
  );

  const corpus = buildLiveResearchCorpus("Find all contexts for Turkey in this document.", [unrelatedStudy, activeStudy]);

  assert.deepEqual(corpus.sources.map((source) => source.id), ["study-active"]);
  assert.equal(corpus.package.document_metadata?.document_id, "study-active");
  assert.doesNotMatch(corpus.package.clean_text, /Quartz Strategy|Blue Meridian|DockPilot|BluePilot|Cyprus/);
});

test("buildLiveResearchCorpus only uses global DB records when the user explicitly asks for global search", () => {
  const activeStudy = makeStudy(
    "study-active",
    "Active Turkey Report",
    makePackage({
      clean_text: "Turkey appears in the active report as a communications node.",
      entities: [{ id: "e1", name: "Turkey", type: "LOCATION", confidence: 0.92 }],
      insights: [{ type: "summary", importance: 0.9, text: "Turkey communications node is scoped to the active report." }],
    }),
  );
  const otherStudy = makeStudy(
    "study-other",
    "Other Turkey Case",
    makePackage({
      clean_text: "Turkey appears in another database record as a finance node.",
      entities: [{ id: "e2", name: "Turkey", type: "LOCATION", confidence: 0.9 }],
      insights: [{ type: "summary", importance: 0.9, text: "Turkey finance node appears in another case." }],
    }),
  );

  const corpus = buildLiveResearchCorpus("חפש בכל המאגר את כל ההקשרים של Turkey", [activeStudy, otherStudy]);

  assert.ok(corpus.sources.length > 1);
  assert.ok(corpus.package.clean_text.includes("Other Turkey Case"));
});

test("buildLiveResearchCorpus prefers competing report with stronger direct entity mentions over weak matched signals", () => {
  const weakSignalStudy = makeStudy(
    "study-weak",
    "Cyprus Weak Signals",
    makePackage({
      clean_text: "Quartz Strategy and Blue Orbit Maritime mention regional trade patterns and one generic Turkey context tag.",
      entities: [
        { id: "e1", name: "Cyprus", type: "LOCATION", confidence: 0.84 },
        { id: "e2", name: "Quartz Strategy", type: "ORGANIZATION", confidence: 0.8 },
      ],
      insights: [{ type: "summary", importance: 1, text: "Generic matched signals mention Turkey once without evidence." }],
    }),
  );
  const strongStudy = makeStudy(
    "study-strong",
    "Turkey Direct Mentions",
    makePackage({
      clean_text: "Turkey directed the logistics route. Turkey approved the communications handoff. Turkish contacts transferred funds.",
      entities: [{ id: "e3", name: "Turkey", type: "LOCATION", confidence: 0.94, aliases: ["Turkish"] }],
      statements: [
        {
          statement_id: "stmt-1",
          statement_text: "Turkey directed the logistics route.",
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
    }),
  );

  const corpus = buildLiveResearchCorpus("Find all contexts for Turkey in this document.", [weakSignalStudy, strongStudy]);

  assert.equal(corpus.scope.active_context_id, "study-strong");
  assert.ok((corpus.scope.active_context_confidence || 0) >= 0.62);
  assert.ok((corpus.scope.query_entity_mentions_in_context || 0) >= 2);
  assert.deepEqual(corpus.sources.map((source) => source.id), ["study-strong"]);
});

test("askLiveResearchQuestion blocks synthesis when active context confidence is low", async () => {
  const ambiguousA = makeStudy(
    "study-a",
    "Cyprus Trade Memo",
    makePackage({
      clean_text: "Turkey is referenced once in a generic trade footnote.",
      entities: [{ id: "e1", name: "Cyprus", type: "LOCATION", confidence: 0.82 }],
      insights: [{ type: "summary", importance: 0.8, text: "Weak matched signal for Turkey." }],
    }),
  );
  const ambiguousB = makeStudy(
    "study-b",
    "Haifa-Akko Shipping Note",
    makePackage({
      clean_text: "Turkey is referenced once in a generic shipping footnote.",
      entities: [{ id: "e2", name: "Haifa-Akko", type: "LOCATION", confidence: 0.82 }],
      insights: [{ type: "summary", importance: 0.8, text: "Another weak matched signal for Turkey." }],
    }),
  );

  const answer = await askLiveResearchQuestion("Find all contexts for Turkey in this document.", [ambiguousA, ambiguousB], []);

  assert.equal(answer.answer, "לא ברור על איזה תיק/מסמך להריץ את השאלה.");
  assert.equal(answer.sources.length, 0);
  assert.ok((answer.scope.active_context_confidence || 0) < 0.62);
  assert.ok((answer.scope.competing_contexts || []).length >= 2);
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

test("askLiveResearchQuestion uses source-grounded finance path when the user excludes FCF and graph outputs", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const originalConsoleError = console.error;
  let capturedBody = "";

  globalThis.fetch = async (_url: any, init?: any) => {
    capturedBody = String(init?.body || "");
    return {
      ok: true,
      json: async () => ({
        message: {
          content:
            "Revenue was USD 120 million, operating income was USD 18 million, operating cash flow was USD 22 million, and debt was USD 45 million. Liquidity should be reviewed against the cash balance. [SRC-test]",
        },
      }),
    } as Response;
  };
  console.info = () => {};
  console.error = () => {};

  try {
    const secStudy = makeStudy(
      "study-sec",
      "Acme Form 10-K",
      makePackage({
        clean_text: "Finance profile summary.",
        raw_text:
          "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K. Acme Corp reported revenue of USD 120 million, operating income of USD 18 million, cash flow from operations of USD 22 million, and total debt of USD 45 million. " +
          "risk factor boilerplate ".repeat(800),
        research_profile: "FINANCE",
        entities: [{ id: "e1", name: "USD 120 million", type: "AMOUNT", confidence: 0.9 }],
      }),
    );
    const unrelatedStudy = makeStudy(
      "study-unrelated",
      "Cyprus Quartz Strategy",
      makePackage({
        clean_text: "Haifa-Akko, Cyprus company, and Quartz Strategy are unrelated logistics signals.",
        entities: [{ id: "u1", name: "Quartz Strategy", type: "ORGANIZATION", confidence: 0.8 }],
      }),
    );

    const answer = await askLiveResearchQuestion(
      "זו משימת ניתוח פיננסי של מסמכי SEC. ענה בעברית פשוטה בלבד, בלי קודי מערכת, בלי מזהי ראיות, בלי FCF, בלי timeline, בלי entity, בלי confidence, ובלי communicated_with.",
      [unrelatedStudy, secStudy],
      [],
      undefined,
      { reasoningEngineId: "ollama-local" },
    );

    assert.equal(answer.fcfAudit, undefined);
    assert.equal(answer.tokenBenchmark?.route, "source-grounded");
    assert.ok((answer.tokenBenchmark?.rawSourceEstimatedTokens || 0) > (answer.tokenBenchmark?.selectedContextEstimatedTokens || 0));
    assert.ok(answer.tokenBenchmark?.outputExclusions.includes("entity"));
    assert.ok(answer.tokenBenchmark?.outputExclusions.includes("confidence"));
    assert.deepEqual(answer.sources.map((source) => source.id), ["study-sec"]);
    assert.equal(answer.engineTrace?.responseMode, "deterministic-fallback");
    assert.doesNotMatch(answer.answer, /\bFCF\b|timeline|entity|confidence|communicated_with/i);
    assert.doesNotMatch(answer.answer, /\[[^\]]*(?:SRC|fcf|ev|hit|atom)[^\]]*\]/i);
    assert.match(answer.answer, /Acme/);
    assert.match(answer.answer, /הכנסות|מכירות/);
    assert.match(answer.answer, /תזרים|נזילות/);
    assert.doesNotMatch(answer.answer, /Revenue was USD 120 million/);
    assert.match(capturedBody, /SOURCE-GROUNDED DB CONTEXT/);
    assert.match(capturedBody, /FORM 10-K/);
    assert.match(capturedBody, /ROLE: financial-report/);
    assert.match(capturedBody, /explicitly excluded/i);
    assert.match(capturedBody, /Answer in simple Hebrew only/);
    assert.match(capturedBody, /Do not output source IDs, evidence IDs/);
    assert.doesNotMatch(capturedBody, /\[SRC-[^\]]+\]/);
    assert.doesNotMatch(capturedBody, /Haifa-Akko|Quartz Strategy|Cyprus company/);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    console.error = originalConsoleError;
  }
});

test("askLiveResearchQuestion distinguishes SEC financial reports from Form 4 ownership filings", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  const originalConsoleError = console.error;
  let capturedBody = "";

  globalThis.fetch = async (_url: any, init?: any) => {
    capturedBody = String(init?.body || "");
    return {
      ok: true,
      json: async () => ({
        message: {
          content:
            "Apple ו-Microsoft הם דוחות 10-K ומתאימים לניתוח הכנסות, רווחיות, תזרים, מאזן וסיכונים. Amazon הוא Form 4 ולכן הוא רק טופס שינוי החזקה, לא דוח כספי מלא.",
        },
      }),
    } as Response;
  };
  console.info = () => {};
  console.error = () => {};

  try {
    const amazonForm4 = makeStudy(
      "amazon-form-4",
      "Amazon SEC Form 4",
      makePackage({
        clean_text: "Amazon SEC Form 4 ownership transaction.",
        raw_text:
          "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 4. Issuer Name and Ticker or Trading Symbol Amazon.com, Inc. Reporting Owner. Transaction Date. Non-Derivative Securities Acquired, Disposed of, or Beneficially Owned.",
        research_profile: "FINANCE",
      }),
    );
    const apple10k = makeStudy(
      "apple-10k",
      "Apple SEC Form 10-K",
      makePackage({
        clean_text: "Apple annual report.",
        raw_text:
          "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K. Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations. Apple net sales, operating income, net income, cash flows, total assets, total liabilities, and risk factors are discussed.",
        research_profile: "FINANCE",
      }),
    );
    const microsoft10k = makeStudy(
      "microsoft-10k",
      "Microsoft SEC Form 10-K",
      makePackage({
        clean_text: "Microsoft annual report.",
        raw_text:
          "UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 10-K. Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations. Microsoft revenues, operating income, cash flows from operations, debt, liquidity, cloud services, and risk factors are discussed.",
        research_profile: "FINANCE",
      }),
    );

    const answer = await askLiveResearchQuestion(
      "זו משימת ניתוח פיננסי של מסמכי SEC, לא משימת מודיעין או גרף קשרים. קרא את שלושת המסמכים שהעליתי וענה בעברית פשוטה בלבד, בלי קודי מערכת, בלי מזהי ראיות, בלי FCF, בלי timeline, בלי entity, בלי confidence, ובלי קשרים כמו communicated_with",
      [amazonForm4, apple10k, microsoft10k],
      [],
      undefined,
      { reasoningEngineId: "ollama-local" },
    );

    assert.deepEqual(answer.sources.map((source) => source.id).sort(), ["amazon-form-4", "apple-10k", "microsoft-10k"].sort());
    assert.match(capturedBody, /Amazon SEC Form 4[\s\S]*SEC_FORM: FORM 4 \| ROLE: ownership-form/);
    assert.match(capturedBody, /Apple SEC Form 10-K[\s\S]*SEC_FORM: FORM 10-K \| ROLE: financial-report/);
    assert.match(capturedBody, /Microsoft SEC Form 10-K[\s\S]*SEC_FORM: FORM 10-K \| ROLE: financial-report/);
    assert.match(capturedBody, /ownership or insider-transaction form/i);
    assert.equal((capturedBody.match(/DB RECORD:/g) || []).length, 3);
    assert.match(answer.answer, /Amazon.*Form 4|Form 4.*Amazon/);
    assert.match(answer.answer, /Apple/);
    assert.match(answer.answer, /Microsoft/);
    assert.doesNotMatch(answer.answer, /\bFCF\b|timeline|entity|confidence|communicated_with/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    console.error = originalConsoleError;
  }
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
    assert.ok(typeof answer.fcfAudit?.supported_claim_rate === "number");
    assert.match(answer.verificationNote || "", /Citation verification:/);
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
    assert.ok(promptBody.includes("CLUSTERS"));
    assert.ok(promptBody.includes("EVIDENCE"));
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
    assert.ok(promptBody.includes("CLUSTERS"));
    assert.ok(promptBody.includes("EVIDENCE"));
    assert.ok(!promptBody.includes("prompt-token-waste prompt-token-waste"));
    // Model gave a real answer (even without citing IDs) → responseMode is "model-answer".
    // "verified-synthesis" only fires when citation verification also confirms < 40% support.
    assert.ok(["model-answer", "verified-synthesis"].includes(answer.engineTrace?.responseMode || ""));
    assert.ok(typeof answer.fcfAudit?.supported_claim_rate === "number");
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
