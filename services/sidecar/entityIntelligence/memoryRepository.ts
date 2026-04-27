import { applyDerivedArtifacts } from "./caseAssembly";
import type {
  EntityIntelligenceCaseResult,
  EntityIntelligenceDebugReport,
  ManualReviewAuditRecord,
} from "./types";
import type {
  AmbiguousMentionRecord,
  CaseEntityGraphRecord,
  EntityIntelligenceRepository,
} from "./repository";
import { stableHash } from "./normalization";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export class MemoryEntityIntelligenceRepository implements EntityIntelligenceRepository {
  private caseStore = new Map<string, EntityIntelligenceCaseResult>();
  private debugStore = new Map<string, Record<string, EntityIntelligenceDebugReport>>();
  private entityToCase = new Map<string, string>();

  async resetForTests(): Promise<void> {
    this.caseStore.clear();
    this.debugStore.clear();
    this.entityToCase.clear();
  }

  async persistCase(
    result: EntityIntelligenceCaseResult,
    debugReports: Record<string, EntityIntelligenceDebugReport> = {},
  ): Promise<EntityIntelligenceCaseResult> {
    const persisted = applyDerivedArtifacts(clone(result), {
      processingJobId: result.processing_jobs.at(-1)?.id,
    });
    this.caseStore.set(persisted.case_id, persisted);
    this.debugStore.set(persisted.case_id, clone(debugReports));
    persisted.canonical_entities.forEach((entity) => {
      this.entityToCase.set(entity.id, persisted.case_id);
    });
    return clone(persisted);
  }

  async getCase(caseId: string): Promise<EntityIntelligenceCaseResult | null> {
    const current = this.caseStore.get(caseId);
    return current ? clone(current) : null;
  }

  async getEntityById(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    return current?.canonical_entities.find((entity) => entity.id === entityId) || null;
  }

  async getEntityProfile(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    return current?.entity_profiles[entityId] || null;
  }

  async getEntityMentions(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    const mentionIds = new Set(current?.canonical_entities.find((entity) => entity.id === entityId)?.mention_ids || []);
    return (current?.mentions || []).filter((mention) => mentionIds.has(mention.id));
  }

  async getEntityClaims(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    return (current?.claims || []).filter((claim) => claim.subject_entity_id === entityId);
  }

  async getEntityRelations(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    return (current?.relationships || []).filter(
      (relationship) => relationship.source_entity_id === entityId || relationship.target_entity_id === entityId,
    );
  }

  async getEntityTimeline(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    return current?.entity_timelines[entityId] || [];
  }

  async getEntityConflicts(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    return (current?.conflicts || []).filter((conflict) => conflict.entity_id === entityId);
  }

  async getEntitySummary(entityId: string) {
    return this.getEntityProfile(entityId);
  }

  async getCaseEntityGraph(caseId: string): Promise<CaseEntityGraphRecord | null> {
    const current = await this.getCase(caseId);
    if (!current) return null;
    return {
      case_id: caseId,
      entities: current.canonical_entities,
      relationships: current.relationships,
      events: current.events,
      event_participants: current.event_participants,
    };
  }

  async getAmbiguousMentions(caseId: string): Promise<AmbiguousMentionRecord[]> {
    const current = await this.getCase(caseId);
    if (!current) return [];
    return current.review_tasks
      .filter((task) => task.review_type === "ambiguous_mention" && task.status === "open" && task.mention_id)
      .map((task) => ({
        mention: current.mentions.find((mention) => mention.id === task.mention_id)!,
        candidates: current.candidate_matches.filter((candidate) => candidate.mention_id === task.mention_id),
        explanation: task.reason,
      }))
      .filter((item) => Boolean(item.mention));
  }

  async getEntityCandidateDecisions(entityId: string) {
    const current = await this.getCaseForEntity(entityId);
    const mentionIds = new Set(current?.canonical_entities.find((entity) => entity.id === entityId)?.mention_ids || []);
    return (current?.candidate_matches || []).filter((candidate) => mentionIds.has(candidate.mention_id));
  }

  async getEntityDebugReport(entityId: string) {
    const caseId = this.entityToCase.get(entityId);
    if (!caseId) return null;
    return clone(this.debugStore.get(caseId)?.[entityId] || null);
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

    return this.persistCase(current, this.debugStore.get(caseId));
  }

  async splitEntities(caseId: string, entityId: string, mentionIds: string[], actor = "system") {
    return this.splitEntity(caseId, entityId, mentionIds, actor);
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
    return this.persistCase(current, this.debugStore.get(caseId));
  }

  async regenerateEntitySummary(caseId: string, entityId: string) {
    const current = await this.getCase(caseId);
    if (!current || !current.entity_profiles[entityId]) return null;
    current.generated_at = new Date().toISOString();
    return this.persistCase(current, this.debugStore.get(caseId));
  }

  private async getCaseForEntity(entityId: string): Promise<EntityIntelligenceCaseResult | null> {
    const caseId = this.entityToCase.get(entityId);
    if (!caseId) return null;
    return this.getCase(caseId);
  }

  private buildReviewAction(
    caseId: string,
    action: ManualReviewAuditRecord["action"],
    actor: string,
    entityId?: string,
    mentionId?: string,
    note?: string,
  ) {
    return {
      id: `review_${stableHash(`${caseId}:${action}:${entityId || "none"}:${mentionId || "none"}:${note || ""}`)}`,
      case_id: caseId,
      action,
      actor,
      entity_id: entityId,
      mention_id: mentionId,
      note,
      created_at: new Date().toISOString(),
      status: "applied" as const,
      attributes_json: {},
    };
  }
}
