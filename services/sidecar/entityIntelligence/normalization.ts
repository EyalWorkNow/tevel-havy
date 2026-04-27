import type { ConfidenceBand, EntityMentionLabel, MentionType } from "./types";

export const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const normalizeEntityText = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/[‘’‚‛“”„‟״׳`']/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[()[\]{}.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const stripHonorifics = (value: string): { canonical: string; stripped: string[] } => {
  const stripped: string[] = [];
  let current = value.trim();
  const patterns = [
    /^(mr|mrs|ms|dr|prof|capt|commander|colonel|director|agent)\.?\s+/i,
    /^(מר|גב׳|גברת|ד"ר|פרופ(?:׳|')?|אלוף|מפקד|קצין|שר|מנכ"ל)\s+/u,
    /^(السيد|السيدة|د\.?|دكتور|دكتورة|عميد|عقيد|لواء|رائد|نقيب|مقدم|مدير)\s+/u,
  ];
  patterns.forEach((pattern) => {
    const match = current.match(pattern);
    if (match) {
      stripped.push(match[0].trim());
      current = current.replace(pattern, "").trim();
    }
  });
  return { canonical: current, stripped };
};

export const normalizeInitials = (value: string): string =>
  value
    .replace(/\b([A-Z])\./g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export const transliterationSkeleton = (value: string): string =>
  normalizeEntityText(value)
    .replace(/kh/g, "h")
    .replace(/ph/g, "f")
    .replace(/ou/g, "u")
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/w/g, "v")
    .replace(/ibn/g, "bin")
    .replace(/ben/g, "bin")
    .replace(/abu/g, "abo")
    .replace(/al /g, "el ")
    .replace(/abd/g, "abed");

export const classifyMentionType = (label: string, text: string): MentionType => {
  if (/^(he|she|they|him|her|them|הוא|היא|הם|הן)$/iu.test(text.trim())) return "pronoun";
  if (["EMAIL", "PHONE", "URL", "HANDLE", "USERNAME", "ID_NUMBER", "REGISTRATION_NUMBER"].includes(label)) {
    return "structured-id";
  }
  if (["ROLE", "TITLE"].includes(label)) return "nominal";
  return "named";
};

export const normalizeLabel = (value?: string): EntityMentionLabel => {
  const normalized = (value || "OTHER").toUpperCase();
  switch (normalized) {
    case "PERSON":
    case "ORG":
    case "LOCATION":
    case "GPE":
    case "FACILITY":
    case "EVENT":
    case "EMAIL":
    case "PHONE":
    case "URL":
    case "HANDLE":
    case "USERNAME":
    case "ID_NUMBER":
    case "REGISTRATION_NUMBER":
    case "ROLE":
    case "TITLE":
      return normalized;
    default:
      return "OTHER";
  }
};

export const confidenceBand = (value: number, unresolved = false): ConfidenceBand => {
  if (unresolved) return "unresolved";
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
};

export const lexicalSimilarity = (left: string, right: string): number => {
  const a = new Set(normalizeEntityText(left).split(" ").filter(Boolean));
  const b = new Set(normalizeEntityText(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((token) => {
    if (b.has(token)) overlap += 1;
  });
  return overlap / new Set([...a, ...b]).size;
};

export const surnameOf = (value: string): string => {
  const parts = normalizeEntityText(stripHonorifics(value).canonical).split(" ").filter(Boolean);
  return parts[parts.length - 1] || "";
};

export const canonicalSurface = (value: string): { canonical: string; aliases: string[] } => {
  const normalizedInitials = normalizeInitials(value);
  const stripped = stripHonorifics(normalizedInitials);
  const aliases = Array.from(new Set([value.trim(), normalizedInitials, stripped.canonical].filter(Boolean)));
  return {
    canonical: stripped.canonical || value.trim(),
    aliases,
  };
};
