import {
  collapseMentionsToEntities,
  extractRelationCandidates,
  extractRuleMentions,
  toExtractionCandidates,
} from "./extraction";
import { ingestSourceDocument, IngestOptions } from "./ingest";
import { buildLexicalIndex, searchLexicalIndex } from "./retrieval";
import { LexicalSearchHit, SidecarExtractionPayload, SidecarLexicalIndex } from "./types";

export type FastExtractionPipelineOptions = IngestOptions;

const PIPELINE_VERSION = "milestone1-rule-only-v1";

export const runFastExtractionPipeline = (
  sourceDocId: string,
  rawText: string,
  options: FastExtractionPipelineOptions = {},
): SidecarExtractionPayload => {
  const document = ingestSourceDocument(
    {
      source_doc_id: sourceDocId,
      raw_content: rawText,
      metadata: options.textUnit?.metadata,
    },
    options,
  );
  const textUnits = document.text_units;
  const rawMentions = extractRuleMentions(
    sourceDocId,
    document.raw_content,
    document.normalized_content,
    document.offset_map,
    textUnits,
  );
  const { mentions, entities } = collapseMentionsToEntities(sourceDocId, rawMentions);
  const candidates = toExtractionCandidates(mentions);
  const relationCandidates = extractRelationCandidates(
    sourceDocId,
    document.raw_content,
    document.normalized_content,
    document.offset_map,
    textUnits,
    mentions,
    entities,
  );
  const evidenceCoverageRate =
    candidates.length === 0
      ? 1
      : candidates.filter(
          (candidate) =>
            candidate.evidence.normalized_start >= 0 &&
            candidate.evidence.normalized_end > candidate.evidence.normalized_start &&
            candidate.evidence.raw_end > candidate.evidence.raw_start,
        ).length / candidates.length;

  return {
    source_doc_id: sourceDocId,
    raw_text: document.raw_content,
    normalized_text: document.normalized_content,
    source_input_content: document.source_input_content,
    source_parser: document.source_parser,
    normalization_steps: document.normalization_steps,
    generated_at: new Date().toISOString(),
    pipeline_version: PIPELINE_VERSION,
    text_units: textUnits,
    candidates,
    mentions,
    entities,
    relation_candidates: relationCandidates,
    event_candidates: [],
    claim_candidates: [],
    stats: {
      doc_char_length: document.raw_content.length,
      text_unit_count: textUnits.length,
      candidate_count: candidates.length,
      mention_count: mentions.length,
      entity_count: entities.length,
      relation_count: relationCandidates.length,
      event_count: 0,
      claim_count: 0,
      duplicate_collapse_rate: mentions.length ? (mentions.length - entities.length) / mentions.length : 0,
      evidence_coverage_rate: evidenceCoverageRate,
    },
  };
};

export const buildPipelineLexicalIndex = (payload: SidecarExtractionPayload): SidecarLexicalIndex =>
  buildLexicalIndex(payload);

const lexicalIndexCache = new WeakMap<SidecarExtractionPayload, SidecarLexicalIndex>();

export const searchPipelinePayload = (
  payload: SidecarExtractionPayload,
  query: string,
  limit = 5,
): LexicalSearchHit[] => {
  let index = lexicalIndexCache.get(payload);
  if (!index) {
    index = buildLexicalIndex(payload);
    lexicalIndexCache.set(payload, index);
  }
  return searchLexicalIndex(index, query, limit);
};
