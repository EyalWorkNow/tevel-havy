import type {
  CandidateMatchRecord,
  CanonicalEntityRecord,
  ClaimRecord,
  ConflictRecord,
  EntityIntelligenceCaseResult,
  EntityIntelligenceDebugReport,
  EntityMentionRecord,
  EntityProfileRecord,
  EntityTimelineItem,
  RelationshipRecord,
} from "./types";

export interface AmbiguousMentionRecord {
  mention: EntityMentionRecord;
  candidates: CandidateMatchRecord[];
  explanation?: string;
}

export interface CaseEntityGraphRecord {
  case_id: string;
  entities: CanonicalEntityRecord[];
  relationships: RelationshipRecord[];
  events: EntityIntelligenceCaseResult["events"];
  event_participants: EntityIntelligenceCaseResult["event_participants"];
}

export interface EntityIntelligenceRepository {
  persistCase(
    result: EntityIntelligenceCaseResult,
    debugReports?: Record<string, EntityIntelligenceDebugReport>,
  ): Promise<EntityIntelligenceCaseResult>;
  getCase(caseId: string): Promise<EntityIntelligenceCaseResult | null>;
  getEntityById(entityId: string): Promise<CanonicalEntityRecord | null>;
  getEntityProfile(entityId: string): Promise<EntityProfileRecord | null>;
  getEntityMentions(entityId: string): Promise<EntityMentionRecord[]>;
  getEntityClaims(entityId: string): Promise<ClaimRecord[]>;
  getEntityRelations(entityId: string): Promise<RelationshipRecord[]>;
  getEntityTimeline(entityId: string): Promise<EntityTimelineItem[]>;
  getEntityConflicts(entityId: string): Promise<ConflictRecord[]>;
  getEntitySummary(entityId: string): Promise<EntityProfileRecord | null>;
  getCaseEntityGraph(caseId: string): Promise<CaseEntityGraphRecord | null>;
  getAmbiguousMentions(caseId: string): Promise<AmbiguousMentionRecord[]>;
  getEntityCandidateDecisions(entityId: string): Promise<CandidateMatchRecord[]>;
  getEntityDebugReport(entityId: string): Promise<EntityIntelligenceDebugReport | null>;
  mergeEntities(caseId: string, targetEntityId: string, sourceEntityId: string, actor?: string): Promise<EntityIntelligenceCaseResult | null>;
  splitEntity(caseId: string, entityId: string, mentionIds: string[], actor?: string): Promise<EntityIntelligenceCaseResult | null>;
  regenerateEntitySummary(caseId: string, entityId: string): Promise<EntityIntelligenceCaseResult | null>;
  resetForTests?(): Promise<void> | void;
}
