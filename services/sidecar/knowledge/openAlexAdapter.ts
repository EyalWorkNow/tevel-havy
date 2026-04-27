import type {
  CanonicalFtMEntity,
  ExternalReferenceLink,
  KnowledgeAdapterResult,
  KnowledgeSourceSnapshot,
  ReferenceAssertion,
} from "./contracts";

type OpenAlexResult = {
  id?: string;
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
  country_code?: string;
  last_known_institution?: {
    display_name?: string;
    country_code?: string;
  };
  affiliations?: Array<{
    institution?: {
      display_name?: string;
      country_code?: string;
    };
  }>;
  type?: string;
};

const OPEN_ALEX_API_BASE = "https://api.openalex.org";

const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}.,;:!?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const unique = (values: string[]): string[] => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const tokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(normalize(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalize(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const isResearchLikely = (entity: CanonicalFtMEntity): boolean => {
  const joined = normalize([
    entity.caption,
    ...(entity.aliases || []),
    ...(entity.properties.description || []),
  ].join(" "));
  return /\b(university|institute|lab|laboratory|research|professor|dr|phd|journal|academy|faculty|college)\b/.test(joined);
};

const buildSnapshot = (
  entity: CanonicalFtMEntity,
  status: KnowledgeSourceSnapshot["status"],
  recordCount: number,
  warnings: string[],
): KnowledgeSourceSnapshot => ({
  snapshot_id: `ks_openalex_${stableHash(`${entity.ftm_id}:${status}:${recordCount}`)}`,
  namespace: "openalex",
  cache_key: `${entity.schema}:${normalize(entity.caption)}`,
  status,
  retrieved_at: new Date().toISOString(),
  record_count: recordCount,
  warnings,
  source_url: "https://api.openalex.org",
});

const buildLink = (
  entity: CanonicalFtMEntity,
  candidate: OpenAlexResult,
  confidence: number,
  rationale: string[],
): ExternalReferenceLink => ({
  link_id: `ref_openalex_${stableHash(`${entity.ftm_id}:${candidate.id}`)}`,
  namespace: "openalex",
  external_id: candidate.id || "",
  canonical_ftm_id: entity.ftm_id,
  canonical_ftm_schema: entity.schema,
  label: candidate.display_name || entity.caption,
  description: candidate.last_known_institution?.display_name || candidate.type,
  aliases: unique([candidate.display_name || "", entity.caption]),
  source_url: candidate.id || undefined,
  match_confidence: confidence,
  match_rationale: rationale,
  retrieved_at: new Date().toISOString(),
  derived_from_case: false,
  metadata: {
    works_count: candidate.works_count || 0,
    cited_by_count: candidate.cited_by_count || 0,
    country_code: candidate.country_code || candidate.last_known_institution?.country_code || "",
  },
});

const buildAssertions = (
  entity: CanonicalFtMEntity,
  link: ExternalReferenceLink,
  candidate: OpenAlexResult,
): ReferenceAssertion[] => {
  const assertions: ReferenceAssertion[] = [];
  if (candidate.last_known_institution?.display_name) {
    assertions.push({
      assertion_id: `assert_openalex_affiliation_${stableHash(`${entity.ftm_id}:${candidate.last_known_institution.display_name}`)}`,
      subject_ftm_id: entity.ftm_id,
      subject_entity_id: entity.source_entity_ids[0] || entity.ftm_id,
      source_namespace: "openalex",
      predicate: "affiliation",
      value: candidate.last_known_institution.display_name,
      normalized_value: normalize(candidate.last_known_institution.display_name),
      confidence: Math.max(0.64, link.match_confidence - 0.06),
      source_label: "OpenAlex",
      source_url: link.source_url,
      retrieved_at: link.retrieved_at,
      derived_from_case: false,
      external_reference_ids: [link.link_id],
    });
  }
  if (typeof candidate.works_count === "number") {
    assertions.push({
      assertion_id: `assert_openalex_works_${stableHash(`${entity.ftm_id}:${candidate.works_count}`)}`,
      subject_ftm_id: entity.ftm_id,
      subject_entity_id: entity.source_entity_ids[0] || entity.ftm_id,
      source_namespace: "openalex",
      predicate: "works_count",
      value: String(candidate.works_count),
      normalized_value: String(candidate.works_count),
      confidence: Math.max(0.58, link.match_confidence - 0.1),
      source_label: "OpenAlex",
      source_url: link.source_url,
      retrieved_at: link.retrieved_at,
      derived_from_case: false,
      external_reference_ids: [link.link_id],
    });
  }
  return assertions;
};

export const enrichFromOpenAlex = async (
  entity: CanonicalFtMEntity,
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeAdapterResult> => {
  const warnings: string[] = [];
  if (!["Person", "Organization"].includes(entity.schema)) {
    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: [],
      warnings: [],
      snapshot: buildSnapshot(entity, "skipped", 0, []),
    };
  }

  if (!isResearchLikely(entity)) {
    const message = `OpenAlex enrichment skipped for ${entity.caption} because research-domain cues were weak.`;
    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: [],
      warnings: [message],
      snapshot: buildSnapshot(entity, "skipped", 0, [message]),
    };
  }

  try {
    const resource = entity.schema === "Person" ? "authors" : "institutions";
    const url = new URL(`${OPEN_ALEX_API_BASE}/${resource}`);
    url.searchParams.set("search", entity.caption);
    url.searchParams.set("per-page", "3");

    const response = await fetchImpl(url);
    if (!response.ok) {
      const message = `OpenAlex lookup failed with status ${response.status}.`;
      return {
        assertions: [],
        links: [],
        descriptions: [],
        affiliations: [],
        source_labels: [],
        warnings: [message],
        snapshot: buildSnapshot(entity, "error", 0, [message]),
      };
    }

    const payload = (await response.json()) as { results?: OpenAlexResult[] };
    const ranked = (payload.results || [])
      .map((candidate) => {
        const aliasScore = Math.max(
          tokenOverlap(entity.caption, candidate.display_name || ""),
          ...entity.aliases.map((alias) => tokenOverlap(alias, candidate.display_name || "")),
          0,
        );
        const institutionBoost =
          candidate.last_known_institution?.display_name &&
          entity.properties.description?.some((value) => normalize(value).includes(normalize(candidate.last_known_institution?.display_name || "")))
            ? 0.08
            : 0;
        const worksBoost = Math.min(0.08, (candidate.works_count || 0) / 10000);
        const confidence = Math.max(0, Math.min(1, aliasScore * 0.8 + institutionBoost + worksBoost));
        return {
          candidate,
          confidence,
          rationale: [
            `Alias similarity ${(aliasScore * 100).toFixed(0)}%.`,
            candidate.last_known_institution?.display_name
              ? `Affiliation returned: ${candidate.last_known_institution.display_name}.`
              : "No affiliation returned.",
          ],
        };
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 1);

    if (!ranked.length || ranked[0].confidence < 0.74 || !ranked[0].candidate.id) {
      const message = `No high-confidence OpenAlex candidate was accepted for ${entity.caption}.`;
      return {
        assertions: [],
        links: [],
        descriptions: [],
        affiliations: [],
        source_labels: [],
        warnings: [message],
        snapshot: buildSnapshot(entity, "skipped", 0, [message]),
      };
    }

    const best = ranked[0];
    const link = buildLink(entity, best.candidate, best.confidence, best.rationale);
    const affiliations = unique([
      best.candidate.last_known_institution?.display_name || "",
      ...(best.candidate.affiliations || []).map((item) => item.institution?.display_name || ""),
    ]).slice(0, 6);

    return {
      assertions: buildAssertions(entity, link, best.candidate),
      links: [link],
      descriptions: best.candidate.last_known_institution?.display_name ? [`Research affiliation: ${best.candidate.last_known_institution.display_name}`] : [],
      affiliations,
      source_labels: ["OpenAlex"],
      warnings,
      snapshot: buildSnapshot(entity, "fresh", 1, warnings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenAlex error";
    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: [],
      warnings: [message],
      snapshot: buildSnapshot(entity, "error", 0, [message]),
    };
  }
};

