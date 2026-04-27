import type { KnowledgeEnrichmentResult, ReferenceKnowledgeProfile } from "./contracts";

import { supabaseEnabled } from "../../supabaseClient";

const caseStore = new Map<string, KnowledgeEnrichmentResult>();
const entityStore = new Map<string, ReferenceKnowledgeProfile>();

const getSupabaseConfig = () => {
  const baseUrl = process.env.VITE_SUPABASE_URL || process.env.TEVEL_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.TEVEL_SUPABASE_ANON_KEY;
  const enabled = Boolean(supabaseEnabled && baseUrl && anonKey && process.env.TEVEL_REFERENCE_STORE_MODE !== "memory");
  return { enabled, baseUrl, anonKey };
};

const persistToSupabase = async (result: KnowledgeEnrichmentResult, fetchImpl: typeof fetch = fetch): Promise<void> => {
  const { enabled, baseUrl, anonKey } = getSupabaseConfig();
  const caseTable = process.env.TEVEL_REFERENCE_CASE_TABLE;
  if (!enabled || !baseUrl || !anonKey || !caseTable) {
    return;
  }

  await fetchImpl(`${baseUrl.replace(/\/$/, "")}/rest/v1/${caseTable}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      case_id: result.case_id,
      generated_at: result.generated_at,
      payload: result,
    }),
  }).catch(() => undefined);
};

export const persistKnowledgeEnrichment = async (
  result: KnowledgeEnrichmentResult,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  caseStore.set(result.case_id, result);
  Object.entries(result.reference_knowledge || {}).forEach(([entityId, profile]) => {
    entityStore.set(entityId, profile);
  });
  await persistToSupabase(result, fetchImpl);
};

export const getCaseKnowledge = (caseId: string): KnowledgeEnrichmentResult | null => caseStore.get(caseId) ?? null;

export const getEntityReference = (entityId: string): ReferenceKnowledgeProfile | null => entityStore.get(entityId) ?? null;

export const getCachedReferenceProfile = (entityId: string): ReferenceKnowledgeProfile | null =>
  entityStore.get(entityId) ?? null;
