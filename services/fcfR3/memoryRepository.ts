import type { FcfR3PersistedRun, FcfR3Repository } from "./contracts";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export class MemoryFcfR3Repository implements FcfR3Repository {
  private runsById = new Map<string, FcfR3PersistedRun>();
  private runIdsByCase = new Map<string, string[]>();

  async persistRun(run: FcfR3PersistedRun): Promise<FcfR3PersistedRun> {
    const next = clone(run);
    this.runsById.set(next.run.run_id, next);

    const currentIds = this.runIdsByCase.get(next.run.case_id) || [];
    const withoutCurrent = currentIds.filter((runId) => runId !== next.run.run_id);
    this.runIdsByCase.set(next.run.case_id, [...withoutCurrent, next.run.run_id].slice(-40));

    return clone(next);
  }

  async getRun(runId: string): Promise<FcfR3PersistedRun | null> {
    const run = this.runsById.get(runId);
    return run ? clone(run) : null;
  }

  async getLatestRun(caseId: string): Promise<FcfR3PersistedRun | null> {
    const runIds = this.runIdsByCase.get(caseId) || [];
    const runs = runIds
      .map((runId) => this.runsById.get(runId))
      .filter((run): run is FcfR3PersistedRun => Boolean(run))
      .sort((left, right) => Date.parse(left.run.generated_at) - Date.parse(right.run.generated_at));
    return runs.length ? clone(runs[runs.length - 1]) : null;
  }

  async resetForTests(): Promise<void> {
    this.runsById.clear();
    this.runIdsByCase.clear();
  }
}
