import {
  askContextualQuestion,
  classifyReasoningFailure,
  getReasoningEngineDescriptor,
  isEntityMatch,
  PRIMARY_REASONING_ENGINE,
  type ReasoningEngineDescriptor,
  type ReasoningEngineId,
  type ReasoningEngineSurface,
  type ReasoningFailureKind,
} from "./intelligenceService";
import { detectDocumentDomain, isIntelligenceCompatibleDomain, domainLabel } from "./documentDomain";
import type { IntelligencePackage, StudyItem, Entity, Relation, ContextCard, Insight, TimelineEvent, Statement, IntelQuestion, IntelTask, ChatMessage } from "../types";
import type { RetrievalArtifacts, RetrievalEvidenceBundle, RetrievalEvidenceHit } from "./sidecar/retrieval";
import type { StructuredSummaryPanel } from "./sidecar/summarization/contracts";
import type { CitationVerificationRun } from "./sidecar/citationVerification/contracts";
import type { VersionEdge, VersionValidityArtifacts } from "./sidecar/versionValidity/contracts";
import { normalizeLookupText } from "./sidecar/textUnits";
import {
  buildFcfR3DeterministicAnswer,
  buildFcfR3ReadPath,
  type FcfR3AuditSummary,
  type FcfR3ReadPathRun,
} from "./fcfR3Service";
import {
  synthesizeAcrossDocuments,
  formatCrossDocumentSynthesisHebrew,
  formatCrossDocumentSynthesisEnglish,
} from "./intelligence/crossDocumentSynthesis";
import { buildFcfR3PersistedRun } from "./fcfR3/contracts";
import { persistFcfR3Run } from "./fcfR3/store";
import { verifyAnswerCitations } from "./sidecar/citationVerification/service";
import type { ResearchProfileId } from "./researchProfiles";

const MAX_SELECTED_STUDIES = 4;
const CROSS_DOCUMENT_QUERY_RE =
  /\b(?:all database|entire database|global search|cross[-\s]?case|across cases|compare cases|all reports|other cases|full db|whole corpus)\b|בכל המאגר|כל המאגר|חיפוש גלובלי|בין כל התיקים|השווה בין.*תיקים|עוד תיקים|כל הדוחות|בין הקבצים|שלושת הקבצים|כל הקבצים|הצלבה|השוואה(?:\s*בין)|דפוס\s*חוזר|תמונה\s*מערכתית|מחקר\s*רב.מסמכי|סינתזה\s*חוצת/i;
const MAX_MATCHED_SIGNALS = 5;
const MAX_EVIDENCE_PREVIEWS = 3;
const MAX_RAW_SOURCE_EXCERPTS = 3;
const MAX_RAW_SOURCE_EXCERPT_CHARS = 860;
const MAX_RAW_SOURCE_SEGMENTS = 720;
const MAX_STUDY_BLOCK_CHARS = 1400;
const MAX_CORPUS_TEXT_CHARS = 6500;
const MAX_STUDY_GIST_CHARS = 420;
const MAX_CONTEXT_CARD_CHARS = 360;
const MAX_EVIDENCE_SNIPPET_CHARS = 520;
const isGlobalDbSearchQuery = (question: string): boolean =>
  /\b(?:all database|entire database|global search|cross[-\s]?case|across cases|compare cases|all reports|other cases|full db|whole corpus)\b|בכל המאגר|כל המאגר|חיפוש גלובלי|בין כל התיקים|השווה בין.*תיקים|עוד תיקים|כל הדוחות/i.test(
    question,
  );
const QUERY_STOPWORDS = new Set([
  "מה",
  "מי",
  "איך",
  "למה",
  "כמה",
  "איפה",
  "אילו",
  "איזה",
  "האם",
  "הוא",
  "היא",
  "הם",
  "הן",
  "זה",
  "זאת",
  "על",
  "אודות",
  "לגבי",
  "בנוגע",
  "אני",
  "אתה",
  "את",
  "יכול",
  "יכולה",
  "ספר",
  "לספר",
  "תספר",
  "תגיד",
  "לי",
  "the",
  "what",
  "who",
  "about",
  "tell",
  "can",
  "could",
  "you",
  "me",
  "please",
  "analyze",
  "analysis",
  "document",
  "documents",
  "file",
  "files",
  "uploaded",
  "upload",
  "report",
  "reports",
  "בבקשה",
  "נתח",
  "ניתוח",
  "מסמך",
  "מסמכים",
  "קובץ",
  "קבצים",
  "דוח",
  "דוחות",
  "שהעליתי",
  "העליתי",
]);

export interface LiveResearchSource {
  id: string;
  title: string;
  date: string;
  source: StudyItem["source"];
  relevance: number;
  reliability: number;
  citationReady: boolean;
  watchlistHits: number;
  openQuestions: number;
  openTasks: number;
  matchedSignals: string[];
  evidencePreview: string[];
}

export interface LiveResearchScopeSummary {
  totalStudies: number;
  scopedStudies: number;
  selectedStudies: number;
  totalEntities: number;
  totalRelations: number;
  citationReadyStudies: number;
  watchlistHits: number;
  retrievalBundles: number;
  retrievalHits: number;
  active_context_id?: string;
  active_context_reason?: string;
  active_context_confidence?: number;
  query_entity_mentions_in_context?: number;
  alias_mentions_in_context?: number;
  number_of_relevant_evidence_atoms?: number;
  competing_contexts?: Array<{ id: string; title: string; confidence: number }>;
}

export interface LiveResearchCorpus {
  package: IntelligencePackage;
  sources: LiveResearchSource[];
  scope: LiveResearchScopeSummary;
  warnings: string[];
}

export interface LiveResearchEngineTrace {
  engineId: ReasoningEngineDescriptor["id"];
  engineLabel: string;
  engineSurface: ReasoningEngineSurface;
  responseMode: "model-answer" | "verified-synthesis" | "deterministic-fallback";
  failureKind?: ReasoningFailureKind;
  failureMessage?: string;
}

export interface LiveResearchAnswer {
  answer: string;
  sources: LiveResearchSource[];
  scope: LiveResearchScopeSummary;
  warnings: string[];
  verificationNote?: string;
  citationGuard: "active" | "limited";
  engineTrace?: LiveResearchEngineTrace;
  fcfAudit?: FcfR3AuditSummary;
  tokenBenchmark?: LiveResearchTokenBenchmark;
}

export interface LiveResearchQuestionOptions {
  reasoningEngineId?: ReasoningEngineId;
  geminiApiKey?: string;
  precomputedCorpus?: LiveResearchCorpus;
}

export interface LiveResearchTokenBenchmark {
  route: "source-grounded" | "fcf-r3" | "blocked" | "empty";
  selectedSourceCount: number;
  scopedSourceCount: number;
  rawSourceChars: number;
  rawSourceEstimatedTokens: number;
  selectedContextChars: number;
  selectedContextEstimatedTokens: number;
  promptEstimatedTokens: number;
  compressionRatio: number;
  outputExclusions: string[];
  warnings: string[];
}

type ScoredStudy = {
  study: StudyItem;
  relevance: number;
  matchedSignals: string[];
  evidencePreview: string[];
  exactEntityMatches: string[];
  entityTermMatches: string[];
  phraseMatches: string[];
  matchedTerms: string[];
  lexicalScore: number;
  queryEntityMentions: number;
  aliasMentions: number;
  relevantEvidenceAtoms: number;
  relevantClusterDensity: number;
  activeContextConfidence: number;
  activeContextReason: string;
};

type StudySelectionResult = {
  selected: ScoredStudy[];
  activeContextId?: string;
  activeContextReason?: string;
  activeContextConfidence?: number;
  queryEntityMentionsInContext?: number;
  aliasMentionsInContext?: number;
  numberOfRelevantEvidenceAtoms?: number;
  competingContexts: Array<{ id: string; title: string; confidence: number }>;
  ambiguous: boolean;
};

type SecDocumentKind = "FORM 10-K" | "FORM 10-Q" | "FORM 20-F" | "FORM 8-K" | "FORM 4" | "FORM 3" | "FORM 5" | "SEC document" | "unknown";

type RawSourceExcerptOptions = {
  documentKind?: SecDocumentKind;
  financeIntent?: boolean;
  maxExcerpts?: number;
};

const normalize = (value: string): string => normalizeLookupText(value);

const uniqueStrings = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

const estimateTokens = (value: string): number => Math.ceil((value || "").length / 4);

const truncateText = (value: string, maxChars: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
};

const sortCharacters = (value: string): string => value.split("").sort().join("");

const damerauLevenshteinDistance = (left: string, right: string, maxDistance = 2): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array.from<number>({ length: cols }).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );

      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      ) {
        matrix[row][col] = Math.min(matrix[row][col], matrix[row - 2][col - 2] + 1);
      }

      rowMin = Math.min(rowMin, matrix[row][col]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
  }

  return matrix[left.length][right.length];
};

const tokensLooselyMatch = (left: string, right: string): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length >= 4 && right.length >= 4 && left[0] === right[0] && sortCharacters(left) === sortCharacters(right)) {
    return true;
  }
  return damerauLevenshteinDistance(left, right, 1) <= 1;
};

const isLoosePhraseEntityMatch = (candidate: string, phrase: string): boolean => {
  const normalizedCandidate = normalize(candidate);
  const normalizedPhrase = normalize(phrase);
  if (!normalizedCandidate || !normalizedPhrase) return false;
  if (
    normalizedPhrase.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedPhrase)
  ) {
    return true;
  }

  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);
  const phraseTokens = normalizedPhrase.split(" ").filter(Boolean);
  if (!candidateTokens.length || candidateTokens.length > phraseTokens.length) return false;

  for (let start = 0; start <= phraseTokens.length - candidateTokens.length; start += 1) {
    const window = phraseTokens.slice(start, start + candidateTokens.length);
    const allMatch = candidateTokens.every((token, index) => tokensLooselyMatch(token, window[index]));
    if (!allMatch) continue;

    const exactTokenCount = candidateTokens.filter((token, index) => token === window[index]).length;
    if (exactTokenCount > 0 || candidateTokens.length === 1) {
      return true;
    }
  }

  return false;
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const parseDateWeight = (value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0;
  const ageMs = Math.max(0, Date.now() - parsed);
  const ageDays = ageMs / 86_400_000;
  return Math.max(0, 1 - ageDays / 120);
};

const splitTerms = (value: string): string[] =>
  uniqueStrings(
    normalize(value)
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 1 && !QUERY_STOPWORDS.has(term)),
  );

const normalizedTokens = (value: string): string[] => normalize(value).split(/\s+/).filter(Boolean);

// Returns true only when the user is explicitly asking for SEC/financial-metric analysis.
// Hebrew intelligence/investigative queries mentioning money do NOT trigger this.
const hasFinanceOrSecIntent = (question: string): boolean => {
  // Strong explicit SEC intent
  if (/\b(?:sec|10-k|10-q|20-f|8-k|s-1|filing|annual report|quarterly report)\b|מסמכי?\s*sec/i.test(question)) return true;
  // Quantitative financial metric request (not investigative money mention)
  if (/\b(?:revenue|income statement|balance sheet|cash flow|ebitda|gross margin|net income|liquidity|assets|liabilities|P&L|free cash flow)\b/i.test(question)) return true;
  // Hebrew finance metric request — only when paired with financial metric nouns, not general investigative
  if (/(?:ניתוח\s*פיננסי\s*של\s*מסמכי|דוח\s*כספי|מאזן\s*חשבונאי|רווח\s*גולמי|תזרים\s*מזומנים|EBITDA|הכנסות\s*(?:שנתיות|רבעוניות))/i.test(question)) return true;
  return false;
};

const detectSecDocumentKind = (rawText = "", title = ""): SecDocumentKind => {
  const sample = `${title}\n${rawText.slice(0, 30000)}`;
  if (/\bFORM\s+10-K\b/i.test(sample)) return "FORM 10-K";
  if (/\bFORM\s+10-Q\b/i.test(sample)) return "FORM 10-Q";
  if (/\bFORM\s+20-F\b/i.test(sample)) return "FORM 20-F";
  if (/\bFORM\s+8-K\b/i.test(sample)) return "FORM 8-K";
  if (/\bFORM\s+4\b/i.test(sample)) return "FORM 4";
  if (/\bFORM\s+3\b/i.test(sample)) return "FORM 3";
  if (/\bFORM\s+5\b/i.test(sample)) return "FORM 5";
  // "SEC" alone is not enough — require explicit SECURITIES AND EXCHANGE COMMISSION text
  if (/\bSECURITIES AND EXCHANGE COMMISSION\b/i.test(sample)) return "SEC document";
  // Default to "unknown" — never assume SEC for documents that lack explicit SEC evidence
  return "unknown";
};

const isFinancialSecReport = (kind: SecDocumentKind): boolean =>
  kind === "FORM 10-K" || kind === "FORM 10-Q" || kind === "FORM 20-F";

const isOwnershipSecForm = (kind: SecDocumentKind): boolean =>
  kind === "FORM 3" || kind === "FORM 4" || kind === "FORM 5";

const inferSourceDisplayName = (title: string): string => {
  if (/amazon/i.test(title)) return "Amazon";
  if (/apple/i.test(title)) return "Apple";
  if (/microsoft/i.test(title)) return "Microsoft";
  const withoutExtension = title.replace(/\.(?:pdf|docx?|txt)$/i, "").trim();
  return truncateText(withoutExtension || title, 64);
};

const isDocumentGroundedQuestion = (question: string): boolean =>
  hasFinanceOrSecIntent(question) ||
  /\b(?:uploaded|upload|documents|files|filings|reports|source documents|source files)\b|מסמכים|קבצים|דוחות|שהעליתי|העליתי/i.test(
    question,
  );

const expandDomainQueryTerms = (question: string, terms: string[]): string[] => {
  const expanded = [...terms];
  if (/\b(?:sec|10-k|10-q|20-f|8-k|s-1|filing|annual report|quarterly report)\b|מסמכי?\s*sec/i.test(question)) {
    expanded.push(
      "sec",
      "securities",
      "exchange",
      "commission",
      "form",
      "10-k",
      "10-q",
      "20-f",
      "8-k",
      "annual",
      "quarterly",
      "filing",
      "registrant",
    );
  }
  if (hasFinanceOrSecIntent(question)) {
    expanded.push(
      "revenue",
      "income",
      "cash",
      "flow",
      "debt",
      "liquidity",
      "assets",
      "liabilities",
      "margin",
      "profit",
      "loss",
      "operating",
      "expenses",
      "ebitda",
      "risk",
      "yoy",
      "qoq",
      "הכנסות",
      "רווח",
      "תזרים",
      "מאזן",
      "חוב",
      "נזילות",
    );
  }
  return uniqueStrings(expanded.map((term) => normalize(term)).filter(Boolean));
};

const entityMatchesQueryTerm = (candidate: string, queryTerms: string[]): boolean => {
  const candidateTokens = normalizedTokens(candidate);
  return queryTerms.some((term) => {
    if (term.length < 3) return false;
    return candidateTokens.some((token) => token === term || tokensLooselyMatch(token, term));
  });
};

const extractQueryPhrases = (value: string): string[] => {
  const normalized = normalize(value);
  const phrases = new Set<string>();
  const aboutMatch = normalized.match(/(?:^|\s)(?:על|לגבי|אודות|בנוגע|about)\s+(.+)$/i);
  if (aboutMatch?.[1]) {
    phrases.add(aboutMatch[1].trim());
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (let length = 4; length >= 2; length -= 1) {
    for (let index = 0; index <= tokens.length - length; index += 1) {
      const phrase = tokens.slice(index, index + length).join(" ").trim();
      if (!phrase) continue;
      if (phrase.split(" ").every((token) => QUERY_STOPWORDS.has(token))) continue;
      phrases.add(phrase);
    }
  }

  return Array.from(phrases).slice(0, 10);
};

const summarizePanel = (panel?: StructuredSummaryPanel): string[] => {
  if (!panel) return [];
  return uniqueStrings([panel.summary_text, ...(panel.key_findings || []), ...(panel.contradictions || [])]).slice(0, 4);
};

const scoreEvidenceSnippet = (snippet: string, queryTerms: string[], queryPhrases: string[], matchedEntities: string[]): number => {
  const normalizedSnippet = normalize(snippet);
  const lexicalScore = queryTerms.filter((term) => normalizedSnippet.includes(term)).length * 1.4;
  const phraseScore = queryPhrases.filter((phrase) => normalizedSnippet.includes(phrase)).length * 2.2;
  const entityScore = matchedEntities.filter((entity) => normalizedSnippet.includes(normalize(entity))).length * 2.8;
  return lexicalScore + phraseScore + entityScore;
};

const countRegexHits = (value: string, patterns: RegExp[]): number =>
  patterns.reduce((sum, pattern) => sum + (value.match(pattern)?.length || 0), 0);

const FINANCIAL_SECTION_PATTERNS = [
  /\bitem\s+7\b/gi,
  /\bmanagement'?s discussion\b/gi,
  /\bresults of operations\b/gi,
  /\bliquidity and capital resources\b/gi,
  /\bconsolidated statements? of (?:operations|cash flows|balance sheets?)\b/gi,
  /\bselected financial data\b/gi,
];

const FINANCIAL_METRIC_PATTERNS = [
  /\bnet sales\b/gi,
  /\brevenues?\b/gi,
  /\boperating income\b/gi,
  /\boperating loss\b/gi,
  /\bnet income\b/gi,
  /\bgross margin\b/gi,
  /\bcash flows?\b/gi,
  /\boperating cash\b/gi,
  /\bliquidity\b/gi,
  /\btotal assets\b/gi,
  /\btotal liabilities\b/gi,
  /\bdebt\b/gi,
  /\bcash and cash equivalents\b/gi,
  /\bresearch and development\b/gi,
  /\bcapital expenditures?\b/gi,
  /\brisk factors?\b/gi,
];

const OWNERSHIP_FORM_PATTERNS = [
  /\breporting owner\b/gi,
  /\bissuer\b/gi,
  /\btransaction date\b/gi,
  /\bsecurities acquired\b/gi,
  /\bsecurities disposed\b/gi,
  /\bnon-derivative securities\b/gi,
  /\bbeneficial owner\b/gi,
];

const GENERIC_SEC_BOILERPLATE_PATTERNS = [
  /\bunited states securities and exchange commission\b/gi,
  /\bcommission file number\b/gi,
  /\btable of contents\b/gi,
  /\bsignatures?\b/gi,
  /\bcertification\b/gi,
];

const hasFinancialNumber = (value: string): boolean =>
  /(?:\$|USD|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:million|billion)\b)/i.test(value);

const scoreRawSourceSegment = (
  segment: string,
  index: number,
  queryTerms: string[],
  queryPhrases: string[],
  matchedEntities: string[],
  options: RawSourceExcerptOptions,
): number => {
  const documentKind = options.documentKind || "unknown";
  const financeIntent = Boolean(options.financeIntent);
  let score = scoreEvidenceSnippet(segment, queryTerms, queryPhrases, matchedEntities) + (index === 0 ? 0.15 : 0);

  if (!financeIntent) return score;

  const sectionHits = countRegexHits(segment, FINANCIAL_SECTION_PATTERNS);
  const metricHits = countRegexHits(segment, FINANCIAL_METRIC_PATTERNS);
  const ownershipHits = countRegexHits(segment, OWNERSHIP_FORM_PATTERNS);
  const boilerplateHits = countRegexHits(segment, GENERIC_SEC_BOILERPLATE_PATTERNS);

  if (isFinancialSecReport(documentKind)) {
    score += sectionHits * 4.5 + metricHits * 2.2 + (hasFinancialNumber(segment) ? 1.1 : 0);
    score -= Math.min(3, boilerplateHits * 0.8);
    if (/\bcover page\b|\bexact name of registrant\b|\bindicate by check mark\b/i.test(segment)) score -= 2.2;
    if (ownershipHits > 0 && metricHits === 0) score -= 2.5;
  } else if (isOwnershipSecForm(documentKind)) {
    score += /\bFORM\s+[345]\b/i.test(segment) ? 4.5 : 0;
    score += ownershipHits * 1.6;
    score += /\bAmazon|Apple|Microsoft|issuer\b/i.test(segment) ? 0.8 : 0;
    score -= metricHits > 0 ? 0 : 0.4;
  } else {
    score += metricHits * 1.8 + sectionHits * 2.5 + (hasFinancialNumber(segment) ? 0.8 : 0);
    score -= Math.min(2.2, boilerplateHits * 0.7);
  }

  return score;
};

const splitRawSourceSegments = (rawText: string): string[] => {
  const normalized = rawText.replace(/\r/g, "").replace(/[ \t\u00A0]+/g, " ").trim();
  if (!normalized) return [];

  const paragraphSegments = normalized
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 40);
  const sourceSegments = paragraphSegments.length
    ? paragraphSegments
    : normalized
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"$€₪])/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length >= 40);

  const chunks: string[] = [];
  sourceSegments.forEach((segment) => {
    if (segment.length <= MAX_RAW_SOURCE_EXCERPT_CHARS) {
      chunks.push(segment);
      return;
    }
    for (let offset = 0; offset < segment.length; offset += MAX_RAW_SOURCE_EXCERPT_CHARS) {
      const chunk = segment.slice(offset, offset + MAX_RAW_SOURCE_EXCERPT_CHARS).trim();
      if (chunk.length >= 40) chunks.push(chunk);
    }
  });
  return chunks.slice(0, MAX_RAW_SOURCE_SEGMENTS);
};

const pickRawSourceExcerpts = (
  rawText: string | undefined,
  queryTerms: string[],
  queryPhrases: string[],
  matchedEntities: string[],
  options: RawSourceExcerptOptions = {},
): string[] => {
  if (!rawText?.trim()) return [];
  const segments = splitRawSourceSegments(rawText);
  if (!segments.length) return [];

  const documentKind = options.documentKind || detectSecDocumentKind(rawText);
  const maxExcerpts = Math.max(
    1,
    Math.min(
      options.maxExcerpts || MAX_RAW_SOURCE_EXCERPTS,
      options.financeIntent && isOwnershipSecForm(documentKind) ? 1 : MAX_RAW_SOURCE_EXCERPTS,
    ),
  );
  const ranked = segments
    .map((segment, index) => ({
      segment,
      score: scoreRawSourceSegment(segment, index, queryTerms, queryPhrases, matchedEntities, {
        ...options,
        documentKind,
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const relevant = ranked.filter((entry) => entry.score > 0.15);
  const selected = relevant.length ? relevant : ranked.slice(0, 1);

  return selected
    .slice(0, maxExcerpts)
    .map((entry) => truncateText(entry.segment, MAX_RAW_SOURCE_EXCERPT_CHARS));
};

const pickEvidencePreview = (
  study: StudyItem,
  queryTerms: string[],
  queryPhrases: string[],
  matchedEntities: string[],
  financeIntent = false,
): string[] => {
  const entityEvidence = (study.intelligence.entities || [])
    .filter((entity) => matchedEntities.some((name) => isEntityMatch(name, entity.name)))
    .flatMap((entity) => [
      entity.description || "",
      ...(entity.evidence || []),
      ...(study.intelligence.context_cards?.[entity.name]?.key_mentions || []),
      study.intelligence.context_cards?.[entity.name]?.summary || "",
      study.intelligence.context_cards?.[entity.name]?.role_in_document || "",
    ])
    .filter(Boolean);

  const retrievalHits = Object.values(study.intelligence.retrieval_artifacts?.bundles || {})
    .flatMap((bundle) => bundle.hits)
    .filter((hit) => !hit.reference_only)
    .map((hit) => ({
      snippet: hit.snippet,
      score: scoreEvidenceSnippet(hit.snippet, queryTerms, queryPhrases, matchedEntities) + hit.score * 0.1,
    }));

  const summaryFindings = Object.values(study.intelligence.summary_panels || {})
    .flatMap((panel) => summarizePanel(panel));
  const rawSourceExcerpts = pickRawSourceExcerpts(
    study.intelligence.raw_text,
    queryTerms,
    queryPhrases,
    matchedEntities,
    {
      documentKind: detectSecDocumentKind(study.intelligence.raw_text || study.intelligence.clean_text || "", study.title),
      financeIntent,
    },
  );

  const evidence = uniqueStrings([
    ...entityEvidence,
    ...retrievalHits
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.snippet),
    ...rawSourceExcerpts,
    ...summaryFindings,
    ...(study.intelligence.research_dossier?.pressure_points || []),
    study.intelligence.clean_text,
  ])
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rankedEvidence = evidence
    .map((item, index) => ({
      item,
      score: scoreEvidenceSnippet(item, queryTerms, queryPhrases, matchedEntities) + (index === 0 ? 0.3 : 0),
    }))
    .sort((left, right) => right.score - left.score)
  const relevantEvidence = rankedEvidence.filter((entry) => entry.score > 0);

  return (relevantEvidence.length ? relevantEvidence : rankedEvidence)
    .map((entry) => entry.item)
    .slice(0, MAX_EVIDENCE_PREVIEWS);
};

const buildStudySearchText = (study: StudyItem): string => {
  const pkg = study.intelligence;
  return [
    study.title,
    study.date,
    study.source,
    pkg.clean_text,
    pkg.raw_text?.slice(0, 12000) || "",
    ...(pkg.entities || []).flatMap((entity) => [entity.name, ...(entity.aliases || [])]),
    ...(pkg.insights || []).map((insight) => insight.text),
    ...(pkg.intel_questions || []).map((question) => question.question_text),
    ...(pkg.intel_tasks || []).map((task) => task.task_text),
    ...(pkg.timeline || []).map((event) => `${event.date} ${event.event}`),
    ...(pkg.research_dossier?.pressure_points || []),
    ...(pkg.research_dossier?.collection_priorities || []),
    ...Object.values(pkg.summary_panels || {}).flatMap((panel) => summarizePanel(panel)),
  ]
    .filter(Boolean)
    .join("\n");
};

const computeFallbackPriority = (study: StudyItem): number => {
  const pkg = study.intelligence;
  const reliability = pkg.reliability || 0;
  const openQuestions = (pkg.intel_questions || []).length;
  const openTasks = (pkg.intel_tasks || []).filter((task) => task.status !== "CLOSED").length;
  const watchlistHits = (pkg.watchlist_hits || []).length;
  const relationDensity = Math.min(1.2, (pkg.relations || []).length / 25);
  const recency = parseDateWeight(study.date);
  return reliability * 2.2 + openQuestions * 0.12 + openTasks * 0.16 + watchlistHits * 0.3 + relationDensity + recency * 0.4;
};

const countMentionMatches = (study: StudyItem, names: string[]): { exact: number; alias: number } => {
  if (!names.length) return { exact: 0, alias: 0 };
  const haystack = normalize(buildStudySearchText(study));
  let exact = 0;
  let alias = 0;
  names.forEach((name, index) => {
    const normalizedName = normalize(name);
    if (!normalizedName || normalizedName.length < 3) return;
    const hitCount = haystack.split(normalizedName).length - 1;
    if (index === 0) exact += Math.max(0, hitCount);
    else alias += Math.max(0, hitCount);
  });
  return { exact, alias };
};

const countRelevantEvidenceAtoms = (study: StudyItem, matchedEntities: string[]): number => {
  const retrievalHits = Object.values(study.intelligence.retrieval_artifacts?.bundles || {})
    .flatMap((bundle) => bundle.hits)
    .filter((hit) => !hit.reference_only)
    .filter(
      (hit) =>
        matchedEntities.some((entity) => (hit.related_entities || []).some((related) => isEntityMatch(related, entity))) ||
        matchedEntities.some((entity) => normalize(hit.snippet).includes(normalize(entity))),
    );
  const statements = (study.intelligence.statements || []).filter((statement) =>
    (statement.related_entities || []).some((entity) => matchedEntities.some((matched) => isEntityMatch(entity, matched))),
  );
  const entityEvidence = (study.intelligence.entities || []).filter((entity) =>
    matchedEntities.some((matched) => isEntityMatch(entity.name, matched) || (entity.aliases || []).some((alias) => isEntityMatch(alias, matched))),
  );
  const contextCardEvidence = Object.entries(study.intelligence.context_cards || {}).filter(([name]) =>
    matchedEntities.some((matched) => isEntityMatch(name, matched)),
  );
  return retrievalHits.length + statements.length + entityEvidence.length + contextCardEvidence.length;
};

const computeActiveContextConfidence = (
  study: StudyItem,
  exactEntityMatches: string[],
  entityTermMatches: string[],
  evidencePreview: string[],
  phraseMatches: string[],
  queryEntityMentions: number,
  aliasMentions: number,
  relevantEvidenceAtoms: number,
  relevantClusterDensity: number,
): { confidence: number; reason: string } => {
  const reasons: string[] = [];
  let score = 0;

  if (exactEntityMatches.length > 0) {
    score += 0.42;
    reasons.push("exact entity match");
  }
  if (entityTermMatches.length > 0) {
    score += 0.24;
    reasons.push("entity or alias term match");
  }
  if (queryEntityMentions >= 2) {
    score += 0.24;
    reasons.push("multiple direct mentions");
  }
  if (aliasMentions >= 2) {
    score += 0.12;
    reasons.push("multiple alias mentions");
  }
  if (relevantEvidenceAtoms >= 2) {
    score += 0.14;
    reasons.push("multiple relevant evidence atoms");
  }
  if (relevantClusterDensity >= 1.5) {
    score += 0.1;
    reasons.push("high relevant cluster density");
  }
  if (entityTermMatches.length > 0 && evidencePreview.length > 0) {
    score += 0.08;
    reasons.push("entity-grounded evidence preview");
  }
  if (phraseMatches.length > 0) {
    score += 0.06;
    reasons.push("query phrase overlap");
  }
  score += Math.min(0.08, parseDateWeight(study.date) * 0.08);

  return {
    confidence: Number(Math.min(0.99, score).toFixed(2)),
    reason: reasons.join(", ") || "weak matched signals only",
  };
};

const scoreStudy = (question: string, study: StudyItem): ScoredStudy => {
  const queryTerms = expandDomainQueryTerms(question, splitTerms(question));
  const queryPhrases = extractQueryPhrases(question);
  const haystack = normalize(buildStudySearchText(study));
  const pkg = study.intelligence;

  const exactEntityMatches = uniqueStrings(
    (pkg.entities || [])
      .filter((entity) =>
        [entity.name, ...(entity.aliases || [])].some((candidate) => {
          const normalizedCandidate = normalize(candidate);
          return normalizedCandidate.length >= 3 && queryPhrases.some((phrase) => isLoosePhraseEntityMatch(candidate, phrase));
        }),
      )
      .map((entity) => entity.name),
  );

  const phraseMatches = queryPhrases.filter((phrase) => haystack.includes(phrase)).slice(0, 4);

  const entityTermMatches = uniqueStrings(
    (pkg.entities || [])
      .filter((entity) =>
        [entity.name, ...(entity.aliases || [])].some((candidate) => entityMatchesQueryTerm(candidate, queryTerms)),
      )
      .map((entity) => entity.name),
  );

  const matchedEntities = uniqueStrings(
    (pkg.entities || [])
      .filter((entity) =>
        [entity.name, ...(entity.aliases || [])].some((candidate) =>
          queryTerms.some((term) => normalize(candidate).includes(term) || term.includes(normalize(candidate))),
        ),
      )
      .map((entity) => entity.name),
  );

  const allEntityMatches = uniqueStrings([...exactEntityMatches, ...entityTermMatches, ...matchedEntities]);
  const matchedEntityCount = allEntityMatches.length;
  const financeIntent = hasFinanceOrSecIntent(question);
  const evidencePreview = pickEvidencePreview(study, queryTerms, queryPhrases, allEntityMatches, financeIntent);
  const evidenceBoost = evidencePreview.some((item) => queryTerms.some((term) => normalize(item).includes(term))) ? 0.18 : 0;
  const mentionCounts = countMentionMatches(study, allEntityMatches);
  const relevantEvidenceAtoms = countRelevantEvidenceAtoms(study, allEntityMatches);
  const relevantClusterDensity = Number(
    (
      Object.values(pkg.retrieval_artifacts?.bundles || {}).filter((bundle) =>
        bundle.hits.some((hit) =>
          allEntityMatches.some(
            (entity) =>
              (hit.related_entities || []).some((related) => isEntityMatch(related, entity)) ||
              normalize(hit.snippet).includes(normalize(entity)),
          ),
        ),
      ).length || 0
    ).toFixed(2),
  );

  const textMatchedEntities = (pkg.entities || [])
    .filter((entity) =>
      [entity.name, ...(entity.aliases || [])].some((candidate) =>
        queryTerms.some((term) => normalize(candidate).includes(term) || term.includes(normalize(candidate))),
      ),
    )
    .map((entity) => entity.name);

  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const lexicalScore = queryTerms.length ? matchedTerms.length / queryTerms.length : 0;
  const entityScore = matchedEntityCount ? Math.min(1, matchedEntityCount / 4) : 0;
  const fallbackPriority = computeFallbackPriority(study);

  const matchedSignals = uniqueStrings([
    ...exactEntityMatches,
    ...entityTermMatches,
    ...textMatchedEntities,
    ...phraseMatches,
    ...(pkg.intel_questions || [])
      .map((question) => question.question_text)
      .filter((item) => queryTerms.some((term) => normalize(item).includes(term))),
    ...(pkg.intel_tasks || [])
      .map((task) => task.task_text)
      .filter((item) => queryTerms.some((term) => normalize(item).includes(term))),
    ...evidencePreview.filter((item) => queryTerms.some((term) => normalize(item).includes(term))),
  ]).slice(0, MAX_MATCHED_SIGNALS);

  const relevance =
    queryTerms.length === 0
      ? fallbackPriority
      : lexicalScore * 1.5 +
        entityScore * 1.1 +
        entityTermMatches.length * 1.25 +
        phraseMatches.length * 0.45 +
        exactEntityMatches.length * 1.75 +
        evidenceBoost +
        fallbackPriority * 0.08;
  const activeContext = computeActiveContextConfidence(
    study,
    exactEntityMatches,
    entityTermMatches,
    evidencePreview,
    phraseMatches,
    mentionCounts.exact,
    mentionCounts.alias,
    relevantEvidenceAtoms,
    relevantClusterDensity,
  );

  return {
    study,
    relevance,
    matchedSignals,
    evidencePreview,
    exactEntityMatches,
    entityTermMatches,
    phraseMatches,
    matchedTerms,
    lexicalScore,
    queryEntityMentions: mentionCounts.exact,
    aliasMentions: mentionCounts.alias,
    relevantEvidenceAtoms,
    relevantClusterDensity,
    activeContextConfidence: activeContext.confidence,
    activeContextReason: activeContext.reason,
  };
};

const chooseStudies = (question: string, studies: StudyItem[], selectedStudyIds?: string[]): StudySelectionResult => {
  const scopedStudies =
    selectedStudyIds && selectedStudyIds.length > 0
      ? studies.filter((study) => selectedStudyIds.includes(study.id))
      : studies;

  const scored = scopedStudies.map((study) => scoreStudy(question, study)).sort((left, right) => right.relevance - left.relevance);
  const documentGroundedQuestion = isDocumentGroundedQuestion(question);
  // Cross-document query: user explicitly wants all uploaded files compared/synthesized
  const crossDocumentQuery = CROSS_DOCUMENT_QUERY_RE.test(question);
  const maxSelectedStudies =
    selectedStudyIds && selectedStudyIds.length > 0
      ? MAX_SELECTED_STUDIES
      : isGlobalDbSearchQuery(question) || documentGroundedQuestion || crossDocumentQuery
        ? MAX_SELECTED_STUDIES
        : 1;
  const competingContexts = scored.slice(0, 3).map((entry) => ({
    id: entry.study.id,
    title: entry.study.title,
    confidence: entry.activeContextConfidence,
  }));
  const top = scored[0];
  const runnerUp = scored[1];

  // Per-source coverage guarantee: for explicit cross-document queries, include all scoped studies
  // (up to MAX_SELECTED_STUDIES) regardless of lexical match score.
  if (crossDocumentQuery && !selectedStudyIds?.length) {
    const allScored = scored.slice(0, maxSelectedStudies);
    if (allScored.length > 0) {
      const best = allScored[0];
      return {
        selected: allScored,
        activeContextId: best.study.id,
        activeContextReason: "cross-document synthesis — all sources included for coverage",
        activeContextConfidence: Math.max(best.activeContextConfidence, 0.72),
        queryEntityMentionsInContext: best.queryEntityMentions,
        aliasMentionsInContext: best.aliasMentions,
        numberOfRelevantEvidenceAtoms: best.relevantEvidenceAtoms,
        competingContexts,
        ambiguous: false,
      };
    }
  }

  if (documentGroundedQuestion && !selectedStudyIds?.length && !isGlobalDbSearchQuery(question)) {
    const documentGrounded = scored.filter(
      (entry) =>
        entry.lexicalScore >= 0.16 ||
        entry.matchedTerms.length >= 2 ||
        entry.phraseMatches.length > 0 ||
        entry.evidencePreview.some((snippet) => splitTerms(question).some((term) => normalize(snippet).includes(term))),
    );

    if (documentGrounded.length > 0) {
      const selectedGrounded = documentGrounded.slice(0, maxSelectedStudies);
      const best = selectedGrounded[0];
      return {
        selected: selectedGrounded,
        activeContextId: best.study.id,
        activeContextReason: "document/source text grounding",
        activeContextConfidence: Math.max(best.activeContextConfidence, Math.min(0.94, 0.68 + best.lexicalScore * 0.24)),
        queryEntityMentionsInContext: best.queryEntityMentions,
        aliasMentionsInContext: best.aliasMentions,
        numberOfRelevantEvidenceAtoms: best.relevantEvidenceAtoms,
        competingContexts,
        ambiguous: false,
      };
    }

    return {
      selected: [],
      activeContextId: undefined,
      activeContextReason: "no database record matched the document/source text question",
      activeContextConfidence: 0,
      queryEntityMentionsInContext: 0,
      aliasMentionsInContext: 0,
      numberOfRelevantEvidenceAtoms: 0,
      competingContexts,
      ambiguous: true,
    };
  }

  const ambiguous =
    !selectedStudyIds?.length &&
    !isGlobalDbSearchQuery(question) &&
    (!top ||
      top.activeContextConfidence < 0.62 ||
      (runnerUp &&
        runnerUp.activeContextConfidence >= 0.58 &&
        Math.abs(top.activeContextConfidence - runnerUp.activeContextConfidence) < 0.08 &&
        runnerUp.queryEntityMentions >= top.queryEntityMentions));

  if (selectedStudyIds && selectedStudyIds.length > 0) {
    return {
      selected: scored.slice(0, MAX_SELECTED_STUDIES),
      activeContextId: scored[0]?.study.id,
      activeContextReason: "explicit selected report/case scope",
      activeContextConfidence: 0.99,
      queryEntityMentionsInContext: scored[0]?.queryEntityMentions || 0,
      aliasMentionsInContext: scored[0]?.aliasMentions || 0,
      numberOfRelevantEvidenceAtoms: scored[0]?.relevantEvidenceAtoms || 0,
      competingContexts,
      ambiguous: false,
    };
  }

  if (ambiguous) {
    // Return the top-scoring study rather than nothing — downstream warns about low confidence
    // but an empty corpus guarantees a useless "No scoped database text available" response.
    return {
      selected: top ? [top] : [],
      activeContextId: top?.study.id,
      activeContextReason: top?.activeContextReason || "weak matched signals only",
      activeContextConfidence: top?.activeContextConfidence || 0,
      queryEntityMentionsInContext: top?.queryEntityMentions || 0,
      aliasMentionsInContext: top?.aliasMentions || 0,
      numberOfRelevantEvidenceAtoms: top?.relevantEvidenceAtoms || 0,
      competingContexts,
      ambiguous: true,
    };
  }

  const exactEntityMatches = scored.filter((entry) => entry.exactEntityMatches.length > 0);
  if (exactEntityMatches.length > 0) {
    return {
      selected: exactEntityMatches.slice(0, maxSelectedStudies),
      activeContextId: exactEntityMatches[0]?.study.id,
      activeContextReason: exactEntityMatches[0]?.activeContextReason,
      activeContextConfidence: exactEntityMatches[0]?.activeContextConfidence,
      queryEntityMentionsInContext: exactEntityMatches[0]?.queryEntityMentions,
      aliasMentionsInContext: exactEntityMatches[0]?.aliasMentions,
      numberOfRelevantEvidenceAtoms: exactEntityMatches[0]?.relevantEvidenceAtoms,
      competingContexts,
      ambiguous: false,
    };
  }

  const phraseMatches = scored.filter((entry) => entry.phraseMatches.length > 0);
  if (phraseMatches.length > 0) {
    return {
      selected: phraseMatches.slice(0, maxSelectedStudies),
      activeContextId: phraseMatches[0]?.study.id,
      activeContextReason: phraseMatches[0]?.activeContextReason,
      activeContextConfidence: phraseMatches[0]?.activeContextConfidence,
      queryEntityMentionsInContext: phraseMatches[0]?.queryEntityMentions,
      aliasMentionsInContext: phraseMatches[0]?.aliasMentions,
      numberOfRelevantEvidenceAtoms: phraseMatches[0]?.relevantEvidenceAtoms,
      competingContexts,
      ambiguous: false,
    };
  }

  const entityTermMatches = scored.filter((entry) => entry.entityTermMatches.length > 0);
  if (entityTermMatches.length > 0) {
    return {
      selected: entityTermMatches.slice(0, maxSelectedStudies),
      activeContextId: entityTermMatches[0]?.study.id,
      activeContextReason: entityTermMatches[0]?.activeContextReason,
      activeContextConfidence: entityTermMatches[0]?.activeContextConfidence,
      queryEntityMentionsInContext: entityTermMatches[0]?.queryEntityMentions,
      aliasMentionsInContext: entityTermMatches[0]?.aliasMentions,
      numberOfRelevantEvidenceAtoms: entityTermMatches[0]?.relevantEvidenceAtoms,
      competingContexts,
      ambiguous: false,
    };
  }

  if (scored.length <= maxSelectedStudies) {
    return {
      selected: scored,
      activeContextId: top?.study.id,
      activeContextReason: top?.activeContextReason,
      activeContextConfidence: top?.activeContextConfidence,
      queryEntityMentionsInContext: top?.queryEntityMentions,
      aliasMentionsInContext: top?.aliasMentions,
      numberOfRelevantEvidenceAtoms: top?.relevantEvidenceAtoms,
      competingContexts,
      ambiguous: false,
    };
  }

  const positive = scored.filter((entry) => entry.relevance > 0.22);
  if (positive.length >= 3) {
    return {
      selected: positive.slice(0, maxSelectedStudies),
      activeContextId: positive[0]?.study.id,
      activeContextReason: positive[0]?.activeContextReason,
      activeContextConfidence: positive[0]?.activeContextConfidence,
      queryEntityMentionsInContext: positive[0]?.queryEntityMentions,
      aliasMentionsInContext: positive[0]?.aliasMentions,
      numberOfRelevantEvidenceAtoms: positive[0]?.relevantEvidenceAtoms,
      competingContexts,
      ambiguous: false,
    };
  }

  return {
    selected: scored.slice(0, maxSelectedStudies),
    activeContextId: top?.study.id,
    activeContextReason: top?.activeContextReason,
    activeContextConfidence: top?.activeContextConfidence,
    queryEntityMentionsInContext: top?.queryEntityMentions,
    aliasMentionsInContext: top?.aliasMentions,
    numberOfRelevantEvidenceAtoms: top?.relevantEvidenceAtoms,
    competingContexts,
    ambiguous: false,
  };
};

const preferEntityType = (currentType: string, nextType: string): string => {
  const order = ["PERSON", "ORGANIZATION", "ORG", "LOCATION", "ASSET", "OBJECT", "EVENT", "DATE", "MISC", "OTHER"];
  const currentIndex = order.indexOf(currentType);
  const nextIndex = order.indexOf(nextType);
  if (currentIndex === -1) return nextType;
  if (nextIndex === -1) return currentType;
  return nextIndex < currentIndex ? nextType : currentType;
};

const mergeEntityRecord = (target: Entity, incoming: Entity): Entity => ({
  ...target,
  ...incoming,
  id: target.id,
  name: target.name,
  type: preferEntityType(target.type, incoming.type),
  description:
    (incoming.description && incoming.description.length > (target.description || "").length
      ? incoming.description
      : target.description) || incoming.description,
  confidence: Math.max(target.confidence || 0, incoming.confidence || 0) || undefined,
  salience: Math.max(target.salience || 0, incoming.salience || 0) || undefined,
  aliases: uniqueStrings([...(target.aliases || []), ...(incoming.aliases || [])]),
  evidence: uniqueStrings([...(target.evidence || []), ...(incoming.evidence || [])]).slice(0, 8),
  source_chunks: Array.from(new Set([...(target.source_chunks || []), ...(incoming.source_chunks || [])])).slice(0, 16),
  reference_confidence: Math.max(target.reference_confidence || 0, incoming.reference_confidence || 0) || undefined,
  watchlist_status:
    target.watchlist_status === "match" || incoming.watchlist_status === "match"
      ? "match"
      : target.watchlist_status === "candidate" || incoming.watchlist_status === "candidate"
        ? "candidate"
        : incoming.watchlist_status || target.watchlist_status,
});

const mergeEntities = (studies: StudyItem[]): Entity[] => {
  const merged: Entity[] = [];

  studies.forEach((study) => {
    (study.intelligence.entities || []).forEach((entity) => {
      const existingIndex = merged.findIndex(
        (candidate) =>
          isEntityMatch(candidate.name, entity.name) ||
          (candidate.aliases || []).some((alias) => isEntityMatch(alias, entity.name)) ||
          (entity.aliases || []).some((alias) => isEntityMatch(candidate.name, alias)),
      );

      if (existingIndex === -1) {
        merged.push({
          ...entity,
          aliases: uniqueStrings(entity.aliases || []),
          evidence: uniqueStrings(entity.evidence || []).slice(0, 8),
        });
        return;
      }

      merged[existingIndex] = mergeEntityRecord(merged[existingIndex], entity);
    });
  });

  return merged.sort(
    (left, right) =>
      (right.salience || 0) - (left.salience || 0) ||
      (right.confidence || 0) - (left.confidence || 0) ||
      right.name.length - left.name.length,
  );
};

const mergeRelations = (studies: StudyItem[]): Relation[] => {
  const seen = new Map<string, Relation>();

  studies.forEach((study) => {
    (study.intelligence.relations || []).forEach((relation) => {
      const key = `${normalize(relation.source)}|${normalize(relation.target)}|${normalize(relation.type)}`;
      const existing = seen.get(key);
      if (!existing || (relation.confidence || 0) > (existing.confidence || 0)) {
        seen.set(key, relation);
      }
    });
  });

  return Array.from(seen.values());
};

const mergeByText = <T>(items: T[], getText: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalize(getText(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergeContextCards = (entities: Entity[], studies: StudyItem[]): Record<string, ContextCard> => {
  const merged = new Map<string, ContextCard>();

  studies.forEach((study) => {
    Object.entries(study.intelligence.context_cards || {}).forEach(([name, card]) => {
      const entityName =
        entities.find((entity) => isEntityMatch(entity.name, name) || (entity.aliases || []).some((alias) => isEntityMatch(alias, name)))?.name || name;
      const existing = merged.get(entityName);
      if (!existing) {
        merged.set(entityName, {
          ...card,
          entityName,
          aliases: uniqueStrings(card.aliases || []),
          key_mentions: uniqueStrings(card.key_mentions || []).slice(0, 8),
        });
        return;
      }

      const existingSummaryLength = existing.summary?.length || 0;
      const incomingSummaryLength = card.summary?.length || 0;

      merged.set(entityName, {
        ...existing,
        ...card,
        entityName,
        summary: incomingSummaryLength > existingSummaryLength ? card.summary : existing.summary,
        role_in_document:
          (card.role_in_document && card.role_in_document.length > (existing.role_in_document || "").length
            ? card.role_in_document
            : existing.role_in_document) || card.role_in_document,
        aliases: uniqueStrings([...(existing.aliases || []), ...(card.aliases || [])]),
        key_mentions: uniqueStrings([...(existing.key_mentions || []), ...(card.key_mentions || [])]).slice(0, 8),
        personDossier: existing.personDossier || card.personDossier,
        referenceProfile: existing.referenceProfile || card.referenceProfile,
        entityProfile: existing.entityProfile || card.entityProfile,
      });
    });
  });

  return Object.fromEntries(merged.entries());
};

const combineSummaryPanels = (studies: StudyItem[]): Record<string, StructuredSummaryPanel> =>
  Object.fromEntries(
    studies.flatMap((study) => {
      const prefix = `study_${stableHash(study.id)}`;
      return Object.entries(study.intelligence.summary_panels || {}).map(([key, panel]) => [
        `${prefix}_${key}`,
        {
          ...panel,
          summary_id: `${prefix}_${panel.summary_id}`,
          title: `${study.title} · ${panel.title}`,
          cited_evidence_ids: panel.cited_evidence_ids.map((id) => `${prefix}:${id}`),
          retrieval_bundle_id: panel.retrieval_bundle_id ? `${prefix}:${panel.retrieval_bundle_id}` : panel.retrieval_bundle_id,
        },
      ]);
    }),
  );

const prefixHit = (prefix: string, hit: RetrievalEvidenceHit): RetrievalEvidenceHit => ({
  ...hit,
  item_id: `${prefix}:${hit.item_id}`,
  evidence_id: hit.evidence_id ? `${prefix}:${hit.evidence_id}` : undefined,
  source_doc_id: `${prefix}:${hit.source_doc_id}`,
  source_text_unit_id: hit.source_text_unit_id ? `${prefix}:${hit.source_text_unit_id}` : undefined,
  external_reference_ids: (hit.external_reference_ids || []).map((id) => `${prefix}:${id}`),
  contradiction_ids: (hit.contradiction_ids || []).map((id) => `${prefix}:${id}`),
  version_edge_ids: (hit.version_edge_ids || []).map((id) => `${prefix}:${id}`),
});

const prefixBundle = (prefix: string, studyTitle: string, bundle: RetrievalEvidenceBundle): RetrievalEvidenceBundle => ({
  ...bundle,
  bundle_id: `${prefix}:${bundle.bundle_id}`,
  title: `${studyTitle} · ${bundle.title}`,
  query: `${bundle.query} [${studyTitle}]`,
  hits: bundle.hits.map((hit) => prefixHit(prefix, hit)),
  cited_evidence_ids: bundle.cited_evidence_ids.map((id) => `${prefix}:${id}`),
  warnings: uniqueStrings(bundle.warnings || []).map((warning) => `${studyTitle}: ${warning}`),
});

const combineRetrievalArtifacts = (studies: StudyItem[]): RetrievalArtifacts | undefined => {
  const withArtifacts = studies.filter((study) => study.intelligence.retrieval_artifacts);
  if (!withArtifacts.length) return undefined;

  const bundles = Object.fromEntries(
    withArtifacts.flatMap((study) => {
      const prefix = `study_${stableHash(study.id)}`;
      return Object.entries(study.intelligence.retrieval_artifacts?.bundles || {}).map(([key, bundle]) => [
        `${prefix}_${key}`,
        prefixBundle(prefix, study.title, bundle),
      ]);
    }),
  );

  const warnings = uniqueStrings(
    withArtifacts.flatMap((study) => [
      ...(study.intelligence.retrieval_artifacts?.warnings || []).map((warning) => `${study.title}: ${warning}`),
      ...(study.intelligence.reference_warnings || []).map((warning) => `${study.title}: ${warning}`),
    ]),
  );

  const diagnostics = withArtifacts[0].intelligence.retrieval_artifacts?.diagnostics;
  const bundleList = Object.values(bundles);

  return {
    backend: withArtifacts.some((study) => study.intelligence.retrieval_artifacts?.backend === "hybrid_graph_semantic_v1")
      ? "hybrid_graph_semantic_v1"
      : "hybrid_graph_ranker_v1",
    warnings,
    item_count: bundleList.reduce((sum, bundle) => sum + bundle.hits.length, 0),
    contradiction_item_count: bundleList.reduce(
      (sum, bundle) => sum + bundle.hits.filter((hit) => hit.contradiction_ids.length > 0).length,
      0,
    ),
    bundle_count: bundleList.length,
    bundles,
    diagnostics,
  };
};

const prefixVersionEdge = (prefix: string, edge: VersionEdge): VersionEdge => ({
  ...edge,
  edge_id: `${prefix}:${edge.edge_id}`,
  source_version_id: `${prefix}:${edge.source_version_id}`,
  target_version_id: edge.target_version_id ? `${prefix}:${edge.target_version_id}` : undefined,
  source_atom_id: edge.source_atom_id ? `${prefix}:${edge.source_atom_id}` : undefined,
  target_atom_id: edge.target_atom_id ? `${prefix}:${edge.target_atom_id}` : undefined,
});

const combineVersionValidity = (studies: StudyItem[]): VersionValidityArtifacts | undefined => {
  const reports = studies
    .map((study) => ({ study, report: study.intelligence.version_validity }))
    .filter((entry): entry is { study: StudyItem; report: VersionValidityArtifacts } => Boolean(entry.report));
  if (!reports.length) return undefined;

  const prefixedReports = reports.map(({ study, report }) => {
    const prefix = `study_${stableHash(study.id)}`;
    return {
      prefix,
      report,
      documents: report.documents.map((document) => ({
        ...document,
        document_identity: `${prefix}:${document.document_identity}`,
        source_doc_id: `${prefix}:${document.source_doc_id}`,
      })),
      versions: report.versions.map((version) => ({
        ...version,
        version_id: `${prefix}:${version.version_id}`,
        document_identity: `${prefix}:${version.document_identity}`,
        source_doc_id: `${prefix}:${version.source_doc_id}`,
      })),
      atoms: report.atoms.map((atom) => ({
        ...atom,
        atom_id: `${prefix}:${atom.atom_id}`,
        document_identity: `${prefix}:${atom.document_identity}`,
        version_id: `${prefix}:${atom.version_id}`,
        source_doc_id: `${prefix}:${atom.source_doc_id}`,
        source_text_unit_id: `${prefix}:${atom.source_text_unit_id}`,
        evidence_id: atom.evidence_id ? `${prefix}:${atom.evidence_id}` : undefined,
        exact_pointer: {
          ...atom.exact_pointer,
          source_doc_id: `${prefix}:${atom.exact_pointer.source_doc_id}`,
          source_text_unit_id: `${prefix}:${atom.exact_pointer.source_text_unit_id}`,
        },
        version_edge_ids: atom.version_edge_ids.map((edgeId) => `${prefix}:${edgeId}`),
      })),
      edges: report.edges.map((edge) => prefixVersionEdge(prefix, edge)),
    };
  });

  const atoms = prefixedReports.flatMap((entry) => entry.atoms);
  const edges = prefixedReports.flatMap((entry) => entry.edges);
  const averageValidityScore = atoms.length
    ? Number((atoms.reduce((sum, atom) => sum + atom.validity_score, 0) / atoms.length).toFixed(4))
    : 0;

  return {
    case_id: `live_scope_${stableHash(studies.map((study) => study.id).sort().join("|") || "empty")}`,
    document_identity: "live-research-scope",
    generated_at: new Date().toISOString(),
    current_version_id: "live-research-scope-current",
    documents: prefixedReports.flatMap((entry) => entry.documents),
    versions: prefixedReports.flatMap((entry) => entry.versions),
    atoms,
    edges,
    metrics: {
      atom_count: atoms.length,
      current_atom_count: atoms.filter((atom) => atom.version_state === "current").length,
      historical_atom_count: atoms.filter((atom) => ["historical", "superseded", "cancelled"].includes(atom.version_state)).length,
      edge_count: edges.length,
      contradicted_atom_count: atoms.filter((atom) => atom.version_state === "contradicted").length,
      average_validity_score: averageValidityScore,
    },
    warnings: uniqueStrings(reports.flatMap(({ study, report }) => report.warnings.map((warning) => `${study.title}: ${warning}`))),
  };
};

const buildGraph = (entities: Entity[], relations: Relation[]): IntelligencePackage["graph"] => ({
  nodes: entities.map((entity) => ({
    id: entity.name,
    group:
      entity.type === "PERSON"
        ? 1
        : entity.type === "ORGANIZATION" || entity.type === "ORG"
          ? 2
          : entity.type === "LOCATION"
            ? 3
            : entity.type === "ASSET" || entity.type === "OBJECT"
              ? 4
              : entity.type === "EVENT"
                ? 5
                : entity.type === "DATE"
                  ? 6
                  : 7,
    type: entity.type,
  })),
  edges: relations.map((relation) => ({
    source: relation.source,
    target: relation.target,
    value: Math.max(1, Math.round((relation.confidence || 0.5) * 5)),
    label: relation.type,
  })),
});

const buildStudyGist = (study: StudyItem): string => {
  const pkg = study.intelligence;
  const summaryPanelText = Object.values(pkg.summary_panels || {})
    .flatMap((panel) => summarizePanel(panel))
    .find(Boolean);
  return truncateText(
    pkg.research_dossier?.executive_summary ||
      summaryPanelText ||
      pkg.insights?.find((insight) => insight.type === "summary")?.text ||
      pkg.clean_text ||
      "",
    MAX_STUDY_GIST_CHARS,
  );
};

const matchedEntitiesForSource = (source: LiveResearchSource, study: StudyItem): Entity[] => {
  const matched = source.matchedSignals.flatMap((signal) =>
    (study.intelligence.entities || []).filter(
      (entity) =>
        isEntityMatch(entity.name, signal) ||
        (entity.aliases || []).some((alias) => isEntityMatch(alias, signal)) ||
        normalize(signal).includes(normalize(entity.name)),
    ),
  );

  return uniqueStrings(matched.map((entity) => entity.name))
    .map((name) => matched.find((entity) => entity.name === name))
    .filter((entity): entity is Entity => Boolean(entity))
    .slice(0, 5);
};

const formatEntityContextLine = (entity: Entity, card?: ContextCard): string => {
  const descriptor = card?.summary || entity.description || card?.role_in_document || "";
  const confidence = typeof entity.confidence === "number" ? ` confidence=${Math.round(entity.confidence * 100)}%` : "";
  return truncateText(`- ${entity.name} (${entity.type}${confidence}): ${descriptor || "matched entity"}`, MAX_CONTEXT_CARD_CHARS);
};

const relationTouchesEntity = (relation: Relation, entities: Entity[]): boolean =>
  entities.some((entity) => isEntityMatch(relation.source, entity.name) || isEntityMatch(relation.target, entity.name));

const buildStudyBlock = (source: LiveResearchSource, study: StudyItem): string => {
  const pkg = study.intelligence;
  const matchedEntities = matchedEntitiesForSource(source, study);
  const entityLines = matchedEntities.map((entity) => formatEntityContextLine(entity, pkg.context_cards?.[entity.name]));
  const relationLines = (pkg.relations || [])
    .filter((relation) => relationTouchesEntity(relation, matchedEntities))
    .slice(0, 4)
    .map((relation) =>
      truncateText(
        `- ${relation.source} ${relation.type} ${relation.target} (${Math.round((relation.confidence || 0.5) * 100)}%)`,
        220,
      ),
    );
  const exactEvidence = source.evidencePreview
    .map((snippet) => `- ${truncateText(snippet, MAX_EVIDENCE_SNIPPET_CHARS)}`)
    .slice(0, MAX_EVIDENCE_PREVIEWS);
  const lines = [
    `STUDY: ${study.title}`,
    `DATE: ${study.date} | SOURCE: ${study.source} | RELEVANCE: ${Math.round(source.relevance * 100)}%`,
    `CASE GIST: ${buildStudyGist(study) || "No compact case gist available."}`,
    source.matchedSignals.length ? `MATCHED SIGNALS: ${source.matchedSignals.join(" | ")}` : "",
    entityLines.length ? `MATCHED ENTITY CONTEXT:\n${entityLines.join("\n")}` : "",
    relationLines.length ? `GRAPH LINKS:\n${relationLines.join("\n")}` : "",
    exactEvidence.length ? `EXACT EVIDENCE PACK:\n${exactEvidence.join("\n")}` : "",
    (pkg.intel_questions || []).length
      ? `OPEN QUESTIONS:\n- ${(pkg.intel_questions || []).slice(0, 3).map((question) => question.question_text).join("\n- ")}`
      : "",
    (pkg.intel_tasks || []).length
      ? `OPEN TASKS:\n- ${(pkg.intel_tasks || []).slice(0, 3).map((task) => `${task.task_text} (${task.urgency})`).join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return lines.slice(0, MAX_STUDY_BLOCK_CHARS);
};

const buildCorpusText = (sources: LiveResearchSource[], studies: StudyItem[]): string => {
  const studyIndex = new Map(studies.map((s) => [s.id, s]));
  const blocks = sources
    .map((source) => {
      const study = studyIndex.get(source.id);
      return study ? buildStudyBlock(source, study) : "";
    })
    .filter(Boolean);

  return blocks.join("\n\n==============================\n\n").slice(0, MAX_CORPUS_TEXT_CHARS);
};

const averageReliability = (studies: StudyItem[]): number => {
  if (!studies.length) return 0;
  const values = studies.map((study) => study.intelligence.reliability || 0);
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
};

const inferScopeResearchProfile = (studies: StudyItem[]): ResearchProfileId | undefined => {
  const counts = new Map<ResearchProfileId, number>();
  studies.forEach((study) => {
    const profile = study.intelligence.research_profile;
    if (!profile) return;
    counts.set(profile, (counts.get(profile) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
};

const buildDeterministicFallbackNotice = (
  isHebrew: boolean,
  engineSurface: ReasoningEngineSurface,
  failureKind: ReasoningFailureKind,
): string => {
  if (isHebrew) {
    if (engineSurface === "cloud") {
      return failureKind === "timeout"
        ? "מנוע ההסקה בענן לא החזיר תשובה בזמן, לכן התשובה הורכבה באופן דטרמיניסטי מתוך הראיות וכרטיסי ההקשר הקיימים."
        : "מנוע ההסקה בענן לא היה זמין, לכן התשובה הורכבה באופן דטרמיניסטי מתוך הראיות וכרטיסי ההקשר הקיימים.";
    }
    return failureKind === "timeout"
      ? "המודל המקומי לא החזיר תשובה בזמן, לכן התשובה הורכבה באופן דטרמיניסטי מתוך הראיות וכרטיסי ההקשר הקיימים."
      : "המודל המקומי לא היה זמין, לכן התשובה הורכבה באופן דטרמיניסטי מתוך הראיות וכרטיסי ההקשר הקיימים.";
  }

  if (engineSurface === "cloud") {
    return failureKind === "timeout"
      ? "The cloud reasoning engine did not answer in time, so this answer was assembled deterministically from stored evidence and context cards."
      : "The cloud reasoning engine was unavailable, so this answer was assembled deterministically from stored evidence and context cards.";
  }

  return failureKind === "timeout"
    ? "The local model did not answer in time, so this answer was assembled deterministically from stored evidence and context cards."
    : "The local model was unavailable, so this answer was assembled deterministically from stored evidence and context cards.";
};

const buildLiveResearchEngineTrace = (
  reasoningFailure: ReturnType<typeof classifyReasoningFailure>,
  engine: ReasoningEngineDescriptor = PRIMARY_REASONING_ENGINE,
): LiveResearchEngineTrace => ({
  engineId: engine.id,
  engineLabel: engine.label,
  engineSurface: engine.surface,
  responseMode: reasoningFailure ? "deterministic-fallback" : "model-answer",
  failureKind: reasoningFailure?.kind,
  failureMessage: reasoningFailure?.message,
});

const answerCitesSelectedEvidence = (answerText: string, evidenceIds: string[]): boolean => {
  if (!evidenceIds.length) return false;
  return evidenceIds.some((evidenceId) => answerText.includes(`[${evidenceId}]`) || answerText.includes(evidenceId));
};

const LIVE_RESEARCH_DB_ONLY_SYSTEM_INSTRUCTION =
  "You are TEVEL's database research copilot. The user's question appears at the top of the prompt — read it carefully and answer it directly. Use only the evidence provided in the retrieval context to answer that specific question. Do not summarize the documents generally; answer the question. If the answer is not in the provided evidence, say so clearly. Do not use outside knowledge. Cite evidence IDs in square brackets. Answer in the same language as the question. Be concise and direct.";

type OutputExclusion = "FCF" | "timeline" | "entity" | "confidence" | "communicated_with";

type LiveResearchOutputConstraints = {
  exclusions: OutputExclusion[];
  hebrewOnly: boolean;
  plainLanguage: boolean;
  suppressEvidenceIds: boolean;
  suppressSystemCodes: boolean;
};

const OUTPUT_EXCLUSION_PATTERNS: Array<{ label: OutputExclusion; patterns: RegExp[] }> = [
  { label: "FCF", patterns: [/\bfcf(?:-r3)?\b/i] },
  { label: "timeline", patterns: [/\btimelines?\b/i, /ציר\s*זמן/i] },
  { label: "entity", patterns: [/\b(?:entity|entities)\b/i, /ישות|ישויות/i] },
  { label: "confidence", patterns: [/\bconfidence\b/i, /ביטחון|רמת\s+ודאות/i] },
  { label: "communicated_with", patterns: [/\bcommunicated[_\s-]?with\b/i] },
];

const OUTPUT_EXCLUSION_CUE =
  /\b(?:do\s+not|don't|dont|without|exclude|avoid|no|forbid|forbidden)\b|אסור|בלי|ללא|אל\s+ת|לא\s+(?:לכלול|להחזיר|להציג|להשתמש|להזכיר)/i;

const detectOutputExclusions = (question: string): OutputExclusion[] => {
  if (!OUTPUT_EXCLUSION_CUE.test(question)) return [];
  return OUTPUT_EXCLUSION_PATTERNS
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(question)))
    .map((entry) => entry.label);
};

const detectOutputConstraints = (question: string): LiveResearchOutputConstraints => ({
  exclusions: detectOutputExclusions(question),
  hebrewOnly: /עברית|בעברית|hebrew/i.test(question),
  plainLanguage: /עברית פשוטה|שפה פשוטה|פשוטה בלבד|plain (?:hebrew|language)|simple language/i.test(question),
  suppressEvidenceIds:
    /\b(?:no|without|do\s+not|don't|dont)\s+(?:evidence\s+)?ids?\b|בלי\s+מזהי\s+ראיות|ללא\s+מזהי\s+ראיות|בלי\s+ids?|בלי\s+מזהים/i.test(
      question,
    ),
  suppressSystemCodes:
    /\b(?:no|without|do\s+not|don't|dont)\s+system\s+codes?\b|בלי\s+קודי\s+מערכת|ללא\s+קודי\s+מערכת|בלי\s+קודים/i.test(
      question,
    ),
});

const shouldUseSourceGroundedAnswer = (question: string, corpus: LiveResearchCorpus): boolean =>
  detectOutputConstraints(question).exclusions.length > 0 ||
  hasFinanceOrSecIntent(question) ||
  corpus.package.research_profile === "FINANCE";

type SourceGroundedEvidenceItem = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceDisplayName: string;
  documentKind: SecDocumentKind;
  text: string;
};

type SourceGroundedSourceSummary = {
  id: string;
  title: string;
  displayName: string;
  documentKind: SecDocumentKind;
  analysisRole: "financial-report" | "ownership-form" | "sec-context";
  rawChars: number;
};

type SourceGroundedReadPath = {
  knowledgeSnapshot: string;
  retrievalContext: string;
  evidenceIds: string[];
  evidenceItems: SourceGroundedEvidenceItem[];
  sourceSummaries: SourceGroundedSourceSummary[];
};

const buildSourceGroundedSystemInstruction = (question: string, constraints: LiveResearchOutputConstraints): string => {
  const exclusionRule = constraints.exclusions.length
    ? `The user explicitly excluded these output terms or structures: ${constraints.exclusions.join(", ")}. Do not include those terms, headings, relation labels, or sections in the answer.`
    : "Do not switch into graph, entity-list, relationship, or chronology mode unless the user explicitly asks for that output.";
  const financeRule = hasFinanceOrSecIntent(question)
    ? "For SEC or financial-document questions, first classify each selected filing by SEC form. Treat Form 10-K, 10-Q, and 20-F as financial reports. Treat Form 3, 4, and 5 as ownership or insider-transaction forms; do not use them as evidence for revenue, profitability, cash flow, balance sheet, debt, or liquidity. When multiple company records are selected, cover each company once before giving conclusions, and do not repeat one filing."
    : "Answer in the user's requested analysis frame and keep the answer tied to the selected source excerpts.";
  const languageRule = constraints.hebrewOnly
    ? constraints.plainLanguage
      ? "Answer in simple Hebrew only. Do not use English headings, internal labels, or technical framework names."
      : "Answer in Hebrew only."
    : "Answer in the user's language.";
  const citationRule =
    constraints.suppressEvidenceIds || constraints.suppressSystemCodes
      ? "Do not output source IDs, evidence IDs, bracketed IDs, run IDs, route names, system codes, or internal labels. Refer to records only by company or document name."
      : "Cite source excerpt IDs in square brackets when useful.";

  return [
    "You are TEVEL's source-grounded document analysis copilot.",
    "Use only the selected DB records and source excerpts provided in the prompt. Treat that scoped material as the complete world.",
    languageRule,
    financeRule,
    exclusionRule,
    "If the selected excerpts do not contain enough evidence to answer, say what is missing and stop. Do not fill gaps from outside knowledge.",
    citationRule,
    "Be concise and direct.",
  ].join(" ");
};

const buildSourceGroundedReadPath = (
  question: string,
  corpus: LiveResearchCorpus,
  studies: StudyItem[],
  maxContextChars: number,
  constraints: LiveResearchOutputConstraints = detectOutputConstraints(question),
): SourceGroundedReadPath => {
  const queryTerms = expandDomainQueryTerms(question, splitTerms(question));
  const queryPhrases = extractQueryPhrases(question);
  const financeIntent = hasFinanceOrSecIntent(question);
  const evidenceItems: SourceGroundedEvidenceItem[] = [];
  const sourceSummaries: SourceGroundedSourceSummary[] = [];
  const studyIndex = new Map(studies.map((s) => [s.id, s]));

  corpus.sources.forEach((source) => {
    const study = studyIndex.get(source.id);
    const rawText = study?.intelligence.raw_text || study?.intelligence.clean_text || "";
    const documentKind = detectSecDocumentKind(rawText, source.title);
    const detectedDomain = detectDocumentDomain(rawText, { title: source.title });
    const analysisRole = isFinancialSecReport(documentKind)
      ? "financial-report"
      : isOwnershipSecForm(documentKind)
        ? "ownership-form"
        : "sec-context";
    const sourceDisplayName = inferSourceDisplayName(source.title);
    const maxSourceExcerpts = financeIntent && analysisRole === "ownership-form" ? 1 : MAX_RAW_SOURCE_EXCERPTS;
    sourceSummaries.push({
      id: source.id,
      title: source.title,
      displayName: sourceDisplayName,
      documentKind,
      analysisRole,
      rawChars: rawText.length,
    });
    const matchedEntities = matchedEntitiesForSource(source, study || ({ intelligence: corpus.package } as StudyItem)).map((entity) => entity.name);
    const rawSourceExcerpts = pickRawSourceExcerpts(rawText, queryTerms, queryPhrases, matchedEntities, {
      documentKind,
      financeIntent,
      maxExcerpts: maxSourceExcerpts,
    });
    const sourceExcerpts = uniqueStrings(
      financeIntent
        ? [
            ...rawSourceExcerpts,
            ...source.evidencePreview,
            study?.intelligence.clean_text || "",
          ]
        : [
            ...source.evidencePreview,
            ...rawSourceExcerpts,
            study?.intelligence.clean_text || "",
          ],
    ).filter(Boolean);

    sourceExcerpts.slice(0, maxSourceExcerpts).forEach((text, index) => {
      const id = constraints.suppressEvidenceIds || constraints.suppressSystemCodes
        ? `${source.title} excerpt ${index + 1}`
        : `SRC-${stableHash(`${source.id}:${index}:${text}`)}`;
      evidenceItems.push({
        id,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceDisplayName,
        documentKind,
        text: truncateText(text, MAX_RAW_SOURCE_EXCERPT_CHARS),
      });
    });
    // Attach detected domain to summary for use in context building
    (sourceSummaries[sourceSummaries.length - 1] as SourceGroundedSourceSummary & { detectedDomain?: string }).detectedDomain =
      domainLabel(detectedDomain.domain);
  });

  const retrievalContext = [
    "SOURCE-GROUNDED DB CONTEXT",
    `Question: ${question}`,
    "",
    ...corpus.sources.map((source) => {
      const sourceEvidence = evidenceItems.filter((item) => item.sourceTitle === source.title);
      const sourceSummary = sourceSummaries.find((summary) => summary.id === source.id) as (SourceGroundedSourceSummary & { detectedDomain?: string }) | undefined;
      // Use domain-aware label — only show SEC_FORM for genuine SEC documents
      const docTypeLabel = isFinancialSecReport(sourceSummary?.documentKind || "unknown") || isOwnershipSecForm(sourceSummary?.documentKind || "unknown")
        ? `SEC_FORM: ${sourceSummary?.documentKind} | ROLE: ${sourceSummary?.analysisRole}`
        : `DOC_TYPE: ${sourceSummary?.detectedDomain || "General Document"} | ROLE: document-analysis`;
      const ownershipNote =
        sourceSummary?.analysisRole === "ownership-form"
          ? "ANALYSIS NOTE: This SEC filing is an ownership or insider-transaction form. It is not a full financial statement filing."
          : "";
      return [
        `DB RECORD: ${source.title}`,
        `RECORD_NAME: ${sourceSummary?.displayName || source.title}`,
        docTypeLabel,
        `DATE: ${source.date} | SOURCE: ${source.source} | RELEVANCE: ${formatPercent(source.relevance)}`,
        ownershipNote,
        sourceEvidence.length
          ? sourceEvidence
              .map((item, index) =>
                constraints.suppressEvidenceIds || constraints.suppressSystemCodes
                  ? `Excerpt ${index + 1}: ${item.text}`
                  : `[${item.id}] ${item.text}`,
              )
              .join("\n\n")
          : "No source excerpt survived selection for this record.",
      ].filter(Boolean).join("\n");
    }),
  ]
    .join("\n\n")
    .slice(0, maxContextChars);

  const profileLabel = corpus.package.research_profile || "mixed";
  // Only emit sec_forms when there are actual SEC documents; otherwise use doc_types
  const hasSecDocs = sourceSummaries.some((summary) => summary.documentKind !== "unknown");
  const docTypeLine = hasSecDocs
    ? `sec_forms=${sourceSummaries.map((summary) => `${summary.displayName}:${summary.documentKind}`).join(";")}`
    : `doc_types=${sourceSummaries.map((summary) => `${summary.displayName}:${(summary as SourceGroundedSourceSummary & { detectedDomain?: string }).detectedDomain || "unknown"}`).join(";")}`;
  const knowledgeSnapshot = [
    "SOURCE-GROUNDED DB SNAPSHOT",
    `records=${corpus.sources.length}/${corpus.scope.scopedStudies}`,
    `profile=${profileLabel}`,
    constraints.exclusions.length ? `explicit_output_exclusions=${constraints.exclusions.join(",")}` : "",
    constraints.hebrewOnly ? "answer_language=hebrew" : "",
    constraints.suppressEvidenceIds || constraints.suppressSystemCodes ? "output_ids=suppressed" : "",
    `source_excerpt_count=${evidenceItems.length}`,
    docTypeLine,
    corpus.scope.active_context_reason ? `scope_reason=${corpus.scope.active_context_reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    knowledgeSnapshot,
    retrievalContext,
    evidenceIds: evidenceItems.map((item) => item.id),
    evidenceItems,
    sourceSummaries,
  };
};

const summarizeFinancialSignals = (text: string): string[] => {
  const signals: string[] = [];
  if (/\b(?:net sales|revenues?|sales)\b/i.test(text)) signals.push("הכנסות או מכירות");
  if (/\b(?:operating income|net income|gross margin|income before taxes|earnings)\b/i.test(text)) signals.push("רווחיות");
  if (/\b(?:cash flows?|operating cash|liquidity|cash and cash equivalents)\b/i.test(text)) signals.push("תזרים ונזילות");
  if (/\b(?:total assets|total liabilities|balance sheets?|debt)\b/i.test(text)) signals.push("מאזן וחוב");
  if (/\b(?:risk factors?|risks?|competition|supply|regulatory)\b/i.test(text)) signals.push("סיכונים עסקיים");
  if (/\b(?:research and development|capital expenditures?|cloud|services|products)\b/i.test(text)) signals.push("מנועי פעילות והשקעה");
  return uniqueStrings(signals).slice(0, 5);
};

const buildSourceGroundedFallbackAnswer = (
  question: string,
  readPath: SourceGroundedReadPath,
  engineTrace: LiveResearchEngineTrace,
  _constraints: LiveResearchOutputConstraints = detectOutputConstraints(question),
): string => {
  const hebrew = /[֐-׿]/u.test(question);
  const financeIntent = hasFinanceOrSecIntent(question);
  const allSecDocs = readPath.sourceSummaries.length > 0 && readPath.sourceSummaries.every((summary) =>
    isFinancialSecReport(summary.documentKind) || isOwnershipSecForm(summary.documentKind) || summary.documentKind === 'SEC document',
  );
  const useSecFraming = financeIntent && allSecDocs;

  const sourceLines = readPath.sourceSummaries.map((summary) => {
    const sourceText = readPath.evidenceItems
      .filter((item) => item.sourceId === summary.id)
      .map((item) => item.text)
      .join(' ');
    const detectedDocLabel = (summary as SourceGroundedSourceSummary & { detectedDomain?: string }).detectedDomain
      || (summary.documentKind !== 'unknown' ? summary.documentKind : 'מסמך');
    const excerptCount = readPath.evidenceItems.filter((item) => item.sourceId === summary.id).length;

    if (hebrew) {
      if (useSecFraming && summary.analysisRole === 'ownership-form') {
        return `- ${summary.displayName}: ${detectedDocLabel}. זה טופס על שינוי החזקה או עסקת ניירות ערך, לא דוח כספי מלא.`;
      }
      if (useSecFraming) {
        const signals = summarizeFinancialSignals(sourceText);
        const signalText = signals.length
          ? `הקטעים שנבחרו מאפשרים לבדוק בעיקר ${signals.join(', ')}.`
          : 'בקטעים שנבחרו לא נמצאו מספיק נתונים מספריים ברורים לניתוח כספי מלא.';
        return `- ${summary.displayName}: ${detectedDocLabel}. ${signalText}`;
      }
      return `- ${summary.displayName}: ${detectedDocLabel}. נבחרו ${excerptCount} קטעי עדות לניתוח.`;
    }

    if (useSecFraming && summary.analysisRole === 'ownership-form') {
      return `- ${summary.displayName}: ${detectedDocLabel}. Ownership/transaction form — cannot support financial statement analysis.`;
    }
    if (useSecFraming) {
      const signals = summarizeFinancialSignals(sourceText);
      const signalText = signals.length
        ? `Selected excerpts support review of ${signals.join(', ')}.`
        : 'Selected excerpts do not contain enough numeric financial data for full analysis.';
      return `- ${summary.displayName}: ${detectedDocLabel}. ${signalText}`;
    }
    return `- ${summary.displayName}: ${detectedDocLabel}. ${excerptCount} evidence excerpt(s) selected for analysis.`;
  });

  if (hebrew) {
    const opening = engineTrace.failureMessage
      ? [
          'Source-grounded fallback הוחזר בגלל timeout של מנוע ההסקה.',
          '',
          'כיסוי קריאה:',
          `- קבצים שנשקלו: ${readPath.sourceSummaries.length}`,
          `- קבצים עם עדות שנבחרה: ${readPath.sourceSummaries.filter((s) => readPath.evidenceItems.some((item) => item.sourceId === s.id)).length}`,
          `- קטעי עדות זמינים: ${readPath.evidenceItems.length}`,
        ].join('\n')
      : 'הניתוח מבוסס רק על קטעי המקור שנבחרו מהמסמכים שהועלו.';
    const conclusion = useSecFraming
      ? 'המסקנה העיקרית: אפשר להמשיך לניתוח כספי רק מתוך המדדים שמופיעים בקטעים שנבחרו, בלי להשלים מידע מבחוץ.'
      : 'השלב הבא: אחזור עדות מייצגת מכל קובץ, ריצת סינתזה חוצת-מסמכים על ישויות וקשרים.';

    return [
      opening,
      sourceLines.length ? sourceLines.join('\n') : 'לא נמצאו קטעי מקור מספיקים במסגרת ה-DB שנבחרה.',
      conclusion,
    ].join('\n\n');
  }

  const opening = engineTrace.failureMessage
    ? [
        'Source-grounded fallback engaged because the reasoning engine timed out.',
        '',
        'Read coverage:',
        `- Files considered: ${readPath.sourceSummaries.length}`,
        `- Files with evidence selected: ${readPath.sourceSummaries.filter((s) => readPath.evidenceItems.some((item) => item.sourceId === s.id)).length}`,
        `- Evidence excerpts available: ${readPath.evidenceItems.length}`,
      ].join('\n')
    : 'This analysis is based only on the selected source excerpts.';

  const conclusion = useSecFraming
    ? 'A complete financial analysis requires the selected records to contain revenue, profitability, cash flow, balance sheet, debt, liquidity, and risk data.'
    : 'Next retrieval step: retrieve representative evidence from every uploaded file and run compact cross-document entity/relation synthesis.';

  return [
    opening,
    sourceLines.length ? sourceLines.join('\n') : 'No sufficient source excerpts were found inside the selected DB scope.',
    conclusion,
  ].join('\n\n');
};

const rawCharsForSources = (sources: LiveResearchSource[], studies: StudyItem[]): number => {
  const studyIndex = new Map(studies.map((s) => [s.id, s]));
  return sources.reduce((sum, source) => {
    const study = studyIndex.get(source.id);
    return sum + (study?.intelligence.raw_text?.length || study?.intelligence.clean_text?.length || 0);
  }, 0);
};

const makeTokenBenchmark = (
  route: LiveResearchTokenBenchmark["route"],
  corpus: LiveResearchCorpus,
  studies: StudyItem[],
  params: {
    selectedContext: string;
    systemInstruction?: string;
    question?: string;
    warnings?: string[];
    outputExclusions?: string[];
  },
): LiveResearchTokenBenchmark => {
  const rawSourceChars = rawCharsForSources(corpus.sources, studies);
  const selectedContextChars = params.selectedContext.length;
  const promptChars = [
    params.systemInstruction || "",
    params.selectedContext,
    params.question || "",
  ].join("\n").length;
  const rawSourceEstimatedTokens = Math.ceil(rawSourceChars / 4);
  const selectedContextEstimatedTokens = estimateTokens(params.selectedContext);

  return {
    route,
    selectedSourceCount: corpus.sources.length,
    scopedSourceCount: corpus.scope.scopedStudies,
    rawSourceChars,
    rawSourceEstimatedTokens,
    selectedContextChars,
    selectedContextEstimatedTokens,
    promptEstimatedTokens: Math.ceil(promptChars / 4),
    compressionRatio: rawSourceChars > 0 ? Number((selectedContextChars / rawSourceChars).toFixed(4)) : 0,
    outputExclusions: params.outputExclusions || [],
    warnings: uniqueStrings(params.warnings || []),
  };
};

const sanitizeSourceGroundedAnswer = (answer: string, constraints: LiveResearchOutputConstraints): string => {
  let sanitized = answer;
  if (constraints.suppressEvidenceIds || constraints.suppressSystemCodes) {
    sanitized = sanitized
      .replace(/\[(?:SRC|fcf|ev|hit|atom|study|live|source|doc|run|case|answer)[^\]\n]{0,80}\]/gi, "")
      .replace(/\[[^\]\n]{1,120}\]/g, "")
      .replace(/\b(?:SRC|fcf|ev|hit|atom|run|case|answer|study)_[A-Za-z0-9:_-]+\b/g, "")
      .replace(/\bSRC-[A-Za-z0-9_-]+\b/g, "");
  }

  constraints.exclusions.forEach((exclusion) => {
    const patterns =
      exclusion === "FCF"
        ? [/\bFCF(?:-R3)?\b/gi]
        : exclusion === "timeline"
          ? [/\btimelines?\b/gi, /ציר\s*זמן/g]
          : exclusion === "entity"
            ? [/\b(?:entity|entities)\b/gi, /ישות(?:ות)?/g]
            : exclusion === "confidence"
              ? [/\bconfidence\b/gi, /ביטחון|רמת\s+ודאות/g]
              : [/\bcommunicated[_\s-]?with\b/gi];
    patterns.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, "");
    });
  });

  return sanitized
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasHighRepetition = (answer: string): boolean => {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 24);
  if (lines.length < 5) return false;

  const counts = new Map<string, number>();
  lines.forEach((line) => counts.set(line, (counts.get(line) || 0) + 1));
  if (Array.from(counts.values()).some((count) => count >= 3)) return true;

  const normalizedAnswer = normalize(answer);
  const tokens = normalizedAnswer.split(/\s+/).filter((token) => token.length > 2);
  if (tokens.length < 80) return false;

  const shingles = new Map<string, number>();
  for (let index = 0; index <= tokens.length - 6; index += 1) {
    const shingle = tokens.slice(index, index + 6).join(" ");
    shingles.set(shingle, (shingles.get(shingle) || 0) + 1);
  }
  return Array.from(shingles.values()).some((count) => count >= 4);
};

const hasSingleSourceDominance = (answer: string, readPath: SourceGroundedReadPath): boolean => {
  if (readPath.sourceSummaries.length < 2) return false;
  const counts = readPath.sourceSummaries.map((summary) => {
    const labels = uniqueStrings([
      summary.displayName,
      summary.title,
      summary.title.split(/\s+/)[0] || "",
    ]).filter((label) => label.length >= 3);
    const count = labels.reduce((sum, label) => {
      const pattern = new RegExp(escapeRegExp(label), "gi");
      return sum + (answer.match(pattern)?.length || 0);
    }, 0);
    return { id: summary.id, count };
  });
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (total < 5) return false;
  const max = Math.max(...counts.map((entry) => entry.count));
  const others = total - max;
  return max >= 4 && max > Math.max(2, others * 2.5);
};

const detectSourceGroundedAnswerViolations = (
  answer: string,
  constraints: LiveResearchOutputConstraints,
  readPath: SourceGroundedReadPath,
): string[] => {
  const violations: string[] = [];
  if (constraints.hebrewOnly) {
    const hebrewChars = answer.match(/[\u0590-\u05FF]/g)?.length || 0;
    const latinChars = answer.match(/[A-Za-z]/g)?.length || 0;
    if (latinChars > 80 && latinChars > hebrewChars * 1.4) {
      violations.push("model answer was not Hebrew-only");
    }
  }
  if (hasHighRepetition(answer)) {
    violations.push("model answer repeated the same content");
  }
  if (hasSingleSourceDominance(answer, readPath)) {
    violations.push("model answer over-focused on one selected source");
  }
  if (constraints.exclusions.some((exclusion) => {
    if (exclusion === "FCF") return /\bFCF(?:-R3)?\b/i.test(answer);
    if (exclusion === "timeline") return /\btimelines?\b|ציר\s*זמן/i.test(answer);
    if (exclusion === "entity") return /\bentities?\b|ישות(?:ות)?/i.test(answer);
    if (exclusion === "confidence") return /\bconfidence\b|ביטחון|רמת\s+ודאות/i.test(answer);
    return /\bcommunicated[_\s-]?with\b/i.test(answer);
  })) {
    violations.push("model answer contained explicitly excluded output terms");
  }
  if ((constraints.suppressEvidenceIds || constraints.suppressSystemCodes) && /\[[^\]\n]{1,120}\]|\bSRC-[A-Za-z0-9_-]+\b/i.test(answer)) {
    violations.push("model answer leaked source or system identifiers");
  }
  return uniqueStrings(violations);
};

const buildEntityScopedFallback = (
  question: string,
  corpus: LiveResearchCorpus,
  engineTrace?: LiveResearchEngineTrace,
): string | null => {
  const queryPhrases = extractQueryPhrases(question);
  const queryTerms = splitTerms(question);
  const isHebrewQuestion = /[\u0590-\u05FF]/u.test(question);
  const matchedEntities = (corpus.package.entities || []).filter((entity) =>
    [entity.name, ...(entity.aliases || [])].some((candidate) => {
      const normalizedCandidate = normalize(candidate);
      return (
        normalizedCandidate.length >= 3 &&
        (queryPhrases.some((phrase) => isLoosePhraseEntityMatch(candidate, phrase)) ||
          entityMatchesQueryTerm(candidate, queryTerms))
      );
    }),
  );

  const entity = matchedEntities[0];
  if (!entity) return null;

  const contextCard = corpus.package.context_cards?.[entity.name];
  const relatedSources = corpus.sources.filter((source) =>
    source.matchedSignals.some((signal) => isEntityMatch(signal, entity.name)) ||
    source.evidencePreview.some((snippet) => normalize(snippet).includes(normalize(entity.name))),
  );

  const relatedQuestions = (corpus.package.intel_questions || [])
    .filter((question) => normalize(question.question_text).includes(normalize(entity.name)))
    .slice(0, 3)
    .map((question) => `- ${question.question_text}`);
  const relatedTasks = (corpus.package.intel_tasks || [])
    .filter((task) => normalize(task.task_text).includes(normalize(entity.name)))
    .slice(0, 3)
    .map((task) => `- ${task.task_text} (${task.urgency})`);
  const fallbackNotice = buildDeterministicFallbackNotice(
    isHebrewQuestion,
    engineTrace?.engineSurface || PRIMARY_REASONING_ENGINE.surface,
    engineTrace?.failureKind || "offline",
  );

  if (isHebrewQuestion) {
    const hebrewLines = [
      `${entity.name} מופיע ב-${relatedSources.length || 1} רשומ${relatedSources.length === 1 ? "ה" : "ות"} בתוך ה-scope הנוכחי של ה-DB.`,
      contextCard?.summary || entity.description || `${entity.name} מופיע במאגר המודיעיני הנבחר כ-${entity.type}.`,
      contextCard?.role_in_document ? `תפקיד: ${contextCard.role_in_document}` : "",
      entity.evidence?.length ? `ראיות:\n- ${entity.evidence.slice(0, 3).join("\n- ")}` : "",
      relatedSources.length
        ? `מקורות חזקים:\n- ${relatedSources
            .slice(0, 3)
            .map((source) => `${source.title} (${formatPercent(source.relevance)})`)
            .join("\n- ")}`
        : "",
      relatedQuestions.length ? `שאלות פתוחות:\n${relatedQuestions.join("\n")}` : "",
      relatedTasks.length ? `משימות פתוחות:\n${relatedTasks.join("\n")}` : "",
      fallbackNotice,
    ].filter(Boolean);

    return hebrewLines.join("\n\n");
  }

  const lines = [
    `${entity.name} surfaced in ${relatedSources.length || 1} scoped database record${relatedSources.length === 1 ? "" : "s"}.`,
    contextCard?.summary || entity.description || `${entity.name} is present in the selected database scope as ${entity.type}.`,
    contextCard?.role_in_document ? `Role: ${contextCard.role_in_document}` : "",
    entity.evidence?.length ? `Evidence:\n- ${entity.evidence.slice(0, 3).join("\n- ")}` : "",
    relatedSources.length
      ? `Strongest source leads:\n- ${relatedSources
          .slice(0, 3)
          .map((source) => `${source.title} (${formatPercent(source.relevance)})`)
          .join("\n- ")}`
      : "",
    relatedQuestions.length ? `Open questions:\n${relatedQuestions.join("\n")}` : "",
    relatedTasks.length ? `Open tasks:\n${relatedTasks.join("\n")}` : "",
    fallbackNotice,
  ].filter(Boolean);

  return lines.join("\n\n");
};

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const buildLiveResearchCaseId = (corpus: LiveResearchCorpus, selectedStudyIds?: string[]): string => {
  const scopeIds = (selectedStudyIds?.length ? selectedStudyIds : corpus.sources.map((source) => source.id)).slice().sort();
  return `live_scope_${stableHash(scopeIds.join("|") || `all:${corpus.scope.totalStudies}`)}`;
};

const buildLiveResearchAnswerId = (caseId: string, question: string): string =>
  `live_answer_${stableHash(`${caseId}:${question}:${Date.now()}`)}`;

const persistLiveResearchReadPath = async (
  caseId: string,
  answerId: string,
  question: string,
  run: FcfR3ReadPathRun,
  citationRun?: CitationVerificationRun,
  auditOverrides: Partial<FcfR3AuditSummary> = {},
): Promise<{ audit: FcfR3AuditSummary; warning?: string }> => {
  const enrichedRun: FcfR3ReadPathRun =
    Object.keys(auditOverrides).length > 0
      ? {
          ...run,
          audit: {
            ...run.audit,
            ...auditOverrides,
          },
        }
      : run;

  try {
    const persisted = await persistFcfR3Run(
      buildFcfR3PersistedRun({
        caseId,
        question,
        readPathRun: enrichedRun,
        answerId,
        citationRun,
      }),
    );
    return {
      audit: {
        ...enrichedRun.audit,
        run_id: persisted.run.run_id,
        case_id: persisted.run.case_id,
        answer_id: answerId,
        persistence_status: persisted.run.persistence_status,
      },
    };
  } catch (error) {
    console.warn("FCF-R3 persistence failed for live research", error);
    return {
      audit: {
        ...enrichedRun.audit,
        case_id: caseId,
        answer_id: answerId,
        persistence_status: "failed",
      },
      warning: "FCF-R3 persistence failed; this read-path trace is available only in the current runtime.",
    };
  }
};

export const buildLiveResearchCorpus = (
  question: string,
  studies: StudyItem[],
  selectedStudyIds?: string[],
): LiveResearchCorpus => {
  const scopedStudies =
    selectedStudyIds && selectedStudyIds.length > 0
      ? studies.filter((study) => selectedStudyIds.includes(study.id))
      : studies;
  const selection = chooseStudies(question, studies, selectedStudyIds);
  const selected = selection.selected;
  const selectedStudies = selected.map((entry) => entry.study);
  const entities = mergeEntities(selectedStudies);
  const relations = mergeRelations(selectedStudies);
  const cleanText = buildCorpusText(
    selected.map((entry) => ({
      id: entry.study.id,
      title: entry.study.title,
      date: entry.study.date,
      source: entry.study.source,
      relevance: entry.relevance,
      reliability: entry.study.intelligence.reliability || 0,
      citationReady: Boolean(entry.study.intelligence.retrieval_artifacts),
      watchlistHits: (entry.study.intelligence.watchlist_hits || []).length,
      openQuestions: (entry.study.intelligence.intel_questions || []).length,
      openTasks: (entry.study.intelligence.intel_tasks || []).filter((task) => task.status !== "CLOSED").length,
      matchedSignals: entry.matchedSignals,
      evidencePreview: entry.evidencePreview,
    })),
    selectedStudies,
  );

  const mergedPackage: IntelligencePackage = {
    clean_text: cleanText || "No scoped database text available.",
    raw_text: cleanText,
    word_count: cleanText.split(/\s+/).filter(Boolean).length,
    document_metadata: {
      document_id: selectedStudies.length === 1 ? selectedStudies[0].id : "live-research-scope",
      title: selectedStudies.length === 1 ? selectedStudies[0].title : "Live Research Scoped DB Records",
      classification: "DB_SCOPE",
      author: "TEVEL",
      source_orgs: selectedStudies.map((study) => study.source).join(", "),
      language: "mixed",
    },
    entities,
    relations,
    insights: mergeByText(
      selectedStudies.flatMap((study) => study.intelligence.insights || []),
      (item: Insight) => item.text,
    ).slice(0, 40),
    timeline: mergeByText(
      selectedStudies.flatMap((study) => study.intelligence.timeline || []),
      (item: TimelineEvent) => `${item.date}|${item.event}`,
    ).slice(0, 60),
    statements: mergeByText(
      selectedStudies.flatMap((study) => study.intelligence.statements || []),
      (item: Statement) => item.statement_text,
    ).slice(0, 80),
    intel_questions: mergeByText(
      selectedStudies.flatMap((study) => study.intelligence.intel_questions || []),
      (item: IntelQuestion) => item.question_text,
    ).slice(0, 40),
    intel_tasks: mergeByText(
      selectedStudies.flatMap((study) => study.intelligence.intel_tasks || []),
      (item: IntelTask) => item.task_text,
    ).slice(0, 40),
    tactical_assessment: {
      ttps: uniqueStrings(selectedStudies.flatMap((study) => study.intelligence.tactical_assessment?.ttps || [])).slice(0, 12),
      recommendations: uniqueStrings(
        selectedStudies.flatMap((study) => study.intelligence.tactical_assessment?.recommendations || []),
      ).slice(0, 12),
      gaps: uniqueStrings(selectedStudies.flatMap((study) => study.intelligence.tactical_assessment?.gaps || [])).slice(0, 12),
    },
    context_cards: mergeContextCards(entities, selectedStudies),
    graph: buildGraph(entities, relations),
    reliability: averageReliability(selectedStudies),
    research_profile: inferScopeResearchProfile(selectedStudies),
    research_profile_detection: selectedStudies.length === 1 ? selectedStudies[0].intelligence.research_profile_detection : undefined,
    summary_panels: combineSummaryPanels(selectedStudies),
    retrieval_artifacts: combineRetrievalArtifacts(selectedStudies),
    version_validity: combineVersionValidity(selectedStudies),
    research_dossier: undefined,
    canonical_entities: selectedStudies.flatMap((study) => study.intelligence.canonical_entities || []),
    reference_knowledge: Object.assign({}, ...selectedStudies.map((study) => study.intelligence.reference_knowledge || {})),
    watchlist_hits: selectedStudies.flatMap((study) => study.intelligence.watchlist_hits || []),
    knowledge_sources: selectedStudies.flatMap((study) => study.intelligence.knowledge_sources || []),
    reference_warnings: uniqueStrings(selectedStudies.flatMap((study) => study.intelligence.reference_warnings || [])),
  };

  const sources: LiveResearchSource[] = selected.map((entry) => ({
    id: entry.study.id,
    title: entry.study.title,
    date: entry.study.date,
    source: entry.study.source,
    relevance: Number(Math.min(0.99, Math.max(0.01, entry.relevance / 4)).toFixed(2)),
    reliability: entry.study.intelligence.reliability || 0,
    citationReady: Boolean(entry.study.intelligence.retrieval_artifacts),
    watchlistHits: (entry.study.intelligence.watchlist_hits || []).length,
    openQuestions: (entry.study.intelligence.intel_questions || []).length,
    openTasks: (entry.study.intelligence.intel_tasks || []).filter((task) => task.status !== "CLOSED").length,
    matchedSignals: entry.matchedSignals,
    evidencePreview: entry.evidencePreview,
  }));

  const scope: LiveResearchScopeSummary = {
    totalStudies: studies.length,
    scopedStudies: scopedStudies.length,
    selectedStudies: selectedStudies.length,
    totalEntities: entities.length,
    totalRelations: relations.length,
    citationReadyStudies: scopedStudies.filter((study) => Boolean(study.intelligence.retrieval_artifacts)).length,
    watchlistHits: scopedStudies.reduce((sum, study) => sum + (study.intelligence.watchlist_hits || []).length, 0),
    retrievalBundles: Object.keys(mergedPackage.retrieval_artifacts?.bundles || {}).length,
    retrievalHits: Object.values(mergedPackage.retrieval_artifacts?.bundles || {}).reduce(
      (sum, bundle) => sum + bundle.hits.length,
      0,
    ),
    active_context_id: selection.activeContextId,
    active_context_reason: selection.activeContextReason,
    active_context_confidence: selection.activeContextConfidence,
    query_entity_mentions_in_context: selection.queryEntityMentionsInContext,
    alias_mentions_in_context: selection.aliasMentionsInContext,
    number_of_relevant_evidence_atoms: selection.numberOfRelevantEvidenceAtoms,
    competing_contexts: selection.competingContexts,
  };

  const warnings = uniqueStrings([
    ...(selectedStudies.length === 0 ? ["No studies were available in the current scope."] : []),
    ...(selection.ambiguous ? ["Active context confidence is too low to safely scope this question to one document/report/case."] : []),
    ...selectedStudies.flatMap((study) => study.intelligence.reference_warnings || []),
    ...(mergedPackage.retrieval_artifacts ? [] : ["Citation-ready retrieval artifacts are unavailable for the selected scope."]),
  ]).slice(0, 6);

  return {
    package: mergedPackage,
    sources,
    scope,
    warnings,
  };
};

export const buildLiveResearchQuestionBenchmark = (
  question: string,
  studies: StudyItem[],
  selectedStudyIds?: string[],
  options: LiveResearchQuestionOptions = {},
): LiveResearchTokenBenchmark => {
  const reasoningEngine = getReasoningEngineDescriptor(options.reasoningEngineId);
  const corpus = options.precomputedCorpus ?? buildLiveResearchCorpus(question, studies, selectedStudyIds);

  if (corpus.scope.scopedStudies === 0) {
    return makeTokenBenchmark("empty", corpus, studies, {
      selectedContext: "",
      question,
      outputExclusions: detectOutputConstraints(question).exclusions,
      warnings: corpus.warnings,
    });
  }

  if (corpus.sources.length === 0 || ((corpus.scope.active_context_confidence || 0) < 0.62 && (corpus.scope.competing_contexts || []).length > 1)) {
    return makeTokenBenchmark("blocked", corpus, studies, {
      selectedContext: "",
      question,
      outputExclusions: detectOutputConstraints(question).exclusions,
      warnings: corpus.warnings,
    });
  }

  if (shouldUseSourceGroundedAnswer(question, corpus)) {
    const constraints = detectOutputConstraints(question);
    const systemInstruction = buildSourceGroundedSystemInstruction(question, constraints);
    const readPath = buildSourceGroundedReadPath(
      question,
      corpus,
      studies,
      reasoningEngine.surface === "cloud" ? 11000 : 8200,
      constraints,
    );
    return makeTokenBenchmark("source-grounded", corpus, studies, {
      selectedContext: `${readPath.knowledgeSnapshot}\n\n${readPath.retrievalContext}`,
      systemInstruction,
      question,
      outputExclusions: constraints.exclusions,
      warnings: corpus.warnings,
    });
  }

  const fcfRun = buildFcfR3ReadPath(question, corpus.package, {
    maxContextChars: reasoningEngine.surface === "cloud" ? 5200 : 3600,
    maxEvidenceItems: reasoningEngine.surface === "cloud" ? 12 : 8,
    maxSnippetChars: reasoningEngine.surface === "cloud" ? 220 : 180,
    allowCrossSource: isGlobalDbSearchQuery(question) || CROSS_DOCUMENT_QUERY_RE.test(question) || Boolean(selectedStudyIds && selectedStudyIds.length > 1),
  });

  return makeTokenBenchmark("fcf-r3", corpus, studies, {
    selectedContext: `${fcfRun.knowledge_snapshot}\n\n${fcfRun.materialized_context}`,
    question,
    outputExclusions: detectOutputConstraints(question).exclusions,
    warnings: [...corpus.warnings, ...fcfRun.audit.warnings],
  });
};

const askSourceGroundedLiveResearchQuestion = async (
  question: string,
  studies: StudyItem[],
  history: ChatMessage[],
  corpus: LiveResearchCorpus,
  reasoningEngine: ReasoningEngineDescriptor,
  options: LiveResearchQuestionOptions,
): Promise<LiveResearchAnswer> => {
  const constraints = detectOutputConstraints(question);
  const caseId = `source_scope_${stableHash(corpus.sources.map((source) => source.id).sort().join("|") || question)}`;
  const answerId = `source_answer_${stableHash(`${caseId}:${question}:${Date.now()}`)}`;
  const systemInstruction = buildSourceGroundedSystemInstruction(question, constraints);
  const readPath = buildSourceGroundedReadPath(
    question,
    corpus,
    studies,
    reasoningEngine.surface === "cloud" ? 11000 : 8200,
    constraints,
  );
  const answerPackage: IntelligencePackage = {
    ...corpus.package,
    clean_text: readPath.retrievalContext || corpus.package.clean_text,
    raw_text: readPath.retrievalContext || corpus.package.raw_text,
    word_count: (readPath.retrievalContext || corpus.package.clean_text).split(/\s+/).filter(Boolean).length,
    retrieval_artifacts: undefined,
  };

  const answer = await askContextualQuestion(question, answerPackage, history, {
    fastMode: false,
    caseId,
    answerId,
    reasoningEngineId: reasoningEngine.id,
    geminiApiKey: options.geminiApiKey,
    answerTimeoutMs: reasoningEngine.surface === "cloud" ? 45000 : 90000,
    maxKnowledgeSummaryChars: 1400,
    systemInstruction,
    readPathContext: {
      knowledgeSnapshot: readPath.knowledgeSnapshot,
      retrievalContext: readPath.retrievalContext,
      candidateEvidenceIds: constraints.suppressEvidenceIds || constraints.suppressSystemCodes ? undefined : readPath.evidenceIds,
    },
  });
  const verificationNote = answer.match(/Citation verification:[^\n]+/i)?.[0];
  const answerWithoutCitationNote = answer.replace(/\n*Citation verification:[^\n]+/gi, "").trim();
  const reasoningFailure = classifyReasoningFailure(answerWithoutCitationNote, reasoningEngine);
  const sanitizedModelAnswer = sanitizeSourceGroundedAnswer(answerWithoutCitationNote, constraints);
  const constraintViolations = reasoningFailure
    ? []
    : detectSourceGroundedAnswerViolations(sanitizedModelAnswer, constraints, readPath);
  const engineTrace = constraintViolations.length
    ? {
        ...buildLiveResearchEngineTrace(null, reasoningEngine),
        responseMode: "deterministic-fallback" as const,
        failureMessage: "Model answer violated source-grounded output constraints.",
      }
    : buildLiveResearchEngineTrace(reasoningFailure, reasoningEngine);
  const finalAnswer = sanitizeSourceGroundedAnswer(
    reasoningFailure || constraintViolations.length
      ? buildSourceGroundedFallbackAnswer(question, readPath, engineTrace, constraints)
      : sanitizedModelAnswer,
    constraints,
  );
  const tokenBenchmark = makeTokenBenchmark("source-grounded", corpus, studies, {
    selectedContext: `${readPath.knowledgeSnapshot}\n\n${readPath.retrievalContext}`,
    systemInstruction,
    question,
    outputExclusions: constraints.exclusions,
    warnings: corpus.warnings,
  });

  return {
    answer: finalAnswer,
    sources: corpus.sources,
    scope: corpus.scope,
    warnings: uniqueStrings([
      ...corpus.warnings,
      "Source-grounded document answer path used for this question.",
      ...(constraints.exclusions.length ? ["Explicit output exclusions were passed to the reasoning engine."] : []),
      ...(constraints.suppressEvidenceIds || constraints.suppressSystemCodes ? ["Evidence IDs and system codes were suppressed for this answer."] : []),
      ...(constraintViolations.length ? [`Model answer failed output quality guard: ${constraintViolations.join("; ")}.`] : []),
      engineTrace.failureMessage || "",
    ]).slice(0, 8),
    verificationNote,
    citationGuard: "limited",
    engineTrace,
    tokenBenchmark,
  };
};

export const askLiveResearchQuestion = async (
  question: string,
  studies: StudyItem[],
  history: ChatMessage[],
  selectedStudyIds?: string[],
  options: LiveResearchQuestionOptions = {},
): Promise<LiveResearchAnswer> => {
  const reasoningEngine = getReasoningEngineDescriptor(options.reasoningEngineId);
  const corpus = buildLiveResearchCorpus(question, studies, selectedStudyIds);

  if ((corpus.scope.active_context_confidence || 0) < 0.62 && (corpus.scope.competing_contexts || []).length > 1) {
    return {
      answer: "לא ברור על איזה תיק/מסמך להריץ את השאלה.",
      sources: [],
      scope: corpus.scope,
      warnings: corpus.warnings,
      citationGuard: "limited",
      tokenBenchmark: buildLiveResearchQuestionBenchmark(question, studies, selectedStudyIds, options),
    };
  }

  if (corpus.scope.scopedStudies === 0) {
    return {
      answer: "No database records are currently loaded into TEVEL, so Live Research has nothing to query.",
      sources: [],
      scope: corpus.scope,
      warnings: corpus.warnings,
      citationGuard: "limited",
      tokenBenchmark: buildLiveResearchQuestionBenchmark(question, studies, selectedStudyIds, options),
    };
  }

  if (corpus.sources.length === 0) {
    return {
      answer: /[\u0590-\u05FF]/u.test(question)
        ? "לא נמצא מסמך DB שתואם לשאלה הזו. בחר את מסמכי המקור הרלוונטיים ב-scope או העלה אותם מחדש, ואז הרץ את השאלה שוב."
        : "No DB document matched this question. Select the relevant source records in scope or ingest them again, then ask again.",
      sources: [],
      scope: corpus.scope,
      warnings: uniqueStrings([
        ...corpus.warnings,
        "No selected DB record had enough source-text grounding for this document question.",
      ]).slice(0, 8),
      citationGuard: "limited",
      tokenBenchmark: buildLiveResearchQuestionBenchmark(question, studies, selectedStudyIds, options),
    };
  }

  if (shouldUseSourceGroundedAnswer(question, corpus)) {
    return askSourceGroundedLiveResearchQuestion(question, studies, history, corpus, reasoningEngine, options);
  }

  // corpus.package is already scoped to selected studies by buildLiveResearchCorpus.
  // Do NOT pass allowedSourceDocIds: atoms in the merged package use source_doc_id values
  // of "live-research-scope" (structured atoms) or "study_${hash}:original" (retrieval hits),
  // neither of which matches raw study IDs — the filter would prune all atoms.
  const fcfRun = buildFcfR3ReadPath(question, corpus.package, {
    maxContextChars: reasoningEngine.surface === "cloud" ? 5200 : 3600,
    maxEvidenceItems: reasoningEngine.surface === "cloud" ? 12 : 8,
    maxSnippetChars: reasoningEngine.surface === "cloud" ? 220 : 180,
    allowCrossSource: isGlobalDbSearchQuery(question) || CROSS_DOCUMENT_QUERY_RE.test(question) || Boolean(selectedStudyIds && selectedStudyIds.length > 1),
  });
  // Accept any entity-grounded non-noise evidence — include relations with supporting text.
  const scopedEntityGroundingOk = fcfRun.selected.some(
    (entry) =>
      entry.entity_grounded &&
      !["weak_noisy_evidence", "hypothesis_eei"].includes(entry.evidence_type),
  );
  if (!scopedEntityGroundingOk) {
    return {
      answer: "נמצאו ראיות חלקיות בלבד במסגרת המקור הנוכחי.",
      sources: corpus.sources,
      scope: corpus.scope,
      warnings: uniqueStrings([...corpus.warnings, "Scoped retrieval did not find direct entity-grounded evidence in the active source."]).slice(0, 8),
      citationGuard: "limited",
      fcfAudit: {
        ...fcfRun.audit,
        answer_status: "insufficient-evidence",
      },
      tokenBenchmark: buildLiveResearchQuestionBenchmark(question, studies, selectedStudyIds, options),
    };
  }
  const fcfCaseId = buildLiveResearchCaseId(corpus, selectedStudyIds);
  const fcfAnswerId = buildLiveResearchAnswerId(fcfCaseId, question);
  let citationRun: CitationVerificationRun | undefined;

  // For cross-document queries inject a compact synthesis block into the knowledge snapshot.
  // This gives the model structural intel (shared actors, patterns) without touching the
  // evidence retrieval context or citations.
  const isCrossDocQuery = CROSS_DOCUMENT_QUERY_RE.test(question);
  const crossDocSynthesisBlock = (() => {
    if (!isCrossDocQuery || corpus.sources.length < 2) return "";
    const hebrew = /[֐-׿]/u.test(question);
    const scopedStudies = studies.filter((s) => corpus.sources.some((src) => src.id === s.id));
    const synthesis = synthesizeAcrossDocuments(scopedStudies);
    if (!synthesis.sharedEntities.length && !synthesis.crossFilePatterns.length) return "";
    const formatted = hebrew
      ? formatCrossDocumentSynthesisHebrew(synthesis)
      : formatCrossDocumentSynthesisEnglish(synthesis);
    // Keep it compact — up to 700 chars so it doesn't crowd out evidence
    return `\nCROSS_DOC_SYNTHESIS:\n${formatted.slice(0, 700)}`;
  })();

  const answerPackage: IntelligencePackage = {
    ...corpus.package,
    clean_text: fcfRun.materialized_context,
    raw_text: fcfRun.materialized_context,
    word_count: fcfRun.materialized_context.split(/\s+/).filter(Boolean).length,
    retrieval_artifacts: fcfRun.retrieval_artifacts,
  };
  const answer = await askContextualQuestion(question, answerPackage, history, {
    fastMode: true,
    caseId: fcfCaseId,
    answerId: fcfAnswerId,
    reasoningEngineId: reasoningEngine.id,
    geminiApiKey: options.geminiApiKey,
    answerTimeoutMs: reasoningEngine.surface === "cloud" ? 45000 : 90000,
    maxKnowledgeSummaryChars: 900,
    systemInstruction: LIVE_RESEARCH_DB_ONLY_SYSTEM_INSTRUCTION,
    onCitationVerification: (run) => {
      citationRun = run;
    },
    readPathContext: {
      knowledgeSnapshot: fcfRun.knowledge_snapshot + crossDocSynthesisBlock,
      retrievalContext: fcfRun.materialized_context,
      candidateEvidenceIds: fcfRun.audit.selected_evidence_ids,
    },
  });
  let verificationNote = answer.match(/Citation verification:[^\n]+/i)?.[0];
  // Strip the inline citation line from the body — it is surfaced separately in verificationNote
  const answerWithoutCitationNote = answer.replace(/\n*Citation verification:[^\n]+/gi, "").trim();
  const reasoningFailure = classifyReasoningFailure(answerWithoutCitationNote, reasoningEngine);
  const engineTrace = buildLiveResearchEngineTrace(reasoningFailure, reasoningEngine);
  const offlineFallback = buildEntityScopedFallback(question, corpus, engineTrace);
  const fcfFallback = buildFcfR3DeterministicAnswer(question, fcfRun, {
    reasoningEngineSurface: engineTrace.engineSurface,
    failureKind: engineTrace.failureKind || "offline",
  });
  // Only replace model answer with deterministic fallback when BOTH: the model didn't
  // cite any selected evidence AND the citation verifier confirms < 40% support.
  // Using OR here discarded perfectly good Ollama answers just because the model wrote
  // natural language without bracketed IDs — that's worse than the model's answer.
  const modelAnswerIsWeaklyGrounded =
    !reasoningFailure &&
    fcfRun.selected.length > 0 &&
    !answerCitesSelectedEvidence(answerWithoutCitationNote, fcfRun.audit.selected_evidence_ids) &&
    (citationRun ? citationRun.supported_claim_rate < 0.4 : false);

  const verifiedSynthesis = modelAnswerIsWeaklyGrounded
    ? buildFcfR3DeterministicAnswer(question, fcfRun, {
        reasoningEngineSurface: engineTrace.engineSurface,
        failureKind: "offline",
        includeFallbackNotice: false,
      })
    : "";

  if (modelAnswerIsWeaklyGrounded) {
    engineTrace.responseMode = "verified-synthesis";
    verificationNote = undefined;
  }

  const finalAnswer = reasoningFailure
    ? fcfFallback || offlineFallback || answerWithoutCitationNote
    : verifiedSynthesis || answerWithoutCitationNote;
  let citationWarning: string | undefined;
  if (!citationRun || reasoningFailure || modelAnswerIsWeaklyGrounded) {
    try {
      citationRun = await verifyAnswerCitations({
        caseId: fcfCaseId,
        answerId: fcfAnswerId,
        answerText: finalAnswer,
        retrievalArtifacts: fcfRun.retrieval_artifacts,
        versionValidity: corpus.package.version_validity,
        candidateEvidenceIds: fcfRun.audit.selected_evidence_ids,
      });
    } catch (error) {
      console.warn("FCF-R3 fallback citation verification failed", error);
      citationWarning = "Citation verification failed for the persisted FCF-R3 run.";
    }
  }
  const persistedReadPath = await persistLiveResearchReadPath(fcfCaseId, fcfAnswerId, question, fcfRun, citationRun, {
    reasoning_engine_label: engineTrace.engineLabel,
    reasoning_engine_surface: engineTrace.engineSurface,
    reasoning_outcome: engineTrace.responseMode,
    reasoning_failure_kind: engineTrace.failureKind,
    supported_claim_rate: citationRun?.supported_claim_rate,
    citation_status: citationRun?.overall_status,
  });
  const persistedVerificationNote =
    verificationNote ||
    (citationRun
      ? `Citation verification: ${citationRun.overall_status.replace(/_/g, " ")} (${Math.round(citationRun.supported_claim_rate * 100)}% supported claims).`
      : undefined);
  const tokenBenchmark = makeTokenBenchmark("fcf-r3", corpus, studies, {
    selectedContext: `${fcfRun.knowledge_snapshot}\n\n${fcfRun.materialized_context}`,
    systemInstruction: LIVE_RESEARCH_DB_ONLY_SYSTEM_INSTRUCTION,
    question,
    outputExclusions: detectOutputConstraints(question).exclusions,
    warnings: [...corpus.warnings, ...fcfRun.audit.warnings],
  });

  return {
    answer: finalAnswer,
    sources: corpus.sources,
    scope: corpus.scope,
    warnings: uniqueStrings([
      ...corpus.warnings,
      ...fcfRun.audit.warnings,
      engineTrace.failureMessage || "",
      citationWarning || "",
      persistedReadPath.warning || "",
    ]).slice(0, 8),
    verificationNote: persistedVerificationNote,
    citationGuard: fcfRun.retrieval_artifacts.item_count > 0 ? "active" : "limited",
    engineTrace,
    fcfAudit: persistedReadPath.audit,
    tokenBenchmark,
  };
};
