import type { EntityIntelligenceConfig } from "./config";
import type {
  CanonicalEntityRecord,
  CandidateMatchRecord,
  EntityAliasRecord,
  EntityMentionRecord,
  ReferenceLinkRecord,
  ResolutionDecisionRecord,
  ReviewTaskRecord,
} from "./types";
import { confidenceBand, normalizeEntityText, stableHash } from "./normalization";
import { generateCandidateMatches, provisionalEntityIdForMention } from "./candidateGeneration";

const nowIso = (): string => new Date().toISOString();

const mentionPriority = (mention: EntityMentionRecord): number => {
  if (mention.mention_type === "structured-id") return 100;
  if (mention.label === "PERSON") {
    const hasTitle = /\b(minister|director|agent|commander|mr|mrs|ms|dr)\b/i.test(mention.text);
    const tokenCount = normalizeEntityText(mention.text).split(" ").filter(Boolean).length;
    return 80 + Math.min(tokenCount, 4) * 3 - (hasTitle ? 4 : 0);
  }
  if (mention.label === "ORG") return 80;
  return Math.round(mention.confidence * 50);
};

const chooseCanonicalName = (mention: EntityMentionRecord, aliases: string[]): string =>
  [mention.text, ...aliases]
    .filter(Boolean)
    .sort((left, right) => {
      const leftHasTitle = /\b(minister|director|agent|commander|mr|mrs|ms|dr)\b/i.test(left);
      const rightHasTitle = /\b(minister|director|agent|commander|mr|mrs|ms|dr)\b/i.test(right);
      if (leftHasTitle !== rightHasTitle) return leftHasTitle ? 1 : -1;
      const leftParts = normalizeEntityText(left).split(" ").filter(Boolean).length;
      const rightParts = normalizeEntityText(right).split(" ").filter(Boolean).length;
      if (leftParts !== rightParts) return rightParts - leftParts;
      return right.length - left.length;
    })[0] || mention.text;

const buildNewCanonicalEntity = (caseId: string, mention: EntityMentionRecord): CanonicalEntityRecord => {
  const aliases = Array.from(new Set([mention.text, mention.normalized_text, mention.canonical_text])).filter(Boolean);
  const canonicalName = chooseCanonicalName(mention, aliases);
  return {
    id: provisionalEntityIdForMention(caseId, mention),
    case_id: caseId,
    entity_type: mention.label,
    canonical_name: canonicalName,
    normalized_name: normalizeEntityText(canonicalName),
    aliases_json: aliases,
    profile_text: [mention.text, mention.context_window_before, mention.context_window_after].filter(Boolean).join(" ").trim(),
    first_seen_at: typeof mention.attributes_json.timestamp === "string" ? mention.attributes_json.timestamp : undefined,
    last_seen_at: typeof mention.attributes_json.timestamp === "string" ? mention.attributes_json.timestamp : undefined,
    status: "active",
    confidence: mention.confidence,
    review_state: "clear",
    attributes_json: {
      identifiers: mention.mention_type === "structured-id" ? [mention.normalized_text] : [],
      roles: mention.subtype ? [mention.subtype] : [],
      titles: mention.label === "TITLE" ? [mention.text] : [],
      co_mentioned_aliases: [],
    },
    source_counts_json: {
      [mention.document_id]: 1,
    },
    mention_ids: [mention.id],
  };
};

const attachMentionToEntity = (entity: CanonicalEntityRecord, mention: EntityMentionRecord): CanonicalEntityRecord => {
  const aliases = Array.from(new Set([...entity.aliases_json, mention.text, mention.normalized_text, mention.canonical_text])).filter(Boolean);
  const timestamp = typeof mention.attributes_json.timestamp === "string" ? mention.attributes_json.timestamp : undefined;
  return {
    ...entity,
    canonical_name: chooseCanonicalName(mention, aliases),
    normalized_name: normalizeEntityText(chooseCanonicalName(mention, aliases)),
    aliases_json: aliases,
    profile_text: Array.from(new Set([entity.profile_text, mention.text, mention.context_window_before, mention.context_window_after]))
      .filter(Boolean)
      .join(" ")
      .slice(0, 1200),
    first_seen_at: [entity.first_seen_at, timestamp].filter(Boolean).sort()[0],
    last_seen_at: [entity.last_seen_at, timestamp].filter(Boolean).sort().slice(-1)[0],
    confidence: Math.max(entity.confidence, mention.confidence),
    review_state: entity.review_state === "conflicted" ? entity.review_state : "clear",
    source_counts_json: {
      ...entity.source_counts_json,
      [mention.document_id]: (entity.source_counts_json[mention.document_id] || 0) + 1,
    },
    mention_ids: Array.from(new Set([...entity.mention_ids, mention.id])),
    attributes_json: {
      ...entity.attributes_json,
      identifiers: Array.from(
        new Set([
          ...(((entity.attributes_json.identifiers as string[]) || []).filter(Boolean)),
          ...(mention.mention_type === "structured-id" ? [mention.normalized_text] : []),
        ]),
      ),
      roles: Array.from(
        new Set([
          ...(((entity.attributes_json.roles as string[]) || []).filter(Boolean)),
          ...(mention.subtype ? [mention.subtype] : []),
        ]),
      ),
    },
  };
};

export const resolveMentionsToCanonicalEntities = (params: {
  caseId: string;
  mentions: EntityMentionRecord[];
  existingEntities?: CanonicalEntityRecord[];
  existingAliases?: EntityAliasRecord[];
  referenceLinks: ReferenceLinkRecord[];
  config: EntityIntelligenceConfig;
}): {
  canonical_entities: CanonicalEntityRecord[];
  aliases: EntityAliasRecord[];
  candidate_matches: CandidateMatchRecord[];
  decisions: ResolutionDecisionRecord[];
  review_tasks: ReviewTaskRecord[];
  mention_entity_map: Record<string, string>;
} => {
  const entities = [...(params.existingEntities || [])].map((entity) => ({ ...entity }));
  const aliasRecords = [...(params.existingAliases || [])];
  const candidateMatches: CandidateMatchRecord[] = [];
  const decisions: ResolutionDecisionRecord[] = [];
  const reviewTasks: ReviewTaskRecord[] = [];
  const mentionEntityMap: Record<string, string> = {};

  const orderedMentions = [...params.mentions].sort((left, right) => mentionPriority(right) - mentionPriority(left));

  const finalizeCandidateStates = (
    mentionId: string,
    acceptedCandidateId: string | null,
    state: "accepted" | "ambiguous" | "rejected",
    minimumAcceptedScore = 0,
  ) => {
    candidateMatches.forEach((candidate) => {
      if (candidate.mention_id !== mentionId) return;
      if (acceptedCandidateId && candidate.candidate_entity_id === acceptedCandidateId && state === "accepted") {
        candidate.decision_state = "accepted";
        candidate.total_score = Math.max(candidate.total_score, minimumAcceptedScore);
        return;
      }
      candidate.decision_state = state === "ambiguous" && candidate.rank <= 2 ? "ambiguous" : "rejected";
    });
  };

  orderedMentions.forEach((mention) => {
    const candidates = generateCandidateMatches(
      mention,
      entities,
      aliasRecords,
      params.referenceLinks,
      mentionEntityMap,
      params.config.candidate_limit,
    );
    candidateMatches.push(...candidates);

    const [top1, top2] = candidates;
    const strongestReference = params.referenceLinks
      .filter((link) => link.source_mention_id === mention.id || link.target_mention_id === mention.id)
      .map((link) => ({
        link,
        linkedMentionId: link.source_mention_id === mention.id ? link.target_mention_id : link.source_mention_id,
        linkedEntityId: mentionEntityMap[link.source_mention_id === mention.id ? link.target_mention_id : link.source_mention_id],
      }))
      .filter((candidate) => candidate.linkedEntityId)
      .sort((left, right) => right.link.score - left.link.score)[0];

    const hardIdAttach = Boolean(top1 && top1.id_match_score >= 0.98 && top1.conflict_penalty < 0.2);
    const exactAliasAttach = Boolean(top1 && top1.alias_score >= 0.98 && top1.conflict_penalty < 0.15);
    const referenceAttach = Boolean(
      strongestReference &&
        strongestReference.link.score >= 0.68 &&
        top1 &&
        top1.candidate_entity_id === strongestReference.linkedEntityId,
    );
    const clearAttach =
      Boolean(top1) &&
      top1.total_score >= params.config.thresholds.attach_threshold &&
      (top1.total_score - (top2?.total_score || 0)) >= params.config.thresholds.margin_threshold;
    const createNew = !top1 || top1.total_score <= params.config.thresholds.new_entity_threshold;

    let entityId = "";
    let resolutionState: ResolutionDecisionRecord["resolution_state"];
    let explanation = "";
    let dominantFeatures: string[] = [];
    const blockingConflicts: string[] = [];

    if ((hardIdAttach || exactAliasAttach || referenceAttach || clearAttach) && top1) {
      const entityIndex = entities.findIndex((entity) => entity.id === top1.candidate_entity_id);
      if (entityIndex >= 0) {
        entities[entityIndex] = attachMentionToEntity(entities[entityIndex], mention);
        entityId = entities[entityIndex].id;
        resolutionState = "attached";
        explanation = hardIdAttach
          ? "Attached via trusted identifier match with no severe conflicts."
          : exactAliasAttach
            ? "Attached via an exact alias or canonical-name match with no blocking conflicts."
          : referenceAttach
            ? "Attached via a strong reference-chain link to an already resolved mention."
          : "Attached because top candidate cleared attach threshold and margin thresholds.";
        dominantFeatures = [
          top1.id_match_score >= 0.98 ? "trusted_identifier" : "",
          exactAliasAttach ? "exact_alias_match" : "",
          referenceAttach ? "reference_chain" : "",
          top1.alias_score >= 0.7 ? "alias_similarity" : "",
          top1.semantic_score >= 0.5 ? "context_overlap" : "",
        ].filter(Boolean);
        finalizeCandidateStates(
          mention.id,
          top1.candidate_entity_id,
          "accepted",
          hardIdAttach ? 0.98 : exactAliasAttach || referenceAttach ? 0.82 : params.config.thresholds.attach_threshold,
        );
      } else {
        const created = buildNewCanonicalEntity(params.caseId, mention);
        entities.push(created);
        entityId = created.id;
        resolutionState = "created";
        explanation = "Candidate entity missing from workspace; created a new canonical entity.";
        dominantFeatures = ["workspace_recovery"];
        finalizeCandidateStates(mention.id, null, "rejected");
      }
    } else if (createNew) {
      const created = buildNewCanonicalEntity(params.caseId, mention);
      entities.push(created);
      entityId = created.id;
      resolutionState = "created";
      explanation = "Top candidate score fell below the new-entity threshold, so a new canonical entity was created.";
      dominantFeatures = ["low_candidate_score"];
      finalizeCandidateStates(mention.id, null, "rejected");
    } else {
      const created = buildNewCanonicalEntity(params.caseId, mention);
      created.review_state = "pending_review";
      created.confidence = Math.min(created.confidence, 0.55);
      entities.push(created);
      entityId = created.id;
      resolutionState = "ambiguous";
      explanation = "Top candidates were too close or insufficiently strong, so the mention remained ambiguous.";
      dominantFeatures = ["abstain_zone"];
      if (top1) {
        blockingConflicts.push(`top_candidate:${top1.candidate_entity_id}`);
      }
      finalizeCandidateStates(mention.id, null, "ambiguous");
      reviewTasks.push({
        id: `review_${stableHash(`${params.caseId}:${mention.id}:ambiguous`)}`,
        case_id: params.caseId,
        review_type: "ambiguous_mention",
        entity_id: created.id,
        mention_id: mention.id,
        candidate_entity_ids: candidates.map((candidate) => candidate.candidate_entity_id),
        status: "open",
        reason: explanation,
      });
    }

    mentionEntityMap[mention.id] = entityId;

    decisions.push({
      id: `resolution_${stableHash(`${params.caseId}:${mention.id}:${entityId}`)}`,
      mention_id: mention.id,
      resolution_state: resolutionState,
      entity_id: entityId,
      final_score: top1?.total_score || mention.confidence,
      attach_threshold: params.config.thresholds.attach_threshold,
      margin_threshold: params.config.thresholds.margin_threshold,
      new_entity_threshold: params.config.thresholds.new_entity_threshold,
      competing_candidate_ids: candidates.map((candidate) => candidate.candidate_entity_id),
      dominant_features: dominantFeatures,
      blocking_conflicts: blockingConflicts,
      explanation,
      created_at: nowIso(),
    });
  });

  const nextAliases: EntityAliasRecord[] = [];
  entities.forEach((entity) => {
    entity.aliases_json.forEach((alias) => {
      nextAliases.push({
        entity_id: entity.id,
        alias,
        normalized_alias: normalizeEntityText(alias),
        alias_type: alias === entity.canonical_name ? "canonical" : "surface",
        source_count: entity.mention_ids.length,
        confidence: entity.confidence,
      });
    });
    entity.attributes_json.confidence_band = confidenceBand(
      entity.confidence,
      entity.review_state === "pending_review",
    );
  });

  return {
    canonical_entities: entities,
    aliases: nextAliases,
    candidate_matches: candidateMatches,
    decisions,
    review_tasks: reviewTasks,
    mention_entity_map: mentionEntityMap,
  };
};
