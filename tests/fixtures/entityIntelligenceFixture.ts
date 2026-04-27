import type {
  EvidenceSpan,
  SidecarClaimCandidate,
  SidecarEntityRecord,
  SidecarEventCandidate,
  SidecarExtractionPayload,
  SidecarMention,
  SidecarRelationCandidate,
  SidecarTextUnit,
} from "../../services/sidecar/types";

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const nthIndexOf = (text: string, needle: string, ordinal = 0): number => {
  let from = 0;
  for (let index = 0; index <= ordinal; index += 1) {
    const match = text.indexOf(needle, from);
    if (match < 0) {
      throw new Error(`Could not find "${needle}" occurrence ${ordinal} in fixture text.`);
    }
    if (index === ordinal) return match;
    from = match + needle.length;
  }
  return -1;
};

const sentenceFor = (text: string, needle: string): string => {
  const index = text.indexOf(needle);
  const start = index <= 0 ? 0 : text.lastIndexOf(". ", index) + 2;
  const endBoundary = text.indexOf(". ", index);
  const end = endBoundary < 0 ? text.length : endBoundary + 1;
  return text.slice(start, end).trim();
};

const makeTextUnit = (sourceDocId: string, text: string, ordinal: number): SidecarTextUnit => ({
  source_doc_id: sourceDocId,
  text_unit_id: `${sourceDocId}_tu_${ordinal}`,
  ordinal,
  kind: "sentence",
  start: 0,
  end: text.length,
  normalized_start: 0,
  normalized_end: text.length,
  raw_start: 0,
  raw_end: text.length,
  text,
  raw_text: text,
  char_length: text.length,
  token_estimate: text.split(/\s+/).length,
  stable_hash: stableHash(`${sourceDocId}:${ordinal}`),
  metadata: {
    source_type: "FIXTURE",
    language: "en",
  },
});

const makeEvidence = (
  sourceDocId: string,
  textUnitId: string,
  text: string,
  needle: string,
  ordinal = 0,
): EvidenceSpan => {
  const start = nthIndexOf(text, needle, ordinal);
  const end = start + needle.length;
  const sentence = sentenceFor(text, needle);
  return {
    evidence_id: `evidence_${stableHash(`${sourceDocId}:${needle}:${ordinal}`)}`,
    source_doc_id: sourceDocId,
    source_text_unit_id: textUnitId,
    start,
    end,
    normalized_start: start,
    normalized_end: end,
    raw_start: start,
    raw_end: end,
    raw_supporting_snippet: sentence,
    normalized_supporting_snippet: sentence,
    normalized_text: sentence,
    extraction_source: "model",
    source_extractor: "fixture",
    confidence: 0.88,
  };
};

const makeMention = (params: {
  sourceDocId: string;
  unit: SidecarTextUnit;
  text: string;
  needle: string;
  mentionId: string;
  entityId: string;
  entityType: string;
  ordinal?: number;
}): SidecarMention => {
  const start = nthIndexOf(params.unit.raw_text, params.needle, params.ordinal || 0);
  const end = start + params.needle.length;
  const evidence = makeEvidence(params.sourceDocId, params.unit.text_unit_id, params.unit.raw_text, params.needle, params.ordinal || 0);
  return {
    candidate_id: params.mentionId,
    mention_id: params.mentionId,
    source_doc_id: params.sourceDocId,
    source_text_unit_id: params.unit.text_unit_id,
    char_start: start,
    char_end: end,
    normalized_char_start: start,
    normalized_char_end: end,
    raw_char_start: start,
    raw_char_end: end,
    raw_text: params.text,
    normalized_text: params.text.toLowerCase(),
    label: params.entityType,
    candidate_type: "entity_mention",
    extraction_source: "model",
    confidence: 0.88,
    metadata: {
      source_extractor: "fixture",
      language: "en",
      ordinal: params.unit.ordinal,
    },
    evidence,
    entity_id: params.entityId,
    mention_text: params.text,
    entity_type: params.entityType,
    role: params.entityType === "PERSON" && /Minister/.test(params.text) ? "Minister" : undefined,
  };
};

const makeEntity = (sourceDocId: string, canonicalName: string, entityId: string, entityType: string, mentionIds: string[], aliases: string[], unit: SidecarTextUnit): SidecarEntityRecord => ({
  entity_id: entityId,
  source_doc_id: sourceDocId,
  canonical_name: canonicalName,
  normalized_name: canonicalName.toLowerCase(),
  entity_type: entityType,
  aliases,
  mention_ids: mentionIds,
  source_text_unit_ids: [unit.text_unit_id],
  extraction_sources: ["model"],
  confidence: 0.88,
  timestamps: [],
  corroborating_mention_ids: [],
  contradicting_entity_ids: [],
});

const makeRelation = (params: {
  sourceDocId: string;
  unit: SidecarTextUnit;
  relationId: string;
  type: string;
  sourceEntityId: string;
  targetEntityId: string;
  sourceMentionIds: string[];
  targetMentionIds: string[];
  snippet: string;
  timestamp?: string;
}): SidecarRelationCandidate => ({
  relation_id: params.relationId,
  source_doc_id: params.sourceDocId,
  source_text_unit_id: params.unit.text_unit_id,
  source_entity_id: params.sourceEntityId,
  target_entity_id: params.targetEntityId,
  source_mention_ids: params.sourceMentionIds,
  target_mention_ids: params.targetMentionIds,
  relation_type: params.type,
  normalized_text: params.snippet,
  extraction_source: "model",
  confidence: 0.82,
  timestamp: params.timestamp,
  evidence: makeEvidence(params.sourceDocId, params.unit.text_unit_id, params.unit.raw_text, params.snippet),
});

const makeEvent = (params: {
  sourceDocId: string;
  unit: SidecarTextUnit;
  eventId: string;
  type: string;
  trigger: string;
  actorEntityIds: string[];
  actorMentionIds: string[];
  targetEntityIds: string[];
  targetMentionIds: string[];
  locationEntityIds: string[];
  locationMentionIds: string[];
  timestamp: string;
}): SidecarEventCandidate => ({
  event_id: params.eventId,
  source_doc_id: params.sourceDocId,
  source_text_unit_id: params.unit.text_unit_id,
  event_type: params.type,
  trigger_text: params.trigger,
  trigger_normalized_text: params.trigger.toLowerCase(),
  actor_entity_ids: params.actorEntityIds,
  actor_mention_ids: params.actorMentionIds,
  target_entity_ids: params.targetEntityIds,
  target_mention_ids: params.targetMentionIds,
  location_entity_ids: params.locationEntityIds,
  location_mention_ids: params.locationMentionIds,
  normalized_text: params.unit.raw_text,
  extraction_source: "model",
  confidence: 0.84,
  timestamp: params.timestamp,
  evidence: makeEvidence(params.sourceDocId, params.unit.text_unit_id, params.unit.raw_text, params.trigger),
});

const makeClaim = (params: {
  sourceDocId: string;
  unit: SidecarTextUnit;
  claimId: string;
  type: string;
  text: string;
  subjectMentionIds: string[];
  objectMentionIds?: string[];
  timestamp?: string;
}): SidecarClaimCandidate => ({
  claim_id: params.claimId,
  source_doc_id: params.sourceDocId,
  source_text_unit_id: params.unit.text_unit_id,
  claim_type: params.type,
  claim_text: params.text,
  normalized_text: params.text.toLowerCase(),
  extraction_source: "model",
  confidence: 0.8,
  timestamp: params.timestamp,
  subject_mention_ids: params.subjectMentionIds,
  object_mention_ids: params.objectMentionIds,
  evidence: makeEvidence(params.sourceDocId, params.unit.text_unit_id, params.unit.raw_text, params.text),
});

const buildPayload = (params: {
  sourceDocId: string;
  rawText: string;
  mentions: SidecarMention[];
  entities: SidecarEntityRecord[];
  relations: SidecarRelationCandidate[];
  events: SidecarEventCandidate[];
  claims: SidecarClaimCandidate[];
}): SidecarExtractionPayload => {
  const unit = makeTextUnit(params.sourceDocId, params.rawText, 0);
  return {
    source_doc_id: params.sourceDocId,
    raw_text: params.rawText,
    normalized_text: params.rawText,
    normalization_steps: [],
    generated_at: "2026-04-15T00:00:00.000Z",
    pipeline_version: "fixture-entity-intelligence-v1",
    text_units: [unit],
    candidates: [],
    mentions: params.mentions,
    entities: params.entities,
    relation_candidates: params.relations,
    event_candidates: params.events,
    claim_candidates: params.claims,
    stats: {
      doc_char_length: params.rawText.length,
      text_unit_count: 1,
      candidate_count: params.mentions.length,
      mention_count: params.mentions.length,
      entity_count: params.entities.length,
      relation_count: params.relations.length,
      event_count: params.events.length,
      claim_count: params.claims.length,
      duplicate_collapse_rate: 0,
      evidence_coverage_rate: 1,
    },
  };
};

export const buildEntityIntelligenceFixtureCase = () => {
  const caseId = "case_entity_intelligence_fixture";

  const doc1 = "On 2026-04-10 David Amsalem, also referred to as Minister Amsalem, met Orion Logistics at Ashdod Port. Analysts claimed David Amsalem served as Interior Minister.";
  const unit1 = makeTextUnit("fixture_doc_1", doc1, 0);
  const mDavid1 = makeMention({ sourceDocId: "fixture_doc_1", unit: unit1, text: "David Amsalem", needle: "David Amsalem", mentionId: "m_david_1", entityId: "src_david_1", entityType: "PERSON" });
  const mMinister = makeMention({ sourceDocId: "fixture_doc_1", unit: unit1, text: "Minister Amsalem", needle: "Minister Amsalem", mentionId: "m_david_2", entityId: "src_david_1", entityType: "PERSON" });
  const mOrion1 = makeMention({ sourceDocId: "fixture_doc_1", unit: unit1, text: "Orion Logistics", needle: "Orion Logistics", mentionId: "m_orion_1", entityId: "src_orion_1", entityType: "ORG" });
  const mAshdodPort = makeMention({ sourceDocId: "fixture_doc_1", unit: unit1, text: "Ashdod Port", needle: "Ashdod Port", mentionId: "m_ashdod_1", entityId: "src_ashdod_1", entityType: "LOCATION" });

  const payload1 = buildPayload({
    sourceDocId: "fixture_doc_1",
    rawText: doc1,
    mentions: [mDavid1, mMinister, mOrion1, mAshdodPort],
    entities: [
      makeEntity("fixture_doc_1", "David Amsalem", "src_david_1", "PERSON", [mDavid1.mention_id, mMinister.mention_id], ["Minister Amsalem"], unit1),
      makeEntity("fixture_doc_1", "Orion Logistics", "src_orion_1", "ORG", [mOrion1.mention_id], [], unit1),
      makeEntity("fixture_doc_1", "Ashdod Port", "src_ashdod_1", "LOCATION", [mAshdodPort.mention_id], ["Ashdod"], unit1),
    ],
    relations: [
      makeRelation({
        sourceDocId: "fixture_doc_1",
        unit: unit1,
        relationId: "rel_david_orion_1",
        type: "MET_WITH",
        sourceEntityId: "src_david_1",
        targetEntityId: "src_orion_1",
        sourceMentionIds: [mDavid1.mention_id],
        targetMentionIds: [mOrion1.mention_id],
        snippet: "David Amsalem, also referred to as Minister Amsalem, met Orion Logistics at Ashdod Port",
        timestamp: "2026-04-10",
      }),
    ],
    events: [
      makeEvent({
        sourceDocId: "fixture_doc_1",
        unit: unit1,
        eventId: "event_david_orion_1",
        type: "MEETING_EVENT",
        trigger: "met",
        actorEntityIds: ["src_david_1"],
        actorMentionIds: [mDavid1.mention_id],
        targetEntityIds: ["src_orion_1"],
        targetMentionIds: [mOrion1.mention_id],
        locationEntityIds: ["src_ashdod_1"],
        locationMentionIds: [mAshdodPort.mention_id],
        timestamp: "2026-04-10",
      }),
    ],
    claims: [
      makeClaim({
        sourceDocId: "fixture_doc_1",
        unit: unit1,
        claimId: "claim_david_role_1",
        type: "ROLE",
        text: "David Amsalem served as Interior Minister",
        subjectMentionIds: [mDavid1.mention_id],
        timestamp: "2026-04-10",
      }),
    ],
  });

  const doc2 = "On 2026-04-12 Amsalem met Orion Logistics again in Ashdod. A later memo described David Amsalem as Logistics Coordinator and said D. Amsalem attended the follow-up meeting.";
  const unit2 = makeTextUnit("fixture_doc_2", doc2, 0);
  const mAmsalem = makeMention({ sourceDocId: "fixture_doc_2", unit: unit2, text: "Amsalem", needle: "Amsalem", mentionId: "m_david_3", entityId: "src_david_2", entityType: "PERSON" });
  const mDavid2 = makeMention({ sourceDocId: "fixture_doc_2", unit: unit2, text: "David Amsalem", needle: "David Amsalem", mentionId: "m_david_4", entityId: "src_david_2", entityType: "PERSON" });
  const mDotted = makeMention({ sourceDocId: "fixture_doc_2", unit: unit2, text: "D. Amsalem", needle: "D. Amsalem", mentionId: "m_david_5", entityId: "src_david_2", entityType: "PERSON" });
  const mOrion2 = makeMention({ sourceDocId: "fixture_doc_2", unit: unit2, text: "Orion Logistics", needle: "Orion Logistics", mentionId: "m_orion_2", entityId: "src_orion_2", entityType: "ORG" });
  const mAshdod2 = makeMention({ sourceDocId: "fixture_doc_2", unit: unit2, text: "Ashdod", needle: "Ashdod", mentionId: "m_ashdod_2", entityId: "src_ashdod_2", entityType: "LOCATION" });

  const payload2 = buildPayload({
    sourceDocId: "fixture_doc_2",
    rawText: doc2,
    mentions: [mAmsalem, mDavid2, mDotted, mOrion2, mAshdod2],
    entities: [
      makeEntity("fixture_doc_2", "David Amsalem", "src_david_2", "PERSON", [mAmsalem.mention_id, mDavid2.mention_id, mDotted.mention_id], ["Amsalem", "D. Amsalem"], unit2),
      makeEntity("fixture_doc_2", "Orion Logistics", "src_orion_2", "ORG", [mOrion2.mention_id], [], unit2),
      makeEntity("fixture_doc_2", "Ashdod", "src_ashdod_2", "LOCATION", [mAshdod2.mention_id], ["Ashdod Port"], unit2),
    ],
    relations: [
      makeRelation({
        sourceDocId: "fixture_doc_2",
        unit: unit2,
        relationId: "rel_david_orion_2",
        type: "MET_WITH",
        sourceEntityId: "src_david_2",
        targetEntityId: "src_orion_2",
        sourceMentionIds: [mAmsalem.mention_id],
        targetMentionIds: [mOrion2.mention_id],
        snippet: "Amsalem met Orion Logistics again in Ashdod",
        timestamp: "2026-04-12",
      }),
    ],
    events: [
      makeEvent({
        sourceDocId: "fixture_doc_2",
        unit: unit2,
        eventId: "event_david_orion_2",
        type: "MEETING_EVENT",
        trigger: "met",
        actorEntityIds: ["src_david_2"],
        actorMentionIds: [mAmsalem.mention_id],
        targetEntityIds: ["src_orion_2"],
        targetMentionIds: [mOrion2.mention_id],
        locationEntityIds: ["src_ashdod_2"],
        locationMentionIds: [mAshdod2.mention_id],
        timestamp: "2026-04-12",
      }),
    ],
    claims: [
      makeClaim({
        sourceDocId: "fixture_doc_2",
        unit: unit2,
        claimId: "claim_david_role_2",
        type: "ROLE",
        text: "David Amsalem as Logistics Coordinator",
        subjectMentionIds: [mDavid2.mention_id],
        timestamp: "2026-04-12",
      }),
    ],
  });

  const doc3 = "On 2026-04-13 Yossi Amsalem joined Cedar Brokers in Haifa.";
  const unit3 = makeTextUnit("fixture_doc_3", doc3, 0);
  const mYossi = makeMention({ sourceDocId: "fixture_doc_3", unit: unit3, text: "Yossi Amsalem", needle: "Yossi Amsalem", mentionId: "m_yossi_1", entityId: "src_yossi_1", entityType: "PERSON" });
  const mCedar = makeMention({ sourceDocId: "fixture_doc_3", unit: unit3, text: "Cedar Brokers", needle: "Cedar Brokers", mentionId: "m_cedar_1", entityId: "src_cedar_1", entityType: "ORG" });
  const mHaifa = makeMention({ sourceDocId: "fixture_doc_3", unit: unit3, text: "Haifa", needle: "Haifa", mentionId: "m_haifa_1", entityId: "src_haifa_1", entityType: "LOCATION" });

  const payload3 = buildPayload({
    sourceDocId: "fixture_doc_3",
    rawText: doc3,
    mentions: [mYossi, mCedar, mHaifa],
    entities: [
      makeEntity("fixture_doc_3", "Yossi Amsalem", "src_yossi_1", "PERSON", [mYossi.mention_id], [], unit3),
      makeEntity("fixture_doc_3", "Cedar Brokers", "src_cedar_1", "ORG", [mCedar.mention_id], [], unit3),
      makeEntity("fixture_doc_3", "Haifa", "src_haifa_1", "LOCATION", [mHaifa.mention_id], [], unit3),
    ],
    relations: [
      makeRelation({
        sourceDocId: "fixture_doc_3",
        unit: unit3,
        relationId: "rel_yossi_cedar_1",
        type: "AFFILIATED_WITH",
        sourceEntityId: "src_yossi_1",
        targetEntityId: "src_cedar_1",
        sourceMentionIds: [mYossi.mention_id],
        targetMentionIds: [mCedar.mention_id],
        snippet: "Yossi Amsalem joined Cedar Brokers in Haifa",
        timestamp: "2026-04-13",
      }),
    ],
    events: [
      makeEvent({
        sourceDocId: "fixture_doc_3",
        unit: unit3,
        eventId: "event_yossi_join_1",
        type: "AFFILIATION_EVENT",
        trigger: "joined",
        actorEntityIds: ["src_yossi_1"],
        actorMentionIds: [mYossi.mention_id],
        targetEntityIds: ["src_cedar_1"],
        targetMentionIds: [mCedar.mention_id],
        locationEntityIds: ["src_haifa_1"],
        locationMentionIds: [mHaifa.mention_id],
        timestamp: "2026-04-13",
      }),
    ],
    claims: [
      makeClaim({
        sourceDocId: "fixture_doc_3",
        unit: unit3,
        claimId: "claim_yossi_affiliation_1",
        type: "AFFILIATION",
        text: "Yossi Amsalem joined Cedar Brokers",
        subjectMentionIds: [mYossi.mention_id],
        objectMentionIds: [mCedar.mention_id],
        timestamp: "2026-04-13",
      }),
    ],
  });

  return {
    caseId,
    payloads: [payload1, payload2, payload3],
  };
};
