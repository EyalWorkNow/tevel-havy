import type { SidecarClaimCandidate, SidecarEventCandidate, SidecarExtractionPayload, SidecarMention, SidecarRelationCandidate, SidecarTextUnit } from "../types";
import type {
  DocumentChunkRecord,
  DocumentRecord,
  DocumentVersionRecord,
  EntityIntelligenceBuildInput,
  EntityMentionRecord,
  EvidenceSpanRecord,
  MentionTypeDecisionRecord,
} from "./types";
import { canonicalSurface, classifyMentionType, normalizeEntityText, normalizeLabel, stableHash } from "./normalization";

const nowIso = (): string => new Date().toISOString();

const chunkIdFor = (documentId: string, textUnitId: string): string =>
  `chunk_${stableHash(`${documentId}:${textUnitId}`)}`;

const evidenceIdFor = (documentId: string, candidateId: string, evidenceId?: string): string =>
  evidenceId || `evidence_${stableHash(`${documentId}:${candidateId}`)}`;

const contextWindow = (text: string, start: number, end: number, radius = 80): { before: string; after: string } => ({
  before: text.slice(Math.max(0, start - radius), start).trim(),
  after: text.slice(end, Math.min(text.length, end + radius)).trim(),
});

export const buildDocumentRecords = (
  input: EntityIntelligenceBuildInput,
): {
  documents: DocumentRecord[];
  versions: DocumentVersionRecord[];
  chunks: DocumentChunkRecord[];
} => {
  const documentId = `doc_${stableHash(`${input.caseId}:${input.payload.source_doc_id}`)}`;
  const createdAt = nowIso();
  const document: DocumentRecord = {
    id: documentId,
    case_id: input.caseId,
    source_doc_id: input.payload.source_doc_id,
    title: input.payload.source_parser?.title || input.payload.source_doc_id,
    source_identity: input.payload.source_parser?.source_uri || input.payload.source_parser?.source_filename,
    language: input.payload.source_parser?.language || String(input.payload.text_units[0]?.metadata?.language || ""),
    parser_name: input.payload.source_parser?.parser_name,
    parser_version: input.payload.source_parser?.parser_version,
    parser_confidence: input.payload.stats.evidence_coverage_rate,
    ocr_flag: Boolean(input.payload.source_parser?.source_mime_type?.startsWith("image/")),
    ingested_at: createdAt,
    metadata_json: {
      source_parser: input.payload.source_parser,
      normalization_steps: input.payload.normalization_steps,
    },
  };

  const version: DocumentVersionRecord = {
    id: `docver_${stableHash(`${documentId}:${input.payload.normalized_text}`)}`,
    document_id: documentId,
    source_doc_id: input.payload.source_doc_id,
    raw_text: input.payload.raw_text,
    normalized_text: input.payload.normalized_text,
    source_input_content: input.payload.source_input_content,
    created_at: input.payload.generated_at,
  };

  const chunks = input.payload.text_units.map((unit: SidecarTextUnit) => ({
    id: chunkIdFor(documentId, unit.text_unit_id),
    document_id: documentId,
    source_text_unit_id: unit.text_unit_id,
    ordinal: unit.ordinal,
    kind: unit.kind,
    raw_text: unit.raw_text,
    normalized_text: unit.text,
    start_offset: unit.normalized_start,
    end_offset: unit.normalized_end,
    raw_start_offset: unit.raw_start,
    raw_end_offset: unit.raw_end,
    page: typeof unit.metadata?.page_number === "number" ? unit.metadata.page_number : undefined,
    section: typeof unit.metadata?.section === "string" ? unit.metadata.section : undefined,
    block: unit.kind,
  }));

  return {
    documents: [document],
    versions: [version],
    chunks,
  };
};

const evidenceFromArtifact = (
  documentId: string,
  rawText: string,
  unitLookup: Map<string, DocumentChunkRecord>,
  artifact: SidecarMention | SidecarRelationCandidate | SidecarEventCandidate | SidecarClaimCandidate,
): EvidenceSpanRecord => {
  const chunk = unitLookup.get(artifact.source_text_unit_id);
  const evidence = artifact.evidence;
  return {
    id: evidenceIdFor(documentId, "candidate_id" in artifact ? artifact.candidate_id : artifact.evidence.evidence_id, evidence.evidence_id),
    document_id: documentId,
    chunk_id: chunk?.id || null,
    raw_text: evidence.raw_supporting_snippet,
    normalized_text: evidence.normalized_supporting_snippet,
    start_offset: evidence.normalized_start,
    end_offset: evidence.normalized_end,
    raw_start_offset: evidence.raw_start,
    raw_end_offset: evidence.raw_end,
    page: chunk?.page,
    section: chunk?.section,
    block: chunk?.block,
    extraction_method: `${artifact.extraction_source}:${artifact.evidence.source_extractor || artifact.evidence.source_parser || "unknown"}`,
    confidence: evidence.confidence,
    created_at: nowIso(),
  };
};

export const buildEvidenceSpans = (
  documentId: string,
  rawText: string,
  chunks: DocumentChunkRecord[],
  payload: SidecarExtractionPayload,
): EvidenceSpanRecord[] => {
  const unitLookup = new Map(chunks.map((chunk) => [chunk.source_text_unit_id, chunk]));
  const seen = new Map<string, EvidenceSpanRecord>();

  const add = (artifact: SidecarMention | SidecarRelationCandidate | SidecarEventCandidate | SidecarClaimCandidate) => {
    const evidence = evidenceFromArtifact(documentId, rawText, unitLookup, artifact);
    const key = `${evidence.document_id}:${evidence.start_offset}:${evidence.end_offset}:${evidence.extraction_method}`;
    if (!seen.has(key)) {
      seen.set(key, evidence);
    }
  };

  payload.mentions.forEach(add);
  payload.relation_candidates.forEach(add);
  payload.event_candidates.forEach(add);
  payload.claim_candidates.forEach(add);
  return Array.from(seen.values());
};

export const buildEntityMentionRecords = (
  documentId: string,
  payload: SidecarExtractionPayload,
  evidenceSpans: EvidenceSpanRecord[],
): EntityMentionRecord[] => {
  const evidenceLookup = new Map(
    evidenceSpans.map((evidence) => [`${evidence.start_offset}:${evidence.end_offset}:${evidence.extraction_method}`, evidence]),
  );

  return payload.mentions.map((mention) => {
    const { canonical, aliases } = canonicalSurface(mention.mention_text);
    const evidenceKey = `${mention.evidence.normalized_start}:${mention.evidence.normalized_end}:${mention.extraction_source}:${mention.evidence.source_extractor || mention.evidence.source_parser || "unknown"}`;
    const evidence =
      evidenceLookup.get(evidenceKey) ||
      evidenceSpans.find(
        (item) =>
          item.start_offset === mention.evidence.normalized_start &&
          item.end_offset === mention.evidence.normalized_end,
      );
    const snippetWindow = contextWindow(payload.raw_text, mention.raw_char_start, mention.raw_char_end);
    const label = normalizeLabel(mention.entity_type || mention.label);

    return {
      id: mention.mention_id,
      document_id: documentId,
      evidence_span_id: evidence?.id || evidenceIdFor(documentId, mention.mention_id),
      source_text_unit_id: mention.source_text_unit_id,
      text: mention.mention_text,
      normalized_text: normalizeEntityText(mention.mention_text),
      canonical_text: normalizeEntityText(canonical),
      label,
      subtype: mention.role,
      mention_type: classifyMentionType(label, mention.mention_text),
      language: typeof mention.metadata?.language === "string" ? mention.metadata.language : undefined,
      sentence_id: mention.source_text_unit_id,
      paragraph_id: mention.source_text_unit_id,
      confidence: mention.confidence,
      extraction_method: `${mention.extraction_source}:${mention.metadata?.source_extractor || mention.evidence.source_extractor || "unknown"}`,
      context_window_before: snippetWindow.before,
      context_window_after: snippetWindow.after,
      attributes_json: {
        source_entity_id: mention.entity_id,
        aliases,
        role: mention.role,
        raw_char_start: mention.raw_char_start,
        raw_char_end: mention.raw_char_end,
        timestamp: mention.timestamp,
      },
    };
  });
};

export const buildMentionTypeDecisions = (mentions: EntityMentionRecord[]): MentionTypeDecisionRecord[] =>
  mentions.map((mention) => {
    const alternatives = [mention.label === "PERSON" ? "ROLE" : "PERSON", mention.label === "ORG" ? "LOCATION" : "ORG"]
      .map((label, index) => ({
        label: normalizeLabel(label),
        confidence: Math.max(0.12, Number((mention.confidence - 0.18 - index * 0.08).toFixed(2))),
      }))
      .filter((candidate) => candidate.label !== mention.label && candidate.confidence > 0.1);

    return {
      id: `mtype_${stableHash(`${mention.id}:${mention.label}:${mention.mention_type}`)}`,
      mention_id: mention.id,
      primary_label: mention.label,
      primary_confidence: mention.confidence,
      alternative_labels: alternatives,
      decision_method: "rule_context_blend",
      explanation:
        mention.mention_type === "structured-id"
          ? "Structured identifier pattern dominated mention typing."
          : mention.mention_type === "pronoun"
            ? "Pronoun and nearby context constrained the mention typing decision."
            : "Primary label was retained from grounded extraction with contextual fallback alternatives.",
      created_at: nowIso(),
    };
  });
