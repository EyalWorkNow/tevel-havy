import assert from "node:assert/strict";
import test from "node:test";

import { buildPersonDossier, extractPersons, resolvePersons } from "../../services/sidecar/person/resolver";
import { PersonExtractionResponse } from "../../services/sidecar/person/types";

test("extractPersons finds person mentions and evidence-linked facts from text", () => {
  const text = `
  Dr. Lina Haddad met Maya Cohen at Ashdod Port on 2026-04-14.
  Lina Haddad later emailed ops@meridian.example and reported to Meridian Logistics.
  `;

  const extracted = extractPersons({
    caseId: "case_person_1",
    documentId: "doc_person_1",
    rawText: text,
    chunks: text
      .trim()
      .split(/\n+/)
      .map((line, index) => ({ chunkId: `chunk_${index}`, text: line.trim() })),
    language: "en",
  });

  assert.ok(extracted.mentions.some((mention) => mention.text.includes("Lina Haddad")));
  assert.ok(extracted.mentions.some((mention) => mention.text.includes("Maya Cohen")));
  assert.ok(extracted.facts.some((fact) => fact.kind === "location" && fact.value.includes("Ashdod Port")));
  assert.ok(extracted.facts.some((fact) => fact.kind === "date" && fact.value.includes("2026-04-14")));
  assert.ok(!extracted.facts.some((fact) => fact.kind === "phone" && fact.value.includes("2026-04-14")));
});

test("resolvePersons merges short-form references only when context is compatible", () => {
  const extracted: PersonExtractionResponse = {
    caseId: "case_person_2",
    documentId: "doc_person_2",
    mentions: [
      {
        mentionId: "m1",
        documentId: "doc_person_2",
        chunkId: "chunk_1",
        text: "Maya Cohen",
        normalizedText: "maya cohen",
        sentenceText: "Maya Cohen briefed the team.",
        startChar: 0,
        endChar: 10,
        language: "en",
        confidence: 0.92,
        extractor: "merged",
      },
      {
        mentionId: "m2",
        documentId: "doc_person_2",
        chunkId: "chunk_2",
        text: "Cohen",
        normalizedText: "cohen",
        sentenceText: "Cohen later reviewed the payment trail.",
        startChar: 25,
        endChar: 30,
        language: "en",
        confidence: 0.71,
        extractor: "rule",
      },
      {
        mentionId: "m3",
        documentId: "doc_person_2",
        chunkId: "chunk_3",
        text: "Daniel Cohen",
        normalizedText: "daniel cohen",
        sentenceText: "Daniel Cohen signed for Atlas Procurement.",
        startChar: 55,
        endChar: 67,
        language: "en",
        confidence: 0.88,
        extractor: "merged",
      },
    ],
    facts: [
      {
        factId: "f1",
        entityId: "person_1",
        kind: "organization",
        value: "Meridian Logistics",
        normalizedValue: "meridian logistics",
        confidence: 0.78,
        evidenceMentionIds: ["m1", "m2"],
      },
      {
        factId: "f2",
        entityId: "person_2",
        kind: "organization",
        value: "Atlas Procurement",
        normalizedValue: "atlas procurement",
        confidence: 0.8,
        evidenceMentionIds: ["m3"],
      },
    ],
    provisionalEntities: [
      {
        entityId: "person_1",
        canonicalName: "Maya Cohen",
        aliases: ["Maya Cohen"],
        mentions: ["m1"],
        facts: ["f1"],
        confidence: 0.92,
      },
      {
        entityId: "person_2",
        canonicalName: "Daniel Cohen",
        aliases: ["Daniel Cohen"],
        mentions: ["m3"],
        facts: ["f2"],
        confidence: 0.88,
      },
    ],
    warnings: [],
    extractionMode: "backend",
    generatedAt: new Date().toISOString(),
  };

  const resolved = resolvePersons("case_person_2", extracted);

  const maya = resolved.entities.find((entity) => entity.canonicalName === "Maya Cohen");
  const daniel = resolved.entities.find((entity) => entity.canonicalName === "Daniel Cohen");

  assert.ok(maya);
  assert.ok(daniel);
  assert.ok(maya?.mentions.includes("m2"));
  assert.ok(!daniel?.mentions.includes("m2"));
  assert.equal(resolved.entities.length, 2);
});

test("buildPersonDossier blocks low-evidence entities and emits compact structured dossiers otherwise", () => {
  const blocked = buildPersonDossier(
    "person_low",
    {
      entityId: "person_low",
      canonicalName: "Lina Haddad",
      aliases: ["Lina Haddad"],
      mentions: ["m1"],
      facts: [],
      confidence: 0.61,
    },
    [
      {
        factId: "f_low",
        entityId: "person_low",
        kind: "title",
        value: "Dr.",
        confidence: 0.6,
        evidenceMentionIds: ["m1"],
      },
    ],
  );

  assert.equal(blocked, null);

  const dossier = buildPersonDossier(
    "person_high",
    {
      entityId: "person_high",
      canonicalName: "Lina Haddad",
      aliases: ["Lina Haddad", "Dr. Lina Haddad"],
      mentions: ["m1", "m2"],
      facts: ["f1", "f2", "f3"],
      confidence: 0.83,
    },
    [
      {
        factId: "f1",
        entityId: "person_high",
        kind: "role",
        value: "director",
        confidence: 0.74,
        evidenceMentionIds: ["m1"],
      },
      {
        factId: "f2",
        entityId: "person_high",
        kind: "organization",
        value: "Meridian Logistics",
        confidence: 0.8,
        evidenceMentionIds: ["m1", "m2"],
      },
      {
        factId: "f3",
        entityId: "person_high",
        kind: "location",
        value: "Ashdod Port",
        confidence: 0.72,
        evidenceMentionIds: ["m2"],
      },
    ],
  );

  assert.ok(dossier);
  assert.ok(dossier?.organizations.includes("Meridian Logistics"));
  assert.ok(dossier?.roles.includes("director"));
  assert.ok(dossier?.locations.includes("Ashdod Port"));
});

test("extractPersons catches Hebrew operational person names and ignores generic finance phrases", () => {
  const text = `
  במהלך השבועיים האחרונים מזהים התעוררות של חולייה מקומית. בראש החולייה עומד היעד מוחמד אבו-סאלח ("המהנדס").
  קיימת אינדיקציה להעברת כספים דרך החלפן ג'מאל זביידי בג'נין.
  היכן מסתתר כרגע סגנו של אבו-סאלח, הפעיל איברהים כרמי?
  `;

  const extracted = extractPersons({
    caseId: "case_person_he_1",
    documentId: "doc_person_he_1",
    rawText: text,
    chunks: text
      .trim()
      .split(/\n+/)
      .map((line, index) => ({ chunkId: `chunk_${index}`, text: line.trim() })),
    language: "he",
  });

  const names = new Set(extracted.mentions.map((mention) => mention.text));

  assert.ok(names.has("מוחמד אבו-סאלח"));
  assert.ok(names.has("ג'מאל זביידי"));
  assert.ok(names.has("איברהים כרמי"));
  assert.ok(!names.has("לחלפנות כספים"));
  assert.ok(!names.has("ציר הכסף"));
});

test("extractPersons catches Arabic-script and transliterated person names without confusing operational nouns", () => {
  const text = `
  اجتمع الهدف أحمد بن صالح مع الوسيط ليلى حداد في نابلس.
  Later, Ahmed bin Saleh contacted Lina al-Khatib about the transfer route.
  `;

  const extracted = extractPersons({
    caseId: "case_person_multi_1",
    documentId: "doc_person_multi_1",
    rawText: text,
    chunks: text
      .trim()
      .split(/\n+/)
      .map((line, index) => ({ chunkId: `chunk_${index}`, text: line.trim() })),
    language: "ar",
  });

  const names = new Set(extracted.mentions.map((mention) => mention.text));

  assert.ok(names.has("أحمد بن صالح"));
  assert.ok(names.has("ليلى حداد"));
  assert.ok(names.has("Ahmed bin Saleh"));
  assert.ok(names.has("Lina al-Khatib"));
  assert.ok(!names.has("transfer route"));
});

test("extractPersons catches multilingual standalone full names even without action verbs", () => {
  const text = `
  רשימת יעד: מוחמד אבו-סאלח, ג'מאל זביידי.
  الأسماء المرصودة: أحمد بن صالح، ليلى حداد.
  Observed names: Ahmed bin Saleh, Lina al-Khatib.
  `;

  const extracted = extractPersons({
    caseId: "case_person_multi_2",
    documentId: "doc_person_multi_2",
    rawText: text,
    chunks: text
      .trim()
      .split(/\n+/)
      .map((line, index) => ({ chunkId: `chunk_${index}`, text: line.trim() })),
    language: "multi",
  });

  const names = new Set(extracted.mentions.map((mention) => mention.text));

  assert.ok(names.has("מוחמד אבו-סאלח"));
  assert.ok(names.has("ג'מאל זביידי"));
  assert.ok(names.has("أحمد بن صالح"));
  assert.ok(names.has("ليلى حداد"));
  assert.ok(names.has("Ahmed bin Saleh"));
  assert.ok(names.has("Lina al-Khatib"));
});

test("extractPersons avoids treating layered report scaffolding as person mentions", () => {
  const text = `
  דו"ח מודיעין שב"ס (ענף איסוף)
  סיווג: סודי ביותר | מאת: קמ"ן כלא "אשל" | אל: חמ"ל מחוז חוף
  המסר נכתב בידי האסיר הביטחוני סאמי נאסר והיה מיועד לאיש הקשר הפיננסי אליאס חדאד.
  כלל רכיבי המבצע כבר במרחב ודורשים מעקב.
  `;

  const extracted = extractPersons({
    caseId: "case_person_he_3",
    documentId: "doc_person_he_3",
    rawText: text,
    chunks: text
      .trim()
      .split(/\n+/)
      .map((line, index) => ({ chunkId: `chunk_${index}`, text: line.trim() })),
    language: "he",
  });

  const names = new Set(extracted.mentions.map((mention) => mention.text));

  assert.ok(names.has("סאמי נאסר"));
  assert.ok(names.has("אליאס חדאד"));
  assert.ok(!names.has("קמ\"ן כלא"));
  assert.ok(!names.has("מחוז חוף"));
  assert.ok(!names.has("כבר במרחב"));
  assert.equal(names.size, 2);
});
