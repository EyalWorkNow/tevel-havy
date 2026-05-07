import type { SidecarExtractionPayload } from "../types";
import type { ClaimEvidenceRecord, ClaimRecord, RelationshipRecord } from "./types";
import { stableHash } from "./normalization";

const modalityForText = (value: string): ClaimRecord["modality"] => {
  if (/\b(alleged|claim(?:ed)?|reportedly|according to)\b/i.test(value)) return "reported_by_third_party";
  if (/\b(denied|not true|false)\b/i.test(value)) return "denied";
  if (/"/.test(value)) return "quoted";
  return "asserted";
};

const polarityForText = (value: string): ClaimRecord["polarity"] =>
  /\b(no|not|never|denied|without)\b/i.test(value) ? "negative" : "positive";

const dedupeBy = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const buildClaimLayer = (
  payload: SidecarExtractionPayload,
  mentionEntityMap: Record<string, string>,
): {
  claims: ClaimRecord[];
  claimEvidence: ClaimEvidenceRecord[];
  relationships: RelationshipRecord[];
} => {
  const claims: ClaimRecord[] = [];
  const claimEvidence: ClaimEvidenceRecord[] = [];

  payload.claim_candidates.forEach((claim) => {
    const subjectEntityId =
      (claim.subject_mention_ids || []).map((id) => mentionEntityMap[id]).find(Boolean) ||
      (claim.speaker_mention_ids || []).map((id) => mentionEntityMap[id]).find(Boolean);
    if (!subjectEntityId) {
      console.warn(
        `[claims] Dropped claim ${claim.claim_id} (${claim.claim_type}): no resolvable subject entity among ${(claim.subject_mention_ids || []).length} subject + ${(claim.speaker_mention_ids || []).length} speaker mention(s)`,
      );
      return;
    }
    const objectEntityId = (claim.object_mention_ids || []).map((id) => mentionEntityMap[id]).find(Boolean);

    claims.push({
      id: claim.claim_id,
      subject_entity_id: subjectEntityId,
      predicate: claim.claim_type.toLowerCase(),
      object_entity_id: objectEntityId,
      object_literal: objectEntityId ? undefined : claim.claim_text,
      claim_type: claim.claim_type,
      modality: modalityForText(claim.claim_text),
      polarity: polarityForText(claim.claim_text),
      time_start: claim.timestamp,
      time_end: claim.timestamp,
      confidence: claim.confidence,
      source_reliability: typeof claim.metadata?.source_reliability === "number" ? claim.metadata.source_reliability : undefined,
      extraction_method: `${claim.extraction_source}:${claim.evidence.source_extractor || "unknown"}`,
      supporting_evidence_count: 1,
      conflicting_evidence_count: claim.contradicts?.length || 0,
      status: claim.confidence >= 0.62 ? "validated" : "tentative",
      attributes_json: {
        cue_text: claim.cue_text,
        normalized_text: claim.normalized_text,
        source_doc_id: claim.source_doc_id,
      },
    });

    claimEvidence.push({
      claim_id: claim.claim_id,
      evidence_span_id: claim.evidence.evidence_id,
      support_type: claim.contradicts?.length ? "contextual" : "direct",
      score: claim.confidence,
      note: claim.claim_text,
    });
  });

  payload.relation_candidates.filter((relation) => relation.relation_type !== "CO_MENTION_SAME_TEXT_UNIT").forEach((relation) => {
    const sourceEntityId =
      (relation.source_mention_ids || []).map((id) => mentionEntityMap[id]).find(Boolean) || relation.source_entity_id;
    const targetEntityId =
      (relation.target_mention_ids || []).map((id) => mentionEntityMap[id]).find(Boolean) || relation.target_entity_id;
    if (!sourceEntityId || !targetEntityId) return;

    const claimId = `claim_${stableHash(`${relation.relation_id}:${relation.source_entity_id}:${relation.target_entity_id}`)}`;
    claims.push({
      id: claimId,
      subject_entity_id: sourceEntityId,
      predicate: relation.relation_type.toLowerCase(),
      object_entity_id: targetEntityId,
      claim_type: relation.relation_type,
      modality: "asserted",
      polarity: "positive",
      time_start: relation.timestamp,
      time_end: relation.timestamp,
      confidence: relation.confidence,
      extraction_method: `${relation.extraction_source}:${relation.evidence.source_extractor || "unknown"}`,
      supporting_evidence_count: 1,
      conflicting_evidence_count: relation.contradicts?.length || 0,
      status: relation.confidence >= 0.62 ? "validated" : "tentative",
      attributes_json: {
        normalized_text: relation.normalized_text,
        source_doc_id: relation.source_doc_id,
      },
    });
    claimEvidence.push({
      claim_id: claimId,
      evidence_span_id: relation.evidence.evidence_id,
      support_type: relation.contradicts?.length ? "contextual" : "direct",
      score: relation.confidence,
      note: relation.normalized_text,
    });
  });

  const relationships = dedupeBy(
    claims
      .filter((claim) => claim.object_entity_id)
      .map<RelationshipRecord>((claim) => ({
        id: `relationship_${stableHash(`${claim.subject_entity_id}:${claim.object_entity_id}:${claim.claim_type}`)}`,
        source_entity_id: claim.subject_entity_id,
        target_entity_id: claim.object_entity_id!,
        relation_type: claim.claim_type,
        directed: true,
        confidence: claim.confidence,
        first_seen_at: claim.time_start,
        last_seen_at: claim.time_end,
        support_count: 1,
        contradiction_count: claim.conflicting_evidence_count,
        attributes_json: {
          modalities: [claim.modality],
        },
        supporting_claim_ids: [claim.id],
        supporting_evidence_ids: claimEvidence.filter((item) => item.claim_id === claim.id).map((item) => item.evidence_span_id),
      })),
    (relation) => `${relation.source_entity_id}:${relation.target_entity_id}:${relation.relation_type}`,
  );

  return {
    claims,
    claimEvidence,
    relationships,
  };
};
