import assert from "node:assert/strict";
import test from "node:test";

import { supabase } from "../../services/supabaseClient";
import { StudyService } from "../../services/studyService";
import { ContextCard, StudyItem } from "../../types";

const makeStudy = (): StudyItem => ({
  id: "s_offline_case",
  title: "Offline Case",
  date: "2026-04-14",
  source: "Report",
  status: "Processing",
  tags: ["offline", "fallback"],
  intelligence: {
    clean_text: "Offline summary",
    raw_text: "Maya Cohen met Orion Logistics at Pier 9.",
    word_count: 8,
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
    reliability: 0.7,
  },
  super_intelligence: {},
  knowledge_intelligence: {},
});

test("StudyService falls back to local offline persistence when Supabase is unreachable", async () => {
  StudyService.__resetForTests();

  const originalFrom = (supabase as any).from;
  (supabase as any).from = () => ({
    select() {
      return this;
    },
    order() {
      throw new TypeError("Failed to fetch");
    },
    eq() {
      return this;
    },
    single() {
      throw new TypeError("Failed to fetch");
    },
    update() {
      throw new TypeError("Failed to fetch");
    },
    upsert() {
      throw new TypeError("Failed to fetch");
    },
  });

  try {
    const savedId = await StudyService.saveStudy(makeStudy());
    assert.ok(savedId);

    const studies = await StudyService.getAllStudies();
    assert.equal(studies.length, 1);
    assert.equal(studies[0].title, "Offline Case");

    const contextCard: ContextCard = {
      entityName: "Maya Cohen",
      summary: "Primary human subject mentioned in the offline case.",
      key_mentions: ["Maya Cohen met Orion Logistics at Pier 9."],
      role_in_document: "Observed participant",
      aliases: ["M. Cohen"],
    };

    const contextUpdated = await StudyService.updateStudyContextCard(savedId!, "Maya Cohen", contextCard);
    const superUpdated = await StudyService.updateSuperIntelligence(savedId!, "Maya Cohen", { score: 92 });
    const knowledgeUpdated = await StudyService.updateKnowledgeIntelligence(savedId!, "Maya Cohen", { dossier: "offline dossier" });

    assert.equal(contextUpdated, true);
    assert.equal(superUpdated, true);
    assert.equal(knowledgeUpdated, true);

    const reloaded = await StudyService.getAllStudies();
    assert.equal(reloaded[0].intelligence.context_cards["Maya Cohen"].summary, contextCard.summary);
    assert.equal(reloaded[0].super_intelligence?.["Maya Cohen"]?.score, 92);
    assert.equal(reloaded[0].knowledge_intelligence?.["Maya Cohen"]?.dossier, "offline dossier");
  } finally {
    (supabase as any).from = originalFrom;
    StudyService.__resetForTests();
  }
});

test("StudyService deletes studies from local cache while offline", async () => {
  StudyService.__resetForTests();

  const originalFrom = (supabase as any).from;
  (supabase as any).from = () => ({
    select() {
      return this;
    },
    order() {
      throw new TypeError("Failed to fetch");
    },
    eq() {
      return this;
    },
    single() {
      throw new TypeError("Failed to fetch");
    },
    update() {
      throw new TypeError("Failed to fetch");
    },
    upsert() {
      throw new TypeError("Failed to fetch");
    },
    delete() {
      throw new TypeError("Failed to fetch");
    },
  });

  try {
    const savedId = await StudyService.saveStudy(makeStudy());
    assert.ok(savedId);

    const deleted = await StudyService.deleteStudy(savedId!);
    const studies = await StudyService.getAllStudies();

    assert.equal(deleted, true);
    assert.equal(studies.length, 0);
  } finally {
    (supabase as any).from = originalFrom;
    StudyService.__resetForTests();
  }
});
