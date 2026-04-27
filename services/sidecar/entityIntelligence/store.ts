import { MemoryEntityIntelligenceRepository } from "./memoryRepository";
import { createPostgresEntityIntelligenceRepository } from "./postgresRepository";
import { supabaseEnabled } from "../../supabaseClient";
import type {
  EntityIntelligenceCaseResult,
  EntityIntelligenceDebugReport,
} from "./types";
import type { EntityIntelligenceRepository } from "./repository";

const OFFLINE_MODE_KEY = "tevel.entityIntelligence.offline.v1";

const readOfflinePreference = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(OFFLINE_MODE_KEY) === "1";
  } catch {
    return false;
  }
};

const persistOfflinePreference = (isOffline: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    if (isOffline) {
      window.localStorage.setItem(OFFLINE_MODE_KEY, "1");
    } else {
      window.localStorage.removeItem(OFFLINE_MODE_KEY);
    }
  } catch {
    // Ignore localStorage failures and keep runtime fallback behavior.
  }
};

const postgresRepository = createPostgresEntityIntelligenceRepository();
const fallbackRepository = new MemoryEntityIntelligenceRepository();
let activeRepository: EntityIntelligenceRepository = readOfflinePreference() ? fallbackRepository : postgresRepository;
let fallbackWarningShown = false;

if (!supabaseEnabled) {
  activeRepository = fallbackRepository;
  persistOfflinePreference(true);
}

const withRepository = async <T,>(operation: (repository: EntityIntelligenceRepository) => Promise<T>): Promise<T> => {
  try {
    return await operation(activeRepository);
  } catch (error) {
    if (activeRepository !== fallbackRepository) {
      activeRepository = fallbackRepository;
      persistOfflinePreference(true);
      if (!fallbackWarningShown) {
        console.warn("Entity intelligence Postgres persistence failed; falling back to in-memory repository.", error);
        fallbackWarningShown = true;
      }
      return operation(activeRepository);
    }
    throw error;
  }
};

export const setEntityIntelligenceRepository = (repository: EntityIntelligenceRepository): void => {
  activeRepository = repository;
  fallbackWarningShown = false;
  persistOfflinePreference(repository === fallbackRepository);
};

export const getEntityIntelligenceRepository = (): EntityIntelligenceRepository => activeRepository;

export const __resetEntityIntelligenceStoreForTests = async (): Promise<void> => {
  const memoryRepository = new MemoryEntityIntelligenceRepository();
  activeRepository = memoryRepository;
  fallbackWarningShown = false;
  persistOfflinePreference(false);
  await memoryRepository.resetForTests();
};

export const persistEntityIntelligenceCase = (
  result: EntityIntelligenceCaseResult,
  debugReports: Record<string, EntityIntelligenceDebugReport> = {},
): Promise<EntityIntelligenceCaseResult> => withRepository((repository) => repository.persistCase(result, debugReports));

export const getEntityIntelligenceCase = (caseId: string) => withRepository((repository) => repository.getCase(caseId));

export const getEntityById = (entityId: string) => withRepository((repository) => repository.getEntityById(entityId));

export const getEntityProfile = (entityId: string) => withRepository((repository) => repository.getEntityProfile(entityId));

export const getEntityMentions = (entityId: string) => withRepository((repository) => repository.getEntityMentions(entityId));

export const getEntityClaims = (entityId: string) => withRepository((repository) => repository.getEntityClaims(entityId));

export const getEntityRelations = (entityId: string) => withRepository((repository) => repository.getEntityRelations(entityId));

export const getEntityTimeline = (entityId: string) => withRepository((repository) => repository.getEntityTimeline(entityId));

export const getEntityConflicts = (entityId: string) => withRepository((repository) => repository.getEntityConflicts(entityId));

export const getEntitySummary = (entityId: string) => withRepository((repository) => repository.getEntitySummary(entityId));

export const getCaseEntityGraph = (caseId: string) => withRepository((repository) => repository.getCaseEntityGraph(caseId));

export const getAmbiguousMentions = (caseId: string) => withRepository((repository) => repository.getAmbiguousMentions(caseId));

export const getEntityCandidateDecisions = (entityId: string) => withRepository((repository) => repository.getEntityCandidateDecisions(entityId));

export const getEntityDebugReport = (entityId: string) => withRepository((repository) => repository.getEntityDebugReport(entityId));

export const mergeEntityRecords = (
  caseId: string,
  targetEntityId: string,
  sourceEntityId: string,
  actor = "system",
) => withRepository((repository) => repository.mergeEntities(caseId, targetEntityId, sourceEntityId, actor));

export const splitEntityRecord = (
  caseId: string,
  entityId: string,
  mentionIds: string[],
  actor = "system",
) => withRepository((repository) => repository.splitEntity(caseId, entityId, mentionIds, actor));

export const regenerateEntitySummaryRecord = (caseId: string, entityId: string) =>
  withRepository((repository) => repository.regenerateEntitySummary(caseId, entityId));
