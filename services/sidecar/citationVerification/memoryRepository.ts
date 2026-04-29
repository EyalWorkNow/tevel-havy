import type { CitationVerificationRun } from "./contracts";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export class MemoryCitationVerificationRepository {
  private runsByCase = new Map<string, CitationVerificationRun[]>();

  async persistRun(run: CitationVerificationRun): Promise<CitationVerificationRun> {
    const runs = this.runsByCase.get(run.case_id) || [];
    runs.push(clone(run));
    this.runsByCase.set(run.case_id, runs.slice(-20));
    return run;
  }

  async getLatestRun(caseId: string): Promise<CitationVerificationRun | null> {
    const runs = this.runsByCase.get(caseId) || [];
    return runs.length ? clone(runs[runs.length - 1]) : null;
  }

  async resetForTests(): Promise<void> {
    this.runsByCase.clear();
  }
}

