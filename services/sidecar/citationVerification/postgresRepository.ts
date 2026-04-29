import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "../../supabaseClient";
import type { CitationVerificationRun } from "./contracts";

type RunRow = {
  run_id: string;
  case_id: string;
  answer_id?: string | null;
  generated_at: string;
  run_json: CitationVerificationRun;
};

const ensure = async <T,>(promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>): Promise<T> => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || "Citation verification Postgres operation failed");
  return data as T;
};

export class PostgresCitationVerificationRepository {
  constructor(private readonly client: SupabaseClient = supabase) {}

  async persistRun(run: CitationVerificationRun): Promise<CitationVerificationRun> {
    await ensure<RunRow[]>(
      this.client.from("citation_verification_runs").upsert(
        [
          {
            run_id: run.run_id,
            case_id: run.case_id,
            answer_id: run.answer_id || null,
            generated_at: run.generated_at,
            run_json: run,
          },
        ],
        { onConflict: "run_id" },
      ).select("*"),
    );
    return run;
  }

  async getLatestRun(caseId: string): Promise<CitationVerificationRun | null> {
    const { data, error } = await this.client
      .from("citation_verification_runs")
      .select("*")
      .eq("case_id", caseId)
      .order("generated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message || "Citation verification Postgres operation failed");
    return ((data as RunRow[] | null)?.[0]?.run_json as CitationVerificationRun | undefined) || null;
  }
}

export const createPostgresCitationVerificationRepository = (): PostgresCitationVerificationRepository =>
  new PostgresCitationVerificationRepository();

