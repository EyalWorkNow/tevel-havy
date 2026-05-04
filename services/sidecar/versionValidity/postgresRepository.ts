import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../supabaseClient";
import type { VersionValidityReport } from "./contracts";

type SnapshotRow = {
  case_id: string;
  document_identity: string;
  generated_at: string;
  current_version_id: string;
  report_json: VersionValidityReport;
};

const ensure = async <T,>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>): Promise<T> => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || "Version validity Postgres operation failed");
  return data as T;
};

const optional = async <T,>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>): Promise<T | null> => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || "Version validity Postgres operation failed");
  return (data as T | null) || null;
};

export class PostgresVersionValidityRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  async persistReport(report: VersionValidityReport): Promise<VersionValidityReport> {
    await ensure<SnapshotRow[]>(
      this.client.from("version_validity_snapshots").upsert(
        [
          {
            case_id: report.case_id,
            document_identity: report.document_identity,
            generated_at: report.generated_at,
            current_version_id: report.current_version_id,
            report_json: report,
          },
        ],
        { onConflict: "case_id" },
      ).select("*"),
    );
    return report;
  }

  async getCaseReport(caseId: string): Promise<VersionValidityReport | null> {
    const row = await optional<SnapshotRow>(
      this.client.from("version_validity_snapshots").select("*").eq("case_id", caseId).maybeSingle(),
    );
    return row?.report_json || null;
  }
}

export const createPostgresVersionValidityRepository = (): PostgresVersionValidityRepository =>
  new PostgresVersionValidityRepository();

