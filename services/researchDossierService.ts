import {
  ContextCard,
  Entity,
  IntelligencePackage,
  IntelQuestion,
  IntelTask,
  InvestigationThread,
  Relation,
  ResearchDossier,
  ResearchEntityBrief,
} from "../types";
import { getActiveResearchProfiles, getResearchProfile } from "./researchProfiles";
import type { RetrievalEvidenceBundle, RetrievalEvidenceHit } from "./sidecar/retrieval";
import type { StructuredSummaryPanel } from "./sidecar/summarization/contracts";

const HEBREW_CHAR_REGEX = /[\u0590-\u05FF]/u;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const uniqueStrings = (items: Array<string | undefined | null>): string[] =>
  Array.from(new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]));

const sameEntity = (left: string, right: string): boolean => normalizeName(left) === normalizeName(right);

const containsAnyEntity = (text: string, entityNames: string[]): boolean => {
  const normalizedText = normalizeName(text);
  return entityNames.some((entityName) => normalizedText.includes(normalizeName(entityName)));
};

const findContextCardByName = (
  contextCards: Record<string, ContextCard> | undefined,
  entityName: string,
): ContextCard | undefined =>
  Object.entries(contextCards || {}).find(([name]) => sameEntity(name, entityName))?.[1];

const isHebrewDominant = (pkg: IntelligencePackage): boolean =>
  HEBREW_CHAR_REGEX.test(pkg.raw_text || pkg.clean_text || "");

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const priorityFromScore = (score: number): InvestigationThread["priority"] => {
  if (score >= 0.82) return "CRITICAL";
  if (score >= 0.71) return "HIGH";
  if (score >= 0.58) return "MEDIUM";
  return "LOW";
};

const significanceRank: Record<NonNullable<ContextCard["significance"]>, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const significanceFromConfidence = (confidence: number): NonNullable<ContextCard["significance"]> => {
  if (confidence >= 0.82) return "CRITICAL";
  if (confidence >= 0.72) return "HIGH";
  if (confidence >= 0.58) return "MEDIUM";
  return "LOW";
};

const buildThreadScore = (bundle: RetrievalEvidenceBundle, caseHits: RetrievalEvidenceHit[], referenceHits: RetrievalEvidenceHit[], entityNames: string[]): number => {
  const corroborationFactor = clamp(caseHits.length / 4, 0, 1);
  const referenceFactor = clamp(referenceHits.length / 2, 0, 1);
  const entityFactor = clamp(entityNames.length / 4, 0, 1);
  const contradictionFactor = bundle.contradictions.length > 0 ? 0.08 : 0;
  const temporalFactor = bundle.temporal_window?.start || bundle.related_events.length > 0 ? 0.06 : 0;
  return clamp(
    bundle.confidence * 0.56 + corroborationFactor * 0.16 + referenceFactor * 0.1 + entityFactor * 0.1 + contradictionFactor + temporalFactor,
    0.35,
    0.97,
  );
};

const truncateSentence = (value: string, limit = 220): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
};

const relationCounterparties = (entityName: string, relations: Relation[]): string[] =>
  uniqueStrings(
    relations
      .filter((relation) => sameEntity(relation.source, entityName) || sameEntity(relation.target, entityName))
      .map((relation) => (sameEntity(relation.source, entityName) ? relation.target : relation.source)),
  );

const buildNetworkNote = (entityName: string, relations: Relation[], hebrew: boolean): string => {
  const topRelations = relations
    .filter((relation) => sameEntity(relation.source, entityName) || sameEntity(relation.target, entityName))
    .slice(0, 2)
    .map((relation) => {
      const counterparty = sameEntity(relation.source, entityName) ? relation.target : relation.source;
      return hebrew
        ? `${entityName} מופיע בקשר ${relation.type.toLowerCase()} מול ${counterparty}`
        : `${entityName} appears in a ${relation.type.toLowerCase()} link with ${counterparty}`;
    });

  if (topRelations.length > 0) return topRelations.join(". ");
  return hebrew
    ? `${entityName} עדיין חסר מיפוי קשרים מלא ולכן נדרשת בדיקת המשך.`
    : `${entityName} still lacks a fully mapped network picture, so follow-up review is needed.`;
};

const buildThreadWhyItMatters = (
  bundle: RetrievalEvidenceBundle,
  entityNames: string[],
  referenceHits: RetrievalEvidenceHit[],
  hebrew: boolean,
): string => {
  if (bundle.contradictions.length > 0) {
    return hebrew
      ? `הציר הזה חשוב כי הוא משלב ראיות מחזקות לצד סתירות פעילות סביב ${entityNames.slice(0, 3).join(", ") || bundle.title}.`
      : `This thread matters because it combines corroborating evidence with active contradictions around ${entityNames.slice(0, 3).join(", ") || bundle.title}.`;
  }

  if (referenceHits.length > 0) {
    return hebrew
      ? `הציר הזה חשוב כי יש כאן גם עדויות מתוך המסמך וגם עוגני ייחוס חיצוניים שמחזקים את ${entityNames.slice(0, 3).join(", ") || bundle.title}.`
      : `This thread matters because internal evidence is reinforced by external reference signals tied to ${entityNames.slice(0, 3).join(", ") || bundle.title}.`;
  }

  if (entityNames.length > 1) {
    return hebrew
      ? `הציר הזה קושר יחד את ${entityNames.slice(0, 3).join(", ")} ומשרטט מהלך מחקרי שניתן להמשיך לאמת.`
      : `This thread links ${entityNames.slice(0, 3).join(", ")} into a working investigative line that can be further validated.`;
  }

  return hebrew
    ? `הציר הזה מגדיר מוקד חקירה פעיל שדורש הצלבה והעמקת ראיות.`
    : `This thread defines an active investigative focus that needs corroboration and deeper evidence.`;
};

const deriveBundleGaps = (
  bundle: RetrievalEvidenceBundle,
  caseHits: RetrievalEvidenceHit[],
  referenceHits: RetrievalEvidenceHit[],
  panel: StructuredSummaryPanel | undefined,
  hebrew: boolean,
): string[] => {
  const gaps = [...(panel?.uncertainty_notes || []), ...bundle.warnings];

  if (referenceHits.length === 0) {
    gaps.push(
      hebrew
        ? "עדיין אין אימות חיצוני מספק לציר הזה."
        : "This thread still lacks strong external corroboration.",
    );
  }

  if (caseHits.length < 2) {
    gaps.push(
      hebrew
        ? "מעט מדי פריטי ראיה כדי לעבוד בביטחון אנליטי מלא."
        : "Too few evidence items are available for analyst-grade confidence.",
    );
  }

  if (!bundle.temporal_window?.start && bundle.related_events.length === 0) {
    gaps.push(
      hebrew
        ? "העיגון הזמני של הציר עדיין חלש."
        : "Temporal anchoring for this thread is still weak.",
    );
  }

  if (bundle.confidence < 0.68) {
    gaps.push(
      hebrew
        ? "רמת הביטחון של הציר עדיין נמוכה מהסף המחקרי הרצוי."
        : "Thread confidence is still below the preferred research threshold.",
    );
  }

  return uniqueStrings(gaps).slice(0, 4);
};

const defaultActionsByKind = (bundle: RetrievalEvidenceBundle, entityNames: string[], hebrew: boolean): string[] => {
  const lead = entityNames[0] || bundle.title;
  switch (bundle.kind) {
    case "contradiction_summary":
      return [
        hebrew
          ? `לבודד את הסתירה המרכזית סביב ${lead} ולבדוק איזה מקור מחזיק בעיגון החזק ביותר.`
          : `Isolate the main contradiction around ${lead} and determine which source has the strongest grounding.`,
      ];
    case "timeline_summary":
      return [
        hebrew
          ? `לחזק את ציר הזמן סביב ${lead} עם חותמות זמן ומקורות משלימים.`
          : `Strengthen the timeline around ${lead} with timestamps and supporting sources.`,
      ];
    case "relationship_brief":
      return [
        hebrew
          ? `לאמת את הקשר בין ${entityNames.slice(0, 2).join(" ו-") || lead} בעזרת מקור נוסף שאינו טקסטואלי.`
          : `Validate the relationship between ${entityNames.slice(0, 2).join(" and ") || lead} with a non-textual supporting source.`,
      ];
    default:
      return [
        hebrew
          ? `להרחיב את בדיקת הראיות סביב ${lead} כדי להפוך את הציר מממצא לסיפור מחקרי סגור יותר.`
          : `Expand evidence review around ${lead} so the thread moves from a finding toward a closed research story.`,
      ];
  }
};

const collectRelatedQuestions = (questions: IntelQuestion[], entityNames: string[]): string[] =>
  uniqueStrings(
    questions
      .filter((question) => containsAnyEntity(question.question_text, entityNames))
      .map((question) => question.question_text),
  );

const collectRelatedTasks = (tasks: IntelTask[], entityNames: string[]): string[] =>
  uniqueStrings(
    tasks
      .filter((task) => containsAnyEntity(task.task_text, entityNames))
      .map((task) => task.task_text),
  );

const buildThreadFromBundle = (
  bundle: RetrievalEvidenceBundle,
  panel: StructuredSummaryPanel | undefined,
  questions: IntelQuestion[],
  tasks: IntelTask[],
  hebrew: boolean,
): InvestigationThread => {
  const caseHits = bundle.hits.filter((hit) => !hit.reference_only);
  const referenceHits = bundle.hits.filter((hit) => hit.reference_only);
  const entityNames = uniqueStrings([
    ...bundle.related_entities,
    ...caseHits.flatMap((hit) => hit.related_entities || []),
  ]).slice(0, 5);
  const score = buildThreadScore(bundle, caseHits, referenceHits, entityNames);
  const relatedQuestions = collectRelatedQuestions(questions, entityNames);
  const relatedTasks = collectRelatedTasks(tasks, entityNames);
  const corroboratingEvidence = uniqueStrings([
    ...(panel?.key_findings || []),
    ...caseHits.slice(0, 3).map((hit) => truncateSentence(hit.snippet)),
  ]).slice(0, 4);
  const referenceSignals = uniqueStrings([
    ...referenceHits.slice(0, 2).map((hit) => truncateSentence(hit.snippet, 180)),
    ...(panel?.reference_context?.source_labels || []),
  ]).slice(0, 3);
  const tensionPoints = uniqueStrings([
    ...bundle.contradictions,
    ...(panel?.contradictions || []),
  ]).slice(0, 3);
  const intelligenceGaps = deriveBundleGaps(bundle, caseHits, referenceHits, panel, hebrew);
  const nextActions = uniqueStrings([
    ...relatedTasks,
    ...relatedQuestions,
    ...defaultActionsByKind(bundle, entityNames, hebrew),
  ]).slice(0, 4);

  return {
    thread_id: `thread_${stableHash(bundle.bundle_id)}`,
    title: panel?.title || bundle.title,
    bundle_kind: bundle.kind,
    priority: priorityFromScore(score),
    confidence: score,
    thesis:
      panel?.summary_text ||
      corroboratingEvidence[0] ||
      (hebrew
        ? `המערכת זיהתה ציר חקירה פעיל סביב ${bundle.title}.`
        : `The system identified an active investigation thread around ${bundle.title}.`),
    why_it_matters: buildThreadWhyItMatters(bundle, entityNames, referenceHits, hebrew),
    entity_names: entityNames,
    corroborating_evidence: corroboratingEvidence,
    reference_signals: referenceSignals,
    tension_points: tensionPoints,
    intelligence_gaps: intelligenceGaps,
    next_actions: nextActions,
    evidence_count: caseHits.length,
    reference_count: referenceHits.length,
    contradiction_count: tensionPoints.length,
    timeline_window: bundle.temporal_window,
  };
};

const buildFallbackThreads = (pkg: IntelligencePackage, hebrew: boolean): InvestigationThread[] => {
  const rankedEntities = [...(pkg.entities || [])]
    .sort((left, right) => {
      const leftDegree = (pkg.relations || []).filter((relation) => sameEntity(relation.source, left.name) || sameEntity(relation.target, left.name)).length;
      const rightDegree = (pkg.relations || []).filter((relation) => sameEntity(relation.source, right.name) || sameEntity(relation.target, right.name)).length;
      const leftScore = leftDegree * 0.55 + (left.confidence || 0.4) * 0.45;
      const rightScore = rightDegree * 0.55 + (right.confidence || 0.4) * 0.45;
      return rightScore - leftScore;
    })
    .slice(0, 3);

  return rankedEntities.map((entity, index) => {
    const contextCard = findContextCardByName(pkg.context_cards, entity.name);
    const relations = (pkg.relations || []).filter(
      (relation) => sameEntity(relation.source, entity.name) || sameEntity(relation.target, entity.name),
    );
    const entityQuestions = collectRelatedQuestions(pkg.intel_questions || [], [entity.name, ...(entity.aliases || [])]);
    const entityTasks = collectRelatedTasks(pkg.intel_tasks || [], [entity.name, ...(entity.aliases || [])]);
    const evidence = uniqueStrings([
      ...(contextCard?.key_mentions || []),
      ...(entity.evidence || []),
    ]).slice(0, 3);
    const confidence = clamp((entity.confidence || 0.5) * 0.75 + clamp(relations.length / 4, 0, 1) * 0.25, 0.42, 0.9);

    return {
      thread_id: `thread_fallback_${stableHash(`${entity.name}_${index}`)}`,
      title: entity.name,
      priority: priorityFromScore(confidence),
      confidence,
      thesis:
        contextCard?.summary ||
        (hebrew
          ? `${entity.name} נשאר מוקד רלוונטי בחומר גם בלי שכבת retrieval מלאה.`
          : `${entity.name} remains a relevant focal point even without a full retrieval layer.`),
      why_it_matters: buildNetworkNote(entity.name, relations, hebrew),
      entity_names: uniqueStrings([entity.name, ...relationCounterparties(entity.name, relations)]).slice(0, 4),
      corroborating_evidence: evidence,
      reference_signals: [],
      tension_points: [],
      intelligence_gaps: uniqueStrings([
        ...entityQuestions,
        hebrew
          ? "עדיין חסרה חבילת ראיות מלאה לציר הזה."
          : "A full evidence bundle is still missing for this thread.",
      ]).slice(0, 3),
      next_actions: uniqueStrings([
        ...entityTasks,
        hebrew
          ? `להעמיק את ההצלבה סביב ${entity.name}.`
          : `Deepen corroboration around ${entity.name}.`,
      ]).slice(0, 3),
      evidence_count: evidence.length,
      reference_count: 0,
      contradiction_count: 0,
    };
  });
};

const buildEntityBriefs = (pkg: IntelligencePackage, threads: InvestigationThread[], hebrew: boolean): Record<string, ResearchEntityBrief> => {
  const prioritizedEntityNames = uniqueStrings([
    ...threads.flatMap((thread) => thread.entity_names),
    ...Object.keys(pkg.context_cards || {}),
    ...[...(pkg.entities || [])].sort((left, right) => (right.confidence || 0) - (left.confidence || 0)).slice(0, 6).map((entity) => entity.name),
  ]).slice(0, 18);

  return Object.fromEntries(
    prioritizedEntityNames.map((entityName) => {
      const entity =
        (pkg.entities || []).find((candidate) => sameEntity(candidate.name, entityName)) ||
        ({ id: entityName, name: entityName, type: "OTHER" } as Entity);
      const contextCard = findContextCardByName(pkg.context_cards, entityName);
      const relatedThreads = threads.filter((thread) => thread.entity_names.some((name) => sameEntity(name, entityName)));
      const questions = collectRelatedQuestions(pkg.intel_questions || [], [entityName, ...(entity.aliases || [])]);
      const tasks = collectRelatedTasks(pkg.intel_tasks || [], [entityName, ...(entity.aliases || [])]);
      const strongestSignal = uniqueStrings([
        contextCard?.key_mentions?.[0],
        relatedThreads[0]?.corroborating_evidence?.[0],
        ...(entity.evidence || []),
      ])[0];
      const confidence = clamp(
        Math.max(entity.confidence || 0.48, ...(relatedThreads.map((thread) => thread.confidence - 0.05) || [0.48])),
        0.38,
        0.95,
      );

      const brief: ResearchEntityBrief = {
        entity_name: entity.name,
        role:
          contextCard?.role_in_document ||
          entity.description ||
          (hebrew
            ? `${entity.name} זוהה כישות מחקרית מסוג ${entity.type}.`
            : `${entity.name} was identified as a ${entity.type} research entity.`),
        why_it_matters:
          relatedThreads[0]?.why_it_matters ||
          contextCard?.summary ||
          (hebrew
            ? `${entity.name} בולט בתמונה אך נדרשת עליו בדיקת ראיות ממוקדת.`
            : `${entity.name} stands out in the picture, but still needs focused evidence review.`),
        strongest_signal:
          strongestSignal ||
          (hebrew
            ? `עדיין אין קטע ראיה חד מספיק עבור ${entity.name}.`
            : `A sharp evidence snippet for ${entity.name} is still missing.`),
        network_note: buildNetworkNote(entity.name, pkg.relations || [], hebrew),
        open_questions: uniqueStrings([
          ...questions,
          ...tasks,
          ...relatedThreads.flatMap((thread) => thread.intelligence_gaps),
        ]).slice(0, 3),
        confidence,
      };

      return [entity.name, brief];
    }),
  );
};

export const buildResearchDossier = (pkg: IntelligencePackage): ResearchDossier => {
  const hebrew = isHebrewDominant(pkg);
  const profile = getResearchProfile(pkg.research_profile);
  const activeProfiles = getActiveResearchProfiles(pkg.research_profile_detection, pkg.research_profile);
  const profileStackLabel = activeProfiles.map((profileId) => getResearchProfile(profileId).label).join(" + ");
  const profileConfidence = pkg.research_profile_detection ? Math.round(pkg.research_profile_detection.confidence * 100) : null;
  const bundles = Object.values(pkg.retrieval_artifacts?.bundles || {});
  const questions = pkg.intel_questions || [];
  const tasks = pkg.intel_tasks || [];

  const threadsFromBundles = bundles.map((bundle) =>
    buildThreadFromBundle(bundle, pkg.summary_panels?.[bundle.kind], questions, tasks, hebrew),
  );

  const priorityThreads = (threadsFromBundles.length > 0 ? threadsFromBundles : buildFallbackThreads(pkg, hebrew))
    .sort((left, right) => {
      const priorityDelta =
        ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(left.priority) - ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(right.priority);
      if (priorityDelta !== 0) return priorityDelta;
      return right.confidence - left.confidence;
    })
    .slice(0, 5);

  const corroboratedThreads = priorityThreads.filter((thread) => thread.evidence_count >= 2).length;
  const contradictionThreads = priorityThreads.filter((thread) => thread.contradiction_count > 0).length;
  const leadTitles = priorityThreads.slice(0, 3).map((thread) => thread.title);
  const executiveSummary =
    priorityThreads[0]
      ? [
          priorityThreads[0].thesis,
          priorityThreads[1]?.thesis,
        ]
          .filter(Boolean)
          .join(" ")
      : hebrew
        ? `טרם נבנה דוח ${profile.label} מלא עבור החומר הנוכחי.`
        : `A full ${profile.label.toLowerCase()} dossier has not been built for the current material yet.`;
  const operatingPicture = hebrew
    ? `נבנו ${priorityThreads.length} צירי ${profile.label} פעילים בפרופיל ${profileStackLabel}${profileConfidence ? ` (${profileConfidence}% ביטחון)` : ""}. ${corroboratedThreads} מהם נתמכים ביותר מפריט ראיה אחד, ו-${contradictionThreads} כוללים סתירות או אזהרות פעילות. המוקדים המרכזיים כעת: ${leadTitles.join(", ") || "ללא מוקדים בולטים"}.`
    : `${priorityThreads.length} active ${profile.label.toLowerCase()} threads were assembled under the ${profileStackLabel} profile stack${profileConfidence ? ` (${profileConfidence}% confidence)` : ""}. ${corroboratedThreads} are backed by more than one evidence item, and ${contradictionThreads} include active contradictions or warnings. Current focal points: ${leadTitles.join(", ") || "none yet"}.`;

  const pressurePoints = uniqueStrings(
    priorityThreads.map((thread) =>
      hebrew
        ? `${thread.title}: ${thread.why_it_matters}`
        : `${thread.title}: ${thread.why_it_matters}`,
    ),
  ).slice(0, 4);

  const collectionPriorities = uniqueStrings([
    ...priorityThreads.flatMap((thread) => thread.next_actions),
    ...priorityThreads.flatMap((thread) => thread.intelligence_gaps),
  ]).slice(0, 6);

  return {
    executive_summary: executiveSummary,
    operating_picture: operatingPicture,
    priority_threads: priorityThreads,
    pressure_points: pressurePoints,
    collection_priorities: collectionPriorities,
    entity_briefs: buildEntityBriefs(pkg, priorityThreads, hebrew),
  };
};

const appendDistinctBlock = (existingBlock: string | undefined, nextBlock: string): string => {
  if (!existingBlock?.trim()) return nextBlock;
  if (normalizeName(existingBlock).includes(normalizeName(nextBlock))) return existingBlock;
  return `${existingBlock.trim()}\n\n${nextBlock}`;
};

export const mergeResearchDossierIntoContextCards = (
  contextCards: Record<string, ContextCard>,
  dossier: ResearchDossier,
  hebrew: boolean,
): Record<string, ContextCard> =>
  Object.fromEntries(
    Object.entries(contextCards).map(([entityName, card]) => {
      const brief = Object.entries(dossier.entity_briefs).find(([candidate]) => sameEntity(candidate, entityName))?.[1];
      if (!brief) return [entityName, card];

      const researchBlock = [
        hebrew ? "## Research posture" : "## Research posture",
        `- ${brief.why_it_matters}`,
        `- ${brief.strongest_signal}`,
        hebrew ? "## Network assessment" : "## Network assessment",
        `- ${brief.network_note}`,
        brief.open_questions.length > 0 ? (hebrew ? "## Open questions" : "## Open questions") : "",
        ...brief.open_questions.map((question) => `- ${question}`),
      ]
        .filter(Boolean)
        .join("\n");

      const currentSignificance = card.significance || "LOW";
      const briefSignificance = significanceFromConfidence(brief.confidence);
      const significance =
        significanceRank[briefSignificance] > significanceRank[currentSignificance] ? briefSignificance : currentSignificance;

      return [
        entityName,
        {
          ...card,
          summary: card.summary || brief.why_it_matters,
          role_in_document:
            card.role_in_document &&
            !/detected in the document|זוהה במסמך/i.test(card.role_in_document)
              ? card.role_in_document
              : brief.role,
          extended_profile: appendDistinctBlock(card.extended_profile, researchBlock),
          significance,
        },
      ];
    }),
  );
