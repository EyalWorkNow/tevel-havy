import type { CanonicalFtMEntity, CanonicalFtMSchema, KnowledgeEntityInput, KnowledgeRelationInput } from "./contracts";

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

const mapTypeToSchema = (type: string): CanonicalFtMSchema => {
  switch (normalize(type)) {
    case "person":
      return "Person";
    case "org":
    case "organization":
      return "Organization";
    case "location":
      return "Location";
    case "asset":
    case "object":
    case "method":
      return "Asset";
    case "vehicle":
      return "Vehicle";
    case "identifier":
      return "Identifier";
    case "event":
      return "Event";
    default:
      return "Thing";
  }
};

const preferredCaption = (left: string, right: string): string => {
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
};

export const projectEntitiesToCanonicalFtM = (
  caseId: string,
  entities: KnowledgeEntityInput[],
  relations: KnowledgeRelationInput[] = [],
  eventIds: string[] = [],
): CanonicalFtMEntity[] => {
  const canonicalMap = new Map<string, CanonicalFtMEntity>();

  entities.forEach((entity) => {
    const schema = mapTypeToSchema(entity.type);
    const aliases = unique([entity.name, ...(entity.aliases || [])]);
    const key = `${schema}:${normalize(entity.name)}`;
    const existing = canonicalMap.get(key);
    const sourceDocumentIds = unique(entity.document_ids || []);

    if (!existing) {
      canonicalMap.set(key, {
        ftm_id: `ftm_${schema.toLowerCase()}_${stableHash(`${caseId}:${schema}:${key}`)}`,
        schema,
        caption: entity.name,
        aliases,
        properties: {
          name: [entity.name],
          alias: aliases.filter((alias) => normalize(alias) !== normalize(entity.name)),
          description: entity.description ? [entity.description] : [],
          category: [entity.type],
        },
        source_entity_ids: [entity.entity_id],
        source_document_ids: sourceDocumentIds,
        relation_ids: [],
        event_ids: [...eventIds],
        confidence: entity.confidence || 0.6,
        external_reference_ids: [],
        merge_rationale: [`Projected ${entity.type} entity ${entity.name} into FtM schema ${schema}.`],
      });
      return;
    }

    existing.caption = preferredCaption(existing.caption, entity.name);
    existing.aliases = unique([...existing.aliases, ...aliases]);
    existing.properties = {
      ...existing.properties,
      name: unique([...(existing.properties.name || []), entity.name]),
      alias: unique([...(existing.properties.alias || []), ...aliases.filter((alias) => normalize(alias) !== normalize(existing.caption))]),
      description: unique([...(existing.properties.description || []), ...(entity.description ? [entity.description] : [])]),
      category: unique([...(existing.properties.category || []), entity.type]),
    };
    existing.source_entity_ids = unique([...existing.source_entity_ids, entity.entity_id]);
    existing.source_document_ids = unique([...existing.source_document_ids, ...sourceDocumentIds]);
    existing.confidence = Math.max(existing.confidence, entity.confidence || 0);
    existing.merge_rationale = unique([
      ...existing.merge_rationale,
      `Merged ${entity.name} into ${existing.caption} because schema and normalized caption aligned.`,
    ]);
  });

  const relationLookup = new Map<string, string[]>();
  relations.forEach((relation) => {
    const leftKey = normalize(relation.source);
    const rightKey = normalize(relation.target);
    const relationId = `rel_${stableHash(`${leftKey}:${relation.type}:${rightKey}`)}`;
    relationLookup.set(leftKey, unique([...(relationLookup.get(leftKey) || []), relationId]));
    relationLookup.set(rightKey, unique([...(relationLookup.get(rightKey) || []), relationId]));
  });

  return Array.from(canonicalMap.values())
    .map((entity) => ({
      ...entity,
      relation_ids: relationLookup.get(normalize(entity.caption)) || [],
      properties: {
        ...entity.properties,
        alias: unique((entity.properties.alias || []).filter((alias) => normalize(alias) !== normalize(entity.caption))),
      },
    }))
    .sort((left, right) => right.confidence - left.confidence || right.source_entity_ids.length - left.source_entity_ids.length);
};

