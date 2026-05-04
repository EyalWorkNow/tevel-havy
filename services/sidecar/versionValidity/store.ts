import { supabaseEnabled } from "../../supabaseClient";
import type { VersionValidityReport } from "./contracts";
import { MemoryVersionValidityRepository } from "./memoryRepository";
import { createPostgresVersionValidityRepository } from "./postgresRepository";

type VersionValidityRepository = {
  persistReport(report: VersionValidityReport): Promise<VersionValidityReport>;
  getCaseReport(caseId: string): Promise<VersionValidityReport | null>;
};

const fallbackRepository = new MemoryVersionValidityRepository();
const postgresRepository = createPostgresVersionValidityRepository();
let activeRepository: VersionValidityRepository = supabaseEnabled ? postgresRepository : fallbackRepository;
let fallbackWarningShown = false;

const withRepository = async <T,>(operation: (repository: VersionValidityRepository) => Promise<T>): Promise<T> => {
  try {
    return await operation(activeRepository);
  } catch (error) {
    if (activeRepository !== fallbackRepository) {
      activeRepository = fallbackRepository;
      if (!fallbackWarningShown) {
        console.warn("Version validity Postgres persistence failed; falling back to in-memory repository.", error);
        fallbackWarningShown = true;
      }
      return operation(activeRepository);
    }
    throw error;
  }
};

export const persistVersionValidityReport = (report: VersionValidityReport): Promise<VersionValidityReport> =>
  withRepository((repository) => repository.persistReport(report));

export const getVersionValidityReport = (caseId: string): Promise<VersionValidityReport | null> =>
  withRepository((repository) => repository.getCaseReport(caseId));

export const __resetVersionValidityStoreForTests = async (): Promise<void> => {
  activeRepository = fallbackRepository;
  fallbackWarningShown = false;
  await fallbackRepository.resetForTests();
};

