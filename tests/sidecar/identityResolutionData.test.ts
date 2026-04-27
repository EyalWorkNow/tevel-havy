import test from "node:test";
import assert from "node:assert/strict";
import { buildIdentityResolutionDataset } from "../../identity-resolution/liveData";
import { StudyItem } from "../../types";

const baseStudy = (overrides: Partial<StudyItem>): StudyItem => ({
  id: "study-1",
  title: "Case File A",
  date: "2026-04-14",
  source: "Report",
  status: "Approved",
  tags: ["identity"],
  intelligence: {
    clean_text: "Yousef Haddad signed the shipment form for Meridian Relief Network.",
    raw_text: "Yousef Haddad signed the shipment form for Meridian Relief Network in Amman.",
    word_count: 12,
    entities: [
      {
        id: "entity_1",
        name: "Yousef Haddad",
        type: "PERSON",
        confidence: 0.78,
        aliases: ["Y. Haddad"],
        evidence: ["Yousef Haddad signed the shipment form for Meridian Relief Network in Amman."],
      },
    ],
    relations: [],
    insights: [],
    timeline: [{ date: "2026-04-14", event: "Yousef Haddad signed the shipment form." }],
    statements: [],
    intel_questions: [],
    intel_tasks: [],
    tactical_assessment: { ttps: [], recommendations: [], gaps: [] },
    context_cards: {
      "Yousef Haddad": {
        entityName: "Yousef Haddad",
        summary: "Person mention surfaced in procurement records.",
        key_mentions: ["Yousef Haddad signed the shipment form for Meridian Relief Network in Amman."],
        role_in_document: "Procurement intermediary",
      },
    },
    graph: { nodes: [], edges: [] },
    reliability: 0.8,
    person_entities: [
      {
        entityId: "person_1",
        canonicalName: "Yousef Haddad",
        aliases: ["Y. Haddad", "يوسف حداد"],
        mentions: ["mention_1"],
        facts: ["fact_1"],
        confidence: 0.79,
      },
    ],
    person_facts: [
      {
        factId: "fact_1",
        entityId: "person_1",
        kind: "organization",
        value: "Meridian Relief Network",
        confidence: 0.8,
        evidenceMentionIds: ["mention_1"],
      },
    ],
    person_dossiers: {
      person_1: {
        entityId: "person_1",
        canonicalName: "Yousef Haddad",
        aliases: ["Y. Haddad", "يوسف حداد"],
        titles: [],
        roles: ["Procurement intermediary"],
        organizations: ["Meridian Relief Network"],
        contact: { emails: [], phones: [] },
        locations: ["Amman"],
        dates: ["2026-04-14"],
        relationships: [],
        claims: [],
        sourceMentions: ["يوسف حداد", "Yousef Haddad"],
        overallConfidence: 0.81,
      },
    },
    person_pipeline: {
      mode: "backend",
      warnings: [],
    },
  },
  ...overrides,
});

test("buildIdentityResolutionDataset uses live study data when dossiers exist", () => {
  const dataset = buildIdentityResolutionDataset([baseStudy({})]);

  assert.equal(dataset.dataSource, "live");
  assert.equal(dataset.backendStudies, 1);
  assert.ok(dataset.profiles.some((profile) => profile.canonicalName === "Yousef Haddad"));
  assert.ok(dataset.mentions.some((mention) => mention.documentTitle === "Case File A"));
  assert.ok(dataset.snippets.some((snippet) => snippet.title === "Case File A"));
});

test("buildIdentityResolutionDataset marks alias collisions as unresolved risk", () => {
  const first = baseStudy({});
  const second = baseStudy({
    id: "study-2",
    title: "Case File B",
    intelligence: {
      ...baseStudy({}).intelligence,
      clean_text: "Y. Haddad appears in a second case with different employer context.",
      raw_text: "Y. Haddad appears in a second case with North Gate Logistics.",
      entities: [
        {
          id: "entity_2",
          name: "Yosef Haddad",
          type: "PERSON",
          confidence: 0.74,
          aliases: ["Y. Haddad"],
          evidence: ["Y. Haddad appears in a second case with North Gate Logistics."],
        },
      ],
      person_entities: [
        {
          entityId: "person_2",
          canonicalName: "Yosef Haddad",
          aliases: ["Y. Haddad", "יוסף חדאד"],
          mentions: ["mention_2"],
          facts: ["fact_2"],
          confidence: 0.7,
        },
      ],
      person_facts: [
        {
          factId: "fact_2",
          entityId: "person_2",
          kind: "organization",
          value: "North Gate Logistics",
          confidence: 0.71,
          evidenceMentionIds: ["mention_2"],
        },
      ],
      person_dossiers: {
        person_2: {
          entityId: "person_2",
          canonicalName: "Yosef Haddad",
          aliases: ["Y. Haddad", "יוסף חדאד"],
          titles: [],
          roles: ["Field coordinator"],
          organizations: ["North Gate Logistics"],
          contact: { emails: [], phones: [] },
          locations: ["Jerusalem"],
          dates: ["2026-04-15"],
          relationships: [],
          claims: [],
          sourceMentions: ["Y. Haddad"],
          overallConfidence: 0.74,
        },
      },
      person_pipeline: {
        mode: "fallback",
        warnings: ["Fallback path used for this study."],
      },
    },
  });

  const dataset = buildIdentityResolutionDataset([first, second]);

  assert.ok(dataset.profiles.some((profile) => profile.unresolvedAliases.includes("Y. Haddad")));
  assert.ok(dataset.queue.length > 0);
  assert.ok(dataset.warnings.some((warning) => warning.includes("Fallback path used for this study.")));
});
