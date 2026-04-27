import type { CanonicalFtMEntity, KnowledgeSourceSnapshot, ReferenceKnowledgeProfile } from "./contracts";

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const maybeWriteGraphitiKnowledgeSink = async (
  caseId: string,
  canonicalEntities: CanonicalFtMEntity[],
  referenceProfiles: Record<string, ReferenceKnowledgeProfile>,
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeSourceSnapshot> => {
  const enabled = process.env.TEVEL_GRAPHITI_SINK_ENABLED === "true";
  const sinkUrl = process.env.TEVEL_GRAPHITI_SINK_URL;
  const warnings: string[] = [];

  if (!enabled || !sinkUrl) {
    warnings.push("Graphiti sink is disabled; canonical knowledge stayed inside Tevel-owned stores.");
    return {
      snapshot_id: `ks_graphiti_${stableHash(`${caseId}:disabled`)}`,
      namespace: "graphiti",
      cache_key: caseId,
      status: "skipped",
      retrieved_at: new Date().toISOString(),
      record_count: 0,
      warnings,
      source_url: sinkUrl,
    };
  }

  try {
    const payload = {
      case_id: caseId,
      entities: canonicalEntities,
      reference_profiles: Object.values(referenceProfiles),
    };
    const response = await fetchImpl(sinkUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      warnings.push(`Graphiti sink request failed with status ${response.status}.`);
      return {
        snapshot_id: `ks_graphiti_${stableHash(`${caseId}:error`)}`,
        namespace: "graphiti",
        cache_key: caseId,
        status: "error",
        retrieved_at: new Date().toISOString(),
        record_count: 0,
        warnings,
        source_url: sinkUrl,
      };
    }

    return {
      snapshot_id: `ks_graphiti_${stableHash(`${caseId}:fresh`)}`,
      namespace: "graphiti",
      cache_key: caseId,
      status: "fresh",
      retrieved_at: new Date().toISOString(),
      record_count: canonicalEntities.length,
      warnings,
      source_url: sinkUrl,
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Unknown Graphiti sink error");
    return {
      snapshot_id: `ks_graphiti_${stableHash(`${caseId}:exception`)}`,
      namespace: "graphiti",
      cache_key: caseId,
      status: "error",
      retrieved_at: new Date().toISOString(),
      record_count: 0,
      warnings,
      source_url: sinkUrl,
    };
  }
};

