import {
  collapseMentionsToEntities,
  extractRelationCandidates,
  extractRuleMentions,
  toExtractionCandidates,
} from "./extraction";
import { ingestSourceDocument, IngestOptions } from "./ingest";
import { parseSourceInput, SidecarSourceInput } from "./parsers";
import { buildLexicalIndex, searchLexicalIndex } from "./retrieval";
import {
  buildRuntimeDiagnostics,
  buildStructuredClaimCandidates,
  buildStructuredEventCandidates,
  buildStructuredRelationCandidates,
  createMentionFromNormalizedProposal,
  mergeMentionSets,
  runPythonSmartExtractor,
} from "./smartExtraction";
import { IngestedSourceDocument, LexicalSearchHit, SidecarExtractionPayload, SidecarLexicalIndex, SidecarMention } from "./types";

export type SmartExtractionPipelineOptions = IngestOptions;

const PIPELINE_VERSION = "milestone2-spacy-parser-hybrid-v1";

const annotateFastMentions = (mentions: SidecarMention[], parserName?: string): SidecarMention[] =>
  mentions.map((mention) => ({
    ...mention,
    metadata: {
      ...mention.metadata,
      source_parser: parserName ?? null,
      source_extractor: "fast_rule_v1",
    },
    evidence: {
      ...mention.evidence,
      source_parser: parserName,
      source_extractor: "fast_rule_v1",
    },
  }));

const mergeRelationSets = (...sets: Array<SidecarExtractionPayload["relation_candidates"]>): SidecarExtractionPayload["relation_candidates"] => {
  const seen = new Set<string>();
  return sets
    .flat()
    .filter((candidate) => candidate.source_entity_id && candidate.target_entity_id)
    .filter((candidate) => {
      const key = `${candidate.source_text_unit_id}:${candidate.relation_type}:${candidate.source_entity_id}:${candidate.target_entity_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const runSmartExtractionPipeline = (
  source: SidecarSourceInput,
  options: SmartExtractionPipelineOptions = {},
): SidecarExtractionPayload => {
  const document = prepareSmartIngestedDocument(source, options);
  return buildSmartExtractionPayload(document);
};

export const prepareSmartIngestedDocument = (
  source: SidecarSourceInput,
  options: SmartExtractionPipelineOptions = {},
): IngestedSourceDocument => {
  const parsed = parseSourceInput(source);
  return ingestSourceDocument(parsed, options);
};

export const buildSmartExtractionPayload = (document: IngestedSourceDocument): SidecarExtractionPayload => {
  const parserName = document.source_parser?.parser_name;

  const fastMentions = annotateFastMentions(
    extractRuleMentions(
      document.source_doc_id,
      document.raw_content,
      document.normalized_content,
      document.offset_map,
      document.text_units,
    ),
    parserName,
  );

  const pythonResult = runPythonSmartExtractor(document.normalized_content, {
    ...document.metadata,
    source_parser: parserName ?? null,
  });
  const runtimeDiagnostics = buildRuntimeDiagnostics(pythonResult);
  const smartMentions = pythonResult.mentions.map((proposal) =>
    createMentionFromNormalizedProposal({
      sourceDocId: document.source_doc_id,
      rawText: document.raw_content,
      normalizedText: document.normalized_content,
      offsetMap: document.offset_map,
      textUnits: document.text_units,
      proposal,
      sourceParser: document.source_parser,
      sourceExtractor: pythonResult.extractor_name,
    }),
  );

  const mergedMentions = mergeMentionSets([...fastMentions, ...smartMentions]);
  const { mentions, entities } = collapseMentionsToEntities(document.source_doc_id, mergedMentions);
  const candidates = toExtractionCandidates(mentions);
  const scaffoldRelations = extractRelationCandidates(
    document.source_doc_id,
    document.raw_content,
    document.normalized_content,
    document.offset_map,
    document.text_units,
    mentions,
    entities,
  );
  const explicitRelations = buildStructuredRelationCandidates({
    sourceDocId: document.source_doc_id,
    rawText: document.raw_content,
    normalizedText: document.normalized_content,
    offsetMap: document.offset_map,
    textUnits: document.text_units,
    mentions,
    entities,
    proposals: pythonResult.relations,
    sourceParser: document.source_parser,
    sourceExtractor: pythonResult.extractor_name,
  });
  const eventCandidates = buildStructuredEventCandidates({
    sourceDocId: document.source_doc_id,
    rawText: document.raw_content,
    normalizedText: document.normalized_content,
    offsetMap: document.offset_map,
    textUnits: document.text_units,
    mentions,
    proposals: pythonResult.events,
    sourceParser: document.source_parser,
    sourceExtractor: pythonResult.extractor_name,
  });
  const claimCandidates = buildStructuredClaimCandidates({
    sourceDocId: document.source_doc_id,
    rawText: document.raw_content,
    normalizedText: document.normalized_content,
    offsetMap: document.offset_map,
    textUnits: document.text_units,
    mentions,
    proposals: pythonResult.claims,
    sourceParser: document.source_parser,
    sourceExtractor: pythonResult.extractor_name,
  });
  const relationCandidates = mergeRelationSets(scaffoldRelations, explicitRelations);

  const evidenceBearingRecords =
    candidates.length + relationCandidates.length + eventCandidates.length + claimCandidates.length;
  const evidenceCoverageCount =
    candidates.filter((candidate) => candidate.evidence.raw_end > candidate.evidence.raw_start).length +
    relationCandidates.filter((candidate) => candidate.evidence.raw_end > candidate.evidence.raw_start).length +
    eventCandidates.filter((candidate) => candidate.evidence.raw_end > candidate.evidence.raw_start).length +
    claimCandidates.filter((candidate) => candidate.evidence.raw_end > candidate.evidence.raw_start).length;

  return {
    source_doc_id: document.source_doc_id,
    raw_text: document.raw_content,
    normalized_text: document.normalized_content,
    source_input_content: document.source_input_content,
    source_parser: document.source_parser,
    normalization_steps: document.normalization_steps,
    generated_at: new Date().toISOString(),
    pipeline_version: PIPELINE_VERSION,
    text_units: document.text_units,
    candidates,
    mentions,
    entities,
    relation_candidates: relationCandidates,
    event_candidates: eventCandidates,
    claim_candidates: claimCandidates,
    stats: {
      doc_char_length: document.raw_content.length,
      text_unit_count: document.text_units.length,
      candidate_count: candidates.length,
      mention_count: mentions.length,
      entity_count: entities.length,
      relation_count: relationCandidates.length,
      event_count: eventCandidates.length,
      claim_count: claimCandidates.length,
      duplicate_collapse_rate: mentions.length ? (mentions.length - entities.length) / mentions.length : 0,
      evidence_coverage_rate: evidenceBearingRecords ? evidenceCoverageCount / evidenceBearingRecords : 1,
    },
    runtime_diagnostics: runtimeDiagnostics,
  };
};

export const buildSmartPipelineLexicalIndex = (payload: SidecarExtractionPayload): SidecarLexicalIndex =>
  buildLexicalIndex(payload);

export const searchSmartPipelinePayload = (
  payload: SidecarExtractionPayload,
  query: string,
  limit = 5,
): LexicalSearchHit[] => searchLexicalIndex(buildLexicalIndex(payload), query, limit);
