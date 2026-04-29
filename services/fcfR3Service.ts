import type { Entity, Insight, IntelligencePackage, Relation, Statement, TimelineEvent } from "../types";
import type {
  RetrievalArtifacts,
  RetrievalBundleKind,
  RetrievalEvidenceHit,
  RetrievalItemType,
} from "./sidecar/retrieval";
import type { VersionValidityState } from "./sidecar/versionValidity/contracts";
import { normalizeLookupText } from "./sidecar/textUnits";

type FcfR3RouteMode = "case" | "entity" | "relationship" | "timeline" | "contradiction" | "update";
type FcfR3TaskFamily = "general" | "financial" | "temporal" | "policy" | "risk";
type FcfR3AnswerStatus =
  | "current-supported"
  | "historical-only"
  | "conflict-detected"
  | "insufficient-evidence"
  | "no-evidence"
  | "human-review-required";
type FcfR3AtomKind =
  | "retrieval_hit"
  | "version_atom"
  | "entity_context"
  | "statement"
  | "insight"
  | "timeline"
  | "relation"
  | "case_gist";

export interface FcfR3QueryPlan {
  raw_query: string;
  normalized_query: string;
  terms: string[];
  entities: string[];
  dates: string[];
  mode: FcfR3RouteMode;
  task_family: FcfR3TaskFamily;
  wants_current: boolean;
  citation_required: boolean;
  max_evidence_items: number;
  max_context_chars: number;
}

export interface FcfR3EvidenceAtom {
  atom_id: string;
  kind: FcfR3AtomKind;
  item_type: RetrievalItemType;
  source_doc_id: string;
  source_text_unit_id?: string;
  evidence_id?: string;
  citation_id: string;
  title: string;
  text: string;
  text_hash: string;
  entity_anchors: string[];
  time_anchors: string[];
  version_state: VersionValidityState;
  validity_score: number;
  source_trust: number;
  confidence: number;
  task_family: FcfR3TaskFamily;
  retrieval_score: number;
  contradiction_ids: string[];
  version_edge_ids: string[];
  reference_only: boolean;
  cost_chars: number;
}

export interface FcfR3ScoreBreakdown {
  semantic_relevance: number;
  lexical_entity_match: number;
  version_validity: number;
  source_trust: number;
  novelty: number;
  task_family_match: number;
  cost_penalty: number;
  final_score: number;
}

export interface FcfR3SelectedEvidence {
  atom: FcfR3EvidenceAtom;
  score: number;
  reason_selected: string[];
  score_breakdown: FcfR3ScoreBreakdown;
}

export type FcfR3ReasoningEngineSurface = "cloud" | "local";
export type FcfR3ReasoningOutcome = "model-answer" | "verified-synthesis" | "deterministic-fallback";
export type FcfR3ReasoningFailureKind = "timeout" | "offline";

export interface FcfR3AuditSummary {
  run_id?: string;
  case_id?: string;
  answer_id?: string;
  persistence_status?: "pending" | "verified" | "no_claims" | "failed";
  answer_status: FcfR3AnswerStatus;
  candidate_count: number;
  pruned_count: number;
  selected_count: number;
  context_chars: number;
  estimated_input_tokens: number;
  selected_evidence_ids: string[];
  route_mode: FcfR3RouteMode;
  task_family: FcfR3TaskFamily;
  warnings: string[];
  reasoning_engine_label?: string;
  reasoning_engine_surface?: FcfR3ReasoningEngineSurface;
  reasoning_outcome?: FcfR3ReasoningOutcome;
  reasoning_failure_kind?: FcfR3ReasoningFailureKind;
  supported_claim_rate?: number;
  citation_status?: string;
}

export interface FcfR3ReadPathRun {
  query_plan: FcfR3QueryPlan;
  selected: FcfR3SelectedEvidence[];
  materialized_context: string;
  knowledge_snapshot: string;
  retrieval_artifacts: RetrievalArtifacts;
  audit: FcfR3AuditSummary;
}

type FcfR3BuildOptions = {
  maxEvidenceItems?: number;
  maxContextChars?: number;
  maxSnippetChars?: number;
};

const QUERY_STOPWORDS = new Set([
  "מה",
  "מי",
  "הוא",
  "היא",
  "זה",
  "זאת",
  "על",
  "של",
  "את",
  "עם",
  "לי",
  "who",
  "what",
  "is",
  "are",
  "the",
  "about",
  "tell",
  "me",
]);

const VERSION_WEIGHT: Record<VersionValidityState, number> = {
  current: 1,
  unknown: 0.68,
  amended: 0.64,
  historical: 0.48,
  superseded: 0.26,
  contradicted: 0.14,
  cancelled: 0.08,
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const round = (value: number): number => Number(value.toFixed(4));

const uniqueStrings = (items: string[]): string[] => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const truncate = (value: string, maxChars: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
};

const tokenize = (value: string): string[] =>
  uniqueStrings(
    normalizeLookupText(value)
      .split(/\s+/)
      .filter((term) => term.length > 1 && !QUERY_STOPWORDS.has(term)),
  );

const extractDates = (value: string): string[] =>
  uniqueStrings([
    ...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g),
    ...value.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g),
    ...value.matchAll(/\b(?:19|20)\d{2}\b/g),
  ].map((match) => match[0]));

const isEntityMatch = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeLookupText(left);
  const normalizedRight = normalizeLookupText(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      (normalizedLeft === normalizedRight ||
        ((normalizedLeft.length > 3 || normalizedRight.length > 3) &&
          (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)))),
  );
};

const inferTaskFamily = (value: string): FcfR3TaskFamily => {
  const normalized = normalizeLookupText(value);
  if (/(price|cost|budget|fund|payment|finance|כסף|תקציב|תשלום|מימון|פיננס)/i.test(normalized)) return "financial";
  if (/(date|deadline|timeline|before|after|תאריך|לפני|אחרי|ציר זמן|מתי)/i.test(normalized)) return "temporal";
  if (/(rule|policy|procedure|must|shall|מדיניות|נוהל|חייב)/i.test(normalized)) return "policy";
  if (/(risk|warning|threat|conflict|contradict|סתירה|איום|סיכון|קונפליקט)/i.test(normalized)) return "risk";
  return "general";
};

const inferMode = (query: string): FcfR3RouteMode => {
  const normalized = normalizeLookupText(query);
  if (/(current|latest|valid|בתוקף|עדכני|האחרון|עכשיו)/i.test(normalized)) return "update";
  if (/(contradiction|conflict|סתירה|סותר|קונפליקט)/i.test(normalized)) return "contradiction";
  if (/(timeline|when|ציר זמן|מתי|תאריכים)/i.test(normalized)) return "timeline";
  if (/(relationship|link|ties|connection|קשר|מקשר|יחסים)/i.test(normalized)) return "relationship";
  if (/(who|מי|entity|ישות|אדם)/i.test(normalized)) return "entity";
  return "case";
};

export const compileFcfR3Query = (
  query: string,
  pkg: IntelligencePackage,
  options: FcfR3BuildOptions = {},
): FcfR3QueryPlan => {
  const terms = tokenize(query);
  const normalized = normalizeLookupText(query);
  const entities = uniqueStrings(
    (pkg.entities || [])
      .filter((entity) =>
        [entity.name, ...(entity.aliases || [])].some((candidate) =>
          terms.some((term) => isEntityMatch(candidate, term) || normalizeLookupText(candidate).includes(term)),
        ),
      )
      .map((entity) => entity.name),
  );

  return {
    raw_query: query,
    normalized_query: normalized,
    terms,
    entities,
    dates: extractDates(query),
    mode: inferMode(query),
    task_family: inferTaskFamily(query),
    wants_current: /(current|latest|valid|בתוקף|עדכני|האחרון|עכשיו)/i.test(normalized),
    citation_required: true,
    max_evidence_items: options.maxEvidenceItems ?? 8,
    max_context_chars: options.maxContextChars ?? 5200,
  };
};

const textHash = (value: string): string => stableHash(normalizeLookupText(value));

const makeAtom = (params: Omit<FcfR3EvidenceAtom, "text_hash" | "cost_chars" | "citation_id"> & { citation_id?: string }): FcfR3EvidenceAtom => {
  const text = truncate(params.text, 900);
  const citationId = params.citation_id || params.evidence_id || params.atom_id;
  return {
    ...params,
    text,
    citation_id: citationId,
    text_hash: textHash(text),
    cost_chars: text.length,
  };
};

const entityContextText = (entity: Entity, pkg: IntelligencePackage): string => {
  const card = pkg.context_cards?.[entity.name];
  return [
    card?.summary,
    card?.role_in_document,
    entity.description,
    ...(entity.evidence || []).slice(0, 3),
  ]
    .filter(Boolean)
    .join(" ");
};

const collectRetrievalAtoms = (pkg: IntelligencePackage): FcfR3EvidenceAtom[] =>
  Object.entries(pkg.retrieval_artifacts?.bundles || {}).flatMap(([bundleKey, bundle]) =>
    bundle.hits
      .filter((hit) => !hit.reference_only || hit.score > 0.4)
      .map((hit) =>
        makeAtom({
          atom_id: `fcf_hit_${stableHash(`${bundleKey}:${hit.evidence_id || hit.item_id}:${hit.snippet}`)}`,
          kind: "retrieval_hit",
          item_type: hit.item_type,
          source_doc_id: hit.source_doc_id,
          source_text_unit_id: hit.source_text_unit_id,
          evidence_id: hit.evidence_id,
          title: bundle.title,
          text: hit.snippet,
          entity_anchors: uniqueStrings(hit.related_entities || []),
          time_anchors: uniqueStrings([hit.normalized_time_start || "", hit.normalized_time_end || ""]),
          version_state: hit.version_state || "unknown",
          validity_score: hit.validity_score ?? VERSION_WEIGHT[hit.version_state || "unknown"],
          source_trust: hit.source_trust ?? pkg.reliability ?? 0.64,
          confidence: hit.confidence,
          task_family: inferTaskFamily(`${bundle.query} ${hit.snippet}`),
          retrieval_score: hit.score,
          contradiction_ids: hit.contradiction_ids || [],
          version_edge_ids: hit.version_edge_ids || [],
          reference_only: Boolean(hit.reference_only),
        }),
      ),
  );

const collectVersionAtoms = (pkg: IntelligencePackage): FcfR3EvidenceAtom[] => {
  const existingEvidenceIds = new Set(
    Object.values(pkg.retrieval_artifacts?.bundles || {})
      .flatMap((bundle) => bundle.hits)
      .map((hit) => hit.evidence_id || hit.item_id),
  );

  return (pkg.version_validity?.atoms || [])
    .filter((atom) => !existingEvidenceIds.has(atom.evidence_id || atom.atom_id))
    .map((atom) =>
      makeAtom({
        atom_id: `fcf_version_${atom.atom_id}`,
        kind: "version_atom",
        item_type: "text_unit",
        source_doc_id: atom.source_doc_id,
        source_text_unit_id: atom.source_text_unit_id,
        evidence_id: atom.evidence_id,
        title: `Version atom ${atom.version_id}`,
        text: atom.text,
        entity_anchors: atom.entity_anchors,
        time_anchors: atom.time_anchors,
        version_state: atom.version_state,
        validity_score: atom.validity_score,
        source_trust: atom.source_trust,
        confidence: atom.validity_score,
        task_family: atom.task_family as FcfR3TaskFamily,
        retrieval_score: 0.2,
        contradiction_ids: atom.version_state === "contradicted" ? atom.version_edge_ids : [],
        version_edge_ids: atom.version_edge_ids,
        reference_only: false,
      }),
    );
};

const collectStructuredAtoms = (pkg: IntelligencePackage): FcfR3EvidenceAtom[] => {
  const entityAtoms = (pkg.entities || [])
    .map((entity) => ({ entity, text: entityContextText(entity, pkg) }))
    .filter((entry) => entry.text.trim())
    .map(({ entity, text }) =>
      makeAtom({
        atom_id: `fcf_entity_${stableHash(entity.name)}`,
        kind: "entity_context",
        item_type: "entity",
        source_doc_id: pkg.document_metadata?.document_id || "package",
        title: `Entity: ${entity.name}`,
        text,
        entity_anchors: uniqueStrings([entity.name, ...(entity.aliases || [])]),
        time_anchors: [],
        version_state: "unknown",
        validity_score: 0.68,
        source_trust: pkg.reliability ?? 0.64,
        confidence: entity.confidence ?? 0.65,
        task_family: inferTaskFamily(text),
        retrieval_score: 0.18,
        contradiction_ids: [],
        version_edge_ids: [],
        reference_only: false,
      }),
    );

  const statementAtoms = (pkg.statements || []).map((statement: Statement) =>
    makeAtom({
      atom_id: `fcf_statement_${statement.statement_id || stableHash(statement.statement_text)}`,
      kind: "statement",
      item_type: "claim",
      source_doc_id: pkg.document_metadata?.document_id || "package",
      evidence_id: statement.statement_id,
      title: `Statement: ${statement.category}`,
      text: statement.statement_text,
      entity_anchors: statement.related_entities || [],
      time_anchors: [],
      version_state: "unknown",
      validity_score: 0.62,
      source_trust: pkg.reliability ?? 0.64,
      confidence: statement.confidence,
      task_family: inferTaskFamily(`${statement.category} ${statement.statement_text}`),
      retrieval_score: 0.22,
      contradiction_ids: statement.assumption_flag ? [statement.statement_id] : [],
      version_edge_ids: [],
      reference_only: false,
    }),
  );

  const insightAtoms = (pkg.insights || []).map((insight: Insight, index) =>
    makeAtom({
      atom_id: `fcf_insight_${index}_${stableHash(insight.text)}`,
      kind: "insight",
      item_type: "claim",
      source_doc_id: pkg.document_metadata?.document_id || "package",
      title: `Insight: ${insight.type}`,
      text: insight.text,
      entity_anchors: [],
      time_anchors: [],
      version_state: "unknown",
      validity_score: 0.58,
      source_trust: pkg.reliability ?? 0.64,
      confidence: insight.importance,
      task_family: inferTaskFamily(insight.text),
      retrieval_score: 0.2,
      contradiction_ids: [],
      version_edge_ids: [],
      reference_only: false,
    }),
  );

  const timelineAtoms = (pkg.timeline || []).map((event: TimelineEvent, index) =>
    makeAtom({
      atom_id: `fcf_timeline_${index}_${stableHash(`${event.date}:${event.event}`)}`,
      kind: "timeline",
      item_type: "event",
      source_doc_id: pkg.document_metadata?.document_id || "package",
      title: `Timeline: ${event.date}`,
      text: `${event.date} - ${event.event}`,
      entity_anchors: [],
      time_anchors: [event.date],
      version_state: "unknown",
      validity_score: 0.58,
      source_trust: pkg.reliability ?? 0.64,
      confidence: 0.62,
      task_family: "temporal",
      retrieval_score: 0.2,
      contradiction_ids: [],
      version_edge_ids: [],
      reference_only: false,
    }),
  );

  const relationAtoms = (pkg.relations || []).map((relation: Relation, index) =>
    makeAtom({
      atom_id: `fcf_relation_${index}_${stableHash(`${relation.source}:${relation.type}:${relation.target}`)}`,
      kind: "relation",
      item_type: "relation",
      source_doc_id: pkg.document_metadata?.document_id || "package",
      title: `Relation: ${relation.type}`,
      text: `${relation.source} ${relation.type} ${relation.target}`,
      entity_anchors: uniqueStrings([relation.source, relation.target]),
      time_anchors: [],
      version_state: "unknown",
      validity_score: 0.58,
      source_trust: pkg.reliability ?? 0.64,
      confidence: relation.confidence,
      task_family: inferTaskFamily(`${relation.type} ${relation.source} ${relation.target}`),
      retrieval_score: 0.18,
      contradiction_ids: [],
      version_edge_ids: [],
      reference_only: false,
    }),
  );

  return [...entityAtoms, ...statementAtoms, ...insightAtoms, ...timelineAtoms, ...relationAtoms];
};

const collectFallbackAtom = (pkg: IntelligencePackage): FcfR3EvidenceAtom[] => {
  if (pkg.retrieval_artifacts || pkg.version_validity || pkg.entities.length || pkg.statements?.length || pkg.insights.length) {
    return [];
  }
  return [
    makeAtom({
      atom_id: `fcf_gist_${stableHash(pkg.clean_text)}`,
      kind: "case_gist",
      item_type: "text_unit",
      source_doc_id: pkg.document_metadata?.document_id || "package",
      title: "Case gist",
      text: pkg.clean_text,
      entity_anchors: [],
      time_anchors: [],
      version_state: "unknown",
      validity_score: 0.42,
      source_trust: pkg.reliability ?? 0.5,
      confidence: 0.45,
      task_family: inferTaskFamily(pkg.clean_text),
      retrieval_score: 0.08,
      contradiction_ids: [],
      version_edge_ids: [],
      reference_only: false,
    }),
  ];
};

export const buildFcfR3EvidenceAtoms = (pkg: IntelligencePackage): FcfR3EvidenceAtom[] =>
  [...collectRetrievalAtoms(pkg), ...collectVersionAtoms(pkg), ...collectStructuredAtoms(pkg), ...collectFallbackAtom(pkg)].filter(
    (atom) => atom.text.trim(),
  );

const scoreAtom = (atom: FcfR3EvidenceAtom, queryPlan: FcfR3QueryPlan): FcfR3ScoreBreakdown => {
  const normalizedText = normalizeLookupText(`${atom.title} ${atom.text} ${atom.entity_anchors.join(" ")}`);
  const matchedTerms = queryPlan.terms.filter((term) => normalizedText.includes(term));
  const lexicalScore = queryPlan.terms.length ? matchedTerms.length / queryPlan.terms.length : 0;
  const entityScore = queryPlan.entities.length
    ? queryPlan.entities.filter((entity) => atom.entity_anchors.some((anchor) => isEntityMatch(anchor, entity))).length /
      queryPlan.entities.length
    : atom.entity_anchors.some((anchor) => queryPlan.terms.some((term) => isEntityMatch(anchor, term)))
      ? 0.8
      : 0;
  const lexicalEntityMatch = Math.min(1, lexicalScore * 0.65 + entityScore * 0.55);
  const versionValidity = atom.validity_score || VERSION_WEIGHT[atom.version_state];
  const taskFamilyMatch = queryPlan.task_family === "general" || atom.task_family === queryPlan.task_family ? 1 : 0.35;
  const costPenalty = Math.min(0.18, atom.cost_chars / Math.max(1200, queryPlan.max_context_chars) * 0.25);
  const sourceTrust = Math.max(0.1, Math.min(1, atom.source_trust));
  const semanticRelevance = Math.max(0, Math.min(1, atom.retrieval_score));
  const novelty = 0.78;
  const currentPenalty =
    queryPlan.wants_current && ["historical", "superseded", "cancelled"].includes(atom.version_state) ? 0.16 : 0;
  const conflictPenalty = atom.version_state === "contradicted" ? 0.2 : 0;
  const finalScore =
    semanticRelevance * 0.25 +
    lexicalEntityMatch * 0.2 +
    versionValidity * 0.2 +
    sourceTrust * 0.15 +
    novelty * 0.1 +
    taskFamilyMatch * 0.1 -
    costPenalty -
    currentPenalty -
    conflictPenalty;

  return {
    semantic_relevance: round(semanticRelevance),
    lexical_entity_match: round(lexicalEntityMatch),
    version_validity: round(versionValidity),
    source_trust: round(sourceTrust),
    novelty: round(novelty),
    task_family_match: round(taskFamilyMatch),
    cost_penalty: round(costPenalty + currentPenalty + conflictPenalty),
    final_score: round(Math.max(0, finalScore)),
  };
};

const reasonForSelection = (atom: FcfR3EvidenceAtom, score: FcfR3ScoreBreakdown, queryPlan: FcfR3QueryPlan): string[] =>
  [
    score.lexical_entity_match > 0.3 ? "query/entity match" : "",
    score.version_validity >= 0.75 ? "current or high-validity evidence" : "",
    score.source_trust >= 0.75 ? "trusted source" : "",
    atom.contradiction_ids.length ? "conflict signal retained" : "",
    atom.task_family === queryPlan.task_family && queryPlan.task_family !== "general" ? `${queryPlan.task_family} task-family match` : "",
  ].filter(Boolean);

const scoreAndPruneCandidates = (
  atoms: FcfR3EvidenceAtom[],
  queryPlan: FcfR3QueryPlan,
): { candidates: FcfR3SelectedEvidence[]; prunedCount: number; warnings: string[] } => {
  const scored = atoms
    .map((atom) => {
      const score = scoreAtom(atom, queryPlan);
      return {
        atom,
        score: score.final_score,
        score_breakdown: score,
        reason_selected: reasonForSelection(atom, score, queryPlan),
      };
    })
    .filter((entry) => entry.score > 0.05 || entry.atom.contradiction_ids.length > 0);

  const byText = new Map<string, FcfR3SelectedEvidence>();
  scored.forEach((entry) => {
    const current = byText.get(entry.atom.text_hash);
    if (!current || entry.score > current.score) {
      byText.set(entry.atom.text_hash, entry);
    }
  });

  const deduped = Array.from(byText.values());
  const hasCurrent = deduped.some((entry) => entry.atom.version_state === "current");
  const validityPruned =
    queryPlan.wants_current && hasCurrent
      ? deduped.filter((entry) => !["cancelled", "superseded"].includes(entry.atom.version_state))
      : deduped;
  const warnings = [
    ...(deduped.length !== validityPruned.length ? ["Stale or cancelled evidence was pruned for a current-answer query."] : []),
    ...(atoms.length === 0 ? ["No evidence atoms were available for FCF-R3 selection."] : []),
  ];

  return {
    candidates: validityPruned.sort((left, right) => right.score - left.score),
    prunedCount: atoms.length - validityPruned.length,
    warnings,
  };
};

const selectBudgetedEvidence = (candidates: FcfR3SelectedEvidence[], queryPlan: FcfR3QueryPlan): FcfR3SelectedEvidence[] => {
  const selected: FcfR3SelectedEvidence[] = [];
  const entityCoverage = new Set<string>();
  let usedChars = 0;

  for (const candidate of candidates) {
    if (selected.length >= queryPlan.max_evidence_items) break;
    const projectedChars = usedChars + candidate.atom.cost_chars + 180;
    if (projectedChars > queryPlan.max_context_chars && selected.length > 0) continue;

    const newEntityCount = candidate.atom.entity_anchors.filter((entity) => !entityCoverage.has(normalizeLookupText(entity))).length;
    const sameKindCount = selected.filter((entry) => entry.atom.kind === candidate.atom.kind).length;
    if (selected.length >= 3 && sameKindCount >= 3 && newEntityCount === 0 && !candidate.atom.contradiction_ids.length) {
      continue;
    }

    selected.push({
      ...candidate,
      reason_selected: candidate.reason_selected.length ? candidate.reason_selected : ["highest budgeted marginal value"],
    });
    candidate.atom.entity_anchors.forEach((entity) => entityCoverage.add(normalizeLookupText(entity)));
    usedChars = projectedChars;
  }

  return selected;
};

const deriveAnswerStatus = (selected: FcfR3SelectedEvidence[], queryPlan: FcfR3QueryPlan): FcfR3AnswerStatus => {
  if (!selected.length) return "no-evidence";
  if (selected.some((entry) => entry.atom.contradiction_ids.length || entry.atom.version_state === "contradicted")) {
    return queryPlan.task_family === "risk" || queryPlan.mode === "contradiction" ? "conflict-detected" : "human-review-required";
  }
  if (selected.every((entry) => ["historical", "superseded", "cancelled"].includes(entry.atom.version_state))) return "historical-only";
  if (selected.some((entry) => entry.atom.version_state === "current" || entry.score >= 0.45)) return "current-supported";
  return "insufficient-evidence";
};

const toRetrievalHit = (entry: FcfR3SelectedEvidence): RetrievalEvidenceHit => ({
  item_id: entry.atom.atom_id,
  item_type: entry.atom.item_type,
  source_doc_id: entry.atom.source_doc_id,
  source_text_unit_id: entry.atom.source_text_unit_id,
  evidence_id: entry.atom.evidence_id || entry.atom.citation_id,
  reference_only: entry.atom.reference_only,
  snippet: entry.atom.text,
  related_entities: entry.atom.entity_anchors,
  related_events: [],
  normalized_time_start: entry.atom.time_anchors[0],
  contradiction_ids: entry.atom.contradiction_ids,
  version_state: entry.atom.version_state,
  validity_score: entry.atom.validity_score,
  source_trust: entry.atom.source_trust,
  version_edge_ids: entry.atom.version_edge_ids,
  confidence: entry.atom.confidence,
  score: entry.score,
  matched_terms: [],
  explanation: entry.reason_selected,
  score_breakdown: {
    lexical_score: entry.score_breakdown.lexical_entity_match,
    structural_score: round((entry.score_breakdown.version_validity + entry.score_breakdown.source_trust) / 2),
    semantic_score: entry.score_breakdown.semantic_relevance,
    intent_score: entry.score_breakdown.task_family_match,
    graph_score: 0,
    temporal_score: entry.atom.time_anchors.length ? 0.1 : 0,
    confidence_score: entry.atom.confidence,
    validity_score: entry.score_breakdown.version_validity,
    fused_score: entry.score,
  },
});

const buildRetrievalArtifacts = (queryPlan: FcfR3QueryPlan, selected: FcfR3SelectedEvidence[], warnings: string[]): RetrievalArtifacts => {
  const hits = selected.map(toRetrievalHit);
  const kind: RetrievalBundleKind =
    queryPlan.mode === "relationship"
      ? "relationship_brief"
      : queryPlan.mode === "timeline"
        ? "timeline_summary"
        : queryPlan.mode === "contradiction"
          ? "contradiction_summary"
          : queryPlan.mode === "update"
            ? "update_summary"
            : "case_brief";

  return {
    backend: "hybrid_graph_ranker_v1",
    warnings,
    item_count: hits.length,
    contradiction_item_count: hits.filter((hit) => hit.contradiction_ids.length > 0).length,
    bundle_count: 1,
    diagnostics: {
      semantic_enabled: false,
      version_validity_enabled: hits.some((hit) => Boolean(hit.version_state)),
      fusion_strategy: [
        "query compiler",
        "hybrid lexical/entity retrieval",
        "version validity pruning",
        "budgeted selector",
        "citation verification handoff",
      ],
    },
    bundles: {
      fcf_r3_selected: {
        bundle_id: "fcf_r3_selected",
        kind,
        title: "FCF-R3 Selected Evidence",
        query: queryPlan.raw_query,
        hits,
        cited_evidence_ids: hits.map((hit) => hit.evidence_id || hit.item_id),
        related_entities: uniqueStrings(hits.flatMap((hit) => hit.related_entities)),
        related_events: [],
        contradictions: uniqueStrings(hits.flatMap((hit) => hit.contradiction_ids)),
        version_state: hits.some((hit) => hit.version_state === "current") ? "current" : hits[0]?.version_state,
        validity_score: hits.length ? round(hits.reduce((sum, hit) => sum + (hit.validity_score || 0.5), 0) / hits.length) : undefined,
        confidence: hits.length ? round(hits.reduce((sum, hit) => sum + hit.confidence, 0) / hits.length) : 0,
        warnings,
      },
    },
  };
};

const materializeContext = (
  queryPlan: FcfR3QueryPlan,
  selected: FcfR3SelectedEvidence[],
  status: FcfR3AnswerStatus,
  warnings: string[],
  maxSnippetChars: number,
): string => {
  const evidenceLines = selected.map((entry, index) => {
    const id = entry.atom.evidence_id || entry.atom.citation_id;
    const state = entry.atom.version_state ? `state=${entry.atom.version_state}` : "state=unknown";
    const trust = `trust=${Math.round(entry.atom.source_trust * 100)}%`;
    const score = `score=${Math.round(entry.score * 100)}%`;
    return [
      `[${id}] ${entry.atom.title}`,
      `meta: rank=${index + 1}; ${state}; ${trust}; ${score}; reasons=${entry.reason_selected.join(", ") || "budgeted"}`,
      `text: ${truncate(entry.atom.text, maxSnippetChars)}`,
      entry.atom.entity_anchors.length ? `entities: ${entry.atom.entity_anchors.slice(0, 8).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const context = [
    "FCF-R3 READ PATH",
    `route: mode=${queryPlan.mode}; task_family=${queryPlan.task_family}; status=${status}`,
    `budget: selected=${selected.length}/${queryPlan.max_evidence_items}; max_context_chars=${queryPlan.max_context_chars}`,
    queryPlan.entities.length ? `compiled_entities: ${queryPlan.entities.join(", ")}` : "",
    queryPlan.dates.length ? `compiled_dates: ${queryPlan.dates.join(", ")}` : "",
    warnings.length ? `warnings:\n- ${warnings.join("\n- ")}` : "",
    "",
    "SELECTED EXACT EVIDENCE",
    evidenceLines.length ? evidenceLines.join("\n\n") : "No evidence selected. The model must abstain or ask for more data.",
    "",
    "ANSWER RULES",
    "Use only selected evidence ids in brackets. If the selected evidence is insufficient, say so explicitly.",
  ]
    .filter(Boolean)
    .join("\n");

  return truncate(context, queryPlan.max_context_chars);
};

const buildKnowledgeSnapshot = (queryPlan: FcfR3QueryPlan, audit: FcfR3AuditSummary): string =>
  JSON.stringify(
    {
      architecture: "FCF-R3",
      query_plan: {
        mode: queryPlan.mode,
        task_family: queryPlan.task_family,
        entities: queryPlan.entities,
        dates: queryPlan.dates,
        wants_current: queryPlan.wants_current,
        citation_required: queryPlan.citation_required,
      },
      audit,
    },
    null,
    2,
  );

export const buildFcfR3ReadPath = (
  query: string,
  pkg: IntelligencePackage,
  options: FcfR3BuildOptions = {},
): FcfR3ReadPathRun => {
  const queryPlan = compileFcfR3Query(query, pkg, options);
  const atoms = buildFcfR3EvidenceAtoms(pkg);
  const { candidates, prunedCount, warnings: pruneWarnings } = scoreAndPruneCandidates(atoms, queryPlan);
  const selected = selectBudgetedEvidence(candidates, queryPlan);
  const answerStatus = deriveAnswerStatus(selected, queryPlan);
  const warnings = uniqueStrings([
    ...pruneWarnings,
    ...(answerStatus === "no-evidence" ? ["No relevant evidence survived FCF-R3 selection."] : []),
    ...(answerStatus === "historical-only" ? ["Only stale or historical evidence supports this answer."] : []),
    ...(answerStatus === "conflict-detected" || answerStatus === "human-review-required"
      ? ["Conflict evidence is present; answer should surface uncertainty."]
      : []),
  ]);
  const maxSnippetChars = options.maxSnippetChars ?? 420;
  const materializedContext = materializeContext(queryPlan, selected, answerStatus, warnings, maxSnippetChars);
  const audit: FcfR3AuditSummary = {
    answer_status: answerStatus,
    candidate_count: candidates.length,
    pruned_count: prunedCount,
    selected_count: selected.length,
    context_chars: materializedContext.length,
    estimated_input_tokens: Math.ceil(materializedContext.length / 4),
    selected_evidence_ids: selected.map((entry) => entry.atom.evidence_id || entry.atom.citation_id),
    route_mode: queryPlan.mode,
    task_family: queryPlan.task_family,
    warnings,
  };

  return {
    query_plan: queryPlan,
    selected,
    materialized_context: materializedContext,
    knowledge_snapshot: buildKnowledgeSnapshot(queryPlan, audit),
    retrieval_artifacts: buildRetrievalArtifacts(queryPlan, selected, warnings),
    audit,
  };
};

export const buildFcfR3DeterministicAnswer = (
  query: string,
  run: FcfR3ReadPathRun,
  options?: {
    reasoningEngineSurface?: FcfR3ReasoningEngineSurface;
    failureKind?: FcfR3ReasoningFailureKind;
    includeFallbackNotice?: boolean;
  },
): string => {
  const isHebrew = /[\u0590-\u05FF]/u.test(query);
  const selectedLines = run.selected.slice(0, 5).map((entry) => {
    const id = entry.atom.evidence_id || entry.atom.citation_id;
    return `- ${truncate(entry.atom.text, 360)} [${id}]`;
  });
  const reasoningSurface: FcfR3ReasoningEngineSurface = options?.reasoningEngineSurface || "local";
  const failureKind: FcfR3ReasoningFailureKind = options?.failureKind || "timeout";
  const includeFallbackNotice = options?.includeFallbackNotice ?? true;
  const fallbackNotice = isHebrew
    ? reasoningSurface === "cloud"
      ? failureKind === "offline"
        ? "מנוע ההסקה בענן לא היה זמין, לכן נמסרה תשובת FCF-R3 דטרמיניסטית מתוך הראיות שנבחרו."
        : "מנוע ההסקה בענן לא החזיר תשובה בזמן, לכן נמסרה תשובת FCF-R3 דטרמיניסטית מתוך הראיות שנבחרו."
      : failureKind === "offline"
        ? "המודל המקומי לא היה זמין, לכן נמסרה תשובת FCF-R3 דטרמיניסטית מתוך הראיות שנבחרו."
        : "המודל המקומי לא החזיר תשובה בזמן, לכן נמסרה תשובת FCF-R3 דטרמיניסטית מתוך הראיות שנבחרו."
    : reasoningSurface === "cloud"
      ? failureKind === "offline"
        ? "The cloud reasoning engine was unavailable, so this deterministic FCF-R3 answer was assembled from selected evidence."
        : "The cloud reasoning engine did not answer in time, so this deterministic FCF-R3 answer was assembled from selected evidence."
      : failureKind === "offline"
        ? "The local model was unavailable, so this deterministic FCF-R3 answer was assembled from selected evidence."
        : "The local model did not answer in time, so this deterministic FCF-R3 answer was assembled from selected evidence.";

  if (!selectedLines.length) {
    return isHebrew
      ? `סטטוס FCF-R3: ${run.audit.answer_status}\n\nלא נמצאו ראיות מספיקות בקורפוס הנבחר כדי לענות בבטחה.`
      : `FCF-R3 status: ${run.audit.answer_status}\n\nNo sufficient evidence survived selection for a safe answer.`;
  }

  const warningLines = run.audit.warnings.slice(0, 3).map((warning) => `- ${warning}`);
  if (isHebrew) {
    return [
      `סטטוס FCF-R3: ${run.audit.answer_status}`,
      `נבחרו ${run.audit.selected_count} ראיות מתוך ${run.audit.candidate_count} מועמדים בתקציב של כ-${run.audit.estimated_input_tokens} טוקנים.`,
      "",
      "תשובה מבוססת ראיות:",
      selectedLines.join("\n"),
      warningLines.length ? `\nמגבלות:\n${warningLines.join("\n")}` : "",
      includeFallbackNotice ? `\n${fallbackNotice}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `FCF-R3 status: ${run.audit.answer_status}`,
    `Selected ${run.audit.selected_count} evidence atoms from ${run.audit.candidate_count} candidates within an estimated ${run.audit.estimated_input_tokens} input tokens.`,
    "",
    "Evidence-grounded answer:",
    selectedLines.join("\n"),
    warningLines.length ? `\nLimits:\n${warningLines.join("\n")}` : "",
    includeFallbackNotice ? `\n${fallbackNotice}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};
