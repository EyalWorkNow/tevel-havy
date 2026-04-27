import {
  type CanonicalFtMEntity,
  type KnowledgeAdapterResult,
  type KnowledgeEnrichmentRequest,
  type KnowledgeEnrichmentResult,
  type ReferenceKnowledgeProfile,
} from "./contracts";
import { projectEntitiesToCanonicalFtM } from "./ftmProjector";
import { maybeWriteGraphitiKnowledgeSink } from "./graphitiAdapter";
import { enrichFromOpenAlex } from "./openAlexAdapter";
import { getCachedReferenceProfile, persistKnowledgeEnrichment } from "./store";
import { enrichFromWikidata } from "./wikidataAdapter";
import { enrichFromYente } from "./yenteAdapter";

const unique = (values: string[]): string[] => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const emptyProfile = (sourceEntityId: string, entity: CanonicalFtMEntity): ReferenceKnowledgeProfile => ({
  entity_id: sourceEntityId,
  canonical_name: entity.caption,
  ftm_id: entity.ftm_id,
  ftm_schema: entity.schema,
  aliases: [...entity.aliases],
  descriptions: [],
  affiliations: [],
  source_labels: [],
  assertions: [],
  links: [],
  watchlist_hits: [],
  warnings: [],
  derived_from_case: false,
});

const mergeAdapterIntoProfile = (
  profile: ReferenceKnowledgeProfile,
  adapterResult: KnowledgeAdapterResult,
): ReferenceKnowledgeProfile => ({
  ...profile,
  aliases: unique([
    ...profile.aliases,
    ...adapterResult.links.flatMap((link) => link.aliases || []),
  ]),
  descriptions: unique([...profile.descriptions, ...adapterResult.descriptions]),
  affiliations: unique([...profile.affiliations, ...adapterResult.affiliations]),
  source_labels: unique([...profile.source_labels, ...adapterResult.source_labels]),
  assertions: [
    ...profile.assertions,
    ...adapterResult.assertions.filter(
      (candidate) => !profile.assertions.some((existing) => existing.assertion_id === candidate.assertion_id),
    ),
  ],
  links: [
    ...profile.links,
    ...adapterResult.links.filter((candidate) => !profile.links.some((existing) => existing.link_id === candidate.link_id)),
  ],
  watchlist_hits: [
    ...profile.watchlist_hits,
    ...(adapterResult.watchlist_hits || []).filter(
      (candidate) => !profile.watchlist_hits.some((existing) => existing.hit_id === candidate.hit_id),
    ),
  ],
  warnings: unique([...profile.warnings, ...adapterResult.warnings]),
});

const cloneProfileForSource = (profile: ReferenceKnowledgeProfile, sourceEntityId: string): ReferenceKnowledgeProfile => ({
  ...profile,
  entity_id: sourceEntityId,
  assertions: profile.assertions.map((assertion) => ({
    ...assertion,
    subject_entity_id: sourceEntityId,
  })),
  watchlist_hits: profile.watchlist_hits.map((hit) => ({
    ...hit,
    entity_id: sourceEntityId,
  })),
});

export const enrichKnowledgeForCase = async (
  request: KnowledgeEnrichmentRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeEnrichmentResult> => {
  const canonicalEntities = projectEntitiesToCanonicalFtM(
    request.caseId,
    request.entities,
    request.relations || [],
    request.eventIds || [],
  );

  const referenceKnowledge: Record<string, ReferenceKnowledgeProfile> = {};
  const knowledgeSources = [];
  const referenceWarnings: string[] = [];

  for (const canonicalEntity of canonicalEntities) {
    const cachedProfile = canonicalEntity.source_entity_ids
      .map((entityId) => getCachedReferenceProfile(entityId))
      .find((profile): profile is ReferenceKnowledgeProfile => Boolean(profile));

    if (cachedProfile) {
      canonicalEntity.external_reference_ids = unique(cachedProfile.links.map((link) => `${link.namespace}:${link.external_id}`));
      canonicalEntity.aliases = unique([...canonicalEntity.aliases, ...cachedProfile.aliases]);
      canonicalEntity.merge_rationale = unique([
        ...canonicalEntity.merge_rationale,
        "Reused cached reference knowledge for this canonical entity.",
      ]);
      canonicalEntity.source_entity_ids.forEach((sourceEntityId) => {
        referenceKnowledge[sourceEntityId] = cloneProfileForSource(cachedProfile, sourceEntityId);
      });
      knowledgeSources.push({
        snapshot_id: `ks_cache_${stableHash(`${canonicalEntity.ftm_id}:cached`)}`,
        namespace: "wikidata",
        cache_key: canonicalEntity.ftm_id,
        status: "cached" as const,
        retrieved_at: new Date().toISOString(),
        record_count: cachedProfile.links.length,
        warnings: [],
      });
      continue;
    }

    let mergedProfile = emptyProfile(canonicalEntity.source_entity_ids[0] || canonicalEntity.ftm_id, canonicalEntity);
    const adapterResults = await Promise.all([
      enrichFromWikidata(canonicalEntity, fetchImpl),
      enrichFromOpenAlex(canonicalEntity, fetchImpl),
      enrichFromYente(canonicalEntity, fetchImpl),
    ]);

    adapterResults.forEach((result) => {
      mergedProfile = mergeAdapterIntoProfile(mergedProfile, result);
      if (result.snapshot) {
        knowledgeSources.push(result.snapshot);
      }
    });

    canonicalEntity.external_reference_ids = unique(
      mergedProfile.links.map((link) => `${link.namespace}:${link.external_id}`),
    );
    canonicalEntity.aliases = unique([...canonicalEntity.aliases, ...mergedProfile.aliases]);
    canonicalEntity.merge_rationale = unique([
      ...canonicalEntity.merge_rationale,
      ...mergedProfile.links.map((link) => `${link.namespace} matched ${link.label} (${Math.round(link.match_confidence * 100)}%).`),
    ]);

    canonicalEntity.source_entity_ids.forEach((sourceEntityId) => {
      referenceKnowledge[sourceEntityId] = cloneProfileForSource(mergedProfile, sourceEntityId);
    });

    referenceWarnings.push(...mergedProfile.warnings);
  }

  const graphitiSnapshot = await maybeWriteGraphitiKnowledgeSink(request.caseId, canonicalEntities, referenceKnowledge, fetchImpl);
  knowledgeSources.push(graphitiSnapshot);

  const result: KnowledgeEnrichmentResult = {
    case_id: request.caseId,
    canonical_entities: canonicalEntities,
    reference_knowledge: referenceKnowledge,
    watchlist_hits: unique(
      Object.values(referenceKnowledge)
        .flatMap((profile) => profile.watchlist_hits.map((hit) => hit.hit_id)),
    ).map((hitId) =>
      Object.values(referenceKnowledge)
        .flatMap((profile) => profile.watchlist_hits)
        .find((hit) => hit.hit_id === hitId)!,
    ),
    knowledge_sources: knowledgeSources,
    reference_warnings: unique(referenceWarnings),
    generated_at: new Date().toISOString(),
  };

  await persistKnowledgeEnrichment(result, fetchImpl);
  return result;
};

