import type { CanonicalFtMEntity, KnowledgeAdapterResult, KnowledgeSourceSnapshot, WatchlistHit } from "./contracts";

type YenteMatchResult = {
  id?: string;
  schema?: string;
  caption?: string;
  collection?: string;
  score?: number;
  score_breakdown?: Record<string, number>;
  explanation?: string[];
  url?: string;
};

const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}.,;:!?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const buildSnapshot = (
  entity: CanonicalFtMEntity,
  status: KnowledgeSourceSnapshot["status"],
  recordCount: number,
  warnings: string[],
): KnowledgeSourceSnapshot => ({
  snapshot_id: `ks_yente_${stableHash(`${entity.ftm_id}:${status}:${recordCount}`)}`,
  namespace: "yente",
  cache_key: `${entity.schema}:${normalize(entity.caption)}`,
  status,
  retrieved_at: new Date().toISOString(),
  record_count: recordCount,
  warnings,
  source_url: process.env.TEVEL_YENTE_API_BASE,
});

const toWatchlistHit = (
  entity: CanonicalFtMEntity,
  sourceEntityId: string,
  match: YenteMatchResult,
): WatchlistHit => ({
  hit_id: `watch_${stableHash(`${entity.ftm_id}:${match.id || match.caption}`)}`,
  canonical_ftm_id: entity.ftm_id,
  entity_id: sourceEntityId,
  source_namespace: "yente",
  list_name: match.collection || "operator_watchlist",
  matched_name: match.caption || entity.caption,
  status: (match.score || 0) >= 0.85 ? "match" : "candidate",
  score: Math.max(0, Math.min(1, match.score || 0)),
  score_breakdown: match.score_breakdown || {
    alias_similarity: Number(((match.score || 0) * 0.5).toFixed(3)),
    registry_score: Number(((match.score || 0) * 0.3).toFixed(3)),
    context_score: Number(((match.score || 0) * 0.2).toFixed(3)),
  },
  explanation: match.explanation || ["Operator watchlist match returned by configured yente adapter."],
  source_url: match.url,
  retrieved_at: new Date().toISOString(),
  external_reference_id: match.id,
});

export const enrichFromYente = async (
  entity: CanonicalFtMEntity,
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeAdapterResult> => {
  const baseUrl = process.env.TEVEL_YENTE_API_BASE;
  if (!baseUrl) {
    const message = "No operator watchlist endpoint is configured; yente lookups are disabled by default.";
    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: [],
      warnings: [message],
      watchlist_hits: [],
      snapshot: buildSnapshot(entity, "skipped", 0, [message]),
    };
  }

  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: entity.caption,
        schema: entity.schema,
        aliases: entity.aliases,
      }),
    });

    if (!response.ok) {
      const message = `Watchlist lookup failed with status ${response.status}.`;
      return {
        assertions: [],
        links: [],
        descriptions: [],
        affiliations: [],
        source_labels: [],
        warnings: [message],
        watchlist_hits: [],
        snapshot: buildSnapshot(entity, "error", 0, [message]),
      };
    }

    const payload = (await response.json()) as { results?: YenteMatchResult[] } | YenteMatchResult[];
    const results = Array.isArray(payload) ? payload : payload.results || [];
    const hits = results
      .filter((item) => (item.score || 0) >= 0.62)
      .slice(0, 3)
      .map((item) => toWatchlistHit(entity, entity.source_entity_ids[0] || entity.ftm_id, item));

    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: hits.length ? ["Watchlist / Registry"] : [],
      warnings: hits.length ? [] : [`No watchlist hit cleared the acceptance threshold for ${entity.caption}.`],
      watchlist_hits: hits,
      snapshot: buildSnapshot(entity, "fresh", hits.length, hits.length ? [] : [`No watchlist hit cleared the acceptance threshold for ${entity.caption}.`]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown watchlist lookup error";
    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: [],
      warnings: [message],
      watchlist_hits: [],
      snapshot: buildSnapshot(entity, "error", 0, [message]),
    };
  }
};

