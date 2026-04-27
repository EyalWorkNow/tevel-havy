import type { TemporalAnchor, TemporalPrecision } from "./contracts";

export type TemporalNormalizationResult = TemporalAnchor & {
  is_relative: boolean;
};

const MONTH_INDEX: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const toIsoDay = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number): Date => {
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
};

const startOfWeekUtc = (date: Date): Date => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return shiftDays(start, diff);
};

const startOfMonthUtc = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const clampPrecision = (rawText?: string, normalized?: string): TemporalPrecision => {
  if (!rawText && !normalized) return "unknown";
  if (rawText && /\b(?:early|mid|late|around|about|approximately|approx|this week|last week|next week|this month|last month|next month|currently|ongoing)\b/i.test(rawText)) {
    return "approximate";
  }
  if (normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "day";
  if (normalized && /^\d{4}-\d{2}$/.test(normalized)) return "month";
  if (normalized && /^\d{4}$/.test(normalized)) return "year";
  return "unknown";
};

const normalizeAbsoluteDate = (value: string): string | undefined => {
  const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const monthMatch = value.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);
  if (monthMatch) {
    const [, monthName, year] = monthMatch;
    const month = MONTH_INDEX[monthName.toLowerCase()];
    return month ? `${year}-${month}` : undefined;
  }

  const fuzzyYearMatch = value.match(/\b(?:early|mid|late)\s+(\d{4})\b/i);
  if (fuzzyYearMatch) return fuzzyYearMatch[1];

  const yearMatch = value.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) return yearMatch[0];

  return undefined;
};

const normalizeRelativeDate = (value: string, referenceDate: Date): Pick<TemporalNormalizationResult, "normalized_start" | "normalized_end" | "precision" | "confidence" | "assertion_mode" | "is_relative"> | undefined => {
  const lower = value.toLowerCase();

  if (/\btoday\b/.test(lower)) {
    return {
      normalized_start: toIsoDay(referenceDate),
      normalized_end: undefined,
      precision: "day",
      confidence: 0.72,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\byesterday\b/.test(lower)) {
    return {
      normalized_start: toIsoDay(shiftDays(referenceDate, -1)),
      normalized_end: undefined,
      precision: "day",
      confidence: 0.69,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\btomorrow\b/.test(lower)) {
    return {
      normalized_start: toIsoDay(shiftDays(referenceDate, 1)),
      normalized_end: undefined,
      precision: "day",
      confidence: 0.64,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\blast week\b/.test(lower)) {
    const thisWeek = startOfWeekUtc(referenceDate);
    const start = shiftDays(thisWeek, -7);
    const end = shiftDays(start, 6);
    return {
      normalized_start: toIsoDay(start),
      normalized_end: toIsoDay(end),
      precision: "approximate",
      confidence: 0.63,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\bthis week\b/.test(lower)) {
    const start = startOfWeekUtc(referenceDate);
    const end = shiftDays(start, 6);
    return {
      normalized_start: toIsoDay(start),
      normalized_end: toIsoDay(end),
      precision: "approximate",
      confidence: 0.61,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\bnext week\b/.test(lower)) {
    const start = shiftDays(startOfWeekUtc(referenceDate), 7);
    const end = shiftDays(start, 6);
    return {
      normalized_start: toIsoDay(start),
      normalized_end: toIsoDay(end),
      precision: "approximate",
      confidence: 0.58,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\blast month\b/.test(lower)) {
    const start = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 0));
    return {
      normalized_start: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      normalized_end: toIsoDay(end),
      precision: "approximate",
      confidence: 0.6,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\bthis month\b/.test(lower)) {
    const start = startOfMonthUtc(referenceDate);
    const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 0));
    return {
      normalized_start: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      normalized_end: toIsoDay(end),
      precision: "approximate",
      confidence: 0.58,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\bnext month\b/.test(lower)) {
    const start = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1));
    const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 2, 0));
    return {
      normalized_start: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      normalized_end: toIsoDay(end),
      precision: "approximate",
      confidence: 0.54,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  if (/\b(?:currently|ongoing)\b/.test(lower)) {
    return {
      normalized_start: toIsoDay(referenceDate),
      normalized_end: undefined,
      precision: "approximate",
      confidence: 0.48,
      assertion_mode: "explicit",
      is_relative: true,
    };
  }

  return undefined;
};

export const normalizeTemporalExpression = (
  rawText?: string,
  referenceDate?: string,
): TemporalNormalizationResult => {
  const normalizedReference = referenceDate ? new Date(referenceDate) : new Date();
  const effectiveReference = Number.isNaN(normalizedReference.getTime()) ? new Date() : normalizedReference;
  const text = rawText?.trim();

  if (!text) {
    return {
      raw_text: rawText,
      normalized_start: undefined,
      normalized_end: undefined,
      precision: "unknown",
      assertion_mode: "inferred",
      confidence: 0.35,
      is_relative: false,
    };
  }

  const relative = normalizeRelativeDate(text, effectiveReference);
  if (relative) {
    return {
      raw_text: text,
      ...relative,
    };
  }

  const normalized = normalizeAbsoluteDate(text);
  return {
    raw_text: text,
    normalized_start: normalized,
    normalized_end: undefined,
    precision: clampPrecision(text, normalized),
    assertion_mode: normalized ? "explicit" : "inferred",
    confidence: normalized
      ? /^\d{4}-\d{2}-\d{2}$/.test(normalized)
        ? 0.88
        : /^\d{4}-\d{2}$/.test(normalized)
          ? 0.82
          : /^\d{4}$/.test(normalized)
            ? /\b(?:early|mid|late)\b/i.test(text)
              ? 0.56
              : 0.72
            : 0.6
      : 0.35,
    is_relative: false,
  };
};
