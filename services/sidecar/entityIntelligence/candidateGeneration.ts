import type { CanonicalEntityRecord, CandidateMatchRecord, EntityAliasRecord, EntityMentionRecord, ReferenceLinkRecord } from "./types";
import { lexicalSimilarity, normalizeEntityText, stableHash, surnameOf, transliterationSkeleton } from "./normalization";

const maxScore = (scores: number[]): number => scores.reduce((best, score) => Math.max(best, score), 0);

const mentionIdentifiers = (mention: EntityMentionRecord): string[] =>
  mention.mention_type === "structured-id" ? [mention.normalized_text] : [];

const entityIdentifiers = (entity: CanonicalEntityRecord): string[] =>
  Array.isArray(entity.attributes_json.identifiers)
    ? (entity.attributes_json.identifiers as string[]).map((value) => normalizeEntityText(value))
    : [];

const semanticContextScore = (mention: EntityMentionRecord, entity: CanonicalEntityRecord): number => {
  const mentionContext = normalizeEntityText(`${mention.context_window_before} ${mention.context_window_after}`);
  if (!mentionContext || !entity.profile_text) return 0;
  return lexicalSimilarity(mentionContext, entity.profile_text);
};

const roleCompatibilityScore = (mention: EntityMentionRecord, entity: CanonicalEntityRecord): number => {
  const mentionRole = normalizeEntityText(`${mention.subtype || ""} ${(mention.attributes_json.role as string) || ""}`);
  if (!mentionRole) return 0;
  const entityRoles = [
    ...((entity.attributes_json.roles as string[]) || []),
    ...((entity.attributes_json.titles as string[]) || []),
  ]
    .map((value) => normalizeEntityText(value))
    .filter(Boolean);
  return maxScore(entityRoles.map((value) => lexicalSimilarity(mentionRole, value)));
};

const temporalCompatibilityScore = (mention: EntityMentionRecord, entity: CanonicalEntityRecord): number => {
  const mentionTimestamp = typeof mention.attributes_json.timestamp === "string" ? mention.attributes_json.timestamp : undefined;
  if (!mentionTimestamp || !entity.first_seen_at || !entity.last_seen_at) return 0.5;
  if (mentionTimestamp >= entity.first_seen_at && mentionTimestamp <= entity.last_seen_at) return 0.9;
  return 0.25;
};

const neighborhoodScore = (
  mention: EntityMentionRecord,
  entity: CanonicalEntityRecord,
  referenceLinks: ReferenceLinkRecord[],
  resolvedMentionEntityMap: Record<string, string>,
): number => {
  const linkedMentionIds = referenceLinks
    .filter((link) => link.source_mention_id === mention.id || link.target_mention_id === mention.id)
    .map((link) => (link.source_mention_id === mention.id ? link.target_mention_id : link.source_mention_id));
  if (!linkedMentionIds.length) return 0;

  const directResolvedBoost = referenceLinks
    .filter((link) => link.source_mention_id === mention.id || link.target_mention_id === mention.id)
    .reduce((best, link) => {
      const linkedMentionId = link.source_mention_id === mention.id ? link.target_mention_id : link.source_mention_id;
      return resolvedMentionEntityMap[linkedMentionId] === entity.id ? Math.max(best, link.score) : best;
    }, 0);

  const relatedAliases = ((entity.attributes_json.co_mentioned_aliases as string[]) || []).map((value) => normalizeEntityText(value));
  const aliasMatchScore =
    !relatedAliases.length
      ? 0
      : linkedMentionIds.filter((linkedId) =>
          relatedAliases.some((alias) => alias.includes(normalizeEntityText(linkedId))),
        ).length / Math.max(1, linkedMentionIds.length);

  return Math.max(directResolvedBoost, Math.min(1, aliasMatchScore));
};

const conflictPenalty = (mention: EntityMentionRecord, entity: CanonicalEntityRecord): number => {
  if (mention.label !== "OTHER" && normalizeEntityText(mention.label) !== normalizeEntityText(entity.entity_type)) {
    return 0.2;
  }
  const mentionIds = mentionIdentifiers(mention);
  const knownIds = entityIdentifiers(entity);
  if (mentionIds.length && knownIds.length && !mentionIds.some((value) => knownIds.includes(value))) {
    return 0.35;
  }
  return 0;
};

export const generateCandidateMatches = (
  mention: EntityMentionRecord,
  entities: CanonicalEntityRecord[],
  aliases: EntityAliasRecord[],
  referenceLinks: ReferenceLinkRecord[],
  resolvedMentionEntityMap: Record<string, string>,
  limit = 5,
): CandidateMatchRecord[] => {
  const mentionIds = mentionIdentifiers(mention);
  const candidateScores = entities.map((entity) => {
    const entityAliases = aliases
      .filter((alias) => alias.entity_id === entity.id)
      .map((alias) => alias.alias)
      .concat(entity.aliases_json)
      .concat(entity.canonical_name);
    const lexical_score = lexicalSimilarity(mention.text, entity.canonical_name);
    const mentionTokenCount = normalizeEntityText(mention.text).split(" ").filter(Boolean).length;
    const sameSurnameBoost =
      mention.label === "PERSON" &&
      mentionTokenCount <= 2 &&
      surnameOf(mention.text) &&
      entityAliases.some((alias) => surnameOf(alias) && surnameOf(alias) === surnameOf(mention.text)) &&
      (mentionTokenCount === 1 || /\b(minister|director|agent|commander)\b/i.test(mention.text))
        ? 0.72
        : 0;
    const alias_score = Math.max(maxScore(entityAliases.map((alias) => lexicalSimilarity(mention.text, alias))), sameSurnameBoost);
    const semantic_score = semanticContextScore(mention, entity);
    const id_match_score = mentionIds.length
      ? maxScore(
          mentionIds.map((value) =>
            entityIdentifiers(entity).includes(value) || entityAliases.some((alias) => normalizeEntityText(alias) === value) ? 1 : 0,
          ),
        )
      : 0;
    const transliterationBoost = maxScore(
      entityAliases.map((alias) =>
        transliterationSkeleton(alias) === transliterationSkeleton(mention.text) ? 0.85 : 0,
      ),
    );
    const role_score = roleCompatibilityScore(mention, entity);
    const temporal_score = temporalCompatibilityScore(mention, entity);
    const neighborhood_score = neighborhoodScore(mention, entity, referenceLinks, resolvedMentionEntityMap);
    const penalty = conflictPenalty(mention, entity);

    const total_score = Math.max(
      0,
      Math.min(
        1,
        lexical_score * 0.18 +
          Math.max(alias_score, transliterationBoost) * 0.28 +
          semantic_score * 0.16 +
          id_match_score * 0.18 +
          role_score * 0.08 +
          temporal_score * 0.06 +
          neighborhood_score * 0.06 -
          penalty,
      ),
    );

    return {
      mention_id: mention.id,
      candidate_entity_id: entity.id,
      rank: 0,
      total_score,
      lexical_score,
      alias_score: Math.max(alias_score, transliterationBoost),
      semantic_score,
      id_match_score,
      role_score,
      temporal_score,
      neighborhood_score,
      conflict_penalty: penalty,
      features_json: {
        mention_label: mention.label,
        entity_type: entity.entity_type,
        mention_identifiers: mentionIds,
        entity_identifiers: entityIdentifiers(entity),
      },
      decision_state: "pending_review",
    } satisfies CandidateMatchRecord;
  });

  return candidateScores
    .sort((left, right) => right.total_score - left.total_score)
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
};

export const provisionalEntityIdForMention = (caseId: string, mention: EntityMentionRecord): string =>
  `entity_${stableHash(`${caseId}:${mention.document_id}:${mention.label}:${mention.canonical_text}:${mention.id}`)}`;
