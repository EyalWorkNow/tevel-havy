import type {
  CanonicalFtMEntity,
  ExternalReferenceLink,
  KnowledgeAdapterResult,
  KnowledgeSourceSnapshot,
  ReferenceAssertion,
} from "./contracts";

const WIKIDATA_SEARCH_URL = "https://www.wikidata.org/w/api.php";
const WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki/Special:EntityData";

type WikidataSearchItem = {
  id: string;
  label?: string;
  description?: string;
  aliases?: string[];
};

type WikidataEntityResponse = {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value: string }>;
      descriptions?: Record<string, { value: string }>;
      aliases?: Record<string, Array<{ value: string }>>;
    }
  >;
};

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

const schemaHintBoost = (schema: CanonicalFtMEntity["schema"], description?: string): number => {
  const normalized = normalize(description || "");
  if (!normalized) return 0;
  if (schema === "Person" && /\b(person|politician|journalist|officer|businessperson|researcher)\b/.test(normalized)) return 0.08;
  if (schema === "Organization" && /\b(company|organization|agency|ministry|bank|institution)\b/.test(normalized)) return 0.08;
  if (schema === "Location" && /\b(city|town|district|country|village|airport|port|place)\b/.test(normalized)) return 0.08;
  return 0;
};

const buildSnapshot = (
  entity: CanonicalFtMEntity,
  status: KnowledgeSourceSnapshot["status"],
  recordCount: number,
  warnings: string[],
): KnowledgeSourceSnapshot => ({
  snapshot_id: `ks_wikidata_${stableHash(`${entity.ftm_id}:${status}:${recordCount}`)}`,
  namespace: "wikidata",
  cache_key: `${entity.schema}:${normalize(entity.caption)}`,
  status,
  retrieved_at: new Date().toISOString(),
  record_count: recordCount,
  warnings,
  source_url: "https://www.wikidata.org/",
});

const buildLink = (
  entity: CanonicalFtMEntity,
  candidate: WikidataSearchItem,
  aliases: string[],
  confidence: number,
  rationale: string[],
): ExternalReferenceLink => ({
  link_id: `ref_wikidata_${candidate.id}_${stableHash(entity.ftm_id)}`,
  namespace: "wikidata",
  external_id: candidate.id,
  canonical_ftm_id: entity.ftm_id,
  canonical_ftm_schema: entity.schema,
  label: candidate.label || entity.caption,
  description: candidate.description,
  aliases,
  source_url: `${WIKIDATA_ENTITY_URL}/${candidate.id}.json`,
  match_confidence: confidence,
  match_rationale: rationale,
  retrieved_at: new Date().toISOString(),
  derived_from_case: false,
});

const buildAssertions = (
  entity: CanonicalFtMEntity,
  link: ExternalReferenceLink,
  descriptions: string[],
): ReferenceAssertion[] =>
  descriptions.slice(0, 3).map((description, index) => ({
    assertion_id: `assert_wikidata_${link.external_id}_${index}_${stableHash(description)}`,
    subject_ftm_id: entity.ftm_id,
    subject_entity_id: entity.source_entity_ids[0] || entity.ftm_id,
    source_namespace: "wikidata",
    predicate: "description",
    value: description,
    normalized_value: normalize(description),
    confidence: Math.max(0.62, link.match_confidence - 0.08),
    source_label: "Wikidata",
    source_url: link.source_url,
    retrieved_at: link.retrieved_at,
    derived_from_case: false,
    external_reference_ids: [link.link_id],
  }));

const fetchEntityDetails = async (
  entityId: string,
  fetchImpl: typeof fetch,
): Promise<{ aliases: string[]; descriptions: string[] }> => {
  const response = await fetchImpl(`${WIKIDATA_ENTITY_URL}/${encodeURIComponent(entityId)}.json`);
  if (!response.ok) {
    return { aliases: [], descriptions: [] };
  }

  const payload = (await response.json()) as WikidataEntityResponse;
  const record = payload.entities?.[entityId];
  if (!record) {
    return { aliases: [], descriptions: [] };
  }

  const descriptions = unique(Object.values(record.descriptions || {}).map((item) => item.value)).slice(0, 6);
  const aliases = unique(
    Object.values(record.aliases || {})
      .flatMap((items) => items.map((item) => item.value)),
  ).slice(0, 16);

  return { aliases, descriptions };
};

export const enrichFromWikidata = async (
  entity: CanonicalFtMEntity,
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeAdapterResult> => {
  const warnings: string[] = [];
  const query = entity.caption.trim();
  if (!query) {
    return {
      assertions: [],
      links: [],
      descriptions: [],
      affiliations: [],
      source_labels: [],
      warnings: ["Wikidata enrichment skipped because the entity caption was empty."],
      snapshot: buildSnapshot(entity, "skipped", 0, ["Wikidata enrichment skipped because the entity caption was empty."]),
    };
  }

  try {
    const url = new URL(WIKIDATA_SEARCH_URL);
    url.searchParams.set("action", "wbsearchentities");
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en");
    url.searchParams.set("uselang", "en");
    url.searchParams.set("type", "item");
    url.searchParams.set("limit", "5");
    url.searchParams.set("search", query);

    const response = await fetchImpl(url);
    if (!response.ok) {
      const message = `Wikidata lookup failed with status ${response.status}.`;
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

    const payload = (await response.json()) as { search?: WikidataSearchItem[] };
    const ranked = (payload.search || [])
      .map((candidate) => {
        const aliasScore = Math.max(
          tokenOverlap(query, candidate.label || ""),
          ...entity.aliases.map((alias) => Math.max(tokenOverlap(alias, candidate.label || ""), ...(candidate.aliases || []).map((item) => tokenOverlap(alias, item)))),
          0,
        );
        const confidence = Math.max(
          0,
          Math.min(1, aliasScore * 0.82 + schemaHintBoost(entity.schema, candidate.description) + 0.08),
        );
        return {
          candidate,
          confidence,
          rationale: [
            `Alias similarity ${(aliasScore * 100).toFixed(0)}%.`,
            candidate.description ? `Description hint: ${candidate.description}.` : "No description hint returned.",
          ],
        };
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 2);

    if (!ranked.length || ranked[0].confidence < 0.56) {
      const message = `No Wikidata candidate met the confidence threshold for ${entity.caption}.`;
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

    if (ranked.length > 1 && Math.abs(ranked[0].confidence - ranked[1].confidence) < 0.06) {
      warnings.push(`Multiple Wikidata candidates remain close for ${entity.caption}; preserving alternative links.`);
    }

    const links: ExternalReferenceLink[] = [];
    const assertions: ReferenceAssertion[] = [];
    const descriptions: string[] = [];

    for (const { candidate, confidence, rationale } of ranked) {
      const details = await fetchEntityDetails(candidate.id, fetchImpl);
      const candidateAliases = unique([...(candidate.aliases || []), ...details.aliases]).slice(0, 16);
      const candidateDescriptions = unique([candidate.description || "", ...details.descriptions]).slice(0, 4);
      const link = buildLink(entity, candidate, candidateAliases, confidence, rationale);
      links.push(link);
      if (confidence >= 0.72) {
        descriptions.push(...candidateDescriptions);
        assertions.push(...buildAssertions(entity, link, candidateDescriptions));
      }
    }

    return {
      assertions,
      links,
      descriptions: unique(descriptions).slice(0, 6),
      affiliations: [],
      source_labels: links.length ? ["Wikidata"] : [],
      warnings,
      snapshot: buildSnapshot(entity, warnings.length ? "cached" : "fresh", links.length, warnings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Wikidata error";
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

