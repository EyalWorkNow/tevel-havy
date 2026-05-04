import type { VersionValidityReport } from "./contracts";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export class MemoryVersionValidityRepository {
  private reports = new Map<string, VersionValidityReport>();

  async persistReport(report: VersionValidityReport): Promise<VersionValidityReport> {
    this.reports.set(report.case_id, clone(report));
    return report;
  }

  async getCaseReport(caseId: string): Promise<VersionValidityReport | null> {
    const report = this.reports.get(caseId);
    return report ? clone(report) : null;
  }

  async resetForTests(): Promise<void> {
    this.reports.clear();
  }
}

