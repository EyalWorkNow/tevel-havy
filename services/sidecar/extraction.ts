import {
  CandidateMetadataValue,
  EvidenceSpan,
  ExtractionSource,
  SidecarEntityRecord,
  SidecarExtractionCandidate,
  SidecarMention,
  SidecarRelationCandidate,
  SourceOffsetMap,
  SidecarTextUnit,
} from "./types";
import { mapNormalizedSpanToRawSpan, normalizeLookupText } from "./textUnits";

const TITLE_CASE_CONNECTORS = new Set(["of", "the", "and", "for", "de", "del", "al", "bin", "ibn"]);
const TITLE_CASE_STOPWORDS = new Set([
  "report",
  "document",
  "summary",
  "section",
  "chapter",
  "appendix",
  "analysis",
  "assessment",
  "annex",
]);

const ORGANIZATION_HINTS = [
  "group",
  "logistics",
  "finance",
  "bank",
  "ministry",
  "institute",
  "battalion",
  "brigade",
  "university",
  "agency",
  "force",
  "council",
  "company",
  "brokers",
  "holdings",
  "ltd",
  "llc",
  "inc",
  "corp",
  "hospital",
  "center",
  "centre",
];

const LOCATION_HINTS = [
  "pier",
  "warehouse",
  "port",
  "camp",
  "base",
  "airport",
  "station",
  "crossing",
  "street",
  "road",
  "avenue",
  "boulevard",
  "building",
  "tower",
  "campus",
  "clinic",
  "hospital",
  "university",
  "valley",
  "village",
  "county",
  "province",
  "harbor",
  "tel aviv",
  "jerusalem",
  "haifa",
  "ashdod",
  "eilat",
  "gaza",
  "rafah",
  "amman",
  "tehran",
  "damascus",
  "beirut",
];
const VEHICLE_HINTS = [
  "toyota",
  "ford",
  "chevrolet",
  "mercedes",
  "bmw",
  "audi",
  "volkswagen",
  "honda",
  "hyundai",
  "kia",
  "nissan",
  "mazda",
  "mitsubishi",
  "isuzu",
  "volvo",
  "scania",
  "tesla",
  "byd",
  "renault",
  "peugeot",
  "citroen",
  "fiat",
  "skoda",
  "man",
  "daf",
  "iveco",
  "dji",
  "caterpillar",
  "komatsu",
  "truck",
  "sedan",
  "pickup",
  "van",
  "bus",
  "tractor",
  "trailer",
  "forklift",
  "excavator",
  "drone",
];

type PatternSpec = {
  regex: RegExp;
  entityType: string;
  role: string;
  confidence: number;
  captureGroup?: number;
};

const RULE_PATTERNS: PatternSpec[] = [
  {
    regex: /\b(?:met|contacted|emailed|called|briefed|interviewed|questioned|reviewed by|signed by|reported by|spoke with|spoke to|asked|told|directed)\s+([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|bin|ibn|al|de|del|van|von|ben|abu)){1,3})\b/g,
    entityType: "PERSON",
    role: "Person name inferred from action context",
    confidence: 0.77,
    captureGroup: 1,
  },
  { regex: /\b\d{4}-\d{2}-\d{2}\b/g, entityType: "DATE", role: "ISO date mention", confidence: 0.98 },
  { regex: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, entityType: "DATE", role: "Slash date mention", confidence: 0.97 },
  { regex: /\b(?:Ashdod|Haifa|Eilat|Jerusalem|Tel Aviv|Gaza|Rafah|Amman|Tehran|Damascus|Beirut)\b(?:\s+(?:Port|Crossing|District|Airport|Base))?/g, entityType: "LOCATION", role: "Known geo-location", confidence: 0.82 },
  { regex: /\b(?:https?:\/\/|www\.)\S+\b/g, entityType: "ASSET", role: "URL mention", confidence: 0.94 },
  { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, entityType: "ASSET", role: "Email address", confidence: 0.96 },
  { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, entityType: "ASSET", role: "IPv4 address", confidence: 0.95 },
  { regex: /\b0x[a-fA-F0-9]{8,}\b/g, entityType: "ASSET", role: "Wallet or hash-like identifier", confidence: 0.92 },
  { regex: /\b(?:\d{2,3}-\d{2,3}-\d{2,3}|[A-Z]{1,3}-\d{3,4}(?:-\d{1,3})?)\b/g, entityType: "IDENTIFIER", role: "Registration or plate identifier", confidence: 0.84 },
  { regex: /\b[A-HJ-NPR-Z0-9]{17}\b/g, entityType: "IDENTIFIER", role: "VIN-like identifier", confidence: 0.9 },
  { regex: /\b[A-Z]{4}\d{7}\b/g, entityType: "IDENTIFIER", role: "Container identifier", confidence: 0.9 },
  { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, entityType: "IDENTIFIER", role: "IBAN-like identifier", confidence: 0.88 },
  { regex: /\b(?:Toyota|Ford|Chevrolet|Mercedes(?:-Benz)?|BMW|Audi|Volkswagen|Honda|Hyundai|Kia|Nissan|Mazda|Mitsubishi|Isuzu|Volvo|Scania|Tesla|BYD|Renault|Peugeot|Citroen|Fiat|Skoda|MAN|DAF|Iveco|DJI|Caterpillar|CAT|Komatsu|John Deere)\s+[A-Z]?[A-Za-z0-9-]{1,}(?:\s+(?:van|truck|sedan|pickup|bus|tractor|trailer|forklift|drone|excavator))?\b/g, entityType: "VEHICLE", role: "Vehicle or equipment model mention", confidence: 0.83 },
  { regex: /#[\p{L}\p{N}_-]+/gu, entityType: "ASSET", role: "Hashtag or tag identifier", confidence: 0.72 },
  { regex: /\b[A-Z]{2,}(?:[-_][A-Z0-9]+)*\b/g, entityType: "ORGANIZATION", role: "Uppercase coded entity", confidence: 0.64 },
];

const TITLE_CASE_REGEX =
  /\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?(?:\s+(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?|\d+[A-Za-z-]*|of|the|and|for|de|del|al|bin|ibn)){1,4}\b/g;
const UPPERCASE_ENTITY_STOPWORDS = new Set(["VIN", "IBAN", "SWIFT", "BIC", "IMEI", "IMSI"]);

const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value));

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const parseDerivedTimestamp = (mentionText: string, entityType: string): string | undefined => {
  if (entityType !== "DATE") return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(mentionText)) {
    return mentionText;
  }

  const slash = mentionText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return undefined;

  const [, day, month, year] = slash;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const isValidTitleCaseCandidate = (value: string): boolean => {
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);

  if (parts.length < 2) return false;
  if (TITLE_CASE_CONNECTORS.has(parts[0].toLowerCase()) || TITLE_CASE_CONNECTORS.has(parts[parts.length - 1].toLowerCase())) return false;
  if (parts.every((part) => TITLE_CASE_STOPWORDS.has(part.toLowerCase()))) return false;
  if (TITLE_CASE_STOPWORDS.has(parts[0].toLowerCase())) return false;
  if (parts.some((part) => /^\d{4}$/.test(part))) return false;
  return parts.some((part) => part.length > 2);
};

const inferTitleCaseType = (value: string): string => {
  const normalized = value.toLowerCase();
  if (ORGANIZATION_HINTS.some((hint) => normalized.includes(hint))) return "ORGANIZATION";
  if (LOCATION_HINTS.some((hint) => normalized.includes(hint))) return "LOCATION";
  if (VEHICLE_HINTS.some((hint) => normalized.includes(hint))) return "VEHICLE";

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length <= 4) return "PERSON";
  return "MISC";
};

const shouldSkipPatternMatch = (matchText: string, entityType: string): boolean => {
  if (entityType !== "ORGANIZATION") return false;
  if (UPPERCASE_ENTITY_STOPWORDS.has(matchText)) return true;
  if (/\b(?:\d{2,3}-\d{2,3}-\d{2,3}|[A-Z]{1,3}-\d{3,4}(?:-\d{1,3})?)\b/.test(matchText)) return true;
  if (/\b[A-HJ-NPR-Z0-9]{17}\b/.test(matchText)) return true;
  if (/\b[A-Z]{4}\d{7}\b/.test(matchText)) return true;
  if (/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/.test(matchText)) return true;
  return false;
};

const buildEvidence = (params: {
  sourceDocId: string;
  rawText: string;
  normalizedDocumentText: string;
  offsetMap: SourceOffsetMap;
  textUnit: SidecarTextUnit;
  normalizedStart: number;
  normalizedEnd: number;
  normalizedText: string;
  extractionSource: ExtractionSource;
  confidence: number;
  timestamp?: string;
}): EvidenceSpan => {
  const rawSpan = mapNormalizedSpanToRawSpan(params.normalizedStart, params.normalizedEnd, params.offsetMap);
  const normalizedSnippetStart = Math.max(params.textUnit.normalized_start, params.normalizedStart - 90);
  const normalizedSnippetEnd = Math.min(params.textUnit.normalized_end, params.normalizedEnd + 90);
  const rawSnippetStart = Math.max(params.textUnit.raw_start, rawSpan.start - 90);
  const rawSnippetEnd = Math.min(params.textUnit.raw_end, rawSpan.end + 90);

  return {
    evidence_id: `${params.sourceDocId}:ev:${params.normalizedStart}-${params.normalizedEnd}:${rawSpan.start}-${rawSpan.end}`,
    source_doc_id: params.sourceDocId,
    source_text_unit_id: params.textUnit.text_unit_id,
    start: params.normalizedStart,
    end: params.normalizedEnd,
    normalized_start: params.normalizedStart,
    normalized_end: params.normalizedEnd,
    raw_start: rawSpan.start,
    raw_end: rawSpan.end,
    raw_supporting_snippet: params.rawText.slice(rawSnippetStart, rawSnippetEnd).trim(),
    normalized_supporting_snippet: params.normalizedDocumentText.slice(normalizedSnippetStart, normalizedSnippetEnd).trim(),
    normalized_text: params.normalizedText,
    extraction_source: params.extractionSource,
    confidence: clampConfidence(params.confidence),
    timestamp: params.timestamp,
    corroborates: [],
    contradicts: [],
  };
};

const buildMention = (params: {
  sourceDocId: string;
  rawText: string;
  normalizedDocumentText: string;
  offsetMap: SourceOffsetMap;
  textUnit: SidecarTextUnit;
  relativeStart: number;
  relativeEnd: number;
  mentionText: string;
  entityType: string;
  role: string;
  confidence: number;
  extractionSource?: ExtractionSource;
}): SidecarMention => {
  const normalizedStart = params.textUnit.normalized_start + params.relativeStart;
  const normalizedEnd = params.textUnit.normalized_start + params.relativeEnd;
  const rawSpan = mapNormalizedSpanToRawSpan(normalizedStart, normalizedEnd, params.offsetMap);
  const normalizedText = normalizeLookupText(params.mentionText);
  const extractionSource = params.extractionSource ?? "rule";
  const timestamp = parseDerivedTimestamp(params.mentionText, params.entityType);
  const metadata: Record<string, CandidateMetadataValue> = {
    role: params.role,
    entity_type: params.entityType,
    text_unit_kind: params.textUnit.kind,
    timestamp: timestamp ?? null,
  };
  if (params.textUnit.metadata?.section) {
    metadata.section = params.textUnit.metadata.section;
  }
  if (params.textUnit.metadata?.page_number !== undefined) {
    metadata.page_number = params.textUnit.metadata.page_number;
  }
  if (params.textUnit.metadata?.source_type) {
    metadata.source_type = params.textUnit.metadata.source_type;
  }

  return {
    candidate_id: `${params.sourceDocId}:c:${normalizedStart}-${normalizedEnd}:${rawSpan.start}-${rawSpan.end}:${stableHash(`${params.entityType}:${normalizedText}`)}`,
    mention_id: `${params.sourceDocId}:m:${normalizedStart}-${normalizedEnd}:${rawSpan.start}-${rawSpan.end}:${stableHash(`${params.entityType}:${normalizedText}`)}`,
    source_doc_id: params.sourceDocId,
    source_text_unit_id: params.textUnit.text_unit_id,
    char_start: normalizedStart,
    char_end: normalizedEnd,
    normalized_char_start: normalizedStart,
    normalized_char_end: normalizedEnd,
    raw_char_start: rawSpan.start,
    raw_char_end: rawSpan.end,
    raw_text: params.rawText.slice(rawSpan.start, rawSpan.end),
    mention_text: params.mentionText,
    normalized_text: normalizedText,
    label: params.entityType,
    candidate_type: "entity_mention",
    entity_type: params.entityType,
    role: params.role,
    extraction_source: extractionSource,
    confidence: clampConfidence(params.confidence),
    metadata,
    timestamp,
    evidence: buildEvidence({
      sourceDocId: params.sourceDocId,
      rawText: params.rawText,
      normalizedDocumentText: params.normalizedDocumentText,
      offsetMap: params.offsetMap,
      textUnit: params.textUnit,
      normalizedStart,
      normalizedEnd,
      normalizedText,
      extractionSource,
      confidence: params.confidence,
      timestamp,
    }),
  };
};

export const extractRuleMentions = (
  sourceDocId: string,
  rawText: string,
  normalizedDocumentText: string,
  offsetMap: SourceOffsetMap,
  textUnits: SidecarTextUnit[],
): SidecarMention[] => {
  const mentions: SidecarMention[] = [];
  const seen = new Set<string>();

  const pushMention = (mention: SidecarMention) => {
    if (!mention.normalized_text) return;
    const key = `${mention.entity_type}:${mention.evidence.start}:${mention.evidence.end}:${mention.normalized_text}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push(mention);
  };

  textUnits.forEach((textUnit) => {
    RULE_PATTERNS.forEach((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`);
      let match: RegExpExecArray | null = null;

      while ((match = regex.exec(textUnit.text)) !== null) {
        const matchedText = (pattern.captureGroup ? match[pattern.captureGroup] : match[0]).trim();
        const matchStart = pattern.captureGroup
          ? match.index + match[0].indexOf(match[pattern.captureGroup])
          : match.index;
        const matchEnd = matchStart + matchedText.length;
        if (shouldSkipPatternMatch(matchedText, pattern.entityType)) continue;
        pushMention(
          buildMention({
            sourceDocId,
            rawText,
            normalizedDocumentText,
            offsetMap,
            textUnit,
            relativeStart: matchStart,
            relativeEnd: matchEnd,
            mentionText: matchedText,
            entityType: pattern.entityType,
            role: pattern.role,
            confidence: pattern.confidence,
          }),
        );
      }
    });

    let titleCaseMatch: RegExpExecArray | null = null;
    const titleRegex = new RegExp(TITLE_CASE_REGEX.source, "g");
    while ((titleCaseMatch = titleRegex.exec(textUnit.text)) !== null) {
      const candidate = titleCaseMatch[0].trim();
      if (!isValidTitleCaseCandidate(candidate)) continue;

      const entityType = inferTitleCaseType(candidate);
      pushMention(
        buildMention({
          sourceDocId,
          rawText,
          normalizedDocumentText,
          offsetMap,
          textUnit,
          relativeStart: titleCaseMatch.index,
          relativeEnd: titleCaseMatch.index + titleCaseMatch[0].length,
          mentionText: candidate,
          entityType,
          role: "Deterministic title-cased entity candidate",
          confidence: entityType === "ORGANIZATION" ? 0.8 : entityType === "LOCATION" ? 0.77 : 0.73,
        }),
      );
    }
  });

  return mentions.sort(
    (a, b) => a.evidence.normalized_start - b.evidence.normalized_start || a.evidence.normalized_end - b.evidence.normalized_end,
  );
};

export const collapseMentionsToEntities = (
  sourceDocId: string,
  mentions: SidecarMention[],
): { mentions: SidecarMention[]; entities: SidecarEntityRecord[] } => {
  const grouped = new Map<
    string,
    {
      canonicalName: string;
      mentionIds: string[];
      sourceTextUnitIds: Set<string>;
      aliases: Set<string>;
      confidenceTotal: number;
      confidenceCount: number;
      entityType: string;
      extractionSources: Set<ExtractionSource>;
      timestamps: Set<string>;
    }
  >();

  mentions.forEach((mention) => {
    const key = `${mention.entity_type}:${mention.normalized_text}`;
    const existing = grouped.get(key) ?? {
      canonicalName: mention.mention_text,
      mentionIds: [],
      sourceTextUnitIds: new Set<string>(),
      aliases: new Set<string>(),
      confidenceTotal: 0,
      confidenceCount: 0,
      entityType: mention.entity_type,
      extractionSources: new Set<ExtractionSource>(),
      timestamps: new Set<string>(),
    };

    if (mention.mention_text.length > existing.canonicalName.length) {
      existing.canonicalName = mention.mention_text;
    }

    existing.mentionIds.push(mention.mention_id);
    existing.sourceTextUnitIds.add(mention.source_text_unit_id);
    existing.aliases.add(mention.mention_text);
    existing.confidenceTotal += mention.confidence;
    existing.confidenceCount += 1;
    existing.extractionSources.add(mention.extraction_source);
    if (mention.timestamp) existing.timestamps.add(mention.timestamp);
    grouped.set(key, existing);
  });

  const entityIdByKey = new Map<string, string>();
  const entities: SidecarEntityRecord[] = Array.from(grouped.entries()).map(([key, value]) => {
    const entityId = `${sourceDocId}:e:${stableHash(key)}`;
    entityIdByKey.set(key, entityId);
    return {
      entity_id: entityId,
      source_doc_id: sourceDocId,
      canonical_name: value.canonicalName,
      normalized_name: normalizeLookupText(value.canonicalName),
      entity_type: value.entityType,
      aliases: Array.from(value.aliases).sort((a, b) => b.length - a.length),
      mention_ids: value.mentionIds,
      source_text_unit_ids: Array.from(value.sourceTextUnitIds),
      extraction_sources: Array.from(value.extractionSources),
      confidence: clampConfidence(value.confidenceTotal / Math.max(1, value.confidenceCount)),
      timestamps: Array.from(value.timestamps).sort(),
      corroborating_mention_ids: value.mentionIds.slice(1),
      contradicting_entity_ids: [],
    };
  });

  const enrichedMentions = mentions.map((mention) => {
    const key = `${mention.entity_type}:${mention.normalized_text}`;
    return {
      ...mention,
      entity_id: entityIdByKey.get(key),
    };
  });

  return {
    mentions: enrichedMentions,
    entities: entities.sort((a, b) => b.mention_ids.length - a.mention_ids.length || b.canonical_name.length - a.canonical_name.length),
  };
};

export const toExtractionCandidates = (mentions: SidecarMention[]): SidecarExtractionCandidate[] =>
  mentions.map((mention) => ({
    candidate_id: mention.candidate_id,
    source_doc_id: mention.source_doc_id,
    source_text_unit_id: mention.source_text_unit_id,
    char_start: mention.char_start,
    char_end: mention.char_end,
    normalized_char_start: mention.normalized_char_start,
    normalized_char_end: mention.normalized_char_end,
    raw_char_start: mention.raw_char_start,
    raw_char_end: mention.raw_char_end,
    raw_text: mention.raw_text,
    normalized_text: mention.normalized_text,
    label: mention.label,
    candidate_type: mention.candidate_type,
    extraction_source: mention.extraction_source,
    confidence: mention.confidence,
    metadata: mention.metadata,
    evidence: mention.evidence,
  }));

export const extractRelationCandidates = (
  sourceDocId: string,
  rawText: string,
  normalizedDocumentText: string,
  offsetMap: SourceOffsetMap,
  textUnits: SidecarTextUnit[],
  mentions: SidecarMention[],
  entities: SidecarEntityRecord[],
): SidecarRelationCandidate[] => {
  const mentionsByUnit = new Map<string, SidecarMention[]>();
  const entityById = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const relationCandidates: SidecarRelationCandidate[] = [];
  const seen = new Set<string>();

  mentions.forEach((mention) => {
    const list = mentionsByUnit.get(mention.source_text_unit_id) ?? [];
    list.push(mention);
    mentionsByUnit.set(mention.source_text_unit_id, list);
  });

  textUnits.forEach((textUnit) => {
    const unitMentions = (mentionsByUnit.get(textUnit.text_unit_id) ?? [])
      .filter((mention) => Boolean(mention.entity_id))
      .sort((a, b) => a.evidence.normalized_start - b.evidence.normalized_start);

    const groupedByEntity = new Map<string, SidecarMention[]>();
    unitMentions.forEach((mention) => {
      const entityId = mention.entity_id!;
      const list = groupedByEntity.get(entityId) ?? [];
      list.push(mention);
      groupedByEntity.set(entityId, list);
    });

    const entityIds = Array.from(groupedByEntity.keys());
    for (let leftIndex = 0; leftIndex < entityIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entityIds.length; rightIndex += 1) {
        const sourceEntityId = entityIds[leftIndex];
        const targetEntityId = entityIds[rightIndex];
        const sourceMentions = groupedByEntity.get(sourceEntityId) ?? [];
        const targetMentions = groupedByEntity.get(targetEntityId) ?? [];
        const earliestStart = Math.min(sourceMentions[0].evidence.normalized_start, targetMentions[0].evidence.normalized_start);
        const latestEnd = Math.max(
          sourceMentions[sourceMentions.length - 1].evidence.normalized_end,
          targetMentions[targetMentions.length - 1].evidence.normalized_end,
        );
        const distance = Math.max(1, latestEnd - earliestStart);
        const confidence = clampConfidence(0.25 + Math.min(0.45, 220 / distance));
        const sourceEntity = entityById.get(sourceEntityId);
        const targetEntity = entityById.get(targetEntityId);
        const relationType = "CO_MENTION_SAME_TEXT_UNIT";
        const key = `${textUnit.text_unit_id}:${sourceEntityId}:${targetEntityId}:${relationType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const timestamp =
          sourceMentions.find((mention) => mention.timestamp)?.timestamp ??
          targetMentions.find((mention) => mention.timestamp)?.timestamp;
        const normalizedText = [
          sourceEntity?.normalized_name ?? sourceEntityId,
          relationType.toLowerCase(),
          targetEntity?.normalized_name ?? targetEntityId,
        ].join("|");

        relationCandidates.push({
          relation_id: `${sourceDocId}:r:${stableHash(key)}`,
          source_doc_id: sourceDocId,
          source_text_unit_id: textUnit.text_unit_id,
          source_entity_id: sourceEntityId,
          target_entity_id: targetEntityId,
          source_mention_ids: sourceMentions.map((mention) => mention.mention_id),
          target_mention_ids: targetMentions.map((mention) => mention.mention_id),
          relation_type: relationType,
          normalized_text: normalizedText,
          extraction_source: "rule",
          confidence,
          timestamp,
          evidence: buildEvidence({
            sourceDocId,
            rawText,
            normalizedDocumentText,
            offsetMap,
            textUnit,
            normalizedStart: earliestStart,
            normalizedEnd: latestEnd,
            normalizedText,
            extractionSource: "rule",
            confidence,
            timestamp,
          }),
          corroborates: [],
          contradicts: [],
          evidence_status: "inferred" as const,
        });
      }
    }
  });

  return relationCandidates;
};
