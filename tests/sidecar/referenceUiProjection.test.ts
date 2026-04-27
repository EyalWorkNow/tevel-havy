import assert from "node:assert/strict";
import test from "node:test";

import { buildEntityContextCardFromPackage } from "../../services/analysisService";
import { buildRetrievalArtifactsFromPayload } from "../../services/sidecar/retrieval";
import { buildSummaryPanelsFromRetrievalArtifacts } from "../../services/sidecar/summarization/evidencePack";
import type { ReferenceKnowledgeProfile } from "../../services/sidecar/knowledge/contracts";
import type { SidecarExtractionPayload } from "../../services/sidecar/types";
import type { IntelligencePackage } from "../../types";

const payload: SidecarExtractionPayload = {
  source_doc_id: "case-ref-ui",
  raw_text: "On 2026-04-12 Lina Haddad met Meridian Institute in Haifa.",
  normalized_text: "On 2026-04-12 Lina Haddad met Meridian Institute in Haifa.",
  generated_at: "2026-04-15T00:00:00.000Z",
  pipeline_version: "test",
  normalization_steps: [],
  text_units: [
    {
      source_doc_id: "case-ref-ui",
      text_unit_id: "tu-1",
      ordinal: 0,
      kind: "sentence",
      start: 0,
      end: 58,
      normalized_start: 0,
      normalized_end: 58,
      raw_start: 0,
      raw_end: 58,
      text: "On 2026-04-12 Lina Haddad met Meridian Institute in Haifa.",
      raw_text: "On 2026-04-12 Lina Haddad met Meridian Institute in Haifa.",
      char_length: 58,
      token_estimate: 10,
      stable_hash: "tu1",
    },
  ],
  candidates: [],
  mentions: [],
  entities: [
    {
      entity_id: "person-1",
      source_doc_id: "case-ref-ui",
      canonical_name: "Lina Haddad",
      normalized_name: "lina haddad",
      entity_type: "PERSON",
      aliases: [],
      mention_ids: [],
      source_text_unit_ids: ["tu-1"],
      extraction_sources: ["model"],
      confidence: 0.91,
      timestamps: ["2026-04-12"],
      corroborating_mention_ids: [],
      contradicting_entity_ids: [],
    },
  ],
  relation_candidates: [],
  event_candidates: [],
  claim_candidates: [],
  stats: {
    doc_char_length: 58,
    text_unit_count: 1,
    candidate_count: 0,
    mention_count: 0,
    entity_count: 1,
    relation_count: 0,
    event_count: 0,
    claim_count: 0,
    duplicate_collapse_rate: 0,
    evidence_coverage_rate: 1,
  },
};

const referenceKnowledge: Record<string, ReferenceKnowledgeProfile> = {
  "person-1": {
    entity_id: "person-1",
    canonical_name: "Lina Haddad",
    ftm_id: "ftm_person_demo",
    ftm_schema: "Person",
    aliases: ["Dr Lina Haddad", "לינה חדאד"],
    descriptions: ["Researcher affiliated with Meridian Institute."],
    affiliations: ["Meridian Institute"],
    source_labels: ["Wikidata", "OpenAlex"],
    assertions: [
      {
        assertion_id: "assert-1",
        subject_ftm_id: "ftm_person_demo",
        subject_entity_id: "person-1",
        source_namespace: "openalex",
        predicate: "affiliation",
        value: "Meridian Institute",
        normalized_value: "meridian institute",
        confidence: 0.84,
        source_label: "OpenAlex",
        retrieved_at: "2026-04-15T00:00:00.000Z",
        derived_from_case: false,
        external_reference_ids: ["openalex:A1"],
      },
    ],
    links: [
      {
        link_id: "ref-1",
        namespace: "wikidata",
        external_id: "Q123",
        canonical_ftm_id: "ftm_person_demo",
        canonical_ftm_schema: "Person",
        label: "Lina Haddad",
        aliases: ["Dr Lina Haddad"],
        match_confidence: 0.88,
        match_rationale: ["Alias similarity 88%."],
        retrieved_at: "2026-04-15T00:00:00.000Z",
        derived_from_case: false,
      },
    ],
    watchlist_hits: [],
    warnings: [],
    derived_from_case: false,
  },
};

test("reference-only retrieval hits stay out of citation counts and surface through reference_context", () => {
  const retrievalArtifacts = buildRetrievalArtifactsFromPayload(payload, [], [], (id) => id, referenceKnowledge);
  const panels = buildSummaryPanelsFromRetrievalArtifacts(retrievalArtifacts);

  assert.ok(retrievalArtifacts.bundles.case_brief.hits.some((hit) => hit.reference_only));
  assert.equal(
    retrievalArtifacts.bundles.case_brief.cited_evidence_ids.includes("ref-1"),
    false,
  );
  assert.ok(panels.case_brief.reference_context);
  assert.ok(panels.case_brief.reference_context?.summary_text.includes("Researcher affiliated"));
});

test("buildEntityContextCardFromPackage exposes reference knowledge separately from case evidence", () => {
  const pkg: IntelligencePackage = {
    clean_text: "Detected Lina Haddad in the case file.",
    raw_text: payload.raw_text,
    word_count: 10,
    entities: [
      {
        id: "person-1",
        name: "Lina Haddad",
        type: "PERSON",
        aliases: ["Lina Haddad"],
        evidence: ["On 2026-04-12 Lina Haddad met Meridian Institute in Haifa."],
        ftm_id: "ftm_person_demo",
        ftm_schema: "Person",
      },
    ],
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
    canonical_entities: [],
    reference_knowledge: referenceKnowledge,
    watchlist_hits: [],
    knowledge_sources: [],
    reference_warnings: [],
  };

  const card = buildEntityContextCardFromPackage(pkg, "Lina Haddad");
  assert.ok(card);
  assert.ok(card?.referenceProfile);
  assert.ok(card?.referenceProfile?.aliases.includes("לינה חדאד"));
  assert.equal(card?.summary.includes("Researcher affiliated with Meridian Institute."), false);
});

