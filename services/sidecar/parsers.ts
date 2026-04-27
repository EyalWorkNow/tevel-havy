import path from "node:path";

import { runPythonSidecarHelper } from "./pythonBridge";
import { SourceDocumentInput, SourceDocumentMetadata, SourceParserInfo } from "./types";

export type SidecarSourceInput = {
  source_doc_id: string;
  raw_content?: string;
  file_path?: string;
  source_uri?: string;
  source_mime_type?: string;
  source_filename?: string;
  metadata?: SourceDocumentMetadata;
};

type PythonParseResult = {
  parser_name: string;
  parser_version?: string | null;
  parser_input_kind: "html" | "file";
  parser_view: "raw_text" | "parsed_text";
  text: string;
  source_input_content?: string;
  metadata?: Record<string, unknown>;
  source_filename?: string;
};

const looksLikeHtml = (value: string): boolean => /<(?:!doctype|html|head|body|article|main|div|p|section)\b/i.test(value);
const textLikeFileExtensions = new Set([".txt", ".md", ".json", ".csv", ".xml", ".log", ".tsv", ".yaml", ".yml", ".html", ".htm"]);

const buildParserInfo = (
  result: PythonParseResult,
  input: SidecarSourceInput,
  metadata: SourceDocumentMetadata,
): SourceParserInfo => ({
  parser_name: result.parser_name,
  parser_version: result.parser_version ?? undefined,
  parser_input_kind: result.parser_input_kind,
  parser_view: result.parser_view,
  source_uri: input.source_uri,
  source_mime_type: input.source_mime_type,
  source_filename: input.source_filename ?? (input.file_path ? path.basename(input.file_path) : undefined),
  title: typeof metadata.title === "string" ? metadata.title : undefined,
  author: typeof metadata.author === "string" ? metadata.author : undefined,
  hostname: typeof metadata.hostname === "string" ? metadata.hostname : undefined,
  published_at: typeof metadata.published_at === "string" ? metadata.published_at : undefined,
  language: typeof metadata.language === "string" ? metadata.language : undefined,
});

const flattenParserMetadata = (metadata?: Record<string, unknown>): SourceDocumentMetadata => {
  const next: SourceDocumentMetadata = {};
  Object.entries(metadata ?? {}).forEach(([key, value]) => {
    if (value == null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      next[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      next[key] = value as string[];
    }
  });
  if (typeof next.published_at === "string" && !next.page_number) {
    next.page_number = undefined;
  }
  return next;
};

export const parseSourceInput = (input: SidecarSourceInput): SourceDocumentInput => {
  const baseMetadata = { ...(input.metadata ?? {}) };

  if (input.file_path) {
    const result = runPythonSidecarHelper<PythonParseResult>("parse_file", {
      file_path: input.file_path,
      source_uri: input.source_uri,
    });
    const parserMetadata = flattenParserMetadata(result.metadata);
    const fileExt = path.extname(input.file_path).toLowerCase();
    const safeSourceInputContent =
      typeof result.source_input_content === "string"
        ? result.source_input_content
        : textLikeFileExtensions.has(fileExt)
          ? result.text || undefined
          : undefined;
    const safeRawContent = result.text || safeSourceInputContent || "";
    return {
      source_doc_id: input.source_doc_id,
      raw_content: safeRawContent,
      source_input_content: safeSourceInputContent,
      source_parser: buildParserInfo(result, input, { ...baseMetadata, ...parserMetadata }),
      metadata: { ...baseMetadata, ...parserMetadata, source_type: baseMetadata.source_type ?? "FILE" },
    };
  }

  const rawContent = input.raw_content ?? "";
  const shouldParseHtml =
    input.source_mime_type === "text/html" ||
    looksLikeHtml(rawContent);

  if (shouldParseHtml) {
    const result = runPythonSidecarHelper<PythonParseResult>("parse_html", {
      raw_content: rawContent,
      source_uri: input.source_uri,
    });
    const parserMetadata = flattenParserMetadata(result.metadata);
    return {
      source_doc_id: input.source_doc_id,
      raw_content: result.text || rawContent,
      source_input_content: rawContent,
      source_parser: buildParserInfo(result, input, { ...baseMetadata, ...parserMetadata }),
      metadata: { ...baseMetadata, ...parserMetadata, source_type: baseMetadata.source_type ?? "HTML" },
    };
  }

  return {
    source_doc_id: input.source_doc_id,
    raw_content: rawContent,
    source_input_content: rawContent,
    source_parser: {
      parser_name: "raw_text",
      parser_input_kind: "raw_text",
      parser_view: "raw_text",
      source_uri: input.source_uri,
      source_mime_type: input.source_mime_type,
      source_filename: input.source_filename,
      title: typeof baseMetadata.title === "string" ? baseMetadata.title : undefined,
      language: typeof baseMetadata.language === "string" ? baseMetadata.language : undefined,
    },
    metadata: { ...baseMetadata, source_type: baseMetadata.source_type ?? "TEXT" },
  };
};
