import { runPythonPersonAdapter } from "./adapters";
import { ReferenceKnowledgeProfile } from "../knowledge/contracts";
import { PersonDossier, PersonEntity, PersonExtractionResponse, PersonFact, PersonMention, PersonResolutionResponse } from "./types";

type PythonPersonExtractionResponse = {
  mentions: PersonMention[];
  facts: PersonFact[];
  provisionalEntities: PersonEntity[];
  warnings: string[];
  extractionMode: "backend" | "fallback";
};

const stableHash = (value: string): string => {
  let hashValue = 2166136261;
  for (const char of value) {
    hashValue ^= char.charCodeAt(0);
    hashValue = (hashValue * 16777619) >>> 0;
  }
  return hashValue.toString(16).padStart(8, "0");
};

const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenSet = (value: string): Set<string> => new Set(normalize(value).split(" ").filter(Boolean));

const jaccard = (left: string, right: string): number => {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) overlap += 1;
  });
  return overlap / new Set([...a, ...b]).size;
};

const surname = (value: string): string => {
  const parts = normalize(value).split(" ").filter(Boolean);
  return parts[parts.length - 1] || "";
};

const contextCompatible = (mentionId: string, mentionIds: string[], facts: PersonFact[]): boolean => {
  const mentionFacts = facts.filter((fact) => fact.evidenceMentionIds.includes(mentionId));
  const clusterFacts = facts.filter((fact) => fact.evidenceMentionIds.some((id) => mentionIds.includes(id)));
  const orgValues = new Set(clusterFacts.filter((fact) => fact.kind === "organization").map((fact) => normalize(fact.value)));
  const mentionOrgValues = mentionFacts.filter((fact) => fact.kind === "organization").map((fact) => normalize(fact.value));
  if (!orgValues.size || !mentionOrgValues.length) return true;
  return mentionOrgValues.every((value) => orgValues.has(value));
};

const shouldMergeMention = (mention: PersonMention, entity: PersonEntity, facts: PersonFact[]): boolean => {
  const aliasSimilarity = Math.max(...[entity.canonicalName, ...entity.aliases].map((alias) => jaccard(alias, mention.normalizedText)), 0);
  const sameSurname = surname(entity.canonicalName) && surname(entity.canonicalName) === surname(mention.normalizedText);
  if (aliasSimilarity >= 0.9) return true;
  if (sameSurname && aliasSimilarity >= 0.45 && contextCompatible(mention.mentionId, entity.mentions, facts)) return true;
  return false;
};

const mergeFacts = (facts: PersonFact[], entities: PersonEntity[]): PersonFact[] =>
  facts.map((fact) => {
    const linked = entities.find((entity) => entity.entityId === fact.entityId);
    return linked ? fact : fact;
  });

export const extractPersons = (params: {
  caseId: string;
  documentId: string;
  rawText: string;
  chunks: Array<{ chunkId: string; text: string; page?: number }>;
  language?: string;
}): PersonExtractionResponse => {
  const result = runPythonPersonAdapter<PythonPersonExtractionResponse>("person_extract", params);
  return {
    caseId: params.caseId,
    documentId: params.documentId,
    mentions: result.mentions,
    facts: result.facts,
    provisionalEntities: result.provisionalEntities,
    warnings: result.warnings,
    extractionMode: result.extractionMode,
    generatedAt: new Date().toISOString(),
  };
};

export const resolvePersons = (caseId: string, extracted: PersonExtractionResponse): PersonResolutionResponse => {
  const entityMap = new Map<string, PersonEntity>();
  extracted.provisionalEntities.forEach((entity) => {
    entityMap.set(entity.entityId, { ...entity, aliases: Array.from(new Set(entity.aliases)), mentions: [...entity.mentions], facts: [...entity.facts] });
  });

  extracted.mentions.forEach((mention) => {
    const matched = Array.from(entityMap.values()).find((entity) => shouldMergeMention(mention, entity, extracted.facts));
    if (matched) {
      matched.mentions = Array.from(new Set([...matched.mentions, mention.mentionId]));
      matched.aliases = Array.from(new Set([...matched.aliases, mention.text, mention.normalizedText]));
      matched.confidence = Math.max(matched.confidence, mention.confidence);
      return;
    }

    const entityId = `person_${stableHash(`${mention.documentId}:${mention.normalizedText}:${mention.startChar}`)}`;
    entityMap.set(entityId, {
      entityId,
      canonicalName: mention.text,
      aliases: [mention.text, mention.normalizedText].filter(Boolean),
      mentions: [mention.mentionId],
      facts: [],
      confidence: mention.confidence,
    });
  });

  const resolvedEntities = Array.from(entityMap.values())
    .map((entity) => ({
      ...entity,
      aliases: Array.from(new Set(entity.aliases.filter(Boolean))),
    }))
    .sort((left, right) => right.confidence - left.confidence || right.mentions.length - left.mentions.length);

  const unresolvedMentions = extracted.mentions.filter(
    (mention) => !resolvedEntities.some((entity) => entity.mentions.includes(mention.mentionId)),
  );
  const mergedFacts = mergeFacts(extracted.facts, resolvedEntities);

  const dossiers = Object.fromEntries(
    resolvedEntities
      .map((entity) => [entity.entityId, buildPersonDossier(entity.entityId, entity, mergedFacts)] as const)
      .filter((entry): entry is [string, PersonDossier] => Boolean(entry[1])),
  );

  return {
    caseId,
    entities: resolvedEntities,
    facts: mergedFacts,
    dossiers,
    unresolvedMentions,
    warnings: extracted.warnings,
    resolutionMode: extracted.extractionMode,
    generatedAt: new Date().toISOString(),
  };
};

const dedupeStrings = (values: string[]): string[] => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

export const buildPersonDossier = (
  entityId: string,
  entity: PersonEntity,
  facts: PersonFact[],
): PersonDossier | null => {
  const entityFacts = facts.filter((fact) => fact.entityId === entityId);
  const evidenceDensity = new Set(entityFacts.flatMap((fact) => fact.evidenceMentionIds)).size;
  if (entity.confidence < 0.45 || evidenceDensity < 2) {
    return null;
  }

  try {
    const dossier = runPythonPersonAdapter<PersonDossier | null>("person_build_dossier", {
      entity,
      facts: entityFacts,
    });
    if (dossier) return dossier;
  } catch {
    // deterministic fallback below
  }

  const getValues = (kind: PersonFact["kind"]) => dedupeStrings(entityFacts.filter((fact) => fact.kind === kind).map((fact) => fact.value));
  const relationships = entityFacts
    .filter((fact) => fact.kind === "relationship")
    .map((fact) => ({
      type: fact.normalizedValue || "related_to",
      target: fact.value,
      confidence: fact.confidence,
      evidenceMentionIds: fact.evidenceMentionIds,
    }));
  const claims = entityFacts
    .filter((fact) => fact.kind === "claim")
    .map((fact) => ({
      text: fact.value,
      confidence: fact.confidence,
      evidenceMentionIds: fact.evidenceMentionIds,
    }));

  return {
    entityId: entity.entityId,
    canonicalName: entity.canonicalName,
    aliases: dedupeStrings(entity.aliases.filter((alias) => normalize(alias) !== normalize(entity.canonicalName))),
    titles: getValues("title"),
    roles: getValues("role"),
    organizations: getValues("organization"),
    contact: {
      emails: getValues("email"),
      phones: getValues("phone"),
    },
    locations: getValues("location"),
    dates: getValues("date"),
    relationships,
    claims,
    sourceMentions: [...entity.mentions],
    overallConfidence: Math.max(entity.confidence, entityFacts.reduce((max, fact) => Math.max(max, fact.confidence), 0)),
  };
};

export const applyReferenceKnowledgeToResolvedPersons = (
  resolution: PersonResolutionResponse,
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): PersonResolutionResponse => {
  if (!referenceKnowledge) return resolution;

  const warnings = [...resolution.warnings];
  const entities = resolution.entities.map((entity) => {
    const profile =
      referenceKnowledge[entity.entityId] ||
      Object.values(referenceKnowledge).find(
        (candidate) =>
          normalize(candidate.entity_id) === normalize(entity.entityId) ||
          normalize(candidate.canonical_name) === normalize(entity.canonicalName),
      );

    if (!profile || profile.ftm_schema !== "Person") {
      return entity;
    }

    const watchlistStatus = profile.watchlist_hits.some((hit) => hit.status === "match")
      ? "Watchlist match"
      : profile.watchlist_hits.some((hit) => hit.status === "candidate")
        ? "Watchlist candidate"
        : undefined;

    if (watchlistStatus) {
      warnings.push(`${entity.canonicalName}: ${watchlistStatus} retained in the external reference lane.`);
    }

    return {
      ...entity,
      aliases: dedupeStrings([...entity.aliases, ...profile.aliases]),
      confidence: Math.max(entity.confidence, ...profile.links.map((link) => Math.min(0.96, link.match_confidence))),
    };
  });

  return {
    ...resolution,
    entities,
    warnings: dedupeStrings(warnings),
  };
};
