import {
  CandidateMetadataValue,
  EvidenceSpan,
  SidecarClaimCandidate,
  SidecarEntityRecord,
  SidecarEventCandidate,
  SidecarMention,
  SidecarRelationCandidate,
  SidecarRuntimeDiagnostics,
  SidecarTextUnit,
  SourceOffsetMap,
  SourceParserInfo,
} from "./types";
import { mapNormalizedSpanToRawSpan, normalizeLookupText } from "./textUnits";
import { runPythonSidecarHelper } from "./pythonBridge";

type PythonMentionProposal = {
  start: number;
  end: number;
  text: string;
  label: string;
  confidence: number;
  extraction_source: "rule" | "gazetteer" | "model";
  role?: string;
  metadata?: Record<string, unknown>;
};

type PythonSpanRef = {
  start: number;
  end: number;
  text: string;
};

type PythonRelationProposal = {
  start: number;
  end: number;
  relation_type: string;
  trigger_text: string;
  trigger_start: number;
  trigger_end: number;
  source_span: PythonSpanRef;
  target_span: PythonSpanRef;
  confidence: number;
  metadata?: Record<string, unknown>;
};

type PythonEventProposal = {
  start: number;
  end: number;
  event_type: string;
  trigger_text: string;
  trigger_start: number;
  trigger_end: number;
  actor_spans: PythonSpanRef[];
  target_spans: PythonSpanRef[];
  location_spans: PythonSpanRef[];
  confidence: number;
  metadata?: Record<string, unknown>;
};

type PythonClaimProposal = {
  start: number;
  end: number;
  claim_type: string;
  claim_text: string;
  cue_text?: string;
  cue_start?: number;
  cue_end?: number;
  speaker_span?: PythonSpanRef | null;
  subject_spans?: PythonSpanRef[];
  object_spans?: PythonSpanRef[];
  confidence: number;
  metadata?: Record<string, unknown>;
};

type PythonSmartExtractionResult = {
  extractor_name: string;
  mentions: PythonMentionProposal[];
  relations: PythonRelationProposal[];
  events: PythonEventProposal[];
  claims: PythonClaimProposal[];
  warnings?: string[];
  adapter_status?: Record<string, { state?: string; detail?: string }>;
};

type EvidenceBuilderParams = {
  sourceDocId: string;
  rawText: string;
  normalizedText: string;
  offsetMap: SourceOffsetMap;
  textUnits: SidecarTextUnit[];
  normalizedStart: number;
  normalizedEnd: number;
  normalizedValue: string;
  extractionSource: "rule" | "gazetteer" | "model";
  confidence: number;
  timestamp?: string;
  sourceParser?: SourceParserInfo;
  sourceExtractor?: string;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value));

const flattenMetadata = (value?: Record<string, unknown>): Record<string, CandidateMetadataValue> => {
  const next: Record<string, CandidateMetadataValue> = {};
  Object.entries(value ?? {}).forEach(([key, item]) => {
    if (item == null) return;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      next[key] = item;
    } else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      next[key] = item as string[];
    }
  });
  return next;
};

const resolveTextUnit = (
  textUnits: SidecarTextUnit[],
  normalizedStart: number,
  normalizedEnd: number,
): SidecarTextUnit => {
  const containingUnit =
    textUnits.find((unit) => normalizedStart >= unit.normalized_start && normalizedEnd <= unit.normalized_end) ??
    textUnits.find((unit) => normalizedStart < unit.normalized_end && normalizedEnd > unit.normalized_start);
  if (!containingUnit) {
    throw new Error(`No text unit found for normalized span ${normalizedStart}-${normalizedEnd}`);
  }
  return containingUnit;
};

export const buildEvidenceSpanFromNormalizedRange = (params: EvidenceBuilderParams): EvidenceSpan => {
  const textUnit = resolveTextUnit(params.textUnits, params.normalizedStart, params.normalizedEnd);
  const rawSpan = mapNormalizedSpanToRawSpan(params.normalizedStart, params.normalizedEnd, params.offsetMap);
  const normalizedSnippetStart = Math.max(textUnit.normalized_start, params.normalizedStart - 120);
  const normalizedSnippetEnd = Math.min(textUnit.normalized_end, params.normalizedEnd + 120);
  const rawSnippetStart = Math.max(textUnit.raw_start, rawSpan.start - 120);
  const rawSnippetEnd = Math.min(textUnit.raw_end, rawSpan.end + 120);

  return {
    evidence_id: `${params.sourceDocId}:ev:${params.normalizedStart}-${params.normalizedEnd}:${rawSpan.start}-${rawSpan.end}`,
    source_doc_id: params.sourceDocId,
    source_text_unit_id: textUnit.text_unit_id,
    start: params.normalizedStart,
    end: params.normalizedEnd,
    normalized_start: params.normalizedStart,
    normalized_end: params.normalizedEnd,
    raw_start: rawSpan.start,
    raw_end: rawSpan.end,
    raw_supporting_snippet: params.rawText.slice(rawSnippetStart, rawSnippetEnd).trim(),
    normalized_supporting_snippet: params.normalizedText.slice(normalizedSnippetStart, normalizedSnippetEnd).trim(),
    normalized_text: params.normalizedValue,
    extraction_source: params.extractionSource,
    source_parser: params.sourceParser?.parser_name,
    source_extractor: params.sourceExtractor,
    confidence: clampConfidence(params.confidence),
    timestamp: params.timestamp,
    corroborates: [],
    contradicts: [],
  };
};

export const createMentionFromNormalizedProposal = (params: {
  sourceDocId: string;
  rawText: string;
  normalizedText: string;
  offsetMap: SourceOffsetMap;
  textUnits: SidecarTextUnit[];
  proposal: PythonMentionProposal;
  sourceParser?: SourceParserInfo;
  sourceExtractor: string;
}): SidecarMention => {
  const { proposal } = params;
  const rawSpan = mapNormalizedSpanToRawSpan(proposal.start, proposal.end, params.offsetMap);
  const textUnit = resolveTextUnit(params.textUnits, proposal.start, proposal.end);
  const normalizedValue = normalizeLookupText(proposal.text);
  const metadata: Record<string, CandidateMetadataValue> = {
    role: proposal.role ?? null,
    entity_type: proposal.label,
    text_unit_kind: textUnit.kind,
    source_parser: params.sourceParser?.parser_name ?? null,
    source_extractor: params.sourceExtractor,
    ...flattenMetadata(proposal.metadata),
  };

  return {
    candidate_id: `${params.sourceDocId}:c:${proposal.start}-${proposal.end}:${rawSpan.start}-${rawSpan.end}:${stableHash(`${proposal.label}:${normalizedValue}`)}`,
    mention_id: `${params.sourceDocId}:m:${proposal.start}-${proposal.end}:${rawSpan.start}-${rawSpan.end}:${stableHash(`${proposal.label}:${normalizedValue}`)}`,
    source_doc_id: params.sourceDocId,
    source_text_unit_id: textUnit.text_unit_id,
    char_start: proposal.start,
    char_end: proposal.end,
    normalized_char_start: proposal.start,
    normalized_char_end: proposal.end,
    raw_char_start: rawSpan.start,
    raw_char_end: rawSpan.end,
    raw_text: params.rawText.slice(rawSpan.start, rawSpan.end),
    mention_text: proposal.text,
    normalized_text: normalizedValue,
    label: proposal.label,
    candidate_type: "entity_mention",
    entity_type: proposal.label,
    role: proposal.role,
    extraction_source: proposal.extraction_source,
    confidence: clampConfidence(proposal.confidence),
    metadata,
    evidence: buildEvidenceSpanFromNormalizedRange({
      sourceDocId: params.sourceDocId,
      rawText: params.rawText,
      normalizedText: params.normalizedText,
      offsetMap: params.offsetMap,
      textUnits: params.textUnits,
      normalizedStart: proposal.start,
      normalizedEnd: proposal.end,
      normalizedValue,
      extractionSource: proposal.extraction_source,
      confidence: proposal.confidence,
      sourceParser: params.sourceParser,
      sourceExtractor: params.sourceExtractor,
    }),
  };
};

export const runPythonSmartExtractor = (
  normalizedText: string,
  metadata?: Record<string, CandidateMetadataValue>,
): PythonSmartExtractionResult =>
  runPythonSidecarHelper<PythonSmartExtractionResult>("smart_extract", {
    text: normalizedText,
    metadata,
  });

export const buildRuntimeDiagnostics = (result: PythonSmartExtractionResult): SidecarRuntimeDiagnostics => ({
  extractor_name: result.extractor_name,
  warnings: Array.from(new Set(result.warnings || [])),
  adapter_status: Object.fromEntries(
    Object.entries(result.adapter_status || {}).map(([adapter, status]) => [
      adapter,
      {
        state:
          status?.state === "active" ||
          status?.state === "configured" ||
          status?.state === "unavailable" ||
          status?.state === "disabled" ||
          status?.state === "skipped"
            ? status.state
            : "unavailable",
        detail: typeof status?.detail === "string" ? status.detail : undefined,
      },
    ]),
  ),
});

export const mergeMentionSets = (mentions: SidecarMention[]): SidecarMention[] => {
  const seen = new Set<string>();
  return mentions
    .filter((mention) => mention.normalized_text)
    .sort((a, b) => a.normalized_char_start - b.normalized_char_start || a.normalized_char_end - b.normalized_char_end)
    .filter((mention) => {
      const key = `${mention.entity_type}:${mention.normalized_char_start}:${mention.normalized_char_end}:${mention.normalized_text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const resolveMentionMatches = (mentions: SidecarMention[], span?: PythonSpanRef | null): SidecarMention[] => {
  if (!span) return [];
  const exact = mentions.filter(
    (mention) =>
      mention.normalized_char_start === span.start &&
      mention.normalized_char_end === span.end,
  );
  if (exact.length) return exact;
  return mentions.filter(
    (mention) =>
      mention.normalized_char_start < span.end &&
      mention.normalized_char_end > span.start,
  );
};

const resolveMentionMatchesMany = (mentions: SidecarMention[], spans?: PythonSpanRef[]): SidecarMention[] => {
  const seen = new Set<string>();
  return (spans ?? [])
    .flatMap((span) => resolveMentionMatches(mentions, span))
    .filter((mention) => {
      if (seen.has(mention.mention_id)) return false;
      seen.add(mention.mention_id);
      return true;
    });
};

const entityIdsFromMentions = (mentions: SidecarMention[]): string[] => {
  const ids = new Set<string>();
  mentions.forEach((mention) => {
    if (mention.entity_id) ids.add(mention.entity_id);
  });
  return Array.from(ids);
};

export const buildStructuredRelationCandidates = (params: {
  sourceDocId: string;
  rawText: string;
  normalizedText: string;
  offsetMap: SourceOffsetMap;
  textUnits: SidecarTextUnit[];
  mentions: SidecarMention[];
  entities: SidecarEntityRecord[];
  proposals: PythonRelationProposal[];
  sourceParser?: SourceParserInfo;
  sourceExtractor: string;
}): SidecarRelationCandidate[] => {
  const candidates = params.proposals
    .map((proposal) => {
      const sourceMentions = resolveMentionMatches(params.mentions, proposal.source_span);
      const targetMentions = resolveMentionMatches(params.mentions, proposal.target_span);
      if (!sourceMentions.length || !targetMentions.length) return null;
      const normalizedText = [
        sourceMentions[0].normalized_text,
        proposal.relation_type.toLowerCase(),
        targetMentions[0].normalized_text,
      ].join("|");
      const evidence = buildEvidenceSpanFromNormalizedRange({
        sourceDocId: params.sourceDocId,
        rawText: params.rawText,
        normalizedText: params.normalizedText,
        offsetMap: params.offsetMap,
        textUnits: params.textUnits,
        normalizedStart: proposal.start,
        normalizedEnd: proposal.end,
        normalizedValue: normalizedText,
        extractionSource: "rule",
        confidence: proposal.confidence,
        sourceParser: params.sourceParser,
        sourceExtractor: params.sourceExtractor,
      });
      return {
        relation_id: `${params.sourceDocId}:r:${stableHash(`${proposal.relation_type}:${proposal.start}:${proposal.end}:${normalizedText}`)}`,
        source_doc_id: params.sourceDocId,
        source_text_unit_id: evidence.source_text_unit_id,
        source_entity_id: entityIdsFromMentions(sourceMentions)[0],
        target_entity_id: entityIdsFromMentions(targetMentions)[0],
        source_mention_ids: sourceMentions.map((mention) => mention.mention_id),
        target_mention_ids: targetMentions.map((mention) => mention.mention_id),
        relation_type: proposal.relation_type,
        normalized_text: normalizedText,
        extraction_source: "rule" as const,
        confidence: clampConfidence(proposal.confidence),
        metadata: {
          trigger_text: proposal.trigger_text,
          source_extractor: params.sourceExtractor,
          source_parser: params.sourceParser?.parser_name ?? null,
          ...flattenMetadata(proposal.metadata),
        },
        evidence,
        corroborates: [],
        contradicts: [],
        evidence_status: "explicit" as const,
      } satisfies SidecarRelationCandidate;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate) && Boolean(candidate.source_entity_id) && Boolean(candidate.target_entity_id));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.source_text_unit_id}:${candidate.relation_type}:${candidate.source_entity_id}:${candidate.target_entity_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const buildStructuredEventCandidates = (params: {
  sourceDocId: string;
  rawText: string;
  normalizedText: string;
  offsetMap: SourceOffsetMap;
  textUnits: SidecarTextUnit[];
  mentions: SidecarMention[];
  proposals: PythonEventProposal[];
  sourceParser?: SourceParserInfo;
  sourceExtractor: string;
}): SidecarEventCandidate[] =>
  params.proposals.map((proposal) => {
    const actorMentions = resolveMentionMatchesMany(params.mentions, proposal.actor_spans);
    const targetMentions = resolveMentionMatchesMany(params.mentions, proposal.target_spans);
    const locationMentions = resolveMentionMatchesMany(params.mentions, proposal.location_spans);
    const normalizedText = [
      proposal.event_type.toLowerCase(),
      actorMentions.map((mention) => mention.normalized_text).join(","),
      targetMentions.map((mention) => mention.normalized_text).join(","),
      locationMentions.map((mention) => mention.normalized_text).join(","),
    ]
      .join("|")
      .replace(/\|+/g, "|");
    const evidence = buildEvidenceSpanFromNormalizedRange({
      sourceDocId: params.sourceDocId,
      rawText: params.rawText,
      normalizedText: params.normalizedText,
      offsetMap: params.offsetMap,
      textUnits: params.textUnits,
      normalizedStart: proposal.start,
      normalizedEnd: proposal.end,
      normalizedValue: normalizedText,
      extractionSource: "rule",
      confidence: proposal.confidence,
      sourceParser: params.sourceParser,
      sourceExtractor: params.sourceExtractor,
    });
    return {
      event_id: `${params.sourceDocId}:evt:${stableHash(`${proposal.event_type}:${proposal.start}:${proposal.end}:${normalizedText}`)}`,
      source_doc_id: params.sourceDocId,
      source_text_unit_id: evidence.source_text_unit_id,
      event_type: proposal.event_type,
      trigger_text: proposal.trigger_text,
      trigger_normalized_text: normalizeLookupText(proposal.trigger_text),
      actor_entity_ids: entityIdsFromMentions(actorMentions),
      actor_mention_ids: actorMentions.map((mention) => mention.mention_id),
      target_entity_ids: entityIdsFromMentions(targetMentions),
      target_mention_ids: targetMentions.map((mention) => mention.mention_id),
      location_entity_ids: entityIdsFromMentions(locationMentions),
      location_mention_ids: locationMentions.map((mention) => mention.mention_id),
      normalized_text: normalizedText,
      extraction_source: "rule",
      confidence: clampConfidence(proposal.confidence),
      metadata: {
        source_extractor: params.sourceExtractor,
        source_parser: params.sourceParser?.parser_name ?? null,
        ...flattenMetadata(proposal.metadata),
      },
      evidence,
    };
  });

export const buildStructuredClaimCandidates = (params: {
  sourceDocId: string;
  rawText: string;
  normalizedText: string;
  offsetMap: SourceOffsetMap;
  textUnits: SidecarTextUnit[];
  mentions: SidecarMention[];
  proposals: PythonClaimProposal[];
  sourceParser?: SourceParserInfo;
  sourceExtractor: string;
}): SidecarClaimCandidate[] =>
  params.proposals.map((proposal) => {
    const speakerMentions = resolveMentionMatches(params.mentions, proposal.speaker_span ?? undefined);
    const subjectMentions = resolveMentionMatchesMany(params.mentions, proposal.subject_spans);
    const objectMentions = resolveMentionMatchesMany(params.mentions, proposal.object_spans);
    const evidence = buildEvidenceSpanFromNormalizedRange({
      sourceDocId: params.sourceDocId,
      rawText: params.rawText,
      normalizedText: params.normalizedText,
      offsetMap: params.offsetMap,
      textUnits: params.textUnits,
      normalizedStart: proposal.start,
      normalizedEnd: proposal.end,
      normalizedValue: normalizeLookupText(proposal.claim_text),
      extractionSource: "rule",
      confidence: proposal.confidence,
      sourceParser: params.sourceParser,
      sourceExtractor: params.sourceExtractor,
    });
    return {
      claim_id: `${params.sourceDocId}:clm:${stableHash(`${proposal.claim_type}:${proposal.start}:${proposal.end}:${proposal.claim_text}`)}`,
      source_doc_id: params.sourceDocId,
      source_text_unit_id: evidence.source_text_unit_id,
      claim_type: proposal.claim_type,
      cue_text: proposal.cue_text,
      speaker_entity_ids: entityIdsFromMentions(speakerMentions),
      speaker_mention_ids: speakerMentions.map((mention) => mention.mention_id),
      subject_entity_ids: entityIdsFromMentions(subjectMentions),
      subject_mention_ids: subjectMentions.map((mention) => mention.mention_id),
      object_entity_ids: entityIdsFromMentions(objectMentions),
      object_mention_ids: objectMentions.map((mention) => mention.mention_id),
      claim_text: proposal.claim_text,
      normalized_text: normalizeLookupText(proposal.claim_text),
      extraction_source: "rule",
      confidence: clampConfidence(proposal.confidence),
      metadata: {
        source_extractor: params.sourceExtractor,
        source_parser: params.sourceParser?.parser_name ?? null,
        ...flattenMetadata(proposal.metadata),
      },
      evidence,
      corroborates: [],
      contradicts: [],
    };
  });
