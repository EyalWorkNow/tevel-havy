import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDocument, buildEntityContextCardFromPackage, enrichIntelligencePackage, sanitizeAnalysisInput } from "../../services/analysisService";
import { __resetSidecarAvailabilityCacheForTests } from "../../services/sidecarClient";
import { IntelligencePackage } from "../../types";

const EMPTY_PACKAGE: IntelligencePackage = {
  clean_text: "",
  raw_text: "",
  word_count: 0,
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
  reliability: 0.4,
};

test("enrichIntelligencePackage expands entity coverage and fills research-facing outputs", () => {
  const sourceText = `
  On 2026-04-12 Maya Cohen emailed ops@orion.example about Orion Logistics at Pier 9.
  Cedar Finance Group funded Falcon Brokers.
  Traffic from 192.168.44.10 was redirected to https://relay-observer.example/admin on 13/04/2026.
  Leah Ben Ami requested follow-up on North Wharf and Warehouse 12.
  `;

  const enriched = enrichIntelligencePackage(EMPTY_PACKAGE, sourceText);
  const entityTypes = new Set(enriched.entities.map((entity) => entity.type));

  assert.ok(enriched.entities.length >= 8);
  assert.ok(entityTypes.has("PERSON"));
  assert.ok(entityTypes.has("ORGANIZATION"));
  assert.ok(entityTypes.has("LOCATION"));
  assert.ok(entityTypes.has("ASSET"));
  assert.ok(entityTypes.has("DATE"));

  assert.ok(enriched.relations.some((relation) => relation.type === "FUNDED"));
  assert.ok(enriched.relations.some((relation) => relation.type === "COMMUNICATED_WITH"));
  assert.ok((enriched.timeline || []).length >= 2);
  assert.ok((enriched.statements || []).length > 0);
  assert.ok((enriched.insights || []).length > 0);
  assert.ok((enriched.intel_questions || []).length > 0);
  assert.ok((enriched.intel_tasks || []).length > 0);
  assert.ok(enriched.tactical_assessment?.recommendations?.length);
  assert.ok(enriched.context_cards["Orion Logistics"]);
  assert.ok(enriched.context_cards["Orion Logistics"].summary.length > 0);
  assert.ok(enriched.research_dossier);
  assert.ok((enriched.research_dossier?.priority_threads || []).length > 0);
  assert.ok((enriched.research_dossier?.collection_priorities || []).length > 0);
  assert.match(enriched.context_cards["Orion Logistics"].extended_profile || "", /Research posture/i);
  assert.ok(enriched.clean_text.includes("Detected"));
});

test("enrichIntelligencePackage preserves existing rich records while adding missing scaffolding", () => {
  const basePackage: IntelligencePackage = {
    ...EMPTY_PACKAGE,
    clean_text: "Existing summary",
    entities: [
      {
        id: "entity_1",
        name: "Orion Logistics",
        type: "ORGANIZATION",
        description: "Existing entity description",
        confidence: 0.81,
        aliases: ["Orion Logistics"],
        evidence: ["Orion Logistics coordinated transport through Pier 9."],
      },
    ],
    relations: [
      {
        source: "Orion Logistics",
        target: "Pier 9",
        type: "MOVED_TO",
        confidence: 0.78,
      },
    ],
    context_cards: {
      "Orion Logistics": {
        entityName: "Orion Logistics",
        summary: "Existing card",
        key_mentions: ["Existing mention"],
        role_in_document: "Existing role",
      },
    },
  };

  const enriched = enrichIntelligencePackage(
    basePackage,
    "On 2026-04-12 Orion Logistics coordinated transport through Pier 9.",
  );

  assert.ok(enriched.entities.some((entity) => entity.name === "Orion Logistics"));
  assert.ok(enriched.relations.some((relation) => relation.type === "MOVED_TO"));
  assert.ok(enriched.timeline?.some((event) => event.date === "2026-04-12"));
  assert.equal(enriched.context_cards["Orion Logistics"].summary, "Existing card");
});

test("enrichIntelligencePackage broadens Hebrew investigative extraction beyond people and organizations", () => {
  const sourceText = `
  ב-2026-04-12 מר יואב כהן שלח מייל אל חברת אוריון לוגיסטיקה לגבי נמל אשדוד ורציף 3.
  קבוצת ארז מימנה את מבצע חוף שקט והעבירה מכולה 17 למחסן דרום ב-13/04/2026.
  ראש הצוות דנה לוי תיעדה שימוש בטלפון לווייני ובשרת relay-7.
  `;

  const enriched = enrichIntelligencePackage(EMPTY_PACKAGE, sourceText);
  const entityTypes = new Set(enriched.entities.map((entity) => entity.type));

  assert.ok(enriched.entities.length >= 10);
  assert.ok(entityTypes.has("PERSON"));
  assert.ok(entityTypes.has("ORGANIZATION"));
  assert.ok(entityTypes.has("LOCATION"));
  assert.ok(entityTypes.has("EVENT"));
  assert.ok(entityTypes.has("OBJECT") || entityTypes.has("ASSET"));
  assert.ok(enriched.context_cards["נמל אשדוד"]);
  assert.ok(enriched.context_cards["מבצע חוף שקט"]);
  assert.ok(enriched.relations.some((relation) => relation.type === "FUNDED"));
  assert.ok(enriched.relations.some((relation) => relation.type === "COMMUNICATED_WITH"));
  assert.ok(enriched.relations.some((relation) => relation.type === "MOVED_TO"));
  assert.ok((enriched.timeline || []).length >= 2);
  assert.match(enriched.clean_text, /זוהו \d+ ישויות/);
  assert.ok((enriched.intel_questions || []).length > 0);
  assert.ok((enriched.intel_tasks || []).length > 0);
});

test("analyzeDocument returns a fast structured package without waiting on legacy model extraction", async () => {
  const sourceText = `
  On 2026-04-12 Cedar Finance Group funded Falcon Brokers through North Wharf.
  Maya Cohen emailed ops@orion.example about Pier 9 and Warehouse 12.
  `;

  const result = await analyzeDocument(sourceText);

  assert.ok(result.entities.length >= 6);
  assert.ok(result.relations.some((relation) => relation.type === "FUNDED"));
  assert.ok(Object.keys(result.context_cards).length >= 4);
  assert.ok((result.timeline || []).length >= 1);
  assert.ok((result.research_dossier?.priority_threads || []).length > 0);
});

test("sanitizeAnalysisInput removes ingestion control wrappers and Admiralty Code markers", () => {
  const raw = `
[METADATA_START]
TITLE: Case
RELIABILITY: B2 (Admiralty Code)
[METADATA_END]

[SYSTEM ATTACHMENT]
FILENAME: report.txt
TYPE: TEXT
METADATA: 1200 bytes
[EXTRACTED_TEXT_START]
Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.
[EXTRACTED_TEXT_END]
  `;

  const sanitized = sanitizeAnalysisInput(raw);

  assert.ok(!sanitized.includes("Admiralty Code"));
  assert.ok(!sanitized.includes("[METADATA_START]"));
  assert.ok(!sanitized.includes("FILENAME:"));
  assert.match(sanitized, /Maya Cohen met Omar Saleh in Tel Aviv/);
});

test("analyzeDocument keeps broad recall on a larger entity-dense text", async () => {
  const names = [
    "Cedar Finance Group",
    "Falcon Brokers",
    "Orion Logistics",
    "North Wharf",
    "Warehouse 12",
    "Pier 9",
    "Maya Cohen",
    "Leah Ben Ami",
    "Jordan Valley Crossing",
    "Ashdod Port",
    "Relay Server 7",
    "Container 44A",
  ];

  const sourceText = names
    .map((name, index) => `Entry ${index + 1}: ${name} was referenced on 2026-04-${String((index % 9) + 10).padStart(2, "0")}.`)
    .join("\n");

  const result = await analyzeDocument(sourceText);
  const extractedNames = new Set(result.entities.map((entity) => entity.name));

  assert.ok(result.entities.length >= 12);
  assert.ok(extractedNames.has("Ashdod Port"));
  assert.ok(extractedNames.has("Jordan Valley Crossing"));
  assert.ok(result.entities.filter((entity) => entity.type === "LOCATION").length >= 4);
});

test("analyzeDocument blocks phantom ingestion metadata entities and keeps timeline/workbench populated", async () => {
  const sourceText = `
[METADATA_START]
TITLE: Intake
RELIABILITY: B2 (Admiralty Code)
[METADATA_END]

On 2026-04-12 Maya Cohen met Omar Saleh at Ashdod Port.
Cedar Finance Group funded Falcon Brokers near Warehouse 12.
  `;

  const result = await analyzeDocument(sourceText);
  const entityNames = new Set(result.entities.map((entity) => entity.name));

  assert.ok(!entityNames.has("Admiralty Code"));
  assert.ok((result.timeline || []).length > 0);
  assert.ok((result.intel_questions || []).length > 0);
  assert.ok((result.intel_tasks || []).length > 0);
});

test("analyzeDocument scales to a dense list of mixed-domain entities", async () => {
  const sourceText = `
  People: Maya Cohen, Leah Ben Ami, Daniel Regev, Amir Azulay, Noa Levi.
  Organizations: Cedar Finance Group, Falcon Brokers, Orion Logistics, Atlas Procurement, Delta Holdings.
  Locations: Ashdod Port, Jordan Valley Crossing, North Wharf, Warehouse 12, Pier 9.
  Assets: relay-7, ops@orion.example, 192.168.44.10, Container 44A, Wallet 0x1234abcd9876ef.
  Events: Operation Quiet Shore, Transfer Meeting, Procurement Shipment, Payment Session, Briefing Call.
  Dates: 2026-04-12, 2026-04-13, 2026-04-14, 2026-04-15, 2026-04-16.
  `;

  const result = await analyzeDocument(sourceText);
  const types = new Set(result.entities.map((entity) => entity.type));

  assert.ok(result.entities.length >= 20);
  assert.ok(types.has("PERSON"));
  assert.ok(types.has("ORGANIZATION"));
  assert.ok(types.has("LOCATION"));
  assert.ok(types.has("ASSET"));
  assert.ok(types.has("EVENT") || types.has("METHOD") || types.has("OBJECT"));
});

test("analyzeDocument adapts to civilian mixed-domain research entities like vehicles and identifiers", async () => {
  const sourceText = `
  On 2026-04-14 Dr. Lina Haddad inspected Toyota Corolla near Meridian Clinic Building A on Harbor Road.
  Vehicle plate AX-442-19 and VIN JTMAB3FV70D123456 were recorded beside container MSCU1234567.
  Payment instructions referenced IBAN GB82WEST12345698765432 and SWIFT DEUTDEFF.
  Omar Saleh later moved the same vehicle toward North Valley Campus.
  `;

  const result = await analyzeDocument(sourceText);
  const names = new Set(result.entities.map((entity) => entity.name));
  const types = new Set(result.entities.map((entity) => entity.type));

  assert.ok(names.has("Toyota Corolla"));
  assert.ok(names.has("Meridian Clinic Building A") || names.has("Harbor Road") || names.has("North Valley Campus"));
  assert.ok(names.has("AX-442-19"));
  assert.ok(names.has("JTMAB3FV70D123456"));
  assert.ok(names.has("MSCU1234567"));
  assert.ok(types.has("VEHICLE"));
  assert.ok(types.has("IDENTIFIER"));
  assert.ok(types.has("LOCATION"));
  assert.ok(types.has("PERSON"));
});

test("analyzeDocument detects person names from Hebrew and English action context", async () => {
  const sourceText = `
  החוקר פגש את יוסי כהן בנמל אשדוד ולאחר מכן שוחח עם נועה לוי.
  Investigators later contacted Lina Haddad and briefed Omar Saleh near Tel Aviv.
  `;

  const result = await analyzeDocument(sourceText);
  const names = new Set(result.entities.map((entity) => entity.name));
  const people = result.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.name);

  assert.ok(names.has("יוסי כהן"));
  assert.ok(names.has("נועה לוי"));
  assert.ok(names.has("Lina Haddad"));
  assert.ok(names.has("Omar Saleh"));
  assert.ok(people.length >= 4);
});

test("buildEntityContextCardFromPackage returns evidence-first context without model fallback text", () => {
  const enriched = enrichIntelligencePackage(
    EMPTY_PACKAGE,
    "On 2026-04-12 Maya Cohen emailed Orion Logistics about Ashdod Port and Warehouse 12.",
  );

  const card = buildEntityContextCardFromPackage(enriched, "Maya Cohen");

  assert.ok(card);
  assert.ok(card?.summary.length);
  assert.ok(!(card?.summary || "").includes("local model could not produce"));
  assert.ok((card?.key_mentions || []).length > 0);
  assert.ok(card?.extended_profile?.includes("## Evidence Highlights"));
});

test("analyzeDocument uses local sidecar smart extraction when available", async () => {
  __resetSidecarAvailabilityCacheForTests();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/sidecar/health")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("/api/sidecar/smart-extract")) {
      return new Response(
        JSON.stringify({
          source_doc_id: "doc-sidecar",
          raw_text: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
          normalized_text: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
          normalization_steps: [],
          generated_at: new Date().toISOString(),
          pipeline_version: "test",
          text_units: [],
          candidates: [],
          mentions: [
            {
              candidate_id: "cand_1",
              mention_id: "m1",
              source_doc_id: "doc-sidecar",
              source_text_unit_id: "unit_1",
              char_start: 0,
              char_end: 10,
              normalized_char_start: 0,
              normalized_char_end: 10,
              raw_char_start: 0,
              raw_char_end: 10,
              raw_text: "Maya Cohen",
              normalized_text: "Maya Cohen",
              mention_text: "Maya Cohen",
              entity_type: "PERSON",
              entity_id: "e1",
              label: "PERSON",
              candidate_type: "PERSON",
              extraction_source: "model",
              confidence: 0.91,
              metadata: {},
              evidence: {
                evidence_id: "ev1",
                source_doc_id: "doc-sidecar",
                source_text_unit_id: "unit_1",
                start: 0,
                end: 10,
                normalized_start: 0,
                normalized_end: 10,
                raw_start: 0,
                raw_end: 10,
                raw_supporting_snippet: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                normalized_supporting_snippet: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                normalized_text: "Maya Cohen",
                extraction_source: "model",
                confidence: 0.91,
              },
            },
          ],
          entities: [
            {
              entity_id: "e1",
              source_doc_id: "doc-sidecar",
              canonical_name: "Maya Cohen",
              normalized_name: "maya cohen",
              entity_type: "PERSON",
              aliases: ["Maya Cohen"],
              mention_ids: ["m1"],
              source_text_unit_ids: ["unit_1"],
              extraction_sources: ["model"],
              confidence: 0.91,
              timestamps: [],
              corroborating_mention_ids: [],
              contradicting_entity_ids: [],
            },
            {
              entity_id: "e2",
              source_doc_id: "doc-sidecar",
              canonical_name: "Orion Logistics",
              normalized_name: "orion logistics",
              entity_type: "ORGANIZATION",
              aliases: ["Orion Logistics"],
              mention_ids: ["m2"],
              source_text_unit_ids: ["unit_1"],
              extraction_sources: ["model"],
              confidence: 0.89,
              timestamps: [],
              corroborating_mention_ids: [],
              contradicting_entity_ids: [],
            },
            {
              entity_id: "e3",
              source_doc_id: "doc-sidecar",
              canonical_name: "Ashdod Port",
              normalized_name: "ashdod port",
              entity_type: "LOCATION",
              aliases: ["Ashdod Port"],
              mention_ids: ["m3"],
              source_text_unit_ids: ["unit_1"],
              extraction_sources: ["model"],
              confidence: 0.88,
              timestamps: [],
              corroborating_mention_ids: [],
              contradicting_entity_ids: [],
            },
          ],
          relation_candidates: [
            {
              relation_id: "r1",
              source_doc_id: "doc-sidecar",
              source_text_unit_id: "unit_1",
              source_entity_id: "e1",
              target_entity_id: "e2",
              source_mention_ids: ["m1"],
              target_mention_ids: ["m2"],
              relation_type: "COMMUNICATED_WITH",
              normalized_text: "Maya Cohen emailed Orion Logistics",
              extraction_source: "model",
              confidence: 0.86,
              evidence: {
                evidence_id: "ev2",
                source_doc_id: "doc-sidecar",
                source_text_unit_id: "unit_1",
                start: 0,
                end: 31,
                normalized_start: 0,
                normalized_end: 31,
                raw_start: 0,
                raw_end: 31,
                raw_supporting_snippet: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                normalized_supporting_snippet: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                normalized_text: "Maya Cohen emailed Orion Logistics",
                extraction_source: "model",
                confidence: 0.86,
              },
            },
          ],
          event_candidates: [
            {
              event_id: "evt1",
              source_doc_id: "doc-sidecar",
              source_text_unit_id: "unit_1",
              event_type: "COMMUNICATION_EVENT",
              trigger_text: "emailed",
              trigger_normalized_text: "emailed",
              actor_entity_ids: ["e1"],
              actor_mention_ids: ["m1"],
              target_entity_ids: ["e2"],
              target_mention_ids: ["m2"],
              location_entity_ids: ["e3"],
              location_mention_ids: ["m3"],
              normalized_text: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
              extraction_source: "model",
              confidence: 0.84,
              timestamp: "2026-04-13",
              evidence: {
                evidence_id: "ev3",
                source_doc_id: "doc-sidecar",
                source_text_unit_id: "unit_1",
                start: 0,
                end: 54,
                normalized_start: 0,
                normalized_end: 54,
                raw_start: 0,
                raw_end: 54,
                raw_supporting_snippet: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                normalized_supporting_snippet: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                normalized_text: "Maya Cohen emailed Orion Logistics about Ashdod Port.",
                extraction_source: "model",
                confidence: 0.84,
              },
              metadata: {},
            },
          ],
          claim_candidates: [],
          stats: {
            doc_char_length: 54,
            text_unit_count: 1,
            candidate_count: 0,
            mention_count: 1,
            entity_count: 3,
            relation_count: 1,
            event_count: 1,
            claim_count: 0,
            duplicate_collapse_rate: 0,
            evidence_coverage_rate: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/api/persons/extract") || url.includes("/api/persons/resolve") || url.includes("/api/persons/")) {
      return new Response(JSON.stringify({ error: "person endpoint not used in this test" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await analyzeDocument("Maya Cohen emailed Orion Logistics about Ashdod Port.");
    const names = new Set(result.entities.map((entity) => entity.name));

    assert.ok(names.has("Maya Cohen"));
    assert.ok(names.has("Orion Logistics"));
    assert.ok(names.has("Ashdod Port"));
    assert.ok(result.relations.some((relation) => relation.type === "COMMUNICATED_WITH"));
    assert.ok(result.timeline?.some((event) => event.date === "2026-04-13"));
  } finally {
    globalThis.fetch = originalFetch;
    __resetSidecarAvailabilityCacheForTests();
  }
});

test("analyzeDocument keeps person entities clean and avoids date-noise as the semantic lead", async () => {
  const sourceText = `
  On 2026-04-14 Maya Cohen met Omar Saleh in Tel Aviv.
  Leah Ben Ami emailed Orion Logistics about Ashdod Port.
  Dr. Lina Haddad reviewed the manifest with Daniel Regev and Yael Mor.
  `;

  const result = await analyzeDocument(sourceText);
  const names = new Set(result.entities.map((entity) => entity.name));
  const personNames = result.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.name);

  assert.ok(names.has("Maya Cohen"));
  assert.ok(names.has("Omar Saleh"));
  assert.ok(names.has("Leah Ben Ami"));
  assert.ok(names.has("Lina Haddad"));
  assert.ok(names.has("Daniel Regev"));
  assert.ok(names.has("Yael Mor"));

  assert.ok(!names.has("14 Maya Cohen"));
  assert.ok(!names.has("On 2026-"));
  assert.ok(!names.has("Dr. Lina Haddad reviewed"));
  assert.ok(!personNames.some((name) => /reviewed|emailed|met/i.test(name)));

  assert.ok(result.timeline?.some((event) => /Maya Cohen|Omar Saleh|Leah Ben Ami|Lina Haddad/.test(event.event)));
  assert.ok(result.intel_questions?.[0]?.question_text);
  assert.ok(!result.intel_questions?.[0]?.question_text.includes("2026-04-14"));
  assert.ok(!result.clean_text.includes("On 2026-,"));
});

test("analyzeDocument extracts Hebrew operational person names without misclassifying generic task phrases as people", async () => {
  const sourceText = `
  מסמך דרישת צי"ח - גזרת איו"ש
  במהלך השבועיים האחרונים מזהים התעוררות של חולייה מקומית בשם "אריות הקסבה" במחנה הפליטים בלאטה בשכם.
  בראש החולייה עומד היעד מוחמד אבו-סאלח ("המהנדס").
  קיימת אינדיקציה על ניסיון להעברת כספים משמעותית מחמאס טורקיה דרך חלפן כספים בג'נין.
  האם התקיים מפגש פיזי בין מוחמד אבו-סאלח לבין החלפן ג'מאל זביידי ב-48 שעות האחרונות?
  היכן מסתתר כרגע סגנו של אבו-סאלח, הפעיל איברהים כרמי?
  `;

  const result = await analyzeDocument(sourceText);
  const personNames = new Set(result.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.name));

  assert.ok(personNames.has("מוחמד אבו-סאלח"));
  assert.ok(personNames.has("ג'מאל זביידי"));
  assert.ok(personNames.has("איברהים כרמי"));
  assert.ok(!personNames.has("לחלפנות כספים"));
  assert.ok(!personNames.has("ציר הכסף"));
  assert.ok(!personNames.has("Essential Elements of Information"));
});

test("analyzeDocument detects Arabic-script and transliterated person names across mixed-language text", async () => {
  const sourceText = `
  اجتمع الهدف أحمد بن صالح مع الوسيط ليلى حداد في نابلس.
  Later, Ahmed bin Saleh contacted Lina al-Khatib about the transfer route.
  `;

  const result = await analyzeDocument(sourceText);
  const personNames = new Set(result.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.name));

  assert.ok(personNames.has("أحمد بن صالح"));
  assert.ok(personNames.has("ليلى حداد"));
  assert.ok(personNames.has("Ahmed bin Saleh"));
  assert.ok(personNames.has("Lina al-Khatib"));
  assert.ok(!personNames.has("transfer route"));
});

test("analyzeDocument catches multilingual standalone full names without requiring action context", async () => {
  const sourceText = `
  רשימת יעד: מוחמד אבו-סאלח, ג'מאל זביידי.
  الأسماء المرصودة: أحمد بن صالح، ليلى حداد.
  Observed names: Ahmed bin Saleh, Lina al-Khatib.
  `;

  const result = await analyzeDocument(sourceText);
  const personNames = new Set(result.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.name));

  assert.ok(personNames.has("מוחמד אבו-סאלח"));
  assert.ok(personNames.has("ג'מאל זביידי"));
  assert.ok(personNames.has("أحمد بن صالح"));
  assert.ok(personNames.has("ليلى حداد"));
  assert.ok(personNames.has("Ahmed bin Saleh"));
  assert.ok(personNames.has("Lina al-Khatib"));
});

test("analyzeDocument avoids exploding report headers into person entities on layered intelligence documents", async () => {
  const sourceText = `
  דו"ח מודיעין שב"ס (ענף איסוף)
  סיווג: סודי ביותר | מאת: קמ"ן כלא "אשל" | אל: חמ"ל מחוז חוף
  1. מקור המידע
  במסגרת פעילות יזומה יורט מסר שנכתב בידי האסיר הביטחוני סאמי נאסר והיה מיועד לאחיינו רפעת נאסר הפועל במרחב חיפה.
  האם חברת Blue Orbit Maritime משמשת כחברת כיסוי לציר הכסף?
  כלל רכיבי המבצע כבר במרחב ודורשים מעקב.
  על החתום, שירות בתי הסוהר
  `;

  const result = await analyzeDocument(sourceText);
  const personNames = new Set(result.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.name));
  const orgNames = new Set(result.entities.filter((entity) => entity.type === "ORGANIZATION").map((entity) => entity.name));

  assert.ok(personNames.has("סאמי נאסר"));
  assert.ok(personNames.has("רפעת נאסר"));
  assert.ok(!personNames.has("דו\"ח מודיעין"));
  assert.ok(!personNames.has("מקור המידע"));
  assert.ok(!personNames.has("על החתום"));
  assert.ok(!personNames.has("שירות בתי הסוהר"));
  assert.ok(!personNames.has("Blue Orbit Maritime"));
  assert.ok(!personNames.has("כבר במרחב"));
  assert.ok(orgNames.has("חברת Blue Orbit Maritime") || orgNames.has("Blue Orbit Maritime"));
  assert.ok(personNames.size <= 4);
});

test("analyzeDocument integrates backend person extraction and attaches person dossiers to context cards", async () => {
  __resetSidecarAvailabilityCacheForTests();

  const originalFetch = globalThis.fetch;
  const mockJsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/api/sidecar/health")) {
      return mockJsonResponse({ ok: true });
    }

    if (url.endsWith("/api/sidecar/smart-extract")) {
      return mockJsonResponse({
        source_doc_id: "doc_mock",
        raw_text: "Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.",
        normalized_text: "Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.",
        normalization_steps: [],
        generated_at: new Date().toISOString(),
        pipeline_version: "test",
        text_units: [],
        candidates: [],
        mentions: [],
        entities: [],
        relation_candidates: [],
        event_candidates: [],
        claim_candidates: [],
        stats: {
          doc_char_length: 53,
          text_unit_count: 1,
          candidate_count: 0,
          mention_count: 0,
          entity_count: 0,
          relation_count: 0,
          event_count: 0,
          claim_count: 0,
          duplicate_collapse_rate: 0,
          evidence_coverage_rate: 1,
        },
      });
    }

    if (url.endsWith("/api/persons/extract")) {
      return mockJsonResponse({
        caseId: "case_mock",
        documentId: "doc_mock",
        mentions: [
          {
            mentionId: "pm1",
            documentId: "doc_mock",
            chunkId: "person_chunk_0",
            text: "Maya Cohen",
            normalizedText: "maya cohen",
            sentenceText: "Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.",
            startChar: 0,
            endChar: 10,
            language: "en",
            confidence: 0.93,
            extractor: "gliner2",
          },
        ],
        facts: [
          {
            factId: "pf1",
            entityId: "person_1",
            kind: "location",
            value: "Tel Aviv",
            confidence: 0.74,
            evidenceMentionIds: ["pm1"],
          },
          {
            factId: "pf2",
            entityId: "person_1",
            kind: "date",
            value: "2026-04-12",
            confidence: 0.8,
            evidenceMentionIds: ["pm1"],
          },
        ],
        provisionalEntities: [
          {
            entityId: "person_1",
            canonicalName: "Maya Cohen",
            aliases: ["Maya Cohen"],
            mentions: ["pm1"],
            facts: ["pf1", "pf2"],
            confidence: 0.93,
          },
        ],
        warnings: [],
        extractionMode: "backend",
        generatedAt: new Date().toISOString(),
      });
    }

    if (url.endsWith("/api/persons/resolve")) {
      return mockJsonResponse({
        caseId: "case_mock",
        entities: [
          {
            entityId: "person_1",
            canonicalName: "Maya Cohen",
            aliases: ["Maya Cohen", "M. Cohen"],
            mentions: ["pm1"],
            facts: ["pf1", "pf2", "pf3"],
            confidence: 0.93,
          },
        ],
        facts: [
          {
            factId: "pf1",
            entityId: "person_1",
            kind: "location",
            value: "Tel Aviv",
            confidence: 0.74,
            evidenceMentionIds: ["pm1"],
          },
          {
            factId: "pf2",
            entityId: "person_1",
            kind: "date",
            value: "2026-04-12",
            confidence: 0.8,
            evidenceMentionIds: ["pm1"],
          },
          {
            factId: "pf3",
            entityId: "person_1",
            kind: "organization",
            value: "Meridian Logistics",
            confidence: 0.73,
            evidenceMentionIds: ["pm1"],
          },
        ],
        dossiers: {
          person_1: {
            entityId: "person_1",
            canonicalName: "Maya Cohen",
            aliases: ["M. Cohen"],
            titles: [],
            roles: ["analyst"],
            organizations: ["Meridian Logistics"],
            contact: { emails: [], phones: [] },
            locations: ["Tel Aviv"],
            dates: ["2026-04-12"],
            relationships: [],
            claims: [],
            sourceMentions: ["pm1"],
            overallConfidence: 0.91,
          },
        },
        unresolvedMentions: [],
        warnings: [],
        resolutionMode: "backend",
        generatedAt: new Date().toISOString(),
      });
    }

    return mockJsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  try {
    const result = await analyzeDocument("Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.");
    const maya = result.entities.find((entity) => entity.name === "Maya Cohen");

    assert.ok(maya);
    assert.equal(maya?.type, "PERSON");
    assert.equal(result.person_pipeline?.mode, "backend");
    assert.ok(result.person_entities?.some((entity) => entity.canonicalName === "Maya Cohen"));
    assert.ok(result.person_dossiers?.person_1);
    assert.ok(result.context_cards["Maya Cohen"]?.personDossier);
    assert.match(result.context_cards["Maya Cohen"]?.extended_profile || "", /Person Dossier/);
  } finally {
    globalThis.fetch = originalFetch;
    __resetSidecarAvailabilityCacheForTests();
  }
});

test("analyzeDocument skips per-person dossier lookups when resolve payload already includes dossiers", async () => {
  __resetSidecarAvailabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  const mockJsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url.endsWith("/api/sidecar/health")) {
      return new Response("ok", { status: 200 });
    }

    if (url.endsWith("/api/sidecar/smart-extract")) {
      return mockJsonResponse({
        source_doc_id: "doc_mock",
        raw_text: "Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.",
        normalized_text: "Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.",
        normalization_steps: [],
        generated_at: new Date().toISOString(),
        pipeline_version: "test",
        text_units: [],
        candidates: [],
        mentions: [],
        entities: [],
        relation_candidates: [],
        event_candidates: [],
        claim_candidates: [],
        stats: {
          doc_char_length: 53,
          text_unit_count: 1,
          candidate_count: 0,
          mention_count: 0,
          entity_count: 0,
          relation_count: 0,
          event_count: 0,
          claim_count: 0,
          duplicate_collapse_rate: 0,
          evidence_coverage_rate: 1,
        },
      });
    }

    if (url.endsWith("/api/persons/extract")) {
      return mockJsonResponse({
        caseId: "case_mock",
        documentId: "doc_mock",
        mentions: [],
        facts: [],
        provisionalEntities: [],
        warnings: [],
        extractionMode: "backend",
        generatedAt: new Date().toISOString(),
      });
    }

    if (url.endsWith("/api/persons/resolve")) {
      return mockJsonResponse({
        caseId: "case_mock",
        entities: [
          {
            entityId: "person_1",
            canonicalName: "Maya Cohen",
            aliases: ["Maya Cohen"],
            mentions: ["pm1"],
            facts: [],
            confidence: 0.9,
          },
        ],
        facts: [],
        dossiers: {
          person_1: {
            entityId: "person_1",
            canonicalName: "Maya Cohen",
            aliases: [],
            titles: [],
            roles: [],
            organizations: [],
            contact: { emails: [], phones: [] },
            locations: [],
            dates: [],
            relationships: [],
            claims: [],
            sourceMentions: ["pm1"],
            overallConfidence: 0.9,
          },
        },
        unresolvedMentions: [],
        warnings: [],
        resolutionMode: "backend",
        generatedAt: new Date().toISOString(),
      });
    }

    return mockJsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  try {
    const result = await analyzeDocument("Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.");
    assert.ok(result.person_dossiers?.person_1);
    assert.equal(requestedUrls.some((url) => url.includes("/api/persons/person_1/dossier")), false);
  } finally {
    globalThis.fetch = originalFetch;
    __resetSidecarAvailabilityCacheForTests();
  }
});

test("analyzeDocument filters self-referential relation edges from smart extraction payloads", async () => {
  __resetSidecarAvailabilityCacheForTests();
  const originalFetch = globalThis.fetch;

  const mockJsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/api/sidecar/health")) {
      return new Response("ok", { status: 200 });
    }

    if (url.endsWith("/api/sidecar/smart-extract")) {
      return mockJsonResponse({
        source_doc_id: "doc_mock",
        raw_text: "Maya Cohen met Maya Cohen in Tel Aviv.",
        normalized_text: "Maya Cohen met Maya Cohen in Tel Aviv.",
        normalization_steps: [],
        generated_at: new Date().toISOString(),
        pipeline_version: "test",
        text_units: [],
        candidates: [],
        mentions: [],
        entities: [
          {
            entity_id: "entity_1",
            canonical_name: "Maya Cohen",
            entity_type: "PERSON",
            aliases: ["Maya Cohen"],
            mention_ids: [],
            confidence: 0.92,
            salience: 0.88,
            metadata: {},
          },
        ],
        relation_candidates: [
          {
            relation_id: "rel_1",
            relation_type: "COMMUNICATED_WITH",
            source_entity_id: "entity_1",
            target_entity_id: "entity_1",
            confidence: 0.95,
            extraction_source: "test",
            evidence: {
              source_doc_id: "doc_mock",
              source_text_unit_id: "tu_1",
              raw_supporting_snippet: "Maya Cohen met Maya Cohen in Tel Aviv.",
              normalized_supporting_snippet: "Maya Cohen met Maya Cohen in Tel Aviv.",
              raw_start: 0,
              raw_end: 37,
              normalized_start: 0,
              normalized_end: 37,
            },
            metadata: {},
          },
        ],
        event_candidates: [],
        claim_candidates: [],
        stats: {
          doc_char_length: 37,
          text_unit_count: 1,
          candidate_count: 0,
          mention_count: 0,
          entity_count: 1,
          relation_count: 1,
          event_count: 0,
          claim_count: 0,
          duplicate_collapse_rate: 0,
          evidence_coverage_rate: 1,
        },
      });
    }

    if (url.endsWith("/api/persons/extract")) {
      return mockJsonResponse({
        caseId: "case_mock",
        documentId: "doc_mock",
        mentions: [],
        facts: [],
        provisionalEntities: [],
        warnings: [],
        extractionMode: "backend",
        generatedAt: new Date().toISOString(),
      });
    }

    if (url.endsWith("/api/persons/resolve")) {
      return mockJsonResponse({
        caseId: "case_mock",
        entities: [],
        facts: [],
        dossiers: {},
        unresolvedMentions: [],
        warnings: [],
        resolutionMode: "backend",
        generatedAt: new Date().toISOString(),
      });
    }

    return mockJsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  try {
    const result = await analyzeDocument("Maya Cohen met Maya Cohen in Tel Aviv.");
    assert.equal(result.relations.length, 0);
    assert.equal(result.graph.edges.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    __resetSidecarAvailabilityCacheForTests();
  }
});

test("analyzeDocument returns deterministic fallback output instead of throwing when backend analysis crashes", async () => {
  __resetSidecarAvailabilityCacheForTests();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/sidecar/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/sidecar/smart-extract")) {
      throw new Error("simulated extraction crash");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await analyzeDocument("Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12.");
    assert.ok(result.entities.length > 0);
    assert.equal(result.person_pipeline?.mode, "fallback");
    assert.ok((result.person_pipeline?.warnings || []).length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    __resetSidecarAvailabilityCacheForTests();
  }
});

test("analyzeDocument bypasses heavy backend extraction for very large documents instead of failing", async () => {
  __resetSidecarAvailabilityCacheForTests();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/sidecar/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Large-document path should not call backend endpoint: ${url}`);
  }) as typeof fetch;

  try {
    const unit = "Maya Cohen met Omar Saleh in Tel Aviv on 2026-04-12. Orion Logistics funded Falcon Brokers via Ashdod Port.";
    const largeText = Array.from({ length: 2500 }, () => unit).join("\n");
    const result = await analyzeDocument(largeText);
    assert.ok(result.entities.length > 0);
    assert.equal(result.person_pipeline?.mode, "fallback");
    assert.ok(result.person_pipeline?.warnings?.some((warning) => warning.includes("Large document detected")));
  } finally {
    globalThis.fetch = originalFetch;
    __resetSidecarAvailabilityCacheForTests();
  }
});
