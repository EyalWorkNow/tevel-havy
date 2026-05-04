import assert from "node:assert/strict";
import test from "node:test";

import {
  synthesizeAcrossDocuments,
  formatCrossDocumentSynthesisHebrew,
  formatCrossDocumentSynthesisEnglish,
} from "../../services/intelligence/crossDocumentSynthesis";
import type { StudyItem } from "../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeStudy = (
  id: string,
  title: string,
  entities: Array<{ id: string; name: string; type: string; salience?: number }>,
  relations: Array<{ source: string; target: string; type: string; confidence: number }>,
  insights: Array<{ type: "key_event" | "pattern" | "anomaly" | "summary"; importance: number; text: string }>,
): StudyItem => ({
  id,
  title,
  date: "2026-01-01",
  source: "Report",
  status: "Approved",
  tags: [],
  intelligence: {
    clean_text: `Study ${id}`,
    word_count: 100,
    entities: entities as any,
    relations: relations as any,
    insights,
    context_cards: {},
    graph: { nodes: [], edges: [] },
  },
});

// Two studies share "יוסי כהן" and "חברת קדם"
const studyA = makeStudy(
  "s-a",
  "דוח מודיעין A",
  [
    { id: "e1", name: "יוסי כהן", type: "PERSON", salience: 0.9 },
    { id: "e2", name: "חברת קדם", type: "ORGANIZATION", salience: 0.8 },
    { id: "e3", name: "נמל אשדוד", type: "LOCATION", salience: 0.7 },
  ],
  [
    { source: "יוסי כהן", target: "חברת קדם", type: "FUNDED", confidence: 0.85 },
    { source: "חברת קדם", target: "נמל אשדוד", type: "MOVED_TO", confidence: 0.75 },
  ],
  [
    { type: "key_event", importance: 0.9, text: "יוסי כהן העביר כספים לחברת קדם" },
    { type: "pattern", importance: 0.7, text: "פעילות בנמל אשדוד" },
  ],
);

const studyB = makeStudy(
  "s-b",
  "חקירת מכרז B",
  [
    { id: "e4", name: "יוסי כהן", type: "PERSON", salience: 0.85 },
    { id: "e5", name: "קדם בע\"מ", type: "ORGANIZATION", salience: 0.8 },
    { id: "e6", name: "ועדת מכרזים", type: "ORGANIZATION", salience: 0.9 },
  ],
  [
    { source: "יוסי כהן", target: "ועדת מכרזים", type: "COMMUNICATED_WITH", confidence: 0.8 },
    { source: "קדם בע\"מ", target: "ועדת מכרזים", type: "FUNDED", confidence: 0.7 },
  ],
  [
    { type: "key_event", importance: 0.95, text: "קדם בע\"מ זכתה במכרז" },
    { type: "anomaly", importance: 0.8, text: "תקשורת בין יוסי כהן לוועדה" },
  ],
);

const studyC = makeStudy(
  "s-c",
  "תצפית מבצעית C",
  [
    { id: "e7", name: "יוסי כהן", type: "PERSON", salience: 0.6 },
    { id: "e8", name: "אבי לוי", type: "PERSON", salience: 0.9 },
    { id: "e9", name: "דירת מסתור תל אביב", type: "LOCATION", salience: 0.8 },
  ],
  [
    { source: "יוסי כהן", target: "אבי לוי", type: "COMMUNICATED_WITH", confidence: 0.75 },
    { source: "אבי לוי", target: "דירת מסתור תל אביב", type: "MOVED_TO", confidence: 0.85 },
  ],
  [
    { type: "key_event", importance: 0.9, text: "אבי לוי נצפה ביציאה מהדירה" },
  ],
);

// Study with ALIAS_OF relation
const studyD = makeStudy(
  "s-d",
  "פרופיל מבצעי D",
  [
    { id: "e10", name: "יוסי כהן", type: "PERSON", salience: 0.95 },
    { id: "e11", name: "ג'וזף כהן", type: "PERSON", salience: 0.8 },
  ],
  [
    { source: "יוסי כהן", target: "ג'וזף כהן", type: "ALIAS_OF", confidence: 0.92 },
  ],
  [
    { type: "key_event", importance: 0.9, text: "הישות פעלה בשני שמות" },
  ],
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("synthesizeAcrossDocuments: empty input returns zero-count result", () => {
  const result = synthesizeAcrossDocuments([]);
  assert.equal(result.studyCount, 0);
  assert.equal(result.perFile.length, 0);
  assert.equal(result.sharedEntities.length, 0);
});

test("synthesizeAcrossDocuments: per-file scenario captures main actors and key events", () => {
  const result = synthesizeAcrossDocuments([studyA, studyB]);

  assert.equal(result.studyCount, 2);
  assert.equal(result.perFile.length, 2);

  const fileA = result.perFile.find((pf) => pf.studyId === "s-a");
  assert.ok(fileA, "Expected per-file entry for s-a");
  assert.ok(fileA.mainActors.includes("יוסי כהן"), "Expected יוסי כהן as main actor in study A");
  assert.ok(fileA.keyEvents.length > 0, "Expected at least one key event for study A");
});

test("synthesizeAcrossDocuments: detects shared entity across two studies", () => {
  const result = synthesizeAcrossDocuments([studyA, studyB]);

  const shared = result.sharedEntities.find((se) =>
    se.canonicalName.includes("יוסי") || se.canonicalName.includes("כהן"),
  );
  assert.ok(shared, "Expected יוסי כהן to appear as a shared entity");
  assert.ok(
    shared.appearsIn.length >= 2,
    `Expected shared entity to appear in ≥2 studies, got ${shared.appearsIn.length}`,
  );
});

test("synthesizeAcrossDocuments: entity shared across 3 studies generates RECURRING_ACTOR pattern", () => {
  const result = synthesizeAcrossDocuments([studyA, studyB, studyC]);

  const recurringPattern = result.crossFilePatterns.find((p) => p.type === "RECURRING_ACTOR");
  assert.ok(
    recurringPattern,
    `Expected a RECURRING_ACTOR pattern, got patterns: ${result.crossFilePatterns.map((p) => p.type).join(", ")}`,
  );
  // יוסי כהן appears in all 3 studies
  assert.ok(
    recurringPattern.evidenceStudyIds.length >= 3,
    `Expected ≥3 evidence study IDs for recurring actor, got ${recurringPattern.evidenceStudyIds.length}`,
  );
});

test("synthesizeAcrossDocuments: ALIAS_OF relation produces role equivalence", () => {
  const result = synthesizeAcrossDocuments([studyA, studyD]);

  assert.ok(result.roleEquivalences.length > 0, "Expected at least one role equivalence");
  const eq = result.roleEquivalences[0];
  assert.ok(
    eq.canonicalName === "יוסי כהן" || eq.aliases.includes("יוסי כהן"),
    `Expected יוסי כהן in alias equivalence, got: ${JSON.stringify(eq)}`,
  );
});

test("formatCrossDocumentSynthesisHebrew: produces non-empty Hebrew output with section headers", () => {
  const result = synthesizeAcrossDocuments([studyA, studyB, studyC]);
  const output = formatCrossDocumentSynthesisHebrew(result);

  assert.ok(output.includes("סינתזה חוצת-מסמכים"), "Expected Hebrew synthesis header");
  assert.ok(output.includes("תרחיש לפי קובץ"), "Expected per-file section");
  assert.ok(output.includes("ישויות משותפות"), "Expected shared entities section");
  assert.ok(output.includes("יוסי כהן"), "Expected יוסי כהן in Hebrew output");
});

test("formatCrossDocumentSynthesisEnglish: produces non-empty English output with section headers", () => {
  const result = synthesizeAcrossDocuments([studyA, studyB]);
  const output = formatCrossDocumentSynthesisEnglish(result);

  assert.ok(output.includes("Cross-Document Synthesis"), "Expected English synthesis header");
  assert.ok(output.includes("Per-File Scenario"), "Expected per-file section in English");
  assert.ok(output.includes("Shared Entities"), "Expected shared entities section in English");
});
