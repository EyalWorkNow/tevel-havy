import { askContextualQuestion, isEntityMatch } from "./intelligenceService";
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
import { buildFcfR3PersistedRun } from "./fcfR3/contracts";
import { persistFcfR3Run } from "./fcfR3/store";
import { verifyAnswerCitations } from "./sidecar/citationVerification/service";

const MAX_SELECTED_STUDIES = 4;
const MAX_MATCHED_SIGNALS = 5;
const MAX_EVIDENCE_PREVIEWS = 3;
const MAX_STUDY_BLOCK_CHARS = 1400;
const MAX_CORPUS_TEXT_CHARS = 6500;
const MAX_STUDY_GIST_CHARS = 420;
const MAX_CONTEXT_CARD_CHARS = 360;
const MAX_EVIDENCE_SNIPPET_CHARS = 520;
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
}

export interface LiveResearchCorpus {
  package: IntelligencePackage;
  sources: LiveResearchSource[];
  scope: LiveResearchScopeSummary;
  warnings: string[];
}

export interface LiveResearchAnswer {
  answer: string;
  sources: LiveResearchSource[];
  scope: LiveResearchScopeSummary;
  warnings: string[];
  verificationNote?: string;
  citationGuard: "active" | "limited";
  fcfAudit?: FcfR3AuditSummary;
}

type ScoredStudy = {
  study: StudyItem;
  relevance: number;
  matchedSignals: string[];
  evidencePreview: string[];
  exactEntityMatches: string[];
  entityTermMatches: string[];
  phraseMatches: string[];
};

const normalize = (value: string): string => normalizeLookupText(value);

const uniqueStrings = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

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

const pickEvidencePreview = (
  study: StudyItem,
  queryTerms: string[],
  queryPhrases: string[],
  matchedEntities: string[],
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

  const evidence = uniqueStrings([
    ...entityEvidence,
    ...retrievalHits
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.snippet),
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
    pkg.raw_text?.slice(0, 5000) || "",
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

const scoreStudy = (question: string, study: StudyItem): ScoredStudy => {
  const queryTerms = splitTerms(question);
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
  const evidencePreview = pickEvidencePreview(study, queryTerms, queryPhrases, allEntityMatches);
  const evidenceBoost = evidencePreview.some((item) => queryTerms.some((term) => normalize(item).includes(term))) ? 0.18 : 0;

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

  return {
    study,
    relevance,
    matchedSignals,
    evidencePreview,
    exactEntityMatches,
    entityTermMatches,
    phraseMatches,
  };
};

const chooseStudies = (question: string, studies: StudyItem[], selectedStudyIds?: string[]): ScoredStudy[] => {
  const scopedStudies =
    selectedStudyIds && selectedStudyIds.length > 0
      ? studies.filter((study) => selectedStudyIds.includes(study.id))
      : studies;

  const scored = scopedStudies.map((study) => scoreStudy(question, study)).sort((left, right) => right.relevance - left.relevance);
  const exactEntityMatches = scored.filter((entry) => entry.exactEntityMatches.length > 0);
  if (exactEntityMatches.length > 0) {
    return exactEntityMatches.slice(0, MAX_SELECTED_STUDIES);
  }

  const phraseMatches = scored.filter((entry) => entry.phraseMatches.length > 0);
  if (phraseMatches.length > 0) {
    return phraseMatches.slice(0, MAX_SELECTED_STUDIES);
  }

  const entityTermMatches = scored.filter((entry) => entry.entityTermMatches.length > 0);
  if (entityTermMatches.length > 0) {
    return entityTermMatches.slice(0, MAX_SELECTED_STUDIES);
  }

  if (scored.length <= MAX_SELECTED_STUDIES) return scored;

  const positive = scored.filter((entry) => entry.relevance > 0.22);
  if (positive.length >= 3) {
    return positive.slice(0, MAX_SELECTED_STUDIES);
  }

  return scored.slice(0, MAX_SELECTED_STUDIES);
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
  const blocks = sources
    .map((source) => {
      const study = studies.find((candidate) => candidate.id === source.id);
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

const buildEntityScopedFallback = (question: string, corpus: LiveResearchCorpus): string | null => {
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

  if (isHebrewQuestion) {
    const hebrewLines = [
      `${entity.name} מופיע ב-${relatedSources.length || 1} תיק${relatedSources.length === 1 ? "" : "ים"} בתוך ה-scope הנוכחי.`,
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
      "המודל המקומי לא היה זמין, לכן התשובה הורכבה באופן דטרמיניסטי מתוך הראיות וכרטיסי ההקשר הקיימים.",
    ].filter(Boolean);

    return hebrewLines.join("\n\n");
  }

  const lines = [
    `${entity.name} surfaced in ${relatedSources.length || 1} scoped case${relatedSources.length === 1 ? "" : "s"}.`,
    contextCard?.summary || entity.description || `${entity.name} is present in the scoped intelligence corpus as ${entity.type}.`,
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
    "Local model was unavailable, so this answer was assembled deterministically from stored evidence and context cards.",
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
): Promise<{ audit: FcfR3AuditSummary; warning?: string }> => {
  try {
    const persisted = await persistFcfR3Run(
      buildFcfR3PersistedRun({
        caseId,
        question,
        readPathRun: run,
        answerId,
        citationRun,
      }),
    );
    return {
      audit: {
        ...run.audit,
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
        ...run.audit,
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
  const selected = chooseStudies(question, studies, selectedStudyIds);
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
    clean_text: cleanText || "No scoped corpus text available.",
    raw_text: cleanText,
    word_count: cleanText.split(/\s+/).filter(Boolean).length,
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
  };

  const warnings = uniqueStrings([
    ...(selectedStudies.length === 0 ? ["No studies were available in the current scope."] : []),
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

export const askLiveResearchQuestion = async (
  question: string,
  studies: StudyItem[],
  history: ChatMessage[],
  selectedStudyIds?: string[],
): Promise<LiveResearchAnswer> => {
  const corpus = buildLiveResearchCorpus(question, studies, selectedStudyIds);

  if (corpus.scope.scopedStudies === 0) {
    return {
      answer: "No studies are currently loaded into TEVEL, so the live research corpus is empty.",
      sources: [],
      scope: corpus.scope,
      warnings: corpus.warnings,
      citationGuard: "limited",
    };
  }

  const fcfRun = buildFcfR3ReadPath(question, corpus.package, {
    maxContextChars: 5200,
    maxEvidenceItems: 8,
    maxSnippetChars: 420,
  });
  const fcfCaseId = buildLiveResearchCaseId(corpus, selectedStudyIds);
  const fcfAnswerId = buildLiveResearchAnswerId(fcfCaseId, question);
  let citationRun: CitationVerificationRun | undefined;
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
    answerTimeoutMs: 1800000, // 30 minutes to accommodate very slow local execution
    maxKnowledgeSummaryChars: 900,
    onCitationVerification: (run) => {
      citationRun = run;
    },
    readPathContext: {
      knowledgeSnapshot: fcfRun.knowledge_snapshot,
      retrievalContext: fcfRun.materialized_context,
      candidateEvidenceIds: fcfRun.audit.selected_evidence_ids,
    },
  });
  const verificationNote = answer.match(/Citation verification:[^\n]+/i)?.[0];
  const offlineFallback = buildEntityScopedFallback(question, corpus);
  const fcfFallback = buildFcfR3DeterministicAnswer(question, fcfRun);
  const finalAnswer =
    /comms offline|timed out|unable to reach the local model/i.test(answer)
      ? `${offlineFallback || fcfFallback}\n\n${answer}`
      : answer;
  let citationWarning: string | undefined;
  if (!citationRun) {
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
  const persistedReadPath = await persistLiveResearchReadPath(fcfCaseId, fcfAnswerId, question, fcfRun, citationRun);
  const persistedVerificationNote =
    verificationNote ||
    (citationRun
      ? `Citation verification: ${citationRun.overall_status.replace(/_/g, " ")} (${Math.round(citationRun.supported_claim_rate * 100)}% supported claims).`
      : undefined);

  return {
    answer: finalAnswer,
    sources: corpus.sources,
    scope: corpus.scope,
    warnings: uniqueStrings([
      ...corpus.warnings,
      ...fcfRun.audit.warnings,
      citationWarning || "",
      persistedReadPath.warning || "",
    ]).slice(0, 8),
    verificationNote: persistedVerificationNote,
    citationGuard: fcfRun.retrieval_artifacts.item_count > 0 ? "active" : "limited",
    fcfAudit: persistedReadPath.audit,
  };
};
