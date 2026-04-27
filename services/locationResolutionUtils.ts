import { Entity, Relation } from "../types";
import { LocationMentionInput, ResolvedLocationRecord } from "./sidecar/location/types";

export const normalizeLocationText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const KNOWN_LOCATION_HINTS = [
  "Ashdod Port",
  "Port of Ashdod",
  "נמל אשדוד",
  "Tel Aviv",
  "Haifa",
  "Jerusalem",
  "Amman",
  "Beirut",
  "Jordan Valley",
];

export const buildLocationQueriesForEntity = (location: Pick<Entity, "name" | "aliases" | "evidence">): string[] => {
  const queries = new Set<string>();
  const push = (value?: string) => {
    if (value?.trim()) queries.add(value.trim());
  };

  push(location.name);
  (location.aliases || []).forEach(push);
  (location.evidence || []).forEach((snippet) => {
    const normalizedSnippet = normalizeLocationText(snippet);
    KNOWN_LOCATION_HINTS.forEach((hint) => {
      if (normalizedSnippet.includes(normalizeLocationText(hint))) {
        queries.add(hint);
      }
    });
  });

  return Array.from(queries);
};

const pickSentence = (entity: Entity, query: string): string => {
  const match = (entity.evidence || []).find((snippet) => snippet.includes(query));
  return match || entity.evidence?.[0] || query;
};

const gatherContextEntities = (entity: Entity, relations: Relation[]): string[] => {
  const related = new Set<string>();
  relations.forEach((relation) => {
    if (relation.source === entity.id || relation.source === entity.name) related.add(String(relation.target));
    if (relation.target === entity.id || relation.target === entity.name) related.add(String(relation.source));
  });
  return Array.from(related);
};

export const buildLocationMentionsForEntities = (
  locations: Entity[],
  relations: Relation[],
  caseId: string,
): LocationMentionInput[] =>
  locations.flatMap((entity) => {
    const surroundingEntities = gatherContextEntities(entity, relations);
    return buildLocationQueriesForEntity(entity).map((query, index) => ({
      mention_id: `${entity.id}_loc_${index}`,
      raw_text: query,
      sentence_text: pickSentence(entity, query),
      document_id: caseId,
      page_number: entity.source_chunks?.[0],
      surrounding_entities: surroundingEntities,
      language: /[\u0590-\u05FF]/.test(query) ? "he" : "en",
      source_confidence: entity.confidence,
    }));
  });

export const selectBestResolvedLocation = (
  locations: ResolvedLocationRecord[],
): ResolvedLocationRecord | null =>
  [...locations]
    .sort((left, right) => right.confidence - left.confidence)
    .find((location) => location.pin_confidence !== "low") ?? null;
