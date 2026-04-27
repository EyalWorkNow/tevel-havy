import type { CanonicalFtMEntity, KnowledgeRelationInput } from "./contracts";

export interface OpenAlephExportBundle {
  entities: Array<{
    id: string;
    schema: string;
    caption: string;
    properties: Record<string, string[]>;
  }>;
  relations: Array<{
    source: string;
    target: string;
    type: string;
    confidence: number;
  }>;
}

export const buildOpenAlephExportBundle = (
  canonicalEntities: CanonicalFtMEntity[],
  relations: KnowledgeRelationInput[] = [],
): OpenAlephExportBundle => ({
  entities: canonicalEntities.map((entity) => ({
    id: entity.ftm_id,
    schema: entity.schema,
    caption: entity.caption,
    properties: entity.properties,
  })),
  relations: relations.map((relation) => ({
    source: relation.source,
    target: relation.target,
    type: relation.type,
    confidence: relation.confidence,
  })),
});

