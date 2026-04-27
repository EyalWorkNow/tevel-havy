import type {
  CanonicalEntityRecord,
  ClaimRecord,
  ConflictRecord,
  EntitySummaryRecord,
  EntityProfileRecord,
  EntityTimelineItem,
  RelationshipRecord,
  SummarySentenceRecord,
} from "./types";
import { confidenceBand, stableHash } from "./normalization";

const pickTop = <T extends { confidence: number }>(items: T[], limit: number): T[] =>
  [...items].sort((left, right) => right.confidence - left.confidence).slice(0, limit);

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const buildSentences = (params: {
  entity: CanonicalEntityRecord;
  claims: ClaimRecord[];
  relationships: RelationshipRecord[];
  timeline: EntityTimelineItem[];
  conflicts: ConflictRecord[];
}): SummarySentenceRecord[] => {
  const sentences: SummarySentenceRecord[] = [];

  const supportedClaims = pickTop(params.claims.filter((claim) => claim.status !== "conflicted"), 3);
  if (supportedClaims.length) {
    sentences.push({
      entity_id: params.entity.id,
      sentence_text: `${params.entity.canonical_name} is grounded by ${supportedClaims.length} structured claim(s) across ${Object.keys(params.entity.source_counts_json).length} source document(s).`,
      sentence_type: "identity_overview",
      confidence: Math.max(params.entity.confidence, supportedClaims[0].confidence),
      backing_claim_ids: supportedClaims.map((claim) => claim.id),
      backing_event_ids: [],
      backing_relation_ids: [],
    });
  }

  supportedClaims.forEach((claim) => {
    const predicateText = claim.object_entity_id || claim.object_literal
      ? `${claim.predicate.replace(/_/g, " ")} ${claim.object_entity_id || claim.object_literal}`
      : claim.predicate.replace(/_/g, " ");
    const qualifier = claim.modality === "asserted" ? "is described as" : claim.modality === "reported_by_third_party" ? "is reported as" : "is noted as";
    sentences.push({
      entity_id: params.entity.id,
      sentence_text: `${params.entity.canonical_name} ${qualifier} ${predicateText}.`,
      sentence_type: "supported_claim",
      confidence: claim.confidence,
      backing_claim_ids: [claim.id],
      backing_event_ids: [],
      backing_relation_ids: [],
    });
  });

  if (params.relationships.length) {
    const strongestRelationships = pickTop(params.relationships, 3);
    sentences.push({
      entity_id: params.entity.id,
      sentence_text: `${params.entity.canonical_name} has ${params.relationships.length} active relationship link(s) in the current case graph.`,
      sentence_type: "relationship_summary",
      confidence: Math.max(...params.relationships.map((relation) => relation.confidence)),
      backing_claim_ids: [],
      backing_event_ids: [],
      backing_relation_ids: strongestRelationships.map((relation) => relation.id),
    });
  }

  if (params.timeline.length) {
    const first = params.timeline[0];
    sentences.push({
      entity_id: params.entity.id,
      sentence_text: `Timeline coverage starts with ${first.title}${first.time_start ? ` on ${first.time_start}` : ""}.`,
      sentence_type: "timeline_highlight",
      confidence: first.confidence,
      backing_claim_ids: [],
      backing_event_ids: [first.event_id],
      backing_relation_ids: [],
    });
  }

  return sentences;
};

export const buildEntityProfiles = (params: {
  entities: CanonicalEntityRecord[];
  claims: ClaimRecord[];
  relationships: RelationshipRecord[];
  entityTimelines: Record<string, EntityTimelineItem[]>;
  conflicts: ConflictRecord[];
}): Record<string, EntityProfileRecord> =>
  Object.fromEntries(
    params.entities.map((entity) => {
      const claims = params.claims.filter((claim) => claim.subject_entity_id === entity.id);
      const relationships = params.relationships.filter(
        (relationship) => relationship.source_entity_id === entity.id || relationship.target_entity_id === entity.id,
      );
      const timeline = params.entityTimelines[entity.id] || [];
      const conflicts = params.conflicts.filter((conflict) => conflict.entity_id === entity.id);
      const summary_sentences = buildSentences({
        entity,
        claims,
        relationships,
        timeline,
        conflicts,
      });

      const confidence = Math.max(
        entity.confidence,
        claims.length ? Math.max(...claims.map((claim) => claim.confidence)) : 0,
        relationships.length ? Math.max(...relationships.map((relationship) => relationship.confidence)) : 0,
        timeline.length ? Math.max(...timeline.map((item) => item.confidence)) : 0,
      );

      const roles = uniqueStrings(
        claims
          .filter((claim) => /role/i.test(claim.predicate))
          .map((claim) => claim.object_literal || claim.object_entity_id || ""),
      );
      const affiliations = uniqueStrings(
        claims
          .filter((claim) => /(organization|works_for|employed_by|member_of|affiliat)/i.test(claim.predicate))
          .map((claim) => claim.object_literal || claim.object_entity_id || ""),
      );
      const locations = uniqueStrings(
        timeline
          .map((item) => item.title)
          .filter((item) => /in |at /i.test(item)),
      );

      const factsByConfidence = {
        high: claims.filter((claim) => claim.confidence >= 0.8).map((claim) => claim.id),
        medium: claims.filter((claim) => claim.confidence >= 0.55 && claim.confidence < 0.8).map((claim) => claim.id),
        low: claims.filter((claim) => claim.confidence < 0.55).map((claim) => claim.id),
        unresolved: conflicts.length ? conflicts.map((conflict) => conflict.id) : [],
      };

      return [
        entity.id,
        {
          entity_id: entity.id,
          canonical_name: entity.canonical_name,
          entity_type: entity.entity_type,
          aliases: entity.aliases_json,
          roles,
          affiliations,
          locations,
          facts_by_confidence: factsByConfidence,
          strongest_claim_ids: pickTop(claims, 3).map((claim) => claim.id),
          active_relationship_ids: relationships.map((relationship) => relationship.id),
          timeline_event_ids: timeline.map((item) => item.event_id),
          conflict_ids: conflicts.map((conflict) => conflict.id),
          summary_sentences,
          overall_confidence: confidence,
          confidence_band: confidenceBand(confidence, entity.review_state === "pending_review"),
          gaps: claims.length ? [] : ["insufficient_supported_claims"],
        } satisfies EntityProfileRecord,
      ];
    }),
  );

export const buildEntitySummaryRecords = (params: {
  caseId: string;
  generatedAt: string;
  processingJobId?: string;
  entityProfiles: Record<string, EntityProfileRecord>;
}): EntitySummaryRecord[] =>
  Object.values(params.entityProfiles).map((profile) => {
    const fingerprint = stableHash(
      JSON.stringify({
        entity_id: profile.entity_id,
        aliases: profile.aliases,
        roles: profile.roles,
        affiliations: profile.affiliations,
        locations: profile.locations,
        strongest_claim_ids: profile.strongest_claim_ids,
        active_relationship_ids: profile.active_relationship_ids,
        timeline_event_ids: profile.timeline_event_ids,
        conflict_ids: profile.conflict_ids,
        gaps: profile.gaps,
        summary_sentences: profile.summary_sentences.map((sentence) => sentence.sentence_text),
      }),
    );

    return {
      id: `summary_${profile.entity_id}_${fingerprint}`,
      entity_id: profile.entity_id,
      case_id: params.caseId,
      version: 1,
      is_current: true,
      generated_at: params.generatedAt,
      processing_job_id: params.processingJobId,
      canonical_name: profile.canonical_name,
      entity_type: profile.entity_type,
      aliases: profile.aliases,
      roles: profile.roles,
      affiliations: profile.affiliations,
      locations: profile.locations,
      facts_by_confidence: profile.facts_by_confidence,
      strongest_claim_ids: profile.strongest_claim_ids,
      active_relationship_ids: profile.active_relationship_ids,
      timeline_event_ids: profile.timeline_event_ids,
      conflict_ids: profile.conflict_ids,
      overall_confidence: profile.overall_confidence,
      confidence_band: profile.confidence_band,
      gaps: profile.gaps,
    } satisfies EntitySummaryRecord;
  });
