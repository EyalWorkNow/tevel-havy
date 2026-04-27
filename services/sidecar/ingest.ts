import { createTextUnits, normalizeSourceDocument, TextUnitOptions } from "./textUnits";
import { IngestedSourceDocument, SourceDocumentInput } from "./types";

export type IngestOptions = {
  textUnit?: TextUnitOptions;
};

export const ingestSourceDocument = (
  input: SourceDocumentInput,
  options: IngestOptions = {},
): IngestedSourceDocument => {
  const normalizedDocument = normalizeSourceDocument(input.raw_content);
  const metadata = { ...(input.metadata ?? {}) };

  return {
    source_doc_id: input.source_doc_id,
    raw_content: input.raw_content,
    normalized_content: normalizedDocument.normalized_text,
    source_input_content: input.source_input_content ?? input.raw_content,
    source_parser: input.source_parser,
    offset_map: normalizedDocument.offset_map,
    normalization_steps: normalizedDocument.normalization_steps,
    metadata,
    text_units: createTextUnits(input.source_doc_id, normalizedDocument.normalized_text, {
      ...options.textUnit,
      textIsNormalized: true,
      offsetMap: normalizedDocument.offset_map,
      rawText: input.raw_content,
      metadata,
    }),
  };
};
