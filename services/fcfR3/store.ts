import { supabaseEnabled } from "../supabaseClient";
import type { FcfR3PersistedRun, FcfR3Repository } from "./contracts";
import { MemoryFcfR3Repository } from "./memoryRepository";
import { createPostgresFcfR3Repository } from "./postgresRepository";

const fallbackRepository = new MemoryFcfR3Repository();
const postgresRepository = createPostgresFcfR3Repository();
let activeRepository: FcfR3Repository = supabaseEnabled ? postgresRepository : fallbackRepository;
let fallbackWarningShown = false;

const withRepository = async <T,>(operation: (repository: FcfR3Repository) => Promise<T>): Promise<T> => {
  try {
    return await operation(activeRepository);
  } catch (error) {
    if (activeRepository !== fallbackRepository) {
      activeRepository = fallbackRepository;
      if (!fallbackWarningShown) {
        console.warn("FCF-R3 Postgres persistence failed; falling back to in-memory repository.", error);
        fallbackWarningShown = true;
      }
      return operation(activeRepository);
    }
    throw error;
  }
};

export const persistFcfR3Run = (run: FcfR3PersistedRun): Promise<FcfR3PersistedRun> =>
  withRepository((repository) => repository.persistRun(run));

export const getFcfR3Run = (runId: string): Promise<FcfR3PersistedRun | null> =>
  withRepository((repository) => repository.getRun(runId));

export const getLatestFcfR3Run = (caseId: string): Promise<FcfR3PersistedRun | null> =>
  withRepository((repository) => repository.getLatestRun(caseId));

export const __resetFcfR3StoreForTests = async (): Promise<void> => {
  activeRepository = fallbackRepository;
  fallbackWarningShown = false;
  await fallbackRepository.resetForTests();
};
