import type { Relation } from "../../types";
import type { TemporalEventRecord } from "./temporal/contracts";
import type { ReferenceKnowledgeProfile } from "./knowledge/contracts";
import { LexicalSearchHit, SidecarExtractionPayload, SidecarLexicalIndex } from "./types";
import { normalizeLookupText } from "./textUnits";

export type RetrievalBundleKind =
  | "case_brief"
  | "entity_brief"
  | "relationship_brief"
  | "timeline_summary"
  | "contradiction_summary"
  | "update_summary";

export type RetrievalItemType = "text_unit" | "entity" | "mention" | "relation" | "event" | "claim" | "reference";
export type RetrievalBackend = "hybrid_graph_ranker_v1" | "hybrid_graph_semantic_v1";

export interface RetrievalScoreBreakdown {
  lexical_score: number;
  structural_score: number;
  semantic_score?: number;
  intent_score: number;
  graph_score: number;
  temporal_score: number;
  confidence_score: number;
  fused_score: number;
}

export interface RetrievalRankingDiagnostics {
  semantic_enabled: boolean;
  embedding_model?: string;
  fusion_strategy: string[];
  adapter_status?: NonNullable<SidecarExtractionPayload["runtime_diagnostics"]>["adapter_status"];
}

export interface RetrievalEvidenceHit {
  item_id: string;
  item_type: RetrievalItemType;
  source_doc_id: string;
  source_text_unit_id?: string;
  evidence_id?: string;
  source_namespace?: string;
  external_reference_ids?: string[];
  reference_only?: boolean;
  snippet: string;
  related_entities: string[];
  related_events: string[];
  normalized_time_start?: string;
  normalized_time_end?: string;
  contradiction_ids: string[];
  confidence: number;
  score: number;
  matched_terms: string[];
  explanation: string[];
  score_breakdown?: RetrievalScoreBreakdown;
}

export interface RetrievalEvidenceBundle {
  bundle_id: string;
  kind: RetrievalBundleKind;
  title: string;
  query: string;
  hits: RetrievalEvidenceHit[];
  cited_evidence_ids: string[];
  related_entities: string[];
  related_events: string[];
  contradictions: string[];
  confidence: number;
  temporal_window?: {
    start?: string;
    end?: string;
  };
  warnings: string[];
}

export interface RetrievalArtifacts {
  backend: RetrievalBackend;
  warnings: string[];
  item_count: number;
  contradiction_item_count: number;
  bundle_count: number;
  bundles: Record<string, RetrievalEvidenceBundle>;
  diagnostics?: RetrievalRankingDiagnostics;
}

type SearchMode = "generic" | "case" | "entity" | "relationship" | "timeline" | "contradiction" | "update";

type SearchOptions = {
  limit?: number;
  mode?: SearchMode;
  relatedEntities?: string[];
  relatedEvents?: string[];
  timeWindow?: {
    start?: string;
    end?: string;
  };
};

type IndexedEvidenceItem = Omit<RetrievalEvidenceHit, "score" | "matched_terms" | "explanation"> & {
  search_text: string;
};

type ScoredEvidenceItem = {
  item: IndexedEvidenceItem;
  matchedTerms: string[];
  explanation: string[];
  lexicalScore: number;
  structuralScore: number;
  intentScore: number;
  graphScore: number;
  temporalScore: number;
  confidenceScore: number;
  semanticScore: number;
  fusedScore: number;
  lexicalRank: number;
  structuralRank: number;
  semanticRank?: number;
};

const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "/ollama";
const EMBEDDING_MODEL_CANDIDATES = Array.from(
  new Set([
    process.env.OLLAMA_EMBED_MODEL || "embeddinggemma",
    "embeddinggemma",
    "nomic-embed-text",
    "mxbai-embed-large",
    "qwen3-embedding",
  ].filter(Boolean)),
);
const RRF_K = 60;

let semanticModelPromise: Promise<string | null> | null = null;
const semanticEmbeddingCache = new Map<string, number[]>();

const tokenize = (value: string): string[] =>
  normalizeLookupText(value)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);

const unique = <T>(items: T[]): T[] => Array.from(new Set(items.filter(Boolean) as T[]));

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const makeSnippet = (value: string, limit = 300): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
};

const parseTime = (value?: string): number | undefined => {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, 1);
  }
  if (/^\d{4}$/.test(value)) {
    return Date.UTC(Number(value), 0, 1);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const reciprocalRank = (rank: number): number => 1 / (RRF_K + rank);

const roundScore = (value: number): number => Number(value.toFixed(4));

const cosineSimilarity = (left: number[], right: number[]): number => {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const bundleKindToMode = (kind: RetrievalBundleKind): SearchMode =>
  kind === "case_brief"
    ? "case"
    : kind === "entity_brief"
      ? "entity"
      : kind === "relationship_brief"
        ? "relationship"
        : kind === "timeline_summary"
          ? "timeline"
          : kind === "contradiction_summary"
            ? "contradiction"
            : "update";

const buildSemanticText = (item: IndexedEvidenceItem): string =>
  [
    item.item_type,
    item.snippet,
    item.related_entities.join(" "),
    item.related_events.join(" "),
    item.normalized_time_start,
    item.normalized_time_end,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1000);

const addRecord = (
  index: SidecarLexicalIndex,
  recordId: string,
  hitType: LexicalSearchHit["hit_type"],
  sourceTextUnitId: string | undefined,
  text: string,
) => {
  index.record_text.set(recordId, text);
  index.record_type.set(recordId, hitType);
  index.record_text_unit.set(recordId, sourceTextUnitId);

  const terms = Array.from(new Set(tokenize(text)));
  terms.forEach((term) => {
    const list = index.inverted_terms.get(term) ?? [];
    if (!list.includes(recordId)) {
      list.push(recordId);
      index.inverted_terms.set(term, list);
    }
  });
};

export const buildLexicalIndex = (payload: SidecarExtractionPayload): SidecarLexicalIndex => {
  const index: SidecarLexicalIndex = {
    source_doc_id: payload.source_doc_id,
    inverted_terms: new Map<string, string[]>(),
    record_text: new Map<string, string>(),
    record_type: new Map<string, LexicalSearchHit["hit_type"]>(),
    record_text_unit: new Map<string, string | undefined>(),
  };

  payload.text_units.forEach((unit) => {
    addRecord(index, unit.text_unit_id, "text_unit", unit.text_unit_id, unit.text);
  });

  payload.entities.forEach((entity) => {
    addRecord(
      index,
      entity.entity_id,
      "entity",
      entity.source_text_unit_ids?.[0],
      [entity.canonical_name, ...(entity.aliases || [])].join(" "),
    );
  });

  payload.mentions.forEach((mention) => {
    addRecord(
      index,
      mention.mention_id,
      "mention",
      mention.source_text_unit_id,
      `${mention.mention_text} ${mention.evidence.raw_supporting_snippet}`,
    );
  });

  return index;
};

export const searchLexicalIndex = (
  index: SidecarLexicalIndex,
  query: string,
  limit = 5,
): LexicalSearchHit[] => {
  const terms = tokenize(query);
  if (!terms.length) return [];

  const scores = new Map<string, { score: number; matchedTerms: Set<string> }>();
  terms.forEach((term) => {
    const recordIds = index.inverted_terms.get(term) ?? [];
    recordIds.forEach((recordId) => {
      const entry = scores.get(recordId) ?? { score: 0, matchedTerms: new Set<string>() };
      entry.score += 1;
      entry.matchedTerms.add(term);
      scores.set(recordId, entry);
    });
  });

  return Array.from(scores.entries())
    .map(([id, value]) => ({
      hit_type: index.record_type.get(id) ?? "text_unit",
      id,
      score: value.score / terms.length,
      source_text_unit_id: index.record_text_unit.get(id),
      snippet: (index.record_text.get(id) ?? "").slice(0, 240),
      matched_terms: Array.from(value.matchedTerms).sort(),
    }))
    .sort((a, b) => b.score - a.score || a.hit_type.localeCompare(b.hit_type))
    .slice(0, limit);
};

export const __resetRetrievalSemanticCacheForTests = (): void => {
  semanticModelPromise = null;
  semanticEmbeddingCache.clear();
};

const detectSemanticEmbeddingModel = async (): Promise<string | null> => {
  if (semanticModelPromise) {
    return semanticModelPromise;
  }

  semanticModelPromise = (async () => {
    const baseUrls = Array.from(new Set([DEFAULT_OLLAMA_BASE_URL, "/ollama"]));
    for (const baseUrl of baseUrls) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
        if (!response.ok) continue;
        const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
        const modelNames = (payload.models || [])
          .flatMap((model) => [model.name, model.model])
          .filter((name): name is string => Boolean(name));

        for (const candidate of EMBEDDING_MODEL_CANDIDATES) {
          const match = modelNames.find((name) => name.includes(candidate));
          if (match) return match;
        }
      } catch {
        // fall through to the next candidate base URL
      }
    }

    semanticModelPromise = null;
    return null;
  })();

  return semanticModelPromise;
};

const embedTexts = async (texts: string[]): Promise<{ model: string; embeddings: Map<string, number[]> } | null> => {
  const model = await detectSemanticEmbeddingModel();
  if (!model) return null;

  const uncached = texts.filter((text) => !semanticEmbeddingCache.has(text));
  if (uncached.length > 0) {
    const baseUrls = Array.from(new Set([DEFAULT_OLLAMA_BASE_URL, "/ollama"]));
    let embedded = false;

    for (const baseUrl of baseUrls) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            input: uncached,
          }),
        });
        if (!response.ok) continue;

        const payload = (await response.json()) as { embeddings?: number[][] };
        (payload.embeddings || []).forEach((embedding, index) => {
          if (Array.isArray(embedding) && embedding.length) {
            semanticEmbeddingCache.set(uncached[index], embedding);
          }
        });
        embedded = true;
        break;
      } catch {
        // fall through to next base URL
      }
    }

    if (!embedded && uncached.some((text) => !semanticEmbeddingCache.has(text))) {
      return null;
    }
  }

  return {
    model,
    embeddings: new Map(
      texts
        .map((text) => [text, semanticEmbeddingCache.get(text)] as const)
        .filter((entry): entry is readonly [string, number[]] => Array.isArray(entry[1]) && entry[1].length > 0),
    ),
  };
};

const buildRelationAdjacency = (relations: Relation[]): Map<string, Set<string>> => {
  const adjacency = new Map<string, Set<string>>();
  relations.forEach((relation) => {
    const left = normalizeLookupText(relation.source);
    const right = normalizeLookupText(relation.target);
    if (!left || !right || left === right) return;
    adjacency.set(left, new Set([...(adjacency.get(left) ?? []), right]));
    adjacency.set(right, new Set([...(adjacency.get(right) ?? []), left]));
  });
  return adjacency;
};

const buildIndexedEvidenceItems = (
  payload: SidecarExtractionPayload,
  eventRecords: TemporalEventRecord[],
  relations: Relation[],
  resolveEntityName: (entityId: string) => string,
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): IndexedEvidenceItem[] => {
  const entityNamesByTextUnit = new Map<string, string[]>();
  (payload.entities || []).forEach((entity) => {
    (entity.source_text_unit_ids || []).forEach((textUnitId) => {
      entityNamesByTextUnit.set(
        textUnitId,
        unique([...(entityNamesByTextUnit.get(textUnitId) ?? []), entity.canonical_name, ...(entity.aliases || [])]),
      );
    });
  });

  const eventIdsByTextUnit = new Map<string, string[]>();
  (eventRecords || []).forEach((event) => {
    eventIdsByTextUnit.set(
      event.source_text_unit_id,
      unique([...(eventIdsByTextUnit.get(event.source_text_unit_id) ?? []), event.event_id]),
    );
  });

  const items: IndexedEvidenceItem[] = [
    ...(payload.text_units || []).map((unit) => ({
      item_id: unit.text_unit_id,
      item_type: "text_unit" as const,
      source_doc_id: payload.source_doc_id,
      source_text_unit_id: unit.text_unit_id,
      evidence_id: undefined,
      snippet: makeSnippet(unit.raw_text || unit.text),
      related_entities: entityNamesByTextUnit.get(unit.text_unit_id) ?? [],
      related_events: eventIdsByTextUnit.get(unit.text_unit_id) ?? [],
      normalized_time_start: undefined,
      normalized_time_end: undefined,
      contradiction_ids: [],
      confidence: 0.62,
      search_text: unit.text,
    })),
    ...(payload.entities || []).map((entity) => ({
      item_id: entity.entity_id,
      item_type: "entity" as const,
      source_doc_id: payload.source_doc_id,
      source_text_unit_id: entity.source_text_unit_ids?.[0],
      evidence_id: undefined,
      snippet: makeSnippet([entity.canonical_name, ...(entity.aliases || [])].join(" / ")),
      related_entities: unique([entity.canonical_name, ...(entity.aliases || [])]),
      related_events: [],
      normalized_time_start: entity.timestamps?.[0],
      normalized_time_end: undefined,
      contradiction_ids: entity.contradicting_entity_ids || [],
      confidence: entity.confidence,
      search_text: [entity.canonical_name, ...(entity.aliases || [])].join(" "),
    })),
    ...(payload.mentions || []).map((mention) => ({
      item_id: mention.mention_id,
      item_type: "mention" as const,
      source_doc_id: payload.source_doc_id,
      source_text_unit_id: mention.source_text_unit_id,
      evidence_id: mention.evidence.evidence_id,
      snippet: makeSnippet(mention.evidence.raw_supporting_snippet || mention.mention_text),
      related_entities: unique([mention.mention_text, mention.entity_id ? resolveEntityName(mention.entity_id) : ""]),
      related_events: eventIdsByTextUnit.get(mention.source_text_unit_id) ?? [],
      normalized_time_start: mention.timestamp,
      normalized_time_end: undefined,
      contradiction_ids: mention.evidence.contradicts || [],
      confidence: mention.confidence,
      search_text: `${mention.mention_text} ${mention.evidence.normalized_supporting_snippet}`,
    })),
    ...(payload.relation_candidates || []).map((relation) => {
      const sourceName = resolveEntityName(relation.source_entity_id);
      const targetName = resolveEntityName(relation.target_entity_id);
      return {
        item_id: relation.relation_id,
        item_type: "relation" as const,
        source_doc_id: payload.source_doc_id,
        source_text_unit_id: relation.source_text_unit_id,
        evidence_id: relation.evidence.evidence_id,
        snippet: makeSnippet(relation.evidence.raw_supporting_snippet || `${sourceName} ${relation.relation_type} ${targetName}`),
        related_entities: unique([sourceName, targetName]),
        related_events: eventIdsByTextUnit.get(relation.source_text_unit_id) ?? [],
        normalized_time_start: relation.timestamp || relation.evidence.timestamp,
        normalized_time_end: undefined,
        contradiction_ids: unique([...(relation.contradicts || []), ...(relation.evidence.contradicts || [])]),
        confidence: relation.confidence,
        search_text: `${sourceName} ${relation.relation_type.replace(/_/g, " ")} ${targetName} ${relation.evidence.normalized_supporting_snippet}`,
      };
    }),
    ...(eventRecords || []).map((event) => ({
      item_id: event.event_id,
      item_type: "event" as const,
      source_doc_id: event.source_doc_id,
      source_text_unit_id: event.source_text_unit_id,
      evidence_id: event.supporting_evidence_ids?.[0],
      snippet: makeSnippet([event.time_expression_raw, event.title, event.trigger_text].filter(Boolean).join(" — ")),
      related_entities: unique([...event.actor_entities, ...event.target_entities, ...event.location_entities]),
      related_events: [event.event_id],
      normalized_time_start: event.normalized_start,
      normalized_time_end: event.normalized_end,
      contradiction_ids: event.contradiction_ids,
      confidence: event.confidence,
      search_text: [
        event.title,
        event.trigger_text,
        event.time_expression_raw,
        event.actor_entities.join(" "),
        event.target_entities.join(" "),
        event.location_entities.join(" "),
      ]
        .filter(Boolean)
        .join(" "),
    })),
    ...(payload.claim_candidates || []).map((claim) => ({
      item_id: claim.claim_id,
      item_type: "claim" as const,
      source_doc_id: payload.source_doc_id,
      source_text_unit_id: claim.source_text_unit_id,
      evidence_id: claim.evidence.evidence_id,
      snippet: makeSnippet(claim.claim_text),
      related_entities: unique([
        ...(claim.speaker_entity_ids || []).map(resolveEntityName),
        ...(claim.subject_entity_ids || []).map(resolveEntityName),
        ...(claim.object_entity_ids || []).map(resolveEntityName),
      ]),
      related_events: eventIdsByTextUnit.get(claim.source_text_unit_id) ?? [],
      normalized_time_start: claim.timestamp || claim.evidence.timestamp,
      normalized_time_end: undefined,
      contradiction_ids: unique([...(claim.contradicts || []), ...(claim.evidence.contradicts || [])]),
      confidence: claim.confidence,
      search_text: `${claim.claim_text} ${claim.evidence.normalized_supporting_snippet}`,
    })),
    ...Object.values(referenceKnowledge || {}).flatMap((profile) => {
      const referenceSnippets = [
        ...profile.descriptions.map((description) => ({
          item_id: `reference_desc_${profile.entity_id}_${stableHash(description)}`,
          item_type: "reference" as const,
          source_doc_id: payload.source_doc_id,
          source_text_unit_id: undefined,
          evidence_id: undefined,
          source_namespace: profile.links[0]?.namespace,
          external_reference_ids: profile.links.map((link) => `${link.namespace}:${link.external_id}`),
          reference_only: true,
          snippet: makeSnippet(description),
          related_entities: unique([profile.canonical_name, ...profile.aliases]),
          related_events: [],
          normalized_time_start: undefined,
          normalized_time_end: undefined,
          contradiction_ids: [],
          confidence: Math.max(0.45, ...profile.links.map((link) => link.match_confidence), 0.55),
          search_text: [profile.canonical_name, ...profile.aliases, description, ...profile.affiliations].join(" "),
        })),
        ...profile.assertions.map((assertion) => ({
          item_id: `reference_assert_${assertion.assertion_id}`,
          item_type: "reference" as const,
          source_doc_id: payload.source_doc_id,
          source_text_unit_id: undefined,
          evidence_id: undefined,
          source_namespace: assertion.source_namespace,
          external_reference_ids: assertion.external_reference_ids,
          reference_only: true,
          snippet: makeSnippet(`${assertion.predicate}: ${assertion.value}`),
          related_entities: unique([profile.canonical_name, ...profile.aliases]),
          related_events: [],
          normalized_time_start: undefined,
          normalized_time_end: undefined,
          contradiction_ids: [],
          confidence: assertion.confidence,
          search_text: [profile.canonical_name, ...profile.aliases, assertion.predicate, assertion.value].join(" "),
        })),
      ];

      return referenceSnippets;
    }),
  ];

  return items.filter((item) => item.search_text.trim().length > 0);
};

const buildBaseScoredItems = (
  items: IndexedEvidenceItem[],
  relations: Relation[],
  query: string,
  options: SearchOptions = {},
): ScoredEvidenceItem[] => {
  const terms = tokenize(query);
  const hintedEntities = unique(options.relatedEntities ?? []);
  const hintedEvents = unique(options.relatedEvents ?? []);
  const adjacency = buildRelationAdjacency(relations);
  const timeStart = parseTime(options.timeWindow?.start);
  const timeEnd = parseTime(options.timeWindow?.end);
  const latestTimestamp = items
    .map((item) => parseTime(item.normalized_time_start))
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => right - left)[0];

  return items
    .map<ScoredEvidenceItem | null>((item) => {
      const normalizedText = normalizeLookupText(item.search_text);
      const matchedTerms = terms.filter((term) => normalizedText.includes(term));
      const explanation: string[] = [];

      const lexicalScore = terms.length ? matchedTerms.length / terms.length : 0;
      if (matchedTerms.length > 0) {
        explanation.push(`Matched ${matchedTerms.length}/${terms.length} query terms.`);
      }

      const entityOverlap = hintedEntities.filter((entity) =>
        item.related_entities.some((candidate) => normalizeLookupText(candidate) === normalizeLookupText(entity)),
      );
      const eventOverlap = hintedEvents.filter((eventId) => item.related_events.includes(eventId));
      const graphScore = hintedEntities.some((entity) => {
        const adjacencySet = adjacency.get(normalizeLookupText(entity));
        if (!adjacencySet) return false;
        return item.related_entities.some((candidate) => adjacencySet.has(normalizeLookupText(candidate)));
      })
        ? 0.08
        : 0;

      const itemTime = parseTime(item.normalized_time_start);
      let temporalScore = 0;
      if (timeStart || timeEnd) {
        if (itemTime && (!timeStart || itemTime >= timeStart) && (!timeEnd || itemTime <= timeEnd)) {
          temporalScore += 0.1;
          explanation.push("Temporal window match boosted this hit.");
        } else if (itemTime && (timeStart || timeEnd)) {
          temporalScore -= 0.04;
        }
      }

      let intentScore = 0;
      if (options.mode === "timeline" && item.item_type === "event") {
        intentScore += 0.14;
        explanation.push("Event item boosted for timeline retrieval.");
      }
      if (options.mode === "relationship" && item.item_type === "relation") {
        intentScore += 0.18;
        explanation.push("Relation item boosted for relationship retrieval.");
      }
      if (options.mode === "contradiction" && item.contradiction_ids.length > 0) {
        intentScore += 0.28;
        explanation.push("Contradiction evidence boosted.");
      }
      if (options.mode === "entity" && item.item_type === "entity") {
        intentScore += 0.1;
      }
      if (options.mode === "case" && (item.item_type === "event" || item.item_type === "relation" || item.item_type === "claim")) {
        intentScore += 0.08;
      }
      if (options.mode === "case" && item.item_type === "text_unit") {
        intentScore += 0.04;
      }
      if (options.mode === "update" && itemTime && latestTimestamp) {
        const ageDays = Math.abs(latestTimestamp - itemTime) / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.max(0, 0.18 - ageDays * 0.01);
        if (recencyBoost > 0) {
          intentScore += recencyBoost;
          explanation.push("Recent evidence boosted for update review.");
        }
      }

      if (item.reference_only) {
        intentScore += 0.03;
        explanation.push("Reference knowledge kept as supporting context rather than primary case evidence.");
      }

      const overlapScore = 0.18 * Math.min(entityOverlap.length, 2) + 0.12 * Math.min(eventOverlap.length, 2);
      if (entityOverlap.length > 0) {
        explanation.push(`Entity overlap with ${entityOverlap.join(", ")}.`);
      }
      if (eventOverlap.length > 0) {
        explanation.push(`Event overlap with ${eventOverlap.join(", ")}.`);
      }
      if (graphScore > 0) {
        explanation.push("Graph-adjacent entity context boosted this hit.");
      }

      const confidenceScore = item.confidence * 0.12 + Math.min(0.06, item.related_entities.length * 0.0125);
      const structuralScore = overlapScore + graphScore + temporalScore + confidenceScore;

      if (lexicalScore + structuralScore + intentScore <= 0) {
        return null;
      }

      return {
        item,
        matchedTerms,
        explanation,
        lexicalScore,
        structuralScore,
        intentScore,
        graphScore,
        temporalScore,
        confidenceScore,
        semanticScore: 0,
        fusedScore: 0,
        lexicalRank: 999,
        structuralRank: 999,
      };
    })
    .filter((item): item is ScoredEvidenceItem => Boolean(item));
};

const applyRankFusion = (items: ScoredEvidenceItem[], semanticEnabled = false): ScoredEvidenceItem[] => {
  const lexicalOrder = [...items].sort(
    (left, right) => right.lexicalScore - left.lexicalScore || right.confidenceScore - left.confidenceScore,
  );
  const structuralOrder = [...items].sort(
    (left, right) =>
      right.structuralScore + right.intentScore - (left.structuralScore + left.intentScore) ||
      right.confidenceScore - left.confidenceScore,
  );
  const semanticOrder = semanticEnabled
    ? [...items].sort((left, right) => right.semanticScore - left.semanticScore || right.lexicalScore - left.lexicalScore)
    : [];

  const lexicalRanks = new Map(lexicalOrder.map((item, index) => [item.item.item_id, index + 1]));
  const structuralRanks = new Map(structuralOrder.map((item, index) => [item.item.item_id, index + 1]));
  const semanticRanks = new Map(semanticOrder.map((item, index) => [item.item.item_id, index + 1]));

  return items.map((item) => {
    const lexicalRank = lexicalRanks.get(item.item.item_id) ?? 999;
    const structuralRank = structuralRanks.get(item.item.item_id) ?? 999;
    const semanticRank = semanticEnabled ? semanticRanks.get(item.item.item_id) ?? 999 : undefined;
    const fusedScore =
      reciprocalRank(lexicalRank) +
      reciprocalRank(structuralRank) +
      item.intentScore * 0.45 +
      item.graphScore * 0.3 +
      item.temporalScore * 0.25 +
      item.confidenceScore * 0.3 +
      (semanticEnabled && semanticRank ? reciprocalRank(semanticRank) + item.semanticScore * 0.6 : 0);

    return {
      ...item,
      lexicalRank,
      structuralRank,
      semanticRank,
      fusedScore: roundScore(fusedScore),
    };
  });
};

const selectDiversifiedHits = (items: ScoredEvidenceItem[], limit: number): ScoredEvidenceItem[] => {
  const selected: ScoredEvidenceItem[] = [];
  const remaining = [...items].sort((left, right) => right.fusedScore - left.fusedScore);

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const sameTextUnitPenalty = selected.some((item) =>
        item.item.source_text_unit_id &&
        item.item.source_text_unit_id === candidate.item.source_text_unit_id &&
        (candidate.item.item_type === "text_unit" || item.item.item_type === candidate.item.item_type),
      )
        ? 0.06
        : selected.some((item) => item.item.source_text_unit_id && item.item.source_text_unit_id === candidate.item.source_text_unit_id)
          ? 0.02
          : 0;
      const sameTypePenalty = selected.filter((item) => item.item.item_type === candidate.item.item_type).length * 0.025;
      const entityOverlapPenalty = selected.some((item) =>
        item.item.related_entities.some((entityName) =>
          candidate.item.related_entities.some((candidateName) => normalizeLookupText(candidateName) === normalizeLookupText(entityName)),
        ),
      )
        ? 0.03
        : 0;
      const diversityScore = candidate.fusedScore - sameTextUnitPenalty - sameTypePenalty - entityOverlapPenalty;
      if (diversityScore > bestScore) {
        bestIndex = index;
        bestScore = diversityScore;
      }
    });

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
};

const toRetrievalHits = (items: ScoredEvidenceItem[]): RetrievalEvidenceHit[] =>
  items.map((entry) => {
    const explanation = [...entry.explanation];
    if (entry.semanticScore > 0.12) {
      explanation.push("Semantic similarity reinforced this hit.");
    }

    return {
      item_id: entry.item.item_id,
      item_type: entry.item.item_type,
      source_doc_id: entry.item.source_doc_id,
      source_text_unit_id: entry.item.source_text_unit_id,
      evidence_id: entry.item.evidence_id,
      source_namespace: entry.item.source_namespace,
      external_reference_ids: entry.item.external_reference_ids,
      reference_only: entry.item.reference_only,
      snippet: entry.item.snippet,
      related_entities: entry.item.related_entities,
      related_events: entry.item.related_events,
      normalized_time_start: entry.item.normalized_time_start,
      normalized_time_end: entry.item.normalized_time_end,
      contradiction_ids: entry.item.contradiction_ids,
      confidence: entry.item.confidence,
      score: entry.fusedScore,
      matched_terms: entry.matchedTerms,
      explanation: explanation.slice(0, 4),
      score_breakdown: {
        lexical_score: roundScore(entry.lexicalScore),
        structural_score: roundScore(entry.structuralScore),
        semantic_score: entry.semanticScore ? roundScore(entry.semanticScore) : undefined,
        intent_score: roundScore(entry.intentScore),
        graph_score: roundScore(entry.graphScore),
        temporal_score: roundScore(entry.temporalScore),
        confidence_score: roundScore(entry.confidenceScore),
        fused_score: entry.fusedScore,
      },
    };
  });

const scoreEvidenceItems = (
  items: IndexedEvidenceItem[],
  relations: Relation[],
  query: string,
  options: SearchOptions = {},
): RetrievalEvidenceHit[] => {
  const baseItems = buildBaseScoredItems(items, relations, query, options);
  const fusedItems = applyRankFusion(baseItems)
    .sort((left, right) => right.fusedScore - left.fusedScore || right.item.confidence - left.item.confidence);
  return toRetrievalHits(selectDiversifiedHits(fusedItems, options.limit ?? 6));
};

const scoreEvidenceItemsWithSemanticSearch = async (
  items: IndexedEvidenceItem[],
  relations: Relation[],
  query: string,
  options: SearchOptions = {},
): Promise<{ hits: RetrievalEvidenceHit[]; semanticEnabled: boolean; embeddingModel?: string }> => {
  const baseItems = buildBaseScoredItems(items, relations, query, options);
  const shortlist = applyRankFusion(baseItems)
    .sort((left, right) => right.fusedScore - left.fusedScore || right.item.confidence - left.item.confidence)
    .slice(0, Math.max((options.limit ?? 6) * 3, 12));

  const embeddingTexts = [query, ...shortlist.map((entry) => buildSemanticText(entry.item))];
  const semanticResult = await embedTexts(embeddingTexts);
  const queryEmbedding = semanticResult?.embeddings.get(query);

  if (semanticResult && queryEmbedding) {
    shortlist.forEach((entry) => {
      const semanticText = buildSemanticText(entry.item);
      const candidateEmbedding = semanticResult.embeddings.get(semanticText);
      entry.semanticScore = candidateEmbedding ? cosineSimilarity(queryEmbedding, candidateEmbedding) : 0;
    });
  }

  const fusedItems = applyRankFusion(shortlist, Boolean(semanticResult && queryEmbedding))
    .sort((left, right) => right.fusedScore - left.fusedScore || right.item.confidence - left.item.confidence);

  return {
    hits: toRetrievalHits(selectDiversifiedHits(fusedItems, options.limit ?? 6)),
    semanticEnabled: Boolean(semanticResult && queryEmbedding),
    embeddingModel: semanticResult?.model,
  };
};

const finalizeBundle = (
  kind: RetrievalBundleKind,
  title: string,
  query: string,
  hits: RetrievalEvidenceHit[],
  options: SearchOptions = {},
): RetrievalEvidenceBundle => {
  const contradictions = unique(
    hits
      .filter((hit) => hit.contradiction_ids.length > 0)
      .map((hit) => `${hit.item_type.toUpperCase()} evidence indicates temporal or factual conflict.`),
  );
  const confidence =
    hits.length > 0
      ? Number((hits.reduce((sum, hit) => sum + hit.score, 0) / hits.length).toFixed(4))
      : 0.35;

  return {
    bundle_id: `bundle_${kind}_${stableHash(`${title}:${query}`)}`,
    kind,
    title,
    query,
    hits,
    cited_evidence_ids: unique(
      hits
        .filter((hit) => !hit.reference_only)
        .map((hit) => hit.evidence_id)
        .filter(Boolean) as string[],
    ),
    related_entities: unique(hits.flatMap((hit) => hit.related_entities)),
    related_events: unique(hits.flatMap((hit) => hit.related_events)),
    contradictions,
    confidence,
    temporal_window: options.timeWindow,
    warnings: hits.length > 0 ? [] : [`No high-signal evidence hits were retrieved for ${title.toLowerCase()}.`],
  };
};

const buildBundle = (
  kind: RetrievalBundleKind,
  title: string,
  query: string,
  items: IndexedEvidenceItem[],
  relations: Relation[],
  options: SearchOptions = {},
): RetrievalEvidenceBundle => finalizeBundle(kind, title, query, scoreEvidenceItems(items, relations, query, options), options);

export const buildRetrievalArtifactsFromPayload = (
  payload: SidecarExtractionPayload,
  eventRecords: TemporalEventRecord[],
  relations: Relation[],
  resolveEntityName: (entityId: string) => string,
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): RetrievalArtifacts => {
  const items = buildIndexedEvidenceItems(payload, eventRecords, relations, resolveEntityName, referenceKnowledge);
  const topEntityNames = payload.entities
    .slice()
    .sort((left, right) => right.confidence - left.confidence)
    .map((entity) => entity.canonical_name)
    .slice(0, 5);
  const primaryEntity = topEntityNames[0];
  const topRelationTexts = payload.relation_candidates
    .slice(0, 3)
    .map((relation) => `${resolveEntityName(relation.source_entity_id)} ${relation.relation_type.replace(/_/g, " ")} ${resolveEntityName(relation.target_entity_id)}`);
  const latestEvent = [...eventRecords]
    .filter((event) => event.normalized_start)
    .sort((left, right) => (parseTime(right.normalized_start) || 0) - (parseTime(left.normalized_start) || 0))[0];
  const contradictoryEvents = eventRecords.filter((event) => event.contradiction_ids.length > 0);

  const caseQuery = unique([
    ...topEntityNames.slice(0, 3),
    ...eventRecords.slice(0, 2).map((event) => event.event_type.replace(/_/g, " ")),
    ...payload.claim_candidates.slice(0, 1).map((claim) => claim.claim_text),
  ])
    .filter(Boolean)
    .join(" ");

  const bundlePlans: Array<{
    key: RetrievalBundleKind;
    title: string;
    query: string;
    options: SearchOptions;
  }> = [
    {
      key: "case_brief",
      title: "Case Brief",
      query: caseQuery,
      options: {
        mode: "case",
        relatedEntities: topEntityNames.slice(0, 4),
        relatedEvents: eventRecords.slice(0, 4).map((event) => event.event_id),
        limit: 6,
      },
    },
    {
      key: "entity_brief",
      title: "Entity Brief",
      query: primaryEntity || caseQuery || "primary entity",
      options: {
        mode: "entity",
        relatedEntities: primaryEntity ? [primaryEntity] : topEntityNames.slice(0, 2),
        limit: 5,
      },
    },
    {
      key: "relationship_brief",
      title: "Relationship Brief",
      query: topRelationTexts.join(" ") || caseQuery || "relationship network",
      options: {
        mode: "relationship",
        relatedEntities: topEntityNames.slice(0, 4),
        limit: 5,
      },
    },
    {
      key: "timeline_summary",
      title: "Timeline Summary",
      query: unique([
        ...eventRecords.slice(0, 4).map((event) => event.title || event.trigger_text),
        ...topEntityNames.slice(0, 2),
      ]).join(" "),
      options: {
        mode: "timeline",
        relatedEvents: eventRecords.slice(0, 6).map((event) => event.event_id),
        relatedEntities: topEntityNames.slice(0, 3),
        timeWindow: {
          start: eventRecords[0]?.normalized_start,
          end: latestEvent?.normalized_start,
        },
        limit: 6,
      },
    },
    {
      key: "contradiction_summary",
      title: "Contradiction Summary",
      query: contradictoryEvents.map((event) => event.title || event.trigger_text).join(" ") || caseQuery || "contradictions",
      options: {
        mode: "contradiction",
        relatedEvents: contradictoryEvents.flatMap((event) => [event.event_id, ...event.contradiction_ids]),
        relatedEntities: unique(contradictoryEvents.flatMap((event) => [...event.actor_entities, ...event.target_entities])),
        limit: 5,
      },
    },
    {
      key: "update_summary",
      title: "Update Since Last Review",
      query: latestEvent
        ? unique([
            latestEvent.title || latestEvent.trigger_text,
            ...latestEvent.actor_entities,
            ...latestEvent.target_entities,
          ]).join(" ")
        : caseQuery || "latest update",
      options: {
        mode: "update",
        relatedEvents: latestEvent ? [latestEvent.event_id] : [],
        relatedEntities: latestEvent ? unique([...latestEvent.actor_entities, ...latestEvent.target_entities]) : topEntityNames.slice(0, 2),
        timeWindow: latestEvent
          ? {
              start: latestEvent.normalized_start,
              end: latestEvent.normalized_end || latestEvent.normalized_start,
            }
          : undefined,
        limit: 4,
      },
    },
  ];

  const bundles = Object.fromEntries(
    bundlePlans.map((plan) => [
      plan.key,
      buildBundle(plan.key, plan.title, plan.query, items, relations, plan.options),
    ]),
  ) as Record<string, RetrievalEvidenceBundle>;

  const runtimeWarnings = payload.runtime_diagnostics?.warnings || [];

  return {
    backend: "hybrid_graph_ranker_v1",
    warnings: unique([...runtimeWarnings, ...Object.values(bundles).flatMap((bundle) => bundle.warnings)]),
    item_count: items.length,
    contradiction_item_count: items.filter((item) => item.contradiction_ids.length > 0).length,
    bundle_count: Object.keys(bundles).length,
    bundles,
    diagnostics: {
      semantic_enabled: false,
      fusion_strategy: ["reciprocal-rank-fusion", "graph overlap", "temporal priors", "diversified evidence packing"],
      adapter_status: payload.runtime_diagnostics?.adapter_status,
    },
  };
};

export const buildRetrievalArtifactsFromPayloadWithSemanticSearch = async (
  payload: SidecarExtractionPayload,
  eventRecords: TemporalEventRecord[],
  relations: Relation[],
  resolveEntityName: (entityId: string) => string,
  referenceKnowledge?: Record<string, ReferenceKnowledgeProfile>,
): Promise<RetrievalArtifacts> => {
  const baseArtifacts = buildRetrievalArtifactsFromPayload(payload, eventRecords, relations, resolveEntityName, referenceKnowledge);
  const items = buildIndexedEvidenceItems(payload, eventRecords, relations, resolveEntityName, referenceKnowledge);

  const upgradedBundles = await Promise.all(
    Object.values(baseArtifacts.bundles).map(async (bundle) => {
      const result = await scoreEvidenceItemsWithSemanticSearch(items, relations, bundle.query, {
        mode: bundleKindToMode(bundle.kind),
        relatedEntities: bundle.related_entities,
        relatedEvents: bundle.related_events,
        timeWindow: bundle.temporal_window,
        limit: bundle.hits.length || 6,
      });

      return {
        bundle: finalizeBundle(bundle.kind, bundle.title, bundle.query, result.hits, {
          mode: bundleKindToMode(bundle.kind),
          relatedEntities: bundle.related_entities,
          relatedEvents: bundle.related_events,
          timeWindow: bundle.temporal_window,
          limit: bundle.hits.length || 6,
        }),
        semanticEnabled: result.semanticEnabled,
        embeddingModel: result.embeddingModel,
      };
    }),
  );

  const bundles = Object.fromEntries(
    upgradedBundles.map((entry) => [entry.bundle.kind, entry.bundle]),
  ) as Record<string, RetrievalEvidenceBundle>;
  const semanticEnabled = upgradedBundles.some((entry) => entry.semanticEnabled);
  const embeddingModel = upgradedBundles.find((entry) => entry.embeddingModel)?.embeddingModel;
  const runtimeWarnings = payload.runtime_diagnostics?.warnings || [];

  return {
    backend: semanticEnabled ? "hybrid_graph_semantic_v1" : baseArtifacts.backend,
    warnings: unique([
      ...runtimeWarnings,
      ...Object.values(bundles).flatMap((bundle) => bundle.warnings),
      ...(semanticEnabled ? [] : ["Semantic retrieval was unavailable; using graph-aware reciprocal-rank fusion only."]),
    ]),
    item_count: baseArtifacts.item_count,
    contradiction_item_count: baseArtifacts.contradiction_item_count,
    bundle_count: baseArtifacts.bundle_count,
    bundles,
    diagnostics: {
      semantic_enabled: semanticEnabled,
      embedding_model: embeddingModel,
      fusion_strategy: semanticEnabled
        ? ["reciprocal-rank-fusion", "semantic embeddings", "graph overlap", "temporal priors", "diversified evidence packing"]
        : ["reciprocal-rank-fusion", "graph overlap", "temporal priors", "diversified evidence packing"],
      adapter_status: payload.runtime_diagnostics?.adapter_status,
    },
  };
};
