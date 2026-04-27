export type ResolutionStatus = 'resolved' | 'unresolved' | 'uncertain' | 'conflict';

export interface EvidenceSnippet {
  id: string;
  documentId: string;
  page?: number;
  source: string;
  snippet: string;
  date?: string;
  language: string;
}

export interface ScoreBreakdown {
  aliasSimilarity: number;
  transliterationSimilarity: number;
  organizationOverlap: number;
  locationOverlap: number;
  roleTitleOverlap: number;
  timelineOverlap: number;
  evidenceCount: number;
  explanation: string;
}

export interface CandidateIdentity {
  id: string;
  canonicalName: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  matchReasons: string[];
  conflictReasons?: string[];
  organizations: string[];
  roles: string[];
  locations: string[];
}

export interface PersonMentionRecord {
  id: string;
  documentId: string;
  documentTitle: string;
  page?: number;
  rawMention: string;
  normalizedMention: string;
  confidence: number;
  language: string;
  sourceSnippet: string;
  suggestedIdentityId?: string;
  alternatives: CandidateIdentity[];
  status: ResolutionStatus;
  surroundingEntities: string[];
}

export interface AppearanceTimelineItem {
  date: string;
  event: string;
  documentTitle: string;
  confidence: number;
}

export interface ProfileFact {
  label: string;
  value: string;
  confidence: number;
  evidenceIds: string[];
}

export interface CanonicalPersonProfile {
  id: string;
  canonicalName: string;
  aliases: string[];
  organizations: string[];
  roles: string[];
  locations: string[];
  linkedDocuments: Array<{
    id: string;
    title: string;
    date: string;
    mentionCount: number;
  }>;
  timeline: AppearanceTimelineItem[];
  evidence: EvidenceSnippet[];
  confidenceSummary: number;
  contradictions: string[];
  facts: ProfileFact[];
  unresolvedAliases: string[];
}

export interface ResolutionMetric {
  label: string;
  value: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  detail: string;
}

export interface ConflictQueueItem {
  mentionId: string;
  canonicalHint?: string;
  reason: string;
  severity: 'critical' | 'high' | 'medium';
}
