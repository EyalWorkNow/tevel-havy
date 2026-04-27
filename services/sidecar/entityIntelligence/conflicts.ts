import type { CanonicalEntityRecord, ClaimRecord, ConflictRecord, RelationshipRecord } from "./types";
import { normalizeEntityText, stableHash } from "./normalization";

const canonicalizeRelationType = (value: string): string =>
  normalizeEntityText(value)
    .replace(/_with$/u, "")
    .replace(/\s+/g, "_")
    .replace(/^affiliated$/u, "affiliation")
    .replace(/^met$/u, "meeting");

const buildConflict = (params: Omit<ConflictRecord, "id" | "status">): ConflictRecord => ({
  ...params,
  id: `conflict_${stableHash(`${params.conflict_type}:${params.left_item_ref}:${params.right_item_ref}`)}`,
  status: "open",
});

export const detectConflicts = (
  entities: CanonicalEntityRecord[],
  claims: ClaimRecord[],
  relationships: RelationshipRecord[],
): ConflictRecord[] => {
  const conflicts: ConflictRecord[] = [];

  entities.forEach((entity) => {
    const entityClaims = claims.filter((claim) => claim.subject_entity_id === entity.id);
    const roleClaims = entityClaims.filter((claim) => claim.predicate.includes("role") || claim.claim_type.includes("ROLE"));
    for (let index = 0; index < roleClaims.length; index += 1) {
      for (let inner = index + 1; inner < roleClaims.length; inner += 1) {
        const left = roleClaims[index];
        const right = roleClaims[inner];
        if (
          left.object_literal &&
          right.object_literal &&
          normalizeEntityText(left.object_literal) !== normalizeEntityText(right.object_literal) &&
          left.confidence >= 0.6 &&
          right.confidence >= 0.6
        ) {
          conflicts.push(
            buildConflict({
              conflict_type: "contradictory_role",
              entity_id: entity.id,
              left_item_ref: left.id,
              right_item_ref: right.id,
              severity: "medium",
              explanation: "Entity has multiple incompatible role claims with comparable confidence.",
            }),
          );
        }
      }
    }

    const affiliationClaims = entityClaims.filter((claim) =>
      /(affiliat|organization|member_of|employed_by|works_for)/i.test(claim.predicate),
    );
    for (let index = 0; index < affiliationClaims.length; index += 1) {
      for (let inner = index + 1; inner < affiliationClaims.length; inner += 1) {
        const left = affiliationClaims[index];
        const right = affiliationClaims[inner];
        if (
          left.object_entity_id &&
          right.object_entity_id &&
          left.object_entity_id !== right.object_entity_id &&
          left.confidence >= 0.65 &&
          right.confidence >= 0.65
        ) {
          conflicts.push(
            buildConflict({
              conflict_type: "contradictory_affiliation",
              entity_id: entity.id,
              left_item_ref: left.id,
              right_item_ref: right.id,
              severity: "medium",
              explanation: "Entity is attached to multiple conflicting affiliations.",
            }),
          );
        }
      }
    }
  });

  relationships.forEach((relationship, index) => {
    relationships.slice(index + 1).forEach((candidate) => {
      if (
        relationship.source_entity_id === candidate.source_entity_id &&
        relationship.target_entity_id === candidate.target_entity_id &&
        canonicalizeRelationType(relationship.relation_type) !== canonicalizeRelationType(candidate.relation_type) &&
        relationship.confidence >= 0.7 &&
        candidate.confidence >= 0.7
      ) {
        conflicts.push(
          buildConflict({
            conflict_type: "contradictory_relationship",
            relation_id: relationship.id,
            left_item_ref: relationship.id,
            right_item_ref: candidate.id,
            severity: "low",
            explanation: "The same entity pair carries multiple strong but divergent relationship types.",
          }),
        );
      }
    });
  });

  entities.forEach((left, index) => {
    entities.slice(index + 1).forEach((right) => {
      if (
        normalizeEntityText(left.canonical_name) === normalizeEntityText(right.canonical_name) &&
        left.id !== right.id &&
        left.review_state !== "pending_review" &&
        right.review_state !== "pending_review"
      ) {
        conflicts.push(
          buildConflict({
            conflict_type: "possible_duplicate_entity",
            entity_id: left.id,
            left_item_ref: left.id,
            right_item_ref: right.id,
            severity: "high",
            explanation: "Two canonical entities share the same normalized name and may require duplicate review.",
          }),
        );
      }
    });
  });

  return conflicts;
};
