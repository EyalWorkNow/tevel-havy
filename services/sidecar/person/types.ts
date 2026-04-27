export type PersonMention = {
  mentionId: string;
  documentId: string;
  chunkId: string;
  page?: number;
  text: string;
  normalizedText: string;
  sentenceText: string;
  startChar: number;
  endChar: number;
  language?: string;
  confidence: number;
  extractor: "gliner2" | "rule" | "stanza" | "merged";
};

export type PersonFact = {
  factId: string;
  entityId: string;
  kind:
    | "alias"
    | "title"
    | "role"
    | "organization"
    | "email"
    | "phone"
    | "location"
    | "date"
    | "identifier"
    | "relationship"
    | "claim";
  value: string;
  normalizedValue?: string;
  confidence: number;
  evidenceMentionIds: string[];
};

export type PersonEntity = {
  entityId: string;
  canonicalName: string;
  aliases: string[];
  mentions: string[];
  facts: string[];
  confidence: number;
};

export type PersonDossier = {
  entityId: string;
  canonicalName: string;
  aliases: string[];
  titles: string[];
  roles: string[];
  organizations: string[];
  contact: {
    emails: string[];
    phones: string[];
  };
  locations: string[];
  dates: string[];
  relationships: {
    type: string;
    target: string;
    confidence: number;
    evidenceMentionIds: string[];
  }[];
  claims: {
    text: string;
    confidence: number;
    evidenceMentionIds: string[];
  }[];
  sourceMentions: string[];
  overallConfidence: number;
};

export type PersonExtractionResponse = {
  caseId: string;
  documentId: string;
  mentions: PersonMention[];
  facts: PersonFact[];
  provisionalEntities: PersonEntity[];
  warnings: string[];
  extractionMode: "backend" | "fallback";
  generatedAt: string;
};

export type PersonResolutionResponse = {
  caseId: string;
  entities: PersonEntity[];
  facts: PersonFact[];
  dossiers?: Record<string, PersonDossier>;
  unresolvedMentions: PersonMention[];
  warnings: string[];
  resolutionMode: "backend" | "fallback";
  generatedAt: string;
};
