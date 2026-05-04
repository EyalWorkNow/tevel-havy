export type ResearchProfileId = "INTEL" | "LEGAL" | "FINANCE" | "ACADEMIC";
export type ResearchProfileSelection = ResearchProfileId | "AUTO";

export type ProfileSignalHit = {
  label: string;
  weight: number;
  matches: number;
  score: number;
  examples: string[];
};

export type ResearchProfileRank = {
  profileId: ResearchProfileId;
  score: number;
  share: number;
  confidence: number;
  signals: string[];
};

export type ResearchProfileDetection = {
  requestedProfile: ResearchProfileSelection;
  resolvedProfile: ResearchProfileId;
  scores: Record<ResearchProfileId, number>;
  normalizedScores: Record<ResearchProfileId, number>;
  signals: Record<ResearchProfileId, string[]>;
  signalHits: Record<ResearchProfileId, ProfileSignalHit[]>;
  rankedProfiles: ResearchProfileRank[];
  activeProfiles: ResearchProfileId[];
  secondaryProfiles: ResearchProfileId[];
  confidence: number;
  isMixedDomain: boolean;
  rationale: string;
};

export type ResearchProfile = {
  id: ResearchProfileId;
  label: string;
  description: string;
  analysisNoun: string;
  topEntityLabel: string;
  relationLabel: string;
  entityTypeAllowlist?: ReadonlySet<string>;
  relationCues: Array<{ terms: string[]; type: string }>;
  typePriority: Record<string, number>;
  entityTypeAliases: Record<string, string>;
  entityPatterns: EntityPatternSpec[];
};

export type EntityPatternSpec = {
  type: string;
  role: string;
  confidence: number;
  regexes: RegExp[];
  maxLength?: number;
};

type ProfileSignal = {
  label: string;
  weight: number;
  regex: RegExp;
};

export const RESEARCH_PROFILE_IDS: ResearchProfileId[] = ["INTEL", "LEGAL", "FINANCE", "ACADEMIC"];

const baseTypePriority: Record<string, number> = {
  EVENT: 14,
  DATE: 13,
  DOCUMENT: 12,
  FACILITY: 11,
  LOCATION: 10,
  FINANCIAL_ACCOUNT: 9,
  COMMUNICATION_CHANNEL: 8,
  DIGITAL_ASSET: 8,
  DEVICE: 7,
  CARGO: 7,
  ASSET: 6,
  VEHICLE: 6,
  IDENTIFIER: 6,
  METHOD: 4,
  OBJECT: 3,
  ORGANIZATION: 2,
  ORG: 2,
  PERSON: 1,
};

const baseEntityAliases: Record<string, string> = {
  ORG: "ORGANIZATION",
  ORGANISATION: "ORGANIZATION",
  URL: "DIGITAL_ASSET",
  EMAIL: "COMMUNICATION_CHANNEL",
  PHONE: "COMMUNICATION_CHANNEL",
  ACCOUNT: "FINANCIAL_ACCOUNT",
  BANK_ACCOUNT: "FINANCIAL_ACCOUNT",
  IBAN: "FINANCIAL_ACCOUNT",
  SWIFT: "FINANCIAL_ACCOUNT",
  CONTRACT: "DOCUMENT",
  INVOICE: "DOCUMENT",
  REPORT: "DOCUMENT",
};

const INTEL_RELATION_CUES: Array<{ terms: string[]; type: string }> = [
  { terms: ["funded", "financed", "backed", "paid", "מימן", "מימנה"], type: "FUNDED" },
  {
    terms: ["funded by", "owned by", "belongs to", "reported to", "כפוף ל", "שייך ל", "בבעלות", "בשליטת"],
    type: "OWNED_BY",
  },
  {
    terms: ["emailed", "wrote", "contacted", "forwarded", "copied", "sent", "כתב ל", "שלח ל", "שלח מייל אל", "שלח מייל ל", "פנה אל", "יצר קשר עם", "שוחח עם"],
    type: "COMMUNICATED_WITH",
  },
  {
    terms: ["moved", "transported", "routed", "delivered", "redirected", "coordinated", "הועבר ל", "נשלח ל", "הועבר דרך", "תואם עם", "הוזז ל", "העביר", "העבירה"],
    type: "MOVED_TO",
  },
  { terms: ["used", "operated", "activated", "deployed", "הפעיל", "השתמש ב", "הופעל", "נפרס"], type: "USED_IN" },
  { terms: ["linked", "associated", "ties", "tied", "with", "קשור ל", "מקושר ל", "זוהה עם", "לצד"], type: "ASSOCIATED_WITH" },
];

const LEGAL_RELATION_CUES: Array<{ terms: string[]; type: string }> = [
  { terms: ["signed", "executed", "חתם", "חתמה", "נחתם", "נחתמה"], type: "SIGNED_BY" },
  { terms: ["agreed", "agrees", "agree to", "הסכים", "הסכימה", "מסכים", "מסכימה"], type: "AGREED_TO" },
  { terms: ["shall", "must", "required to", "חייב", "חייבת", "מחויב", "מחויבת"], type: "OBLIGATED_TO" },
  { terms: ["prohibited", "forbidden", "אסור", "נאסר"], type: "PROHIBITED_FROM" },
  { terms: ["terminated", "termination", "rescinded", "בוטל", "בוטלה", "הופסק", "הופסקה"], type: "TERMINATED" },
];

const FINANCE_RELATION_CUES: Array<{ terms: string[]; type: string }> = [
  { terms: ["paid", "pays", "payment", "settled", "שילם", "שילמה", "תשלום", "שולם"], type: "PAID" },
  { terms: ["transferred", "wire", "sent", "credited", "debited", "העביר", "העבירה", "הועבר", "זוכה", "חויב"], type: "TRANSFERRED" },
  { terms: ["invoiced", "invoice", "חשבונית", "חשבוניות"], type: "INVOICED" },
  { terms: ["funded", "financed", "loan", "credit", "מימון", "הלוואה", "אשראי"], type: "FINANCED" },
];

const ACADEMIC_RELATION_CUES: Array<{ terms: string[]; type: string }> = [
  { terms: ["propose", "we propose", "hypothesis", "claim", "טוענים", "השערה", "מציעים"], type: "PROPOSES" },
  { terms: ["evaluate", "benchmark", "measured", "accuracy", "precision", "recall", "evaluated", "הוערך", "נמדד"], type: "EVALUATED_WITH" },
  { terms: ["trained on", "dataset", "corpus", "trained", "אומן", "דאטהסט", "מערך נתונים"], type: "TRAINED_ON" },
  { terms: ["outperforms", "improves", "beats", "משפר", "עוקף", "טוב יותר"], type: "OUTPERFORMS" },
];

const buildAllowlist = (types: string[]): ReadonlySet<string> => new Set(types.map((value) => value.toUpperCase()));

export const RESEARCH_PROFILES: Record<ResearchProfileId, ResearchProfile> = {
  INTEL: {
    id: "INTEL",
    label: "Intelligence",
    description: "High-recall, entity-centric intelligence extraction.",
    analysisNoun: "intelligence entities",
    topEntityLabel: "Most prominent entities",
    relationLabel: "Top explicit links",
    relationCues: INTEL_RELATION_CUES,
    typePriority: baseTypePriority,
    entityTypeAliases: baseEntityAliases,
    entityPatterns: [],
  },
  LEGAL: {
    id: "LEGAL",
    label: "Legal",
    description: "Contract/legal analysis with evidence-first posture.",
    analysisNoun: "legal entities and obligations",
    topEntityLabel: "Key legal objects",
    relationLabel: "Legal links",
    entityTypeAllowlist: buildAllowlist(["AGREEMENT", "CLAUSE", "OBLIGATION", "RIGHT", "JURISDICTION", "REMEDY", "LEGAL_RISK", "AMOUNT", "DOCUMENT", "DATE", "ORGANIZATION", "ORG", "PERSON", "IDENTIFIER", "FINANCIAL_ACCOUNT", "DIGITAL_ASSET", "COMMUNICATION_CHANNEL", "LOCATION", "FACILITY", "VEHICLE", "DEVICE", "CARGO", "ASSET", "EVENT", "METHOD", "OBJECT"]),
    relationCues: [...LEGAL_RELATION_CUES, ...FINANCE_RELATION_CUES, ...INTEL_RELATION_CUES],
    typePriority: {
      ...baseTypePriority,
      AGREEMENT: 24,
      CLAUSE: 23,
      OBLIGATION: 22,
      RIGHT: 21,
      JURISDICTION: 19,
      REMEDY: 17,
      LEGAL_RISK: 17,
      AMOUNT: 13,
      DOCUMENT: 20,
      DATE: 18,
      ORGANIZATION: 16,
      ORG: 16,
      PERSON: 14,
      FINANCIAL_ACCOUNT: 12,
      IDENTIFIER: 10,
      METHOD: 6,
    },
    entityTypeAliases: {
      ...baseEntityAliases,
      CONTRACT: "AGREEMENT",
      AGREEMENT_DOCUMENT: "AGREEMENT",
      SECTION: "CLAUSE",
      ARTICLE: "CLAUSE",
      TERM: "CLAUSE",
      DUTY: "OBLIGATION",
      LIABILITY: "LEGAL_RISK",
      GOVERNING_LAW: "JURISDICTION",
    },
    entityPatterns: [
      { type: "AGREEMENT", role: "Legal agreement or controlling document", confidence: 0.88, regexes: [/\b(?:Master\s+Services\s+Agreement|Service\s+Agreement|Lease\s+Agreement|Purchase\s+Agreement|NDA|Contract|Agreement)\s+[A-Z0-9#/_-]*(?:\s+[A-Z][A-Za-z0-9#/_-]+){0,3}\b/g, /(?:הסכם|חוזה|נספח)\s+[א-תA-Za-z0-9#/_-]+(?:\s+[א-תA-Za-z0-9#/_-]+){0,3}/g] },
      { type: "CLAUSE", role: "Clause, section, or article anchor", confidence: 0.91, regexes: [/\b(?:Clause|Section|Article|Schedule|Appendix)\s+\d+(?:\.\d+)*(?:\([a-z]\))?/gi, /(?:סעיף|נספח|פרק)\s+\d+(?:\.\d+)*/g] },
      { type: "OBLIGATION", role: "Extracted legal obligation", confidence: 0.82, maxLength: 120, regexes: [/\b(?:shall|must|is required to|are required to|undertakes to|agrees to)\s+[^.;\n]{6,110}/gi, /(?:חייב(?:ת)?|מחויב(?:ת)?|מתחייב(?:ת)?|נדרש(?:ת)?)\s+[^.;\n]{6,110}/g] },
      { type: "RIGHT", role: "Extracted contractual right", confidence: 0.8, maxLength: 110, regexes: [/\b(?:right to|entitled to|may)\s+[^.;\n]{6,100}/gi, /(?:זכאי(?:ת)?\s+ל|רשאי(?:ת)?\s+ל|זכות\s+ל)\s*[^.;\n]{6,100}/g] },
      { type: "JURISDICTION", role: "Governing law or jurisdiction anchor", confidence: 0.86, maxLength: 100, regexes: [/\b(?:governing law|jurisdiction|venue)\s*(?:is|of|:)?\s*[^.;\n]{3,90}/gi, /(?:דין\s+חל|סמכות\s+שיפוט|תחום\s+שיפוט)\s*[:：]?\s*[^.;\n]{3,90}/g] },
      { type: "REMEDY", role: "Remedy, penalty, or damages term", confidence: 0.78, maxLength: 120, regexes: [/\b(?:liquidated damages|remedy|remedies|penalty|indemnity)\s+[^.;\n]{4,110}/gi, /(?:פיצוי|סעד|תרופה|שיפוי|קנס)\s+[^.;\n]{4,110}/g] },
      { type: "AMOUNT", role: "Money amount inside legal text", confidence: 0.88, regexes: [/\b(?:USD|EUR|ILS|NIS)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|thousand|m|k))?\b/gi, /[$€₪]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|thousand|m|k))?\b/gi, /\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|ILS|NIS|ש"ח|דולר|אירו)\b/gi] },
    ],
  },
  FINANCE: {
    id: "FINANCE",
    label: "Finance",
    description: "Financial analysis with normalized accounts, amounts, and counterparties.",
    analysisNoun: "financial entities, metrics, and flows",
    topEntityLabel: "Key financial objects",
    relationLabel: "Financial links",
    entityTypeAllowlist: buildAllowlist(["AMOUNT", "METRIC", "PERIOD", "TRANSACTION", "INSTRUMENT", "COUNTERPARTY", "RISK", "FINANCIAL_ACCOUNT", "ORGANIZATION", "ORG", "PERSON", "IDENTIFIER", "DIGITAL_ASSET", "COMMUNICATION_CHANNEL", "DOCUMENT", "DATE", "LOCATION", "FACILITY", "VEHICLE", "DEVICE", "CARGO", "ASSET", "EVENT", "METHOD", "OBJECT"]),
    relationCues: [...FINANCE_RELATION_CUES, ...INTEL_RELATION_CUES],
    typePriority: {
      ...baseTypePriority,
      AMOUNT: 24,
      METRIC: 23,
      TRANSACTION: 22,
      PERIOD: 21,
      INSTRUMENT: 20,
      COUNTERPARTY: 19,
      RISK: 15,
      FINANCIAL_ACCOUNT: 22,
      ORGANIZATION: 18,
      ORG: 18,
      IDENTIFIER: 16,
      DIGITAL_ASSET: 14,
      DOCUMENT: 12,
      DATE: 10,
      PERSON: 9,
      METHOD: 6,
    },
    entityTypeAliases: {
      ...baseEntityAliases,
      KPI: "METRIC",
      FINANCIAL_METRIC: "METRIC",
      CURRENCY: "AMOUNT",
      MONEY: "AMOUNT",
      FISCAL_PERIOD: "PERIOD",
      PAYMENT: "TRANSACTION",
      TRANSFER: "TRANSACTION",
      SECURITY: "INSTRUMENT",
    },
    entityPatterns: [
      { type: "AMOUNT", role: "Normalized monetary amount", confidence: 0.9, regexes: [/\b(?:USD|EUR|ILS|NIS)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|thousand|m|k|bn|b))?\b/gi, /[$€₪]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|thousand|m|k|bn|b))?\b/gi, /\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|ILS|NIS|ש"ח|דולר|אירו)\b/gi] },
      { type: "METRIC", role: "Financial KPI or performance metric", confidence: 0.84, maxLength: 100, regexes: [/\b(?:ARR|MRR|EBITDA|revenue|gross margin|net income|free cash flow|cash burn|runway|ROI|IRR|NPV|YoY|QoQ)\b[^.;\n]{0,80}/gi, /(?:הכנסות|רווח\s+גולמי|רווח\s+נקי|תזרים|שיעור\s+רווח|צמיחה)\s*[^.;\n]{0,80}/g] },
      { type: "PERIOD", role: "Fiscal or reporting period", confidence: 0.86, regexes: [/\b(?:Q[1-4]\s?20\d{2}|FY\s?20\d{2}|fiscal\s+year\s+20\d{2})\b/gi, /(?:רבעון\s+[1-4]\s+20\d{2}|שנת\s+20\d{2})/g] },
      { type: "TRANSACTION", role: "Payment, wire, invoice, or transfer event", confidence: 0.82, maxLength: 120, regexes: [/\b(?:payment|wire transfer|transfer|invoice|settlement|debit entry|credit entry|card charge)\s+[^.;\n]{5,110}/gi, /(?:תשלום|העברה|חשבונית|סליקה|זיכוי|חיוב)\s+[^.;\n]{5,110}/g] },
      { type: "INSTRUMENT", role: "Financial instrument or funding vehicle", confidence: 0.78, maxLength: 90, regexes: [/\b(?:bond|equity|loan|credit facility|option|warrant|convertible note|SAFE)\b[^.;\n]{0,70}/gi, /(?:מניה|אג["״]?ח|הלוואה|מסגרת\s+אשראי|אופציה|כתב\s+אופציה)\s*[^.;\n]{0,70}/g] },
      { type: "RISK", role: "Financial risk or exposure", confidence: 0.74, maxLength: 120, regexes: [/\b(?:liquidity risk|credit risk|market risk|default risk|exposure)\b[^.;\n]{0,100}/gi, /(?:סיכון\s+נזילות|סיכון\s+אשראי|חשיפה|חדלות\s+פירעון)\s*[^.;\n]{0,100}/g] },
    ],
  },
  ACADEMIC: {
    id: "ACADEMIC",
    label: "Academic",
    description: "Research-paper oriented extraction (methods, datasets, metrics, results).",
    analysisNoun: "academic entities, methods, and findings",
    topEntityLabel: "Key research objects",
    relationLabel: "Research links",
    entityTypeAllowlist: buildAllowlist(["PAPER", "STUDY", "METHOD", "MODEL", "DATASET", "METRIC", "RESULT", "HYPOTHESIS", "LIMITATION", "BASELINE", "DOCUMENT", "ORGANIZATION", "ORG", "PERSON", "DIGITAL_ASSET", "DATE", "IDENTIFIER"]),
    relationCues: [...ACADEMIC_RELATION_CUES, ...INTEL_RELATION_CUES],
    typePriority: {
      ...baseTypePriority,
      PAPER: 24,
      STUDY: 24,
      DATASET: 23,
      MODEL: 22,
      METHOD: 20,
      METRIC: 19,
      RESULT: 18,
      HYPOTHESIS: 17,
      LIMITATION: 16,
      BASELINE: 15,
      DOCUMENT: 22,
      IDENTIFIER: 14,
      DIGITAL_ASSET: 12,
      ORGANIZATION: 10,
      ORG: 10,
      PERSON: 8,
      DATE: 7,
    },
    entityTypeAliases: {
      ...baseEntityAliases,
      PAPER: "PAPER",
      ARTICLE: "PAPER",
      STUDY: "STUDY",
      DATA: "DATASET",
      CORPUS: "DATASET",
      BENCHMARK: "DATASET",
      ALGORITHM: "METHOD",
      ARCHITECTURE: "MODEL",
      SCORE: "METRIC",
      CLAIM: "HYPOTHESIS",
      FINDING: "RESULT",
    },
    entityPatterns: [
      { type: "DATASET", role: "Dataset, corpus, or benchmark", confidence: 0.86, maxLength: 90, regexes: [/\b(?:dataset|corpus|benchmark|data set)\s+[A-Z0-9][A-Za-z0-9_.-]*(?:\s+[A-Z0-9][A-Za-z0-9_.-]*){0,4}\b/gi, /(?:דאטהסט|מערך\s+נתונים|קורפוס|בנצ'מרק)\s+[א-תA-Za-z0-9_.-]+(?:\s+[א-תA-Za-z0-9_.-]+){0,4}/g] },
      { type: "MODEL", role: "Model, architecture, or baseline system", confidence: 0.82, maxLength: 90, regexes: [/\b(?:model|architecture|baseline|encoder|decoder)\s+[A-Z0-9][A-Za-z0-9_.-]*(?:\s+[A-Z0-9][A-Za-z0-9_.-]*){0,3}\b/gi, /\b(?:BM25|BERT|RoBERTa|GPT-[A-Za-z0-9.-]+|GraphRAG-[A-Za-z0-9.-]+|Llama\s?\d*)\b/gi, /(?:מודל|ארכיטקטורה|קו\s+בסיס)\s+[א-תA-Za-z0-9_.-]+(?:\s+[א-תA-Za-z0-9_.-]+){0,3}/g] },
      { type: "METHOD", role: "Method, algorithm, or experimental procedure", confidence: 0.8, maxLength: 110, regexes: [/\b(?:method|approach|algorithm|procedure|training objective)\s+[^.;\n]{5,90}/gi, /(?:שיטה|גישה|אלגוריתם|הליך)\s+[^.;\n]{5,90}/g] },
      { type: "METRIC", role: "Evaluation metric and score", confidence: 0.87, regexes: [/\b(?:accuracy|precision|recall|F1|AUC|RMSE|MAE|BLEU|ROUGE)\s*(?:=|:|of)?\s*\d+(?:\.\d+)?%?\b/gi, /(?:דיוק|רגישות|ספציפיות|מדד)\s*(?:=|:)?\s*\d+(?:\.\d+)?%?/g] },
      { type: "RESULT", role: "Reported result or empirical finding", confidence: 0.8, maxLength: 120, regexes: [/\b(?:outperforms|improves|achieves|reduces|increases|we find|we show)\s+[^.;\n]{5,110}/gi, /(?:משפר|משיגה|עוקף|מצאנו|אנו\s+מראים)\s+[^.;\n]{5,110}/g] },
      { type: "HYPOTHESIS", role: "Hypothesis, claim, or research question", confidence: 0.76, maxLength: 120, regexes: [/\b(?:hypothesis|we hypothesize|we propose|research question|claim)\s+[^.;\n]{5,110}/gi, /(?:השערה|שאלת\s+מחקר|טענה|אנו\s+מציעים)\s+[^.;\n]{5,110}/g] },
      { type: "LIMITATION", role: "Limitation or threat to validity", confidence: 0.78, maxLength: 120, regexes: [/\b(?:limitation|limitations|threat to validity|future work)\s+[^.;\n]{5,110}/gi, /(?:מגבלה|מגבלות|איום\s+על\s+התוקף|עבודה\s+עתידית)\s+[^.;\n]{5,110}/g] },
    ],
  },
};

const EMPTY_SCORE: Record<ResearchProfileId, number> = {
  INTEL: 0,
  LEGAL: 0,
  FINANCE: 0,
  ACADEMIC: 0,
};

const EMPTY_SIGNALS: Record<ResearchProfileId, string[]> = {
  INTEL: [],
  LEGAL: [],
  FINANCE: [],
  ACADEMIC: [],
};

const EMPTY_SIGNAL_HITS: Record<ResearchProfileId, ProfileSignalHit[]> = {
  INTEL: [],
  LEGAL: [],
  FINANCE: [],
  ACADEMIC: [],
};

const PROFILE_DETECTION_SIGNALS: Record<ResearchProfileId, ProfileSignal[]> = {
  INTEL: [
    { label: "intelligence vocabulary", weight: 4, regex: /\b(?:intelligence|osint|sigint|humint|target|threat|operation|operative|facility|asset|smuggling|surveillance|watchlist|cell)\b/gi },
    { label: "Hebrew intelligence vocabulary", weight: 4, regex: /(?:מודיעין|יעד|איום|מבצע|מבצעי|תשתית|איסוף|סיכול|מעקב|חוליה)/g },
    { label: "operational entities", weight: 2, regex: /\b(?:vehicle|drone|warehouse|port|border|route|handoff|encrypted|telegram)\b/gi },
  ],
  LEGAL: [
    { label: "contract vocabulary", weight: 5, regex: /\b(?:agreement|contract|clause|section|article|schedule|appendix|party|parties|governing law|jurisdiction|venue|remedy|indemnity|liability|breach|termination)\b/gi },
    { label: "legal obligation language", weight: 5, regex: /\b(?:shall|must|is required to|undertakes to|entitled to|prohibited|warranty|representation)\b/gi },
    { label: "Hebrew legal vocabulary", weight: 5, regex: /(?:הסכם|חוזה|סעיף|נספח|דין\s+חל|סמכות\s+שיפוט|שיפוי|פיצוי|הפרה|ביטול|חייב|מחויב|רשאי|זכאי)/g },
  ],
  FINANCE: [
    { label: "money amount", weight: 6, regex: /\b(?:USD|EUR|ILS|NIS)\s?\d[\d,]*(?:\.\d+)?|[$€₪]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|ILS|NIS|ש"ח|דולר|אירו)\b/gi },
    { label: "financial metric", weight: 5, regex: /\b(?:revenue|EBITDA|ARR|MRR|gross margin|net income|free cash flow|cash burn|runway|ROI|IRR|NPV|YoY|QoQ|P&L|balance sheet|cash flow)\b/gi },
    { label: "transaction language", weight: 5, regex: /\b(?:invoice|payment|wire transfer|settlement|transfer|credit facility|loan|bond|equity|debit|credit|counterparty|receivable|payable)\b/gi },
    { label: "banking identifiers", weight: 6, regex: /\b(?:IBAN|SWIFT|BIC|account number|bank account|ledger|GL|invoice\s+[A-Z0-9#/_-]+)\b/gi },
    { label: "fiscal period", weight: 4, regex: /\b(?:Q[1-4]\s?20\d{2}|FY\s?20\d{2}|fiscal\s+year\s+20\d{2})\b/gi },
    { label: "Hebrew finance vocabulary", weight: 5, regex: /(?:הכנסות|רווח|תזרים|חשבונית|תשלום|העברה|הלוואה|אשראי|אג["״]?ח|מניה|סיכון\s+נזילות|חשיפה|יתרה|מאזן)/g },
  ],
  ACADEMIC: [
    { label: "research-paper vocabulary", weight: 5, regex: /\b(?:abstract|method|methodology|dataset|corpus|benchmark|baseline|experiment|evaluation|ablation|limitation|future work|hypothesis|research question)\b/gi },
    { label: "model and metric language", weight: 5, regex: /\b(?:model|architecture|accuracy|precision|recall|F1|AUC|RMSE|MAE|BLEU|ROUGE|p-value|confidence interval)\b/gi },
    { label: "Hebrew academic vocabulary", weight: 5, regex: /(?:מחקר|שיטה|דאטהסט|מערך\s+נתונים|מודל|ניסוי|מדד|דיוק|מגבלה|השערה|תוצאות)/g },
  ],
};

const countSignalMatches = (text: string, regex: RegExp): number => {
  const matcher = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  return Math.min(6, Array.from(text.matchAll(matcher)).length);
};

const collectRegexExamples = (text: string, regex: RegExp, limit = 3): string[] => {
  const matcher = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const examples: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(matcher)) {
    const value = (match[1] || match[0] || "").replace(/\s+/g, " ").trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    examples.push(value.slice(0, 120));
    if (examples.length >= limit) break;
  }
  return examples;
};

const collectSignalHit = (text: string, signal: ProfileSignal): ProfileSignalHit | null => {
  const matchCount = countSignalMatches(text, signal.regex);
  if (!matchCount) return null;
  return {
    label: signal.label,
    weight: signal.weight,
    matches: matchCount,
    score: signal.weight * matchCount,
    examples: collectRegexExamples(text, signal.regex),
  };
};

const scoreProfilePatterns = (text: string, profile: ResearchProfile): ProfileSignalHit[] =>
  profile.entityPatterns
    .map((pattern) => {
      const matches = Math.min(
        6,
        pattern.regexes.reduce((count, regex) => count + countSignalMatches(text, regex), 0),
      );
      if (!matches) return null;
      return {
        label: `${pattern.type} pattern`,
        weight: 2,
        matches,
        score: Math.min(3, matches) * 2,
        examples: pattern.regexes.flatMap((regex) => collectRegexExamples(text, regex, 2)).slice(0, 3),
      };
    })
    .filter((hit): hit is ProfileSignalHit => Boolean(hit));

const rankProfiles = (
  scores: Record<ResearchProfileId, number>,
  signals: Record<ResearchProfileId, string[]>,
): ResearchProfileRank[] => {
  const totalScore = Math.max(1, RESEARCH_PROFILE_IDS.reduce((sum, profileId) => sum + Math.max(0, scores[profileId]), 0));
  return RESEARCH_PROFILE_IDS
    .map((profileId) => {
      const score = scores[profileId];
      const share = score / totalScore;
      return {
        profileId,
        score,
        share,
        confidence: score <= 0 ? 0 : Math.min(0.98, 0.28 + share * 0.45 + Math.min(score, 48) / 90),
        signals: signals[profileId],
      };
    })
    .sort((left, right) => right.score - left.score || right.share - left.share);
};

const resolveAutoProfile = (ranked: ResearchProfileRank[]): ResearchProfileId => {
  const top = ranked[0];
  if (!top || top.score <= 0) return "INTEL";

  const strongestNonIntel = ranked.find((rank) => rank.profileId !== "INTEL");
  if (
    top.profileId === "INTEL" &&
    strongestNonIntel &&
    strongestNonIntel.score >= 8 &&
    (top.score - strongestNonIntel.score <= 8 || strongestNonIntel.score >= top.score * 0.62)
  ) {
    return strongestNonIntel.profileId;
  }

  return top.profileId;
};

const buildActiveProfiles = (ranked: ResearchProfileRank[], resolvedProfile: ResearchProfileId): ResearchProfileId[] => {
  const topScore = Math.max(1, ranked[0]?.score || 0);
  const active = new Set<ResearchProfileId>([resolvedProfile]);

  ranked.forEach((rank) => {
    if (rank.score < 8) return;
    if (rank.profileId === resolvedProfile) return;
    const closeEnough = rank.score >= Math.max(10, topScore * 0.42);
    const strongIntelSecondary = rank.profileId === "INTEL" && rank.score >= Math.max(18, topScore * 0.85);
    if (rank.profileId === "INTEL" ? strongIntelSecondary : closeEnough) {
      active.add(rank.profileId);
    }
  });

  return [resolvedProfile, ...ranked.map((rank) => rank.profileId).filter((profileId) => profileId !== resolvedProfile && active.has(profileId))].slice(0, 3);
};

const buildDetectionConfidence = (ranked: ResearchProfileRank[], resolvedProfile: ResearchProfileId, activeProfiles: ResearchProfileId[]): number => {
  const resolvedRank = ranked.find((rank) => rank.profileId === resolvedProfile);
  if (!resolvedRank || resolvedRank.score <= 0) return 0.36;
  const nextRank = ranked.find((rank) => rank.profileId !== resolvedProfile);
  const margin = Math.max(0, resolvedRank.score - (nextRank?.score || 0));
  const mixedPenalty = activeProfiles.length > 1 ? 0.08 : 0;
  return Math.max(0.42, Math.min(0.98, 0.46 + Math.min(resolvedRank.score, 54) / 120 + Math.min(margin, 30) / 120 - mixedPenalty));
};

const buildDetectionRationale = (
  resolvedProfile: ResearchProfileId,
  activeProfiles: ResearchProfileId[],
  confidence: number,
  signals: Record<ResearchProfileId, string[]>,
): string => {
  const primary = RESEARCH_PROFILES[resolvedProfile].label;
  const secondary = activeProfiles.filter((profileId) => profileId !== resolvedProfile).map((profileId) => RESEARCH_PROFILES[profileId].label);
  const signalText = signals[resolvedProfile].slice(0, 3).join(", ") || "fallback";
  const stackText = secondary.length ? ` with ${secondary.join(" + ")} secondary context` : "";
  return `${primary} selected at ${Math.round(confidence * 100)}% confidence from ${signalText}${stackText}.`;
};

const uniqueSignals = (hits: ProfileSignalHit[]): string[] =>
  Array.from(new Set(hits.map((hit) => hit.label)));

export const detectResearchProfile = (text: string): ResearchProfileDetection => {
  const scores: Record<ResearchProfileId, number> = { ...EMPTY_SCORE };
  const signals: Record<ResearchProfileId, string[]> = {
    INTEL: [],
    LEGAL: [],
    FINANCE: [],
    ACADEMIC: [],
  };
  const signalHits: Record<ResearchProfileId, ProfileSignalHit[]> = {
    INTEL: [],
    LEGAL: [],
    FINANCE: [],
    ACADEMIC: [],
  };

  RESEARCH_PROFILE_IDS.forEach((profileId) => {
    const directHits = PROFILE_DETECTION_SIGNALS[profileId]
      .map((signal) => collectSignalHit(text, signal))
      .filter((hit): hit is ProfileSignalHit => Boolean(hit));
    const patternHits = scoreProfilePatterns(text, RESEARCH_PROFILES[profileId]);
    const hits = [...directHits, ...patternHits];

    signalHits[profileId] = hits;
    scores[profileId] = hits.reduce((score, hit) => score + hit.score, 0);
    signals[profileId] = uniqueSignals(hits);
  });

  const rankedProfiles = rankProfiles(scores, signals);
  const resolvedProfile = resolveAutoProfile(rankedProfiles);
  const activeProfiles = buildActiveProfiles(rankedProfiles, resolvedProfile);
  const confidence = buildDetectionConfidence(rankedProfiles, resolvedProfile, activeProfiles);
  const normalizedScores = RESEARCH_PROFILE_IDS.reduce<Record<ResearchProfileId, number>>((acc, profileId) => {
    acc[profileId] = rankedProfiles.find((rank) => rank.profileId === profileId)?.share || 0;
    return acc;
  }, { ...EMPTY_SCORE });

  return {
    requestedProfile: "AUTO",
    resolvedProfile,
    scores,
    normalizedScores,
    signals,
    signalHits,
    rankedProfiles,
    activeProfiles,
    secondaryProfiles: activeProfiles.filter((profileId) => profileId !== resolvedProfile),
    confidence,
    isMixedDomain: activeProfiles.length > 1,
    rationale: buildDetectionRationale(resolvedProfile, activeProfiles, confidence, signals),
  };
};

export const resolveResearchProfileSelection = (
  selection: ResearchProfileSelection | undefined | null,
  text: string,
): ResearchProfileDetection => {
  const requestedProfile = selection || "AUTO";
  if (requestedProfile !== "AUTO") {
    const scores: Record<ResearchProfileId, number> = { ...EMPTY_SCORE, [requestedProfile]: 999 };
    const normalizedScores: Record<ResearchProfileId, number> = { ...EMPTY_SCORE, [requestedProfile]: 1 };
    const signals: Record<ResearchProfileId, string[]> = {
      ...EMPTY_SIGNALS,
      [requestedProfile]: ["explicit user selection"],
    };
    return {
      requestedProfile,
      resolvedProfile: requestedProfile,
      scores,
      normalizedScores,
      signals,
      signalHits: {
        ...EMPTY_SIGNAL_HITS,
        [requestedProfile]: [{
          label: "explicit user selection",
          weight: 999,
          matches: 1,
          score: 999,
          examples: [],
        }],
      },
      rankedProfiles: rankProfiles(scores, signals),
      activeProfiles: [requestedProfile],
      secondaryProfiles: [],
      confidence: 1,
      isMixedDomain: false,
      rationale: `${RESEARCH_PROFILES[requestedProfile].label} selected explicitly by the user.`,
    };
  }

  return detectResearchProfile(text);
};

export const RESEARCH_PROFILE_OPTIONS: Array<{ id: ResearchProfileSelection; label: string; description: string }> = [
  {
    id: "AUTO",
    label: "Auto-detect",
    description: "Detect legal, finance, academic, or intelligence analysis from the uploaded content.",
  },
  ...Object.values(RESEARCH_PROFILES).map((profile) => ({
    id: profile.id,
    label: profile.label,
    description: profile.description,
  })),
];

export const getResearchProfile = (profileId?: ResearchProfileId | null): ResearchProfile =>
  RESEARCH_PROFILES[profileId || "INTEL"] || RESEARCH_PROFILES.INTEL;

export const getActiveResearchProfiles = (
  detection?: ResearchProfileDetection | null,
  fallbackProfileId?: ResearchProfileId | null,
): ResearchProfileId[] => {
  const primary = detection?.resolvedProfile || fallbackProfileId || "INTEL";
  const profileIds = detection?.activeProfiles?.length ? detection.activeProfiles : [primary];
  return Array.from(new Set([primary, ...profileIds])).filter((profileId): profileId is ResearchProfileId =>
    Boolean(RESEARCH_PROFILES[profileId as ResearchProfileId]),
  );
};
