import type { ProcessingJobRecord } from "./types";
import { stableHash } from "./normalization";

export const createProcessingJob = (
  caseId: string,
  jobType: ProcessingJobRecord["job_type"],
): ProcessingJobRecord => ({
  id: `job_${stableHash(`${caseId}:${jobType}:${Date.now()}`)}`,
  case_id: caseId,
  job_type: jobType,
  status: "running",
  started_at: new Date().toISOString(),
  metrics_json: {},
  warnings: [],
});

export const finalizeProcessingJob = (
  job: ProcessingJobRecord,
  status: ProcessingJobRecord["status"],
  metrics: Record<string, number>,
  warnings: string[] = [],
): ProcessingJobRecord => {
  const finishedAt = new Date().toISOString();
  return {
    ...job,
    status,
    finished_at: finishedAt,
    duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(job.started_at)),
    metrics_json: metrics,
    warnings,
  };
};
