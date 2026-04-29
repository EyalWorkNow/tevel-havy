import { supabaseEnabled } from "../../supabaseClient";
import type { CitationVerificationRun } from "./contracts";
import { MemoryCitationVerificationRepository } from "./memoryRepository";
import { createPostgresCitationVerificationRepository } from "./postgresRepository";

type CitationVerificationRepository = {
  persistRun(run: CitationVerificationRun): Promise<CitationVerificationRun>;
  getLatestRun(caseId: string): Promise<CitationVerificationRun | null>;
};

const fallbackRepository = new MemoryCitationVerificationRepository();
const postgresRepository = createPostgresCitationVerificationRepository();
let activeRepository: CitationVerificationRepository = supabaseEnabled ? postgresRepository : fallbackRepository;
let fallbackWarningShown = false;

const withRepository = async <T,>(operation: (repository: CitationVerificationRepository) => Promise<T>): Promise<T> => {
  try {
    return await operation(activeRepository);
  } catch (error) {
    if (activeRepository !== fallbackRepository) {
      activeRepository = fallbackRepository;
      if (!fallbackWarningShown) {
        console.warn("Citation verification Postgres persistence failed; falling back to in-memory repository.", error);
        fallbackWarningShown = true;
      }
      return operation(activeRepository);
    }
    throw error;
  }
};

export const persistCitationVerificationRun = (run: CitationVerificationRun): Promise<CitationVerificationRun> =>
  withRepository((repository) => repository.persistRun(run));

export const getLatestCitationVerificationRun = (caseId: string): Promise<CitationVerificationRun | null> =>
  withRepository((repository) => repository.getLatestRun(caseId));

export const __resetCitationVerificationStoreForTests = async (): Promise<void> => {
  activeRepository = fallbackRepository;
  fallbackWarningShown = false;
  await fallbackRepository.resetForTests();
};

