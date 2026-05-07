import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../supabaseClient";
import { applyDerivedArtifacts } from "./caseAssembly";
import type {
  CandidateMatchRecord,
  CanonicalEntityRecord,
  ClaimEvidenceRecord,
  ClaimRecord,
  ConflictRecord,
  EntityIntelligenceCaseResult,
  EntityIntelligenceDebugReport,
  EntityMentionRecord,
  EntityProfileRecord,
  EntitySummaryRecord,
  EventParticipantRecord,
  EventRecord,
  ManualReviewAuditRecord,
  MentionTypeDecisionRecord,
  ReferenceLinkRecord,
  RelationshipRecord,
  ResolutionDecisionRecord,
  ReviewActionRecord,
  ReviewTaskRecord,
  SummarySentenceRecord,
  TimelineItemRecord,
} from "./types";
import type {
  AmbiguousMentionRecord,
  CaseEntityGraphRecord,
  EntityIntelligenceRepository,
} from "./repository";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const ensure = async <T,>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>): Promise<T> => {
  const { data, error } = await promise;
  if (error) {
    throw new Error(error.message || "Postgres entity intelligence operation failed");
  }
  return data as T;
};

const optional = async <T,>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>): Promise<T | null> => {
  const { data, error } = await promise;
  if (error) {
    throw new Error(error.message || "Postgres entity intelligence operation failed");
  }
  return (data as T | null) || null;
};

const nonEmpty = <T,>(items: T[]): T[] => items.filter(Boolean);

const uniqueBy = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const profileFromSummary = (summary: EntitySummaryRecord, sentences: SummarySentenceRecord[]): EntityProfileRecord => ({
  entity_id: summary.entity_id,
  summary_id: summary.id,
  summary_version: summary.version,
  canonical_name: summary.canonical_name,
  entity_type: summary.entity_type,
  aliases: summary.aliases,
  roles: summary.roles,
  affiliations: summary.affiliations,
  locations: summary.locations,
  facts_by_confidence: summary.facts_by_confidence,
  strongest_claim_ids: summary.strongest_claim_ids,
  active_relationship_ids: summary.active_relationship_ids,
  timeline_event_ids: summary.timeline_event_ids,
  conflict_ids: summary.conflict_ids,
  summary_sentences: sentences,
  overall_confidence: summary.overall_confidence,
  confidence_band: summary.confidence_band,
  gaps: summary.gaps,
});

const summarySentenceIntegrityError = (sentence: SummarySentenceRecord): string =>
  `Summary sentence "${sentence.sentence_text}" is missing backing claim/event/relation ids.`;

const validateIntegrity = (result: EntityIntelligenceCaseResult): void => {
  const entityIds = new Set(result.canonical_entities.map((entity) => entity.id));
  const eventIds = new Set(result.events.map((event) => event.id));
  const evidenceIds = new Set(result.evidence_spans.map((span) => span.id));
  const mentionIds = new Set(result.mentions.map((mention) => mention.id));
  const resolutionMentionIds = new Set(result.resolution_decisions.map((decision) => decision.mention_id));

  result.claims.forEach((claim) => {
    const evidenceCount = result.claim_evidence.filter((item) => item.claim_id === claim.id).length;
    if (evidenceCount === 0) {
      throw new Error(`Claim ${claim.id} has no supporting evidence.`);
    }
    if (!entityIds.has(claim.subject_entity_id)) {
      throw new Error(`Claim ${claim.id} points to missing subject entity ${claim.subject_entity_id}.`);
    }
    if (claim.object_entity_id && !entityIds.has(claim.object_entity_id)) {
      throw new Error(`Claim ${claim.id} points to missing object entity ${claim.object_entity_id}.`);
    }
  });

  result.claim_evidence.forEach((item) => {
    if (!evidenceIds.has(item.evidence_span_id)) {
      throw new Error(`Claim evidence ${item.claim_id}/${item.evidence_span_id} points to missing evidence span.`);
    }
  });

  result.mentions.forEach((mention) => {
    if (!resolutionMentionIds.has(mention.id)) {
      throw new Error(`Mention ${mention.id} has no resolution decision.`);
    }
  });

  result.canonical_entities.forEach((entity) => {
    entity.mention_ids.forEach((mentionId) => {
      if (!mentionIds.has(mentionId)) {
        throw new Error(`Entity ${entity.id} references missing mention ${mentionId}.`);
      }
    });
  });

  result.relationships.forEach((relationship) => {
    if (!entityIds.has(relationship.source_entity_id) || !entityIds.has(relationship.target_entity_id)) {
      throw new Error(`Relationship ${relationship.id} points to missing entity endpoints.`);
    }
  });

  result.event_participants.forEach((participant) => {
    if (!entityIds.has(participant.entity_id) || !eventIds.has(participant.event_id)) {
      throw new Error(`Event participant ${participant.event_id}/${participant.entity_id} points to missing entity or event.`);
    }
  });

  Object.values(result.entity_profiles)
    .flatMap((profile) => profile.summary_sentences)
    .forEach((sentence) => {
      if (
        sentence.backing_claim_ids.length === 0 &&
        sentence.backing_event_ids.length === 0 &&
        sentence.backing_relation_ids.length === 0
      ) {
        throw new Error(summarySentenceIntegrityError(sentence));
      }
    });
};

type SnapshotRow = {
  case_id: string;
  generated_at: string;
  processing_job_id?: string | null;
  snapshot_json: EntityIntelligenceCaseResult;
  debug_reports_json: Record<string, EntityIntelligenceDebugReport>;
};

export class PostgresEntityIntelligenceRepository implements EntityIntelligenceRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  async persistCase(
    result: EntityIntelligenceCaseResult,
    debugReports: Record<string, EntityIntelligenceDebugReport> = {},
  ): Promise<EntityIntelligenceCaseResult> {
    const hydrated = applyDerivedArtifacts(clone(result), {
      processingJobId: result.processing_jobs.at(-1)?.id,
    });
    validateIntegrity(hydrated);

    hydrated.resolution_decisions = hydrated.resolution_decisions.map((decision) => ({
      ...decision,
      decision_key: decision.decision_key || decision.mention_id,
      processing_job_id: decision.processing_job_id || hydrated.processing_jobs.at(-1)?.id,
      is_current: true,
    }));

    hydrated.review_actions = hydrated.review_actions?.length ? hydrated.review_actions : hydrated.manual_audit_log;
    hydrated.manual_audit_log = hydrated.review_actions;

    await this.prepareSummaryVersions(hydrated);
    await this.markPreviousResolutionDecisionsAsStale(hydrated.resolution_decisions.map((decision) => decision.mention_id));
    await this.markPreviousSummariesAsStale(hydrated.entity_summaries.map((summary) => summary.entity_id));

    await this.upsertRows("entity_documents", hydrated.documents, "id");
    await this.upsertRows("entity_document_versions", hydrated.document_versions, "id");
    await this.upsertRows("entity_document_chunks", hydrated.document_chunks, "id");
    await this.upsertRows("entity_evidence_spans", hydrated.evidence_spans, "id");
    await this.upsertRows("entity_mentions", hydrated.mentions, "id");
    await this.upsertRows("entity_mention_type_decisions", hydrated.mention_type_decisions, "id");
    await this.upsertRows("canonical_entities", hydrated.canonical_entities, "id");
    await this.upsertRows("entity_aliases", hydrated.entity_aliases, "entity_id,normalized_alias");
    await this.upsertRows("entity_reference_links", hydrated.reference_links, "id");
    await this.upsertRows("entity_candidate_matches", hydrated.candidate_matches, "mention_id,candidate_entity_id");
    await this.upsertRows("entity_resolution_decisions", hydrated.resolution_decisions, "id");
    await this.upsertRows("entity_claims", hydrated.claims.map((claim) => ({ ...claim, case_id: hydrated.case_id })), "id");
    await this.upsertRows("entity_claim_evidence", hydrated.claim_evidence, "claim_id,evidence_span_id");
    await this.upsertRows("entity_relationships", hydrated.relationships.map((relationship) => ({ ...relationship, case_id: hydrated.case_id })), "id");
    await this.upsertRows("entity_events", hydrated.events.map((event) => ({ ...event, case_id: hydrated.case_id })), "id");
    await this.upsertRows("entity_event_participants", hydrated.event_participants, "event_id,entity_id,role_in_event");
    await this.upsertRows("entity_timeline_items", hydrated.timeline_items.map((item) => ({ ...item, case_id: hydrated.case_id })), "id");
    await this.upsertRows("entity_conflicts", hydrated.conflicts.map((conflict) => ({ ...conflict, case_id: hydrated.case_id })), "id");
    await this.upsertRows("entity_summaries", hydrated.entity_summaries, "id");
    await this.upsertRows(
      "entity_summary_sentences",
      Object.values(hydrated.entity_profiles).flatMap((profile) =>
        profile.summary_sentences.map((sentence, sentenceIndex) => ({
          ...sentence,
          summary_id: sentence.summary_id || profile.summary_id,
          entity_id: profile.entity_id,
          sentence_index: sentence.sentence_index ?? sentenceIndex,
        })),
      ),
      "summary_id,sentence_index",
    );
    await this.upsertRows("entity_review_tasks", hydrated.review_tasks, "id");
    await this.upsertRows("entity_review_actions", hydrated.review_actions, "id");
    await this.upsertRows("entity_processing_jobs", hydrated.processing_jobs, "id");

    await this.upsertRows<SnapshotRow>(
      "entity_case_snapshots",
      [
        {
          case_id: hydrated.case_id,
          generated_at: hydrated.generated_at,
          processing_job_id: hydrated.processing_jobs.at(-1)?.id || null,
          snapshot_json: hydrated,
          debug_reports_json: debugReports,
        },
      ],
      "case_id",
    );

    return hydrated;
  }

  async getCase(caseId: string): Promise<EntityIntelligenceCaseResult | null> {
    const snapshot = await optional<SnapshotRow>(
      this.client.from("entity_case_snapshots").select("*").eq("case_id", caseId).maybeSingle(),
    );
    return snapshot?.snapshot_json || null;
  }

  async getEntityById(entityId: string): Promise<CanonicalEntityRecord | null> {
    return optional<CanonicalEntityRecord>(
      this.client.from("canonical_entities").select("*").eq("id", entityId).maybeSingle(),
    );
  }

  async getEntityProfile(entityId: string): Promise<EntityProfileRecord | null> {
    return this.getEntitySummary(entityId);
  }

  async getEntityMentions(entityId: string): Promise<EntityMentionRecord[]> {
    const decisions = await ensure<ResolutionDecisionRecord[]>(
      this.client.from("entity_resolution_decisions").select("*").eq("entity_id", entityId).eq("is_current", true),
    );
    const mentionIds = decisions.map((decision) => decision.mention_id);
    if (!mentionIds.length) return [];
    return ensure<EntityMentionRecord[]>(this.client.from("entity_mentions").select("*").in("id", mentionIds));
  }

  async getEntityClaims(entityId: string): Promise<ClaimRecord[]> {
    return ensure<ClaimRecord[]>(this.client.from("entity_claims").select("*").eq("subject_entity_id", entityId));
  }

  async getEntityRelations(entityId: string): Promise<RelationshipRecord[]> {
    return ensure<RelationshipRecord[]>(
      this.client
        .from("entity_relationships")
        .select("*")
        .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`),
    );
  }

  async getEntityTimeline(entityId: string) {
    const rows = await ensure<TimelineItemRecord[]>(
      this.client.from("entity_timeline_items").select("*").eq("entity_id", entityId).order("time_start", { ascending: true }),
    );
    return rows.map(({ case_id: _caseId, ...item }: TimelineItemRecord & { case_id?: string }) => item);
  }

  async getEntityConflicts(entityId: string): Promise<ConflictRecord[]> {
    return ensure<ConflictRecord[]>(this.client.from("entity_conflicts").select("*").eq("entity_id", entityId));
  }

  async getEntitySummary(entityId: string): Promise<EntityProfileRecord | null> {
    const summary = await optional<EntitySummaryRecord>(
      this.client.from("entity_summaries").select("*").eq("entity_id", entityId).eq("is_current", true).maybeSingle(),
    );
    if (!summary) return null;
    const sentences = await ensure<SummarySentenceRecord[]>(
      this.client.from("entity_summary_sentences").select("*").eq("summary_id", summary.id).order("sentence_index", { ascending: true }),
    );
    return profileFromSummary(
      summary,
      sentences.map((sentence) => ({
        ...sentence,
        summary_id: sentence.summary_id || summary.id,
      })),
    );
  }

  async getCaseEntityGraph(caseId: string): Promise<CaseEntityGraphRecord | null> {
    const entities = await ensure<CanonicalEntityRecord[]>(
      this.client.from("canonical_entities").select("*").eq("case_id", caseId),
    );
    if (!entities.length) return null;
    const relationships = await ensure<RelationshipRecord[]>(
      this.client.from("entity_relationships").select("*").eq("case_id", caseId),
    );
    const events = await ensure<EventRecord[]>(this.client.from("entity_events").select("*").eq("case_id", caseId));
    const eventIds = events.map((event) => event.id);
    const eventParticipants = eventIds.length
      ? await ensure<EventParticipantRecord[]>(
          this.client.from("entity_event_participants").select("*").in("event_id", eventIds),
        )
      : [];
    return {
      case_id: caseId,
      entities,
      relationships,
      events,
      event_participants: eventParticipants,
    };
  }

  async getAmbiguousMentions(caseId: string): Promise<AmbiguousMentionRecord[]> {
    const tasks = await ensure<ReviewTaskRecord[]>(
      this.client
        .from("entity_review_tasks")
        .select("*")
        .eq("case_id", caseId)
        .eq("review_type", "ambiguous_mention")
        .eq("status", "open"),
    );
    const mentionIds = tasks.map((task) => task.mention_id).filter(Boolean) as string[];
    if (!mentionIds.length) return [];
    const mentions = await ensure<EntityMentionRecord[]>(
      this.client.from("entity_mentions").select("*").in("id", mentionIds),
    );
    const candidates = await ensure<CandidateMatchRecord[]>(
      this.client.from("entity_candidate_matches").select("*").in("mention_id", mentionIds),
    );
    return tasks
      .map((task) => {
        const mention = mentions.find((candidate) => candidate.id === task.mention_id);
        if (!mention) return null;
        return {
          mention,
          candidates: candidates.filter((candidate) => candidate.mention_id === mention.id),
          explanation: task.reason,
        } satisfies AmbiguousMentionRecord;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  async getEntityCandidateDecisions(entityId: string): Promise<CandidateMatchRecord[]> {
    const mentions = await this.getEntityMentions(entityId);
    const mentionIds = mentions.map((mention) => mention.id);
    if (!mentionIds.length) return [];
    return ensure<CandidateMatchRecord[]>(
      this.client.from("entity_candidate_matches").select("*").in("mention_id", mentionIds),
    );
  }

  async getEntityDebugReport(entityId: string): Promise<EntityIntelligenceDebugReport | null> {
    const caseId = await this.findCaseIdForEntity(entityId);
    if (!caseId) return null;
    const snapshot = await optional<SnapshotRow>(
      this.client.from("entity_case_snapshots").select("*").eq("case_id", caseId).maybeSingle(),
    );
    if (!snapshot) return null;
    return snapshot.debug_reports_json?.[entityId] || null;
  }

  async mergeEntities(caseId: string, targetEntityId: string, sourceEntityId: string, actor = "system") {
    const current = await this.getCase(caseId);
    if (!current) return null;
    const target = current.canonical_entities.find((entity) => entity.id === targetEntityId);
    const source = current.canonical_entities.find((entity) => entity.id === sourceEntityId);
    if (!target || !source || target.id === source.id) return null;

    target.aliases_json = Array.from(new Set([...target.aliases_json, ...source.aliases_json]));
    target.mention_ids = Array.from(new Set([...target.mention_ids, ...source.mention_ids]));
    target.profile_text = `${target.profile_text} ${source.profile_text}`.trim().slice(0, 1400);
    target.confidence = Math.max(target.confidence, source.confidence);

    current.claims.forEach((claim) => {
      if (claim.subject_entity_id === source.id) claim.subject_entity_id = target.id;
      if (claim.object_entity_id === source.id) claim.object_entity_id = target.id;
    });
    current.relationships.forEach((relationship) => {
      if (relationship.source_entity_id === source.id) relationship.source_entity_id = target.id;
      if (relationship.target_entity_id === source.id) relationship.target_entity_id = target.id;
    });
    current.event_participants.forEach((participant) => {
      if (participant.entity_id === source.id) participant.entity_id = target.id;
    });
    current.canonical_entities = current.canonical_entities.filter((entity) => entity.id !== source.id);
    current.review_actions.push(this.buildReviewAction(caseId, "merge_entities", actor, target.id, undefined, `Merged ${source.id} into ${target.id}`));
    current.manual_audit_log = current.review_actions;
    current.generated_at = new Date().toISOString();
    return this.persistCase(current, (await this.getSnapshotDebugReports(caseId)) || {});
  }

  async splitEntity(caseId: string, entityId: string, mentionIds: string[], actor = "system") {
    const current = await this.getCase(caseId);
    if (!current) return null;
    const entity = current.canonical_entities.find((item) => item.id === entityId);
    if (!entity) return null;
    if (!mentionIds.length || mentionIds.length >= entity.mention_ids.length) return current;

    entity.review_state = "needs_split_review";
    current.review_actions.push(
      this.buildReviewAction(caseId, "split_entity", actor, entityId, undefined, `Marked entity for split review using mentions: ${mentionIds.join(", ")}`),
    );
    current.manual_audit_log = current.review_actions;
    current.generated_at = new Date().toISOString();
    return this.persistCase(current, (await this.getSnapshotDebugReports(caseId)) || {});
  }

  async regenerateEntitySummary(caseId: string, entityId: string) {
    const current = await this.getCase(caseId);
    if (!current || !current.entity_profiles[entityId]) return null;
    current.generated_at = new Date().toISOString();
    return this.persistCase(current, (await this.getSnapshotDebugReports(caseId)) || {});
  }

  private async upsertRows<T extends object>(table: string, rows: T[], onConflict: string): Promise<void> {
    if (!rows.length) return;
    await ensure(this.client.from(table).upsert(rows as never[], { onConflict }));
  }

  private async prepareSummaryVersions(result: EntityIntelligenceCaseResult): Promise<void> {
    const entityIds = result.entity_summaries.map((summary) => summary.entity_id);
    if (!entityIds.length) return;
    const currentRows = await ensure<EntitySummaryRecord[]>(
      this.client.from("entity_summaries").select("*").in("entity_id", entityIds).eq("is_current", true),
    );
    const currentByEntity = new Map(currentRows.map((row) => [row.entity_id, row]));
    const summaryByEntity = new Map(result.entity_summaries.map((summary) => [summary.entity_id, summary]));

    result.entity_summaries = result.entity_summaries.map((summary) => {
      const current = currentByEntity.get(summary.entity_id);
      if (!current) return { ...summary, version: 1, is_current: true };
      if (current.id === summary.id) {
        return { ...summary, version: current.version, is_current: true };
      }
      return { ...summary, version: current.version + 1, is_current: true };
    });

    Object.values(result.entity_profiles).forEach((profile) => {
      const summary = summaryByEntity.get(profile.entity_id);
      if (!summary) return;
      const persistedSummary = result.entity_summaries.find((candidate) => candidate.entity_id === profile.entity_id);
      if (!persistedSummary) return;
      profile.summary_id = persistedSummary.id;
      profile.summary_version = persistedSummary.version;
      profile.summary_sentences = profile.summary_sentences.map((sentence, sentenceIndex) => ({
        ...sentence,
        summary_id: persistedSummary.id,
        sentence_index: sentenceIndex,
      }));
    });
  }

  private async markPreviousResolutionDecisionsAsStale(mentionIds: string[]): Promise<void> {
    if (!mentionIds.length) return;
    await ensure(
      this.client
        .from("entity_resolution_decisions")
        .update({ is_current: false })
        .in("mention_id", mentionIds)
        .eq("is_current", true),
    );
  }

  private async markPreviousSummariesAsStale(entityIds: string[]): Promise<void> {
    if (!entityIds.length) return;
    await ensure(
      this.client
        .from("entity_summaries")
        .update({ is_current: false })
        .in("entity_id", entityIds)
        .eq("is_current", true),
    );
  }

  private async findCaseIdForEntity(entityId: string): Promise<string | null> {
    const row = await optional<{ case_id: string }>(
      this.client.from("canonical_entities").select("case_id").eq("id", entityId).maybeSingle(),
    );
    return row?.case_id || null;
  }

  private async getSnapshotDebugReports(caseId: string): Promise<Record<string, EntityIntelligenceDebugReport> | null> {
    const snapshot = await optional<SnapshotRow>(
      this.client.from("entity_case_snapshots").select("*").eq("case_id", caseId).maybeSingle(),
    );
    return snapshot?.debug_reports_json || null;
  }

  private buildReviewAction(
    caseId: string,
    action: ManualReviewAuditRecord["action"],
    actor: string,
    entityId?: string,
    mentionId?: string,
    note?: string,
  ): ReviewActionRecord {
    return {
      id: `review_${caseId}_${action}_${entityId || "none"}_${mentionId || "none"}_${Date.now()}`,
      case_id: caseId,
      action,
      actor,
      entity_id: entityId,
      mention_id: mentionId,
      note,
      created_at: new Date().toISOString(),
      status: "applied",
      attributes_json: {},
    };
  }
}

export const createPostgresEntityIntelligenceRepository = (
  client: SupabaseClient = supabase,
): EntityIntelligenceRepository => new PostgresEntityIntelligenceRepository(client);
