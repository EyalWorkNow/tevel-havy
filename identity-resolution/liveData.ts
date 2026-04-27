import { StudyItem } from '../types';
import { PersonDossier, PersonEntity, PersonFact } from '../services/sidecar/person/types';
import {
  canonicalProfiles as mockCanonicalProfiles,
  conflictQueue as mockConflictQueue,
  documentReviewSnippets as mockDocumentReviewSnippets,
  personMentions as mockPersonMentions,
  resolutionMetrics as mockResolutionMetrics,
} from './mockData';
import {
  CanonicalPersonProfile,
  CandidateIdentity,
  ConflictQueueItem,
  EvidenceSnippet,
  PersonMentionRecord,
  ResolutionMetric,
} from './types';

type DataSourceMode = 'live' | 'mock';

type ReviewSnippet = {
  id: string;
  title: string;
  date?: string;
  excerpt: string;
  mentionIds: string[];
};

type IdentityResolutionDataset = {
  metrics: ResolutionMetric[];
  profiles: CanonicalPersonProfile[];
  mentions: PersonMentionRecord[];
  snippets: ReviewSnippet[];
  queue: ConflictQueueItem[];
  dataSource: DataSourceMode;
  backendStudies: number;
  fallbackStudies: number;
  warnings: string[];
};

type MentionSeed = {
  mentionId: string;
  rawMention: string;
  normalizedMention: string;
  documentId: string;
  documentTitle: string;
  page?: number;
  language: string;
  sourceSnippet: string;
  surroundingEntities: string[];
  preferredProfileId?: string;
  baseConfidence: number;
  pipelineMode: 'backend' | 'fallback';
  documentDate?: string;
};

type ProfileAccumulator = CanonicalPersonProfile & {
  _studyIds: Set<string>;
  _documentMentions: Set<string>;
};

const mockDataset: IdentityResolutionDataset = {
  metrics: mockResolutionMetrics,
  profiles: mockCanonicalProfiles,
  mentions: mockPersonMentions,
  snippets: mockDocumentReviewSnippets,
  queue: mockConflictQueue,
  dataSource: 'mock',
  backendStudies: 0,
  fallbackStudies: 0,
  warnings: ['Live person dossiers are not available yet for the current workspace selection.'],
};

const normalize = (value?: string) =>
  (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const unique = <T,>(values: T[]) => Array.from(new Set(values));

const detectLanguage = (text: string) => {
  if (/[\u0590-\u05FF]/.test(text)) return 'Hebrew';
  if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
  if (/[\u0400-\u04FF]/.test(text)) return 'Russian';
  return 'English';
};

const stringSimilarity = (left: string, right: string) => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const leftTokens = new Set(a.split(' '));
  const rightTokens = new Set(b.split(' '));
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenScore = union ? intersection / union : 0;
  const charPrefix = a.slice(0, 4) === b.slice(0, 4) ? 0.15 : 0;
  return Math.min(1, tokenScore + charPrefix);
};

const overlapScore = (context: string[], candidates: string[]) => {
  if (!context.length || !candidates.length) return 0;
  const normalizedContext = context.map(normalize).filter(Boolean);
  const normalizedCandidates = candidates.map(normalize).filter(Boolean);
  const hits = normalizedCandidates.filter((candidate) =>
    normalizedContext.some((contextValue) => contextValue.includes(candidate) || candidate.includes(contextValue)),
  ).length;
  return Math.min(1, hits / Math.max(1, normalizedCandidates.length));
};

const buildSnippet = (study: StudyItem, needles: string[]) => {
  const baseText =
    study.intelligence.raw_text ||
    study.intelligence.clean_text ||
    Object.values(study.intelligence.context_cards || {})
      .flatMap((card) => card.key_mentions || [])
      .join(' ');
  if (!baseText) {
    return `No source snippet was preserved for ${study.title}.`;
  }

  for (const needle of needles) {
    const index = baseText.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) {
      const start = Math.max(0, index - 110);
      const end = Math.min(baseText.length, index + Math.max(needle.length, 110));
      return baseText.slice(start, end).replace(/\s+/g, ' ').trim();
    }
  }

  return baseText.slice(0, 240).replace(/\s+/g, ' ').trim();
};

const getUiPersonEntities = (study: StudyItem) =>
  (study.intelligence.entities || []).filter((entity) => normalize(entity.type) === 'person');

const createEvidence = (
  study: StudyItem,
  canonicalName: string,
  dossier?: PersonDossier,
  entityEvidence: string[] = [],
): EvidenceSnippet[] => {
  const card = study.intelligence.context_cards?.[canonicalName];
  const snippets = unique([
    ...(entityEvidence || []),
    ...((card?.key_mentions || []).filter(Boolean) as string[]),
    ...((dossier?.claims || []).map((claim) => claim.text).filter(Boolean) as string[]),
  ])
    .filter(Boolean)
    .slice(0, 6);

  if (!snippets.length) {
    snippets.push(buildSnippet(study, [canonicalName, ...(dossier?.aliases || [])]));
  }

  return snippets.map((snippet, index) => ({
    id: `${study.id}_${normalize(canonicalName)}_${index}`,
    documentId: study.id,
    source: study.title,
    page: undefined,
    snippet,
    date: study.date,
    language: detectLanguage(snippet || canonicalName),
  }));
};

const createFacts = (
  dossier: PersonDossier | undefined,
  personFacts: PersonFact[],
): CanonicalPersonProfile['facts'] => {
  if (dossier) {
    const directFacts = [
      ...dossier.titles.map((value) => ({ label: 'Title', value })),
      ...dossier.roles.map((value) => ({ label: 'Role', value })),
      ...dossier.organizations.map((value) => ({ label: 'Organization', value })),
      ...dossier.locations.map((value) => ({ label: 'Location', value })),
      ...dossier.dates.map((value) => ({ label: 'Date', value })),
    ];

    if (directFacts.length) {
      return directFacts.map((fact, index) => ({
        ...fact,
        confidence: dossier.overallConfidence,
        evidenceIds: dossier.sourceMentions.slice(0, 3).map((mentionId) => `${mentionId}_${index}`),
      }));
    }
  }

  return personFacts.slice(0, 8).map((fact) => ({
    label: fact.kind[0].toUpperCase() + fact.kind.slice(1),
    value: fact.value,
    confidence: fact.confidence,
    evidenceIds: fact.evidenceMentionIds,
  }));
};

const createTimeline = (study: StudyItem, canonicalName: string, dossier?: PersonDossier) => {
  const aliases = dossier?.aliases || [];
  const relevantTimeline = (study.intelligence.timeline || [])
    .filter((item) =>
      [canonicalName, ...aliases].some((value) => value && item.event.toLowerCase().includes(value.toLowerCase())),
    )
    .map((item) => ({
      date: item.date,
      event: item.event,
      documentTitle: study.title,
      confidence: dossier?.overallConfidence ?? 0.68,
    }));

  if (relevantTimeline.length) {
    return relevantTimeline;
  }

  return [
    {
      date: study.date,
      event: `Appearance derived from evidence preserved in ${study.title}.`,
      documentTitle: study.title,
      confidence: dossier?.overallConfidence ?? 0.62,
    },
  ];
};

const buildCandidate = (
  seed: MentionSeed,
  profile: CanonicalPersonProfile,
): CandidateIdentity => {
  const aliasSimilarity = Math.max(...[profile.canonicalName, ...profile.aliases].map((alias) => stringSimilarity(seed.rawMention, alias)));
  const transliterationSimilarity = Math.max(
    stringSimilarity(seed.normalizedMention, profile.canonicalName),
    ...profile.aliases.map((alias) => stringSimilarity(seed.normalizedMention, alias)),
  );
  const organizationOverlap = overlapScore(seed.surroundingEntities, profile.organizations);
  const locationOverlap = overlapScore(seed.surroundingEntities, profile.locations);
  const roleTitleOverlap = overlapScore(
    [...seed.surroundingEntities, seed.sourceSnippet],
    [...profile.roles, ...profile.facts.filter((fact) => fact.label === 'Title').map((fact) => fact.value)],
  );
  const timelineOverlap = profile.linkedDocuments.some((document) => document.id === seed.documentId)
    ? 0.94
    : profile.linkedDocuments.some((document) => document.date.slice(-4) === seed.documentDate?.slice(-4))
      ? 0.58
      : 0.3;
  const evidenceCount = profile.evidence.length;
  const score = Math.min(
    1,
    aliasSimilarity * 0.26 +
      transliterationSimilarity * 0.18 +
      organizationOverlap * 0.17 +
      locationOverlap * 0.13 +
      roleTitleOverlap * 0.12 +
      timelineOverlap * 0.08 +
      Math.min(1, evidenceCount / 6) * 0.06,
  );

  const matchReasons = [
    aliasSimilarity > 0.8 ? 'Alias family aligns strongly' : '',
    transliterationSimilarity > 0.8 ? 'Transliteration path is plausible' : '',
    organizationOverlap > 0.5 ? 'Organization context overlaps' : '',
    locationOverlap > 0.5 ? 'Location context overlaps' : '',
  ].filter(Boolean);

  const conflictReasons = [
    aliasSimilarity > 0.75 && organizationOverlap < 0.2 ? 'Name similarity is strong but organization context is weak' : '',
    aliasSimilarity > 0.75 && locationOverlap < 0.2 ? 'Location evidence does not corroborate the alias match' : '',
    profile.unresolvedAliases.length ? 'Profile already has unresolved alias paths' : '',
  ].filter(Boolean);

  return {
    id: profile.id,
    canonicalName: profile.canonicalName,
    score,
    scoreBreakdown: {
      aliasSimilarity,
      transliterationSimilarity,
      organizationOverlap,
      locationOverlap,
      roleTitleOverlap,
      timelineOverlap,
      evidenceCount,
      explanation:
        matchReasons[0] ||
        conflictReasons[0] ||
        'Evidence remains partial; keep the candidate analyst-visible until more corroboration arrives.',
    },
    matchReasons: matchReasons.length ? matchReasons : ['Weak contextual overlap'],
    conflictReasons: conflictReasons.length ? conflictReasons : undefined,
    organizations: profile.organizations,
    roles: profile.roles,
    locations: profile.locations,
  };
};

const createStatus = (
  topCandidate: CandidateIdentity | undefined,
  secondCandidate: CandidateIdentity | undefined,
  seed: MentionSeed,
) => {
  if (!topCandidate || topCandidate.score < 0.42) {
    return 'unresolved' as const;
  }
  if (secondCandidate && Math.abs(topCandidate.score - secondCandidate.score) < 0.08) {
    return 'conflict' as const;
  }
  if (seed.pipelineMode === 'fallback' && topCandidate.score < 0.84) {
    return 'uncertain' as const;
  }
  if (topCandidate.score >= 0.8 && (!secondCandidate || topCandidate.score - secondCandidate.score >= 0.12)) {
    return 'resolved' as const;
  }
  return 'uncertain' as const;
};

export const buildIdentityResolutionDataset = (studies: StudyItem[] = []): IdentityResolutionDataset => {
  const relevantStudies = studies.filter((study) => {
    const intelligence = study.intelligence;
    return Boolean(
      intelligence.person_entities?.length ||
        Object.keys(intelligence.person_dossiers || {}).length ||
        getUiPersonEntities(study).length,
    );
  });

  if (!relevantStudies.length) {
    return mockDataset;
  }

  const profiles = new Map<string, ProfileAccumulator>();
  const mentionSeeds: MentionSeed[] = [];
  const snippetsMap = new Map<string, ReviewSnippet>();
  let backendStudies = 0;
  let fallbackStudies = 0;
  const warnings = new Set<string>();

  relevantStudies.forEach((study) => {
    const personPipeline = study.intelligence.person_pipeline;
    if (personPipeline?.mode === 'backend') backendStudies += 1;
    if (!personPipeline || personPipeline.mode === 'fallback') fallbackStudies += 1;
    (personPipeline?.warnings || []).forEach((warning) => warnings.add(`${study.title}: ${warning}`));

    const dossiers = Object.values(study.intelligence.person_dossiers || {});
    const dossierByEntity = new Map(dossiers.map((dossier) => [dossier.entityId, dossier]));
    const dossierByName = new Map(dossiers.map((dossier) => [normalize(dossier.canonicalName), dossier]));
    const uiEntities = getUiPersonEntities(study);
    const backendEntities = study.intelligence.person_entities || [];
    const personFacts = study.intelligence.person_facts || [];

    const personSeeds = unique([
      ...dossiers.map((dossier) => dossier.canonicalName),
      ...backendEntities.map((entity) => entity.canonicalName),
      ...uiEntities.map((entity) => entity.name),
    ]).filter(Boolean);

    personSeeds.forEach((seedName) => {
      const backendEntity = backendEntities.find(
        (entity) => normalize(entity.canonicalName) === normalize(seedName),
      );
      const dossier =
        (backendEntity && dossierByEntity.get(backendEntity.entityId)) || dossierByName.get(normalize(seedName));
      const uiEntity = uiEntities.find((entity) => normalize(entity.name) === normalize(seedName));
      const canonicalName = dossier?.canonicalName || backendEntity?.canonicalName || uiEntity?.name || seedName;
      const profileId = dossier?.entityId || backendEntity?.entityId || `person_${normalize(canonicalName).replace(/\s+/g, '_')}`;
      const profileKey = normalize(canonicalName);
      const entityFacts = personFacts.filter((fact) => fact.entityId === profileId);
      const evidence = createEvidence(study, canonicalName, dossier, uiEntity?.evidence || []);

      const existing = profiles.get(profileKey);
      const nextProfile: ProfileAccumulator = existing || {
        id: profileId,
        canonicalName,
        aliases: [],
        organizations: [],
        roles: [],
        locations: [],
        linkedDocuments: [],
        timeline: [],
        evidence: [],
        confidenceSummary: dossier?.overallConfidence ?? backendEntity?.confidence ?? uiEntity?.confidence ?? 0.58,
        contradictions: [],
        facts: [],
        unresolvedAliases: [],
        _studyIds: new Set<string>(),
        _documentMentions: new Set<string>(),
      };

      nextProfile.aliases = unique([
        ...nextProfile.aliases,
        canonicalName,
        ...(dossier?.aliases || []),
        ...(backendEntity?.aliases || []),
        ...(uiEntity?.aliases || []),
      ]).filter(Boolean);
      nextProfile.organizations = unique([
        ...nextProfile.organizations,
        ...(dossier?.organizations || []),
        ...entityFacts.filter((fact) => fact.kind === 'organization').map((fact) => fact.value),
      ]).filter(Boolean);
      nextProfile.roles = unique([
        ...nextProfile.roles,
        ...(dossier?.roles || []),
        ...(dossier?.titles || []),
        ...entityFacts.filter((fact) => fact.kind === 'role' || fact.kind === 'title').map((fact) => fact.value),
      ]).filter(Boolean);
      nextProfile.locations = unique([
        ...nextProfile.locations,
        ...(dossier?.locations || []),
        ...entityFacts.filter((fact) => fact.kind === 'location').map((fact) => fact.value),
      ]).filter(Boolean);
      nextProfile.linkedDocuments = unique([
        ...nextProfile.linkedDocuments,
        {
          id: study.id,
          title: study.title,
          date: study.date,
          mentionCount: Math.max(1, (dossier?.sourceMentions || []).length || (uiEntity?.evidence || []).length),
        },
      ].map((document) => JSON.stringify(document))).map((value) => JSON.parse(value));
      nextProfile.timeline = unique([
        ...nextProfile.timeline.map((item) => JSON.stringify(item)),
        ...createTimeline(study, canonicalName, dossier).map((item) => JSON.stringify(item)),
      ]).map((value) => JSON.parse(value));
      nextProfile.evidence = unique([
        ...nextProfile.evidence.map((item) => JSON.stringify(item)),
        ...evidence.map((item) => JSON.stringify(item)),
      ]).map((value) => JSON.parse(value));
      nextProfile.facts = unique([
        ...nextProfile.facts.map((item) => JSON.stringify(item)),
        ...createFacts(dossier, entityFacts).map((item) => JSON.stringify(item)),
      ]).map((value) => JSON.parse(value));
      nextProfile.confidenceSummary = Math.max(nextProfile.confidenceSummary, dossier?.overallConfidence ?? backendEntity?.confidence ?? 0);
      if (personPipeline?.mode === 'fallback') {
        nextProfile.contradictions = unique([
          ...nextProfile.contradictions,
          'Part of this profile was derived from fallback extraction and should remain analyst-reviewed.',
        ]);
      }
      nextProfile._studyIds.add(study.id);

      profiles.set(profileKey, nextProfile);

      const sourceMentions = unique([
        ...(dossier?.sourceMentions || []),
        ...(backendEntity?.aliases || []).slice(0, 2),
        canonicalName,
      ]).filter(Boolean);

      sourceMentions.slice(0, 4).forEach((rawMention, index) => {
        const snippet = buildSnippet(study, [rawMention, canonicalName, ...(dossier?.aliases || [])]);
        const mentionId = `${study.id}_${profileId}_${index}`;
        const surroundingEntities = unique([
          ...nextProfile.organizations,
          ...nextProfile.locations,
          ...(study.intelligence.relations || [])
            .filter((relation) => normalize(relation.source) === normalize(canonicalName) || normalize(relation.target) === normalize(canonicalName))
            .flatMap((relation) => [relation.source, relation.target]),
        ]).filter((value) => normalize(value) !== normalize(canonicalName));

        if (!nextProfile._documentMentions.has(mentionId)) {
          mentionSeeds.push({
            mentionId,
            rawMention,
            normalizedMention: canonicalName,
            documentId: study.id,
            documentTitle: study.title,
            page: undefined,
            language: detectLanguage(rawMention || snippet),
            sourceSnippet: snippet,
            surroundingEntities,
            preferredProfileId: profileId,
            baseConfidence: Math.max(0.35, dossier?.overallConfidence ?? backendEntity?.confidence ?? uiEntity?.confidence ?? 0.55),
            pipelineMode: personPipeline?.mode || 'fallback',
            documentDate: study.date,
          });
          nextProfile._documentMentions.add(mentionId);
        }
      });

      const snippetRecord = snippetsMap.get(study.id) || {
        id: study.id,
        title: study.title,
        date: study.date,
        excerpt: buildSnippet(study, [canonicalName, ...(dossier?.aliases || [])]),
        mentionIds: [],
      };
      snippetRecord.mentionIds = unique([...snippetRecord.mentionIds, ...sourceMentions.slice(0, 2).map((_, index) => `${study.id}_${profileId}_${index}`)]);
      snippetsMap.set(study.id, snippetRecord);
    });
  });

  const profileList = Array.from(profiles.values()).map((profile) => ({
    ...profile,
    linkedDocuments: profile.linkedDocuments.sort((left, right) => right.date.localeCompare(left.date)),
    timeline: profile.timeline.sort((left, right) => left.date.localeCompare(right.date)),
    evidence: profile.evidence.slice(0, 8),
    facts: profile.facts.slice(0, 10),
    contradictions: unique(profile.contradictions),
    unresolvedAliases: unique(profile.unresolvedAliases),
  }));

  const aliasOwners = new Map<string, string[]>();
  profileList.forEach((profile) => {
    profile.aliases.forEach((alias) => {
      const key = normalize(alias);
      if (!key || key.length < 3) return;
      aliasOwners.set(key, unique([...(aliasOwners.get(key) || []), profile.id]));
    });
  });

  profileList.forEach((profile) => {
    const collisions = profile.aliases.filter((alias) => (aliasOwners.get(normalize(alias)) || []).length > 1);
    if (collisions.length) {
      profile.unresolvedAliases = unique([...profile.unresolvedAliases, ...collisions]);
      profile.contradictions = unique([
        ...profile.contradictions,
        'One or more aliases map to multiple candidate profiles and should stay unresolved until corroborated.',
      ]);
    }
  });

  const mentions = mentionSeeds.map((seed) => {
    const candidates = profileList
      .map((profile) => buildCandidate(seed, profile))
      .filter((candidate) => candidate.score >= 0.22 || candidate.id === seed.preferredProfileId)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    const topCandidate = candidates[0];
    const secondCandidate = candidates[1];
    const status = createStatus(topCandidate, secondCandidate, seed);

    return {
      id: seed.mentionId,
      documentId: seed.documentId,
      documentTitle: seed.documentTitle,
      page: seed.page,
      rawMention: seed.rawMention,
      normalizedMention: seed.normalizedMention,
      confidence: Math.max(seed.baseConfidence, topCandidate?.score || 0),
      language: seed.language,
      sourceSnippet: seed.sourceSnippet,
      suggestedIdentityId: topCandidate?.score && topCandidate.score >= 0.45 ? topCandidate.id : undefined,
      alternatives: candidates,
      status,
      surroundingEntities: seed.surroundingEntities,
    } satisfies PersonMentionRecord;
  });

  const queue = mentions
    .filter((mention) => mention.status !== 'resolved')
    .map((mention) => ({
      mentionId: mention.id,
      canonicalHint: mention.alternatives[0]?.canonicalName,
      reason:
        mention.alternatives[0]?.conflictReasons?.[0] ||
        mention.alternatives[0]?.scoreBreakdown.explanation ||
        'Evidence is insufficient for a safe automatic merge.',
      severity:
        mention.status === 'conflict'
          ? 'critical'
          : mention.confidence < 0.55
            ? 'high'
            : 'medium',
    } satisfies ConflictQueueItem));

  const metrics: ResolutionMetric[] = [
    {
      label: 'Resolvable mentions',
      value: String(mentions.filter((mention) => mention.alternatives.length > 0).length),
      tone: 'primary',
      detail: 'Mentions that currently have at least one ranked identity candidate.',
    },
    {
      label: 'Low-confidence cases',
      value: String(mentions.filter((mention) => mention.status !== 'resolved' || mention.confidence < 0.6).length),
      tone: 'warning',
      detail: 'Mentions that still require analyst attention before they can be trusted operationally.',
    },
    {
      label: 'Duplicate profiles',
      value: String(profileList.filter((profile) => profile.unresolvedAliases.length > 0).length),
      tone: 'danger',
      detail: 'Canonical profiles that still have unresolved alias or duplicate identity pressure.',
    },
    {
      label: 'Resolved this shift',
      value: `${Math.round((mentions.filter((mention) => mention.status === 'resolved').length / Math.max(1, mentions.length)) * 100)}%`,
      tone: 'success',
      detail: 'Mentions currently safe enough to surface as resolved in the analyst workflow.',
    },
  ];

  return {
    metrics,
    profiles: profileList,
    mentions,
    snippets: Array.from(snippetsMap.values()),
    queue,
    dataSource: 'live',
    backendStudies,
    fallbackStudies,
    warnings: Array.from(warnings).slice(0, 8),
  };
};
