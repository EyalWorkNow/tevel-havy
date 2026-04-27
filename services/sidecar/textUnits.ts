import { SidecarTextUnit, SourceDocumentMetadata, SourceOffsetMap, TextUnitKind } from "./types";

export type TextUnitOptions = {
  maxChars?: number;
  metadata?: SourceDocumentMetadata;
  textIsNormalized?: boolean;
  offsetMap?: SourceOffsetMap;
  rawText?: string;
};

type NormalizedDocumentResult = {
  normalized_text: string;
  offset_map: SourceOffsetMap;
  normalization_steps: string[];
};

const DEFAULT_MAX_CHARS = 900;

export const SOURCE_NORMALIZATION_STEPS = [
  "remove carriage returns",
  "replace tabs with single spaces",
  "collapse repeated spaces and non-breaking spaces",
  "collapse runs of 3 or more newlines to 2 newlines",
  "trim leading and trailing whitespace",
] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const normalizeLookupText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s.:@#]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const estimateTokenCount = (value: string): number =>
  value.trim() ? value.trim().split(/\s+/).length : 0;

const stableHash = (value: string): string => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const trimSpan = (text: string, start: number, end: number): { start: number; end: number } => {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && /\s/u.test(text[nextStart])) {
    nextStart += 1;
  }

  while (nextEnd > nextStart && /\s/u.test(text[nextEnd - 1])) {
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
};

const splitParagraphRanges = (text: string): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  const boundaryRegex = /\r?\n(?:[ \t]*\r?\n)+/g;
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = boundaryRegex.exec(text)) !== null) {
    ranges.push({ start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }

  ranges.push({ start: cursor, end: text.length });
  return ranges;
};

const splitSentenceRanges = (text: string, start: number, end: number): Array<{ start: number; end: number }> => {
  const slice = text.slice(start, end);
  const ranges: Array<{ start: number; end: number }> = [];
  const sentenceRegex = /[^.!?。！？\r\n]+(?:[.!?。！？]+|$)/g;
  let match: RegExpExecArray | null = null;

  while ((match = sentenceRegex.exec(slice)) !== null) {
    ranges.push({
      start: start + match.index,
      end: start + match.index + match[0].length,
    });
  }

  return ranges.length ? ranges : [{ start, end }];
};

const splitHardRanges = (
  text: string,
  start: number,
  end: number,
  maxChars: number,
): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = start;

  while (cursor < end) {
    const target = Math.min(cursor + maxChars, end);
    let splitAt = target;

    while (splitAt > cursor + Math.floor(maxChars * 0.55) && splitAt < end && !/\s/u.test(text[splitAt - 1])) {
      splitAt -= 1;
    }

    if (splitAt <= cursor + Math.floor(maxChars * 0.55)) {
      splitAt = target;
    }

    ranges.push({ start: cursor, end: splitAt });
    cursor = splitAt;
  }

  return ranges;
};

const buildTextUnitMetadata = (
  unitText: string,
  metadata?: SourceDocumentMetadata,
): SourceDocumentMetadata | undefined => {
  const derivedSection =
    metadata?.section ??
    unitText
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => /^[A-Z][A-Z0-9 /_-]{2,64}$/.test(line) || /^[A-Z][A-Z0-9 /_-]{2,32}:\s/.test(line))
      ?.replace(/:\s*$/, "");

  const nextMetadata: SourceDocumentMetadata = {
    title: metadata?.title,
    source_type: metadata?.source_type,
    page_number: metadata?.page_number,
    section: derivedSection,
    language: metadata?.language,
  };

  const extraEntries = Object.entries(metadata ?? {}).filter(
    ([key]) => !["title", "source_type", "page_number", "section", "language"].includes(key),
  );
  extraEntries.forEach(([key, value]) => {
    nextMetadata[key] = value;
  });

  return Object.values(nextMetadata).some((value) => value !== undefined) ? nextMetadata : undefined;
};

const buildIdentityOffsetMap = (text: string): SourceOffsetMap => ({
  raw_length: text.length,
  normalized_length: text.length,
  raw_to_normalized: Array.from({ length: text.length + 1 }, (_, index) => index),
  normalized_to_raw: Array.from({ length: text.length }, (_, index) => ({
    normalized_index: index,
    raw_start: index,
    raw_end: index + 1,
  })),
});

export const normalizeSourceDocument = (rawText: string): NormalizedDocumentResult => {
  const segments: Array<{ char: string; raw_start: number; raw_end: number }> = [];
  const rawToNormalized: number[] = [0];

  for (let rawIndex = 0; rawIndex < rawText.length; rawIndex += 1) {
    const rawChar = rawText[rawIndex];

    if (rawChar === "\r") {
      rawToNormalized.push(segments.length);
      continue;
    }

    const nextChar = rawChar === "\t" ? " " : rawChar === "\u00A0" ? " " : rawChar;
    const last = segments[segments.length - 1];
    const secondLast = segments[segments.length - 2];

    if (nextChar === " ") {
      if (last?.char === " ") {
        last.raw_end = rawIndex + 1;
      } else {
        segments.push({ char: " ", raw_start: rawIndex, raw_end: rawIndex + 1 });
      }
      rawToNormalized.push(segments.length);
      continue;
    }

    if (nextChar === "\n") {
      if (last?.char === "\n" && secondLast?.char === "\n") {
        last.raw_end = rawIndex + 1;
      } else {
        segments.push({ char: "\n", raw_start: rawIndex, raw_end: rawIndex + 1 });
      }
      rawToNormalized.push(segments.length);
      continue;
    }

    segments.push({ char: nextChar, raw_start: rawIndex, raw_end: rawIndex + 1 });
    rawToNormalized.push(segments.length);
  }

  let trimStart = 0;
  while (trimStart < segments.length && /\s/u.test(segments[trimStart].char)) {
    trimStart += 1;
  }

  let trimEnd = segments.length;
  while (trimEnd > trimStart && /\s/u.test(segments[trimEnd - 1].char)) {
    trimEnd -= 1;
  }

  const trimmedSegments = segments.slice(trimStart, trimEnd);
  const normalizedText = trimmedSegments.map((segment) => segment.char).join("");
  const normalizedLength = trimmedSegments.length;
  const adjustedRawToNormalized = rawToNormalized.map((value) => clamp(value - trimStart, 0, normalizedLength));

  return {
    normalized_text: normalizedText,
    offset_map: {
      raw_length: rawText.length,
      normalized_length: normalizedLength,
      raw_to_normalized: adjustedRawToNormalized,
      normalized_to_raw: trimmedSegments.map((segment, normalizedIndex) => ({
        normalized_index: normalizedIndex,
        raw_start: segment.raw_start,
        raw_end: segment.raw_end,
      })),
    },
    normalization_steps: [...SOURCE_NORMALIZATION_STEPS],
  };
};

export const normalizeSourceDocumentContent = (value: string): string =>
  normalizeSourceDocument(value).normalized_text;

export const mapNormalizedSpanToRawSpan = (
  start: number,
  end: number,
  offsetMap: SourceOffsetMap,
): { start: number; end: number } => {
  const normalizedStart = clamp(start, 0, offsetMap.normalized_length);
  const normalizedEnd = clamp(end, normalizedStart, offsetMap.normalized_length);

  if (normalizedStart === normalizedEnd) {
    const boundary =
      normalizedStart >= offsetMap.normalized_length
        ? offsetMap.raw_length
        : offsetMap.normalized_to_raw[normalizedStart].raw_start;
    return { start: boundary, end: boundary };
  }

  return {
    start: offsetMap.normalized_to_raw[normalizedStart].raw_start,
    end: offsetMap.normalized_to_raw[normalizedEnd - 1].raw_end,
  };
};

export const mapRawSpanToNormalizedSpan = (
  start: number,
  end: number,
  offsetMap: SourceOffsetMap,
): { start: number; end: number } => {
  const rawStart = clamp(start, 0, offsetMap.raw_length);
  const rawEnd = clamp(end, rawStart, offsetMap.raw_length);
  return {
    start: offsetMap.raw_to_normalized[rawStart],
    end: offsetMap.raw_to_normalized[rawEnd],
  };
};

export const createTextUnits = (
  sourceDocId: string,
  text: string,
  options: TextUnitOptions = {},
): SidecarTextUnit[] => {
  const normalizedDocument = options.textIsNormalized
    ? {
        normalized_text: text,
        offset_map: options.offsetMap ?? buildIdentityOffsetMap(text),
      }
    : normalizeSourceDocument(text);
  const normalizedText = normalizedDocument.normalized_text;
  const rawText = options.rawText ?? (options.textIsNormalized ? text : text);
  const offsetMap = normalizedDocument.offset_map;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const units: SidecarTextUnit[] = [];
  let ordinal = 0;

  const pushUnit = (normalizedRangeStart: number, normalizedRangeEnd: number, kind: TextUnitKind) => {
    const { start, end } = trimSpan(normalizedText, normalizedRangeStart, normalizedRangeEnd);
    if (end <= start) return;

    const unitText = normalizedText.slice(start, end);
    const rawSpan = mapNormalizedSpanToRawSpan(start, end, offsetMap);
    units.push({
      source_doc_id: sourceDocId,
      text_unit_id: `${sourceDocId}:tu:${ordinal}:${start}-${end}`,
      ordinal,
      kind,
      start,
      end,
      normalized_start: start,
      normalized_end: end,
      raw_start: rawSpan.start,
      raw_end: rawSpan.end,
      text: unitText,
      raw_text: rawText.slice(rawSpan.start, rawSpan.end),
      char_length: unitText.length,
      token_estimate: estimateTokenCount(unitText),
      stable_hash: stableHash(unitText),
      metadata: buildTextUnitMetadata(unitText, options.metadata),
    });
    ordinal += 1;
  };

  const emitRange = (start: number, end: number, preferredKind: TextUnitKind) => {
    const { start: trimmedStart, end: trimmedEnd } = trimSpan(normalizedText, start, end);
    if (trimmedEnd <= trimmedStart) return;

    if (trimmedEnd - trimmedStart <= maxChars) {
      pushUnit(trimmedStart, trimmedEnd, preferredKind);
      return;
    }

    const sentenceRanges = splitSentenceRanges(normalizedText, trimmedStart, trimmedEnd);
    if (sentenceRanges.length > 1) {
      let currentStart = sentenceRanges[0].start;
      let currentEnd = sentenceRanges[0].end;

      for (let index = 1; index < sentenceRanges.length; index += 1) {
        const sentence = sentenceRanges[index];
        if (sentence.end - currentStart > maxChars) {
          emitRange(currentStart, currentEnd, "sentence");
          currentStart = sentence.start;
        }
        currentEnd = sentence.end;
      }

      emitRange(currentStart, currentEnd, "sentence");
      return;
    }

    splitHardRanges(normalizedText, trimmedStart, trimmedEnd, maxChars).forEach((range) => {
      pushUnit(range.start, range.end, "hard_split");
    });
  };

  splitParagraphRanges(normalizedText).forEach((range) => emitRange(range.start, range.end, "paragraph"));
  return units;
};
