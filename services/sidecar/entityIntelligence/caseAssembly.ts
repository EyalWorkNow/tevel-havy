import { detectConflicts } from "./conflicts";
import { buildEntityProfiles, buildEntitySummaryRecords } from "./summaries";
import { buildEntityTimelines, flattenEntityTimelines } from "./timeline";
import type { EntityIntelligenceCaseResult } from "./types";

export const applyDerivedArtifacts = (
  current: EntityIntelligenceCaseResult,
  options: { processingJobId?: string } = {},
): EntityIntelligenceCaseResult => {
  current.entity_timelines = buildEntityTimelines(current.canonical_entities, current.events, current.event_participants);
  current.timeline_items = flattenEntityTimelines(current.entity_timelines);
  current.conflicts = detectConflicts(current.canonical_entities, current.claims, current.relationships);
  current.entity_profiles = buildEntityProfiles({
    entities: current.canonical_entities,
    claims: current.claims,
    relationships: current.relationships,
    entityTimelines: current.entity_timelines,
    conflicts: current.conflicts,
  });
  current.entity_summaries = buildEntitySummaryRecords({
    caseId: current.case_id,
    generatedAt: current.generated_at,
    processingJobId: options.processingJobId,
    entityProfiles: current.entity_profiles,
  });

  const summaryByEntityId = new Map(current.entity_summaries.map((summary) => [summary.entity_id, summary]));
  Object.values(current.entity_profiles).forEach((profile) => {
    const summary = summaryByEntityId.get(profile.entity_id);
    if (!summary) return;
    profile.summary_id = summary.id;
    profile.summary_version = summary.version;
    profile.summary_sentences = profile.summary_sentences.map((sentence, sentenceIndex) => ({
      ...sentence,
      summary_id: summary.id,
      sentence_index: sentenceIndex,
    }));
  });

  current.review_actions = current.review_actions?.length ? current.review_actions : current.manual_audit_log;
  current.manual_audit_log = current.review_actions;
  return current;
};
