import { normalizeAddressLikeMention } from "./libpostalAdapter";
import { resolveAmbiguousToponym } from "./mordecaiAdapter";
import { isPeliasConfigured, queryPelias, structuredPeliasQuery } from "./peliasAdapter";
import { enrichFromWikidata } from "../knowledge/wikidataAdapter";
import {
  LocationCandidateSet,
  LocationMentionInput,
  LocationMentionType,
  LocationResolutionResponse,
  LocationResolutionMethod,
  PeliasCandidate,
  ResolvedLocationRecord,
} from "./types";
import type { CanonicalFtMEntity } from "../knowledge/contracts";

const normalizeText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stableHash = (value: string): string => {
  let hashValue = 2166136261;
  for (const char of value) {
    hashValue ^= char.charCodeAt(0);
    hashValue = (hashValue * 16777619) >>> 0;
  }
  return hashValue.toString(16).padStart(8, "0");
};

const tokenOverlap = (left: string, right: string): number => {
  const a = new Set(normalizeText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) overlap += 1;
  });
  return overlap / Math.max(a.size, b.size);
};

const KNOWN_LOCATION_HINTS: Record<string, { lat: number; lon: number; country?: string; region?: string; locality?: string }> = {
  "ashdod port": { lat: 31.8184, lon: 34.65, country: "Israel", region: "Southern District", locality: "Ashdod" },
  "נמל אשדוד": { lat: 31.8184, lon: 34.65, country: "Israel", region: "Southern District", locality: "Ashdod" },
  "tel aviv": { lat: 32.0853, lon: 34.7818, country: "Israel", region: "Tel Aviv District", locality: "Tel Aviv" },
  "haifa": { lat: 32.794, lon: 34.9896, country: "Israel", region: "Haifa District", locality: "Haifa" },
  "amman": { lat: 31.9539, lon: 35.9106, country: "Jordan", region: "Amman Governorate", locality: "Amman" },
  "beirut": { lat: 33.8938, lon: 35.5018, country: "Lebanon", region: "Beirut Governorate", locality: "Beirut" },
};

const detectMentionType = (mention: LocationMentionInput): LocationMentionType => {
  const raw = mention.raw_text.trim();
  const normalized = normalizeText(raw);
  const sentence = normalizeText(mention.sentence_text);

  if (
    /\b(?:street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd\.|building|tower|suite|apt|apartment|district|po box|zip|postal|drive|lane)\b/i.test(raw) ||
    /\b\d{1,5}\b/.test(raw) ||
    /(?:רחוב|שדרה|בניין|מגדל|קומה|ת\.ד\.|דירה)/.test(raw)
  ) {
    return "address_like";
  }

  if (
    /\b(?:port|terminal|warehouse|campus|clinic|hospital|airport|crossing|pier|station|facility|mosque|school|factory|center|centre|base)\b/i.test(raw) ||
    /(?:נמל|מחסן|מסוף|בית חולים|שדה תעופה|מסגד|מרפאה|אוניברסיטה|בסיס)/.test(raw)
  ) {
    return "poi_or_facility";
  }

  if (
    /\b(?:city|district|province|state|country|county|region|valley|governorate)\b/i.test(raw) ||
    KNOWN_LOCATION_HINTS[normalized] ||
    sentence.includes(`${normalized} district`) ||
    sentence.includes(`${normalized} region`)
  ) {
    return "locality_or_admin_area";
  }

  return "ambiguous_text_toponym";
};

const buildContextHints = (mentions: LocationMentionInput[]): { country?: string; region?: string; locality?: string } => {
  const counts = new Map<string, number>();
  const add = (value?: string) => {
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  };

  mentions.forEach((mention) => {
    mention.surrounding_entities.forEach((entity) => add(normalizeText(entity)));
    add(normalizeText(mention.sentence_text));
  });

  const normalizedEntries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const context: { country?: string; region?: string; locality?: string } = {};
  normalizedEntries.forEach(([key]) => {
    const hint = KNOWN_LOCATION_HINTS[key];
    if (!hint) return;
    if (!context.country && hint.country) context.country = hint.country;
    if (!context.region && hint.region) context.region = hint.region;
    if (!context.locality && hint.locality) context.locality = hint.locality;
  });

  return context;
};

const heuristicCandidate = (mention: LocationMentionInput, mentionType: LocationMentionType): PeliasCandidate[] => {
  const hint = KNOWN_LOCATION_HINTS[normalizeText(mention.raw_text)];
  if (!hint) return [];
  return [
    {
      canonical_name: mention.raw_text.trim(),
      normalized_query: normalizeText(mention.raw_text),
      lat: hint.lat,
      lon: hint.lon,
      bbox: null,
      country: hint.country,
      region: hint.region,
      locality: hint.locality,
      neighbourhood: undefined,
      source: "heuristic_fallback",
      confidence: 0.72,
      match_label: mention.raw_text.trim(),
    },
  ];
};

const scoreCandidate = (
  mention: LocationMentionInput,
  candidate: PeliasCandidate,
  caseContext: { country?: string; region?: string; locality?: string },
): number => {
  const mentionConfidence = mention.source_confidence ?? 0.6;
  const exactScore = Math.max(
    tokenOverlap(mention.raw_text, candidate.canonical_name),
    tokenOverlap(mention.raw_text, candidate.match_label),
  );
  const sentenceHints = `${mention.sentence_text} ${mention.surrounding_entities.join(" ")}`;
  const countryBoost = candidate.country && normalizeText(sentenceHints).includes(normalizeText(candidate.country)) ? 0.12 : 0;
  const regionBoost = candidate.region && normalizeText(sentenceHints).includes(normalizeText(candidate.region)) ? 0.1 : 0;
  const localityBoost = candidate.locality && normalizeText(sentenceHints).includes(normalizeText(candidate.locality)) ? 0.1 : 0;
  const adminConsistency =
    (caseContext.country && candidate.country === caseContext.country ? 0.08 : 0) +
    (caseContext.region && candidate.region === caseContext.region ? 0.06 : 0) +
    (caseContext.locality && candidate.locality === caseContext.locality ? 0.06 : 0);

  return Math.max(
    0,
    Math.min(
      1,
      candidate.confidence * 0.38 +
        exactScore * 0.34 +
        mentionConfidence * 0.12 +
        countryBoost +
        regionBoost +
        localityBoost +
        adminConsistency,
    ),
  );
};

const confidenceBucket = (score: number): "high" | "medium" | "low" => {
  if (score >= 0.78) return "high";
  if (score >= 0.58) return "medium";
  return "low";
};

const toResolvedRecord = (
  mention: LocationMentionInput,
  candidate: PeliasCandidate,
  mentionType: LocationMentionType,
  resolutionMethod: LocationResolutionMethod,
  score: number,
  candidateCount: number,
): ResolvedLocationRecord => {
  const pinConfidence = resolutionMethod === "heuristic_fallback" ? "medium" : confidenceBucket(score);
  return {
    location_id: `loc_${stableHash(`${mention.mention_id}:${candidate.gid ?? candidate.canonical_name}:${candidate.lat}:${candidate.lon}`)}`,
    canonical_name: candidate.canonical_name,
    raw_text: mention.raw_text,
    normalized_query: candidate.normalized_query,
    lat: candidate.lat,
    lon: candidate.lon,
    bbox: candidate.bbox ?? null,
    country: candidate.country,
    region: candidate.region,
    locality: candidate.locality,
    neighbourhood: candidate.neighbourhood,
    source: candidate.source,
    gid: candidate.gid,
    wof_id: candidate.wof_id,
    geonameid: candidate.geonameid,
    confidence: score,
    pin_confidence: pinConfidence,
    resolution_method: resolutionMethod,
    mention_type: mentionType,
    evidence_mentions: [mention.mention_id],
    candidate_count: candidateCount,
    warning: pinConfidence === "medium" ? "Approximate location pin" : pinConfidence === "low" ? "Location remains unresolved" : undefined,
  };
};

const locationToCanonicalFtMEntity = (record: ResolvedLocationRecord): CanonicalFtMEntity => ({
  ftm_id: `ftm_location_${stableHash(`${record.canonical_name}:${record.lat}:${record.lon}`)}`,
  schema: "Location",
  caption: record.canonical_name,
  aliases: [record.raw_text, record.canonical_name].filter(Boolean),
  properties: {
    name: [record.canonical_name],
    alias: [record.raw_text].filter(Boolean),
    country: record.country ? [record.country] : [],
    region: record.region ? [record.region] : [],
    locality: record.locality ? [record.locality] : [],
  },
  source_entity_ids: [record.location_id],
  source_document_ids: [],
  relation_ids: [],
  event_ids: [],
  confidence: record.confidence,
  external_reference_ids: [],
  merge_rationale: ["Projected Pelias-resolved location into canonical FtM Location schema."],
});

const applyWikidataLocationSignals = async (record: ResolvedLocationRecord): Promise<ResolvedLocationRecord> => {
  const enrichment = await enrichFromWikidata(locationToCanonicalFtMEntity(record));
  const primaryLink = enrichment.links[0];
  if (!primaryLink) {
    return record;
  }

  return {
    ...record,
    wikidata_id: primaryLink.external_id,
    external_reference_ids: enrichment.links.map((link) => `${link.namespace}:${link.external_id}`),
    alias_surface: Array.from(new Set([...(record.alias_surface || []), ...primaryLink.aliases])).slice(0, 10),
    confidence: Math.max(record.confidence, Math.min(0.92, primaryLink.match_confidence)),
  };
};

const resolveMentionCandidates = async (
  mention: LocationMentionInput,
  caseContext: { country?: string; region?: string; locality?: string },
): Promise<{ method: LocationResolutionMethod; mentionType: LocationMentionType; candidates: PeliasCandidate[] }> => {
  const mentionType = detectMentionType(mention);

  if (!isPeliasConfigured()) {
    return {
      method: "heuristic_fallback",
      mentionType,
      candidates: heuristicCandidate(mention, mentionType),
    };
  }

  if (mentionType === "address_like") {
    const normalized = normalizeAddressLikeMention(mention.raw_text, mention.language);
    const structuredCandidates = await structuredPeliasQuery(normalized.components, normalized.normalized_query || mention.raw_text);
    if (structuredCandidates.length) {
      return {
        method: normalized.source === "libpostal" ? "pelias_after_libpostal" : "pelias_structured",
        mentionType,
        candidates: structuredCandidates,
      };
    }
  }

  if (mentionType === "ambiguous_text_toponym") {
    const hints = resolveAmbiguousToponym(
      mention.raw_text,
      mention.sentence_text,
      mention.surrounding_entities,
      mention.language,
    );
    for (const hint of hints) {
      const candidates = await queryPelias(mention.raw_text, {
        country: hint.country,
        region: hint.region,
        locality: hint.locality,
      });
      if (candidates.length) {
        return {
          method: "pelias_after_mordecai3",
          mentionType,
          candidates,
        };
      }
    }
  }

  return {
    method: "pelias_direct",
    mentionType,
    candidates: await queryPelias(mention.raw_text, caseContext),
  };
};

export const resolveLocationMentions = async (
  caseId: string,
  mentions: LocationMentionInput[],
): Promise<LocationResolutionResponse> => {
  const caseContext = buildContextHints(mentions);
  const resolvedLocations: ResolvedLocationRecord[] = [];
  const candidateSets: LocationCandidateSet[] = [];
  let fallbackMode: "pelias" | "heuristic" = isPeliasConfigured() ? "pelias" : "heuristic";

  for (const mention of mentions) {
    const { candidates, method, mentionType } = await resolveMentionCandidates(mention, caseContext);
    if (method === "heuristic_fallback") {
      fallbackMode = "heuristic";
    }

    const scoredCandidates = candidates
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(mention, candidate, caseContext),
      }))
      .sort((left, right) => right.score - left.score);

    const resolvedRecords = scoredCandidates.map(({ candidate, score }) =>
      toResolvedRecord(mention, candidate, mentionType, method, score, scoredCandidates.length),
    );
    const topScore = scoredCandidates[0]?.score ?? 0;
    const runnerUpScore = scoredCandidates[1]?.score ?? 0;
    const ambiguityGap = topScore - runnerUpScore;
    const shouldHoldForAmbiguity =
      scoredCandidates.length > 1 &&
      topScore < 0.72 &&
      ambiguityGap < 0.08;

    const accepted = shouldHoldForAmbiguity
      ? undefined
      : resolvedRecords.find((record) => record.pin_confidence !== "low");

    if (accepted) {
      const enrichedAccepted = await applyWikidataLocationSignals(accepted);
      const existing = resolvedLocations.find((record) => record.location_id === accepted.location_id);
      if (existing) {
        existing.evidence_mentions = Array.from(new Set([...existing.evidence_mentions, mention.mention_id]));
        existing.confidence = Math.max(existing.confidence, enrichedAccepted.confidence);
        existing.external_reference_ids = Array.from(
          new Set([...(existing.external_reference_ids || []), ...(enrichedAccepted.external_reference_ids || [])]),
        );
        existing.alias_surface = Array.from(
          new Set([...(existing.alias_surface || []), ...(enrichedAccepted.alias_surface || [])]),
        );
        existing.wikidata_id = existing.wikidata_id || enrichedAccepted.wikidata_id;
      } else {
        resolvedLocations.push(enrichedAccepted);
      }
    }

    candidateSets.push({
      mention_id: mention.mention_id,
      mention_type: mentionType,
      candidates: resolvedRecords,
      accepted_location_id: accepted?.location_id,
      unresolved_reason: accepted
        ? undefined
        : shouldHoldForAmbiguity
        ? "Multiple location candidates remain too close in score to auto-pin safely."
        : "No high-confidence candidate passed the auto-pin policy.",
    });
  }

  return {
    case_id: caseId,
    resolved_locations: resolvedLocations,
    candidate_sets: candidateSets,
    fallback_mode: fallbackMode,
    generated_at: new Date().toISOString(),
  };
};
