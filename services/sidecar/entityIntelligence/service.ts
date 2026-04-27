import { DEFAULT_ENTITY_INTELLIGENCE_CONFIG } from "./config";
import { applyDerivedArtifacts } from "./caseAssembly";
import { buildClaimLayer } from "./claims";
import { buildEventLayer } from "./events";
import { buildDocumentRecords, buildEntityMentionRecords, buildEvidenceSpans, buildMentionTypeDecisions } from "./grounding";
import { createProcessingJob, finalizeProcessingJob } from "./jobs";
import { buildReferenceLinks } from "./referenceChaining";
import { resolveMentionsToCanonicalEntities } from "./resolution";
import type {
  EntityIntelligenceBuildInput,
  EntityIntelligenceDebugReport,
  EntityIntelligenceServiceResult,
  ManualReviewAuditRecord,
  ProcessingJobRecord,
} from "./types";
import { getEntityIntelligenceCase, persistEntityIntelligenceCase, regenerateEntitySummaryRecord } from "./store";
import { stableHash } from "./normalization";

const computeMetrics = (result: EntityIntelligenceServiceResult["result"]) => ({
  mention_count: result.mentions.length,
  entity_count: result.canonical_entities.length,
  ambiguous_mention_count: result.resolution_decisions.filter((decision) => decision.resolution_state === "ambiguous").length,
  claim_count: result.claims.length,
  relationship_count: result.relationships.length,
  event_count: result.events.length,
  conflict_count: result.conflicts.length,
  provenance_coverage_rate:
    result.claims.length === 0
      ? 1
      : result.claims.filter((claim) => result.claim_evidence.some((item) => item.claim_id === claim.id)).length / result.claims.length,
  unsupported_summary_rate:
    Object.values(result.entity_profiles)
      .flatMap((profile) => profile.summary_sentences)
      .filter(
        (sentence) =>
          sentence.backing_claim_ids.length === 0 &&
          sentence.backing_event_ids.length === 0 &&
          sentence.backing_relation_ids.length === 0 &&
          sentence.sentence_type !== "identity_overview" &&
          sentence.sentence_type !== "known_aliases" &&
          sentence.sentence_type !== "gap_unknown" &&
          sentence.sentence_type !== "ambiguity_conflict",
      ).length / Math.max(1, Object.values(result.entity_profiles).flatMap((profile) => profile.summary_sentences).length),
});

const dedupeBy = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildDebugReports = (result: EntityIntelligenceServiceResult["result"]): Record<string, EntityIntelligenceDebugReport> =>
  Object.fromEntries(
    result.canonical_entities.map((entity) => [
      entity.id,
      {
        case_id: result.case_id,
        entity_id: entity.id,
        resolution_explanations: result.resolution_decisions
          .filter((decision) => decision.entity_id === entity.id)
          .map((decision) => decision.explanation),
        candidate_decisions: result.candidate_matches.filter((candidate) => entity.mention_ids.includes(candidate.mention_id)),
        conflicts: result.conflicts.filter((conflict) => conflict.entity_id === entity.id),
        summary_support: result.entity_profiles[entity.id]?.summary_sentences || [],
      },
    ]),
  );

export const buildEntityIntelligenceCase = async (input: EntityIntelligenceBuildInput): Promise<EntityIntelligenceServiceResult> => {
  const startedJob = createProcessingJob(input.caseId, "entity_intelligence_run");
  const persistedCase = await getEntityIntelligenceCase(input.caseId);

  const { documents, versions, chunks } = buildDocumentRecords(input);
  const documentId = documents[0].id;
  const evidence_spans = buildEvidenceSpans(documentId, input.payload.raw_text, chunks, input.payload);
  const mentions = buildEntityMentionRecords(documentId, input.payload, evidence_spans);
  const mention_type_decisions = buildMentionTypeDecisions(mentions);
  const reference_links = buildReferenceLinks(mentions);

  const resolution = resolveMentionsToCanonicalEntities({
    caseId: input.caseId,
    mentions,
    existingEntities: persistedCase?.canonical_entities,
    existingAliases: persistedCase?.entity_aliases,
    referenceLinks: reference_links,
    config: DEFAULT_ENTITY_INTELLIGENCE_CONFIG,
  });
  const currentRunDecisions = resolution.decisions.map((decision) => ({
    ...decision,
    id: `resolution_${stableHash(`${startedJob.id}:${decision.mention_id}:${decision.entity_id}`)}`,
    decision_key: decision.mention_id,
    processing_job_id: startedJob.id,
    is_current: true,
  }));

  const resolveEntityName = (entityId: string): string =>
    resolution.canonical_entities.find((entity) => entity.id === entityId)?.canonical_name ||
    input.payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name ||
    entityId;

  const { claims, claimEvidence, relationships } = buildClaimLayer(input.payload, resolution.mention_entity_map);
  const { events, participants } = buildEventLayer(input.payload, resolution.mention_entity_map, resolveEntityName);
  const mergedDocuments = dedupeBy([...(persistedCase?.documents || []), ...documents], (item) => item.id);
  const mergedVersions = dedupeBy([...(persistedCase?.document_versions || []), ...versions], (item) => item.id);
  const mergedChunks = dedupeBy([...(persistedCase?.document_chunks || []), ...chunks], (item) => item.id);
  const mergedEvidenceSpans = dedupeBy([...(persistedCase?.evidence_spans || []), ...evidence_spans], (item) => item.id);
  const mergedMentions = dedupeBy([...(persistedCase?.mentions || []), ...mentions], (item) => item.id);
  const mergedReferenceLinks = dedupeBy([...(persistedCase?.reference_links || []), ...reference_links], (item) => item.id);
  const mergedCandidateMatches = dedupeBy([...(persistedCase?.candidate_matches || []), ...resolution.candidate_matches], (item) => `${item.mention_id}:${item.candidate_entity_id}`);
  const mergedResolutionDecisions = dedupeBy([...currentRunDecisions, ...(persistedCase?.resolution_decisions || [])], (item) => item.decision_key || item.mention_id);
  const mergedClaims = dedupeBy([...(persistedCase?.claims || []), ...claims], (item) => item.id);
  const mergedClaimEvidence = dedupeBy([...(persistedCase?.claim_evidence || []), ...claimEvidence], (item) => `${item.claim_id}:${item.evidence_span_id}`);
  const mergedRelationships = dedupeBy([...(persistedCase?.relationships || []), ...relationships], (item) => item.id);
  const mergedEvents = dedupeBy([...(persistedCase?.events || []), ...events], (item) => item.id);
  const mergedParticipants = dedupeBy([...(persistedCase?.event_participants || []), ...participants], (item) => `${item.event_id}:${item.entity_id}:${item.role_in_event}`);
  const mergedReviewTasks = dedupeBy([...(persistedCase?.review_tasks || []), ...resolution.review_tasks], (item) => item.id);
  const mergedManualAuditLog = [...(persistedCase?.manual_audit_log || [])] as ManualReviewAuditRecord[];
  const mergedAliases = dedupeBy([...(persistedCase?.entity_aliases || []), ...resolution.aliases], (item) => `${item.entity_id}:${item.normalized_alias}`);

  let result = {
    case_id: input.caseId,
    generated_at: new Date().toISOString(),
    documents: mergedDocuments,
    document_versions: mergedVersions,
    document_chunks: mergedChunks,
    evidence_spans: mergedEvidenceSpans,
    mentions: mergedMentions,
    mention_type_decisions: dedupeBy([...(persistedCase?.mention_type_decisions || []), ...mention_type_decisions], (item) => item.id),
    reference_links: mergedReferenceLinks,
    candidate_matches: mergedCandidateMatches,
    resolution_decisions: mergedResolutionDecisions,
    canonical_entities: resolution.canonical_entities,
    entity_aliases: mergedAliases,
    claims: mergedClaims,
    claim_evidence: mergedClaimEvidence,
    relationships: mergedRelationships,
    events: mergedEvents,
    event_participants: mergedParticipants,
    timeline_items: persistedCase?.timeline_items || [],
    entity_timelines: persistedCase?.entity_timelines || {},
    conflicts: persistedCase?.conflicts || [],
    entity_summaries: persistedCase?.entity_summaries || [],
    entity_profiles: persistedCase?.entity_profiles || {},
    review_tasks: mergedReviewTasks,
    review_actions: mergedManualAuditLog,
    manual_audit_log: mergedManualAuditLog,
    processing_jobs: [] as ProcessingJobRecord[],
    metrics: {
      mention_count: 0,
      entity_count: 0,
      ambiguous_mention_count: 0,
      claim_count: 0,
      relationship_count: 0,
      event_count: 0,
      conflict_count: 0,
      provenance_coverage_rate: 0,
      unsupported_summary_rate: 0,
    },
    warnings: [
      ...(persistedCase ? [] : []),
      input.knowledge ? "" : "Reference knowledge was unavailable; entity intelligence ran on case evidence only.",
    ].filter(Boolean),
  };

  result = applyDerivedArtifacts(result, { processingJobId: startedJob.id });
  const metrics = computeMetrics(result);
  const completedJob = finalizeProcessingJob(startedJob, "completed", metrics, result.warnings);
  result.processing_jobs = dedupeBy([...(persistedCase?.processing_jobs || []), completedJob], (item) => item.id);
  result.metrics = metrics;

  const debug_reports = buildDebugReports(result);
  await persistEntityIntelligenceCase(result, debug_reports);

  return {
    result,
    debug_reports,
  };
};

export const regenerateEntitySummary = (caseId: string, entityId: string): Promise<EntityIntelligenceServiceResult["result"] | null> =>
  regenerateEntitySummaryRecord(caseId, entityId);
