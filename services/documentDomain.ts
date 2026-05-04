export type DocumentDomain =
  | "financial_regulatory"
  | "intelligence_investigative"
  | "operational_report"
  | "procurement_investigation"
  | "legal_contractual"
  | "academic_research"
  | "generic_document"
  | "unknown";

export interface DocumentDomainDetection {
  domain: DocumentDomain;
  confidence: number;
  signals: string[];
  negativeSignals: string[];
  isMixedDomain: boolean;
  secondaryDomains: DocumentDomain[];
  rationale: string;
}

// Strong SEC evidence — ALL must be present (at least 2 of these) to reach financial_regulatory
const SEC_STRONG_SIGNALS = [
  /SECURITIES AND EXCHANGE COMMISSION/i,
  /\bFORM\s+(?:10-K|10-Q|20-F|8-K|S-1|S-3|S-4|F-1|424B[A-Z0-9]*|DEF\s*14A)\b/i,
  /\bCIK\b/,
  /\bCommission\s+file\s+number\b/i,
  /\bMD&A\b|\bManagement.s\s+Discussion\s+and\s+Analysis\b/i,
  /\bconsolidated\s+balance\s+sheets?\b/i,
  /\bconsolidated\s+statements?\s+of\s+(?:operations|income|cash\s+flows?)\b/i,
  /\bauditor.s?\s+(?:report|opinion)\b/i,
  /\b(?:GAAP|IFRS)\b/,
  /\bRegistrant\b/i,
];

const INTEL_SIGNALS = [
  { label: "intelligence report header", weight: 5, regex: /דו["״]ח\s*מודיעין|דוח\s*מודיעין/g },
  { label: "classification marking", weight: 5, regex: /סיווג\s*[:：]|סיווג\s*(?:סודי|חסוי|שב"|שב״)/g },
  { label: "tsiyach", weight: 5, regex: /צי["״]ח|TSIYACH/g },
  { label: "shabak", weight: 5, regex: /שב["״]כ|\bשב"כ\b/g },
  { label: "unit 8200", weight: 5, regex: /8200|יחידה\s+8200/g },
  { label: "mossad", weight: 4, regex: /\bמוסד\b/g },
  { label: "aman", weight: 5, regex: /אמ["״]ן|\bאמ"ן\b/g },
  { label: "shabas", weight: 4, regex: /שב["״]ס|\bשב"ס\b/g },
  { label: "sigint", weight: 4, regex: /\bSIGINT\b|סיגינט/g },
  { label: "humint", weight: 4, regex: /\bHUMINT\b|יומינט/g },
  { label: "osint", weight: 3, regex: /\bOSINT\b/g },
  { label: "observation", weight: 3, regex: /תצפית/g },
  { label: "command post", weight: 4, regex: /חמ["״]ל|\bחמ"ל\b/g },
  { label: "cell / operative unit", weight: 4, regex: /חוליה/g },
  { label: "safe house", weight: 4, regex: /דירת\s*מסתור/g },
  { label: "external handler", weight: 4, regex: /מפעיל\s*חיצוני|הכוונה\s*חיצונית/g },
  { label: "intercepted message", weight: 5, regex: /מסר\s*יורט|יירוט/g },
  { label: "transcript / decryption", weight: 3, regex: /תמליל|פענוח/g },
  { label: "location fix", weight: 3, regex: /איכון/g },
  { label: "kamman", weight: 4, regex: /קמ["״]ן|\bקמ"ן\b/g },
  { label: "intelligence source", weight: 3, regex: /\bמקור\b(?:\s+(?:א|ב|ג|ד|ה|\d)|\s*:)/g },
  { label: "intelligence general", weight: 2, regex: /מודיעין(?:י)?/g },
  { label: "investigative", weight: 2, regex: /חקירתי|חקירה\s+מעמיקה/g },
  { label: "Go/No-Go", weight: 3, regex: /Go\/No-Go|גו\s*\/\s*נו\s*גו/g },
  { label: "neutralization", weight: 3, regex: /סיכול/g },
  { label: "arrest", weight: 2, regex: /מעצר/g },
  { label: "service vehicle", weight: 2, regex: /רכב\s*שירות/g },
  { label: "warehouse (intel context)", weight: 2, regex: /מחסן/g },
];

const PROCUREMENT_SIGNALS = [
  { label: "tender", weight: 5, regex: /מכרז/g },
  { label: "procurement committee", weight: 5, regex: /ועדת\s*מכרזים/g },
  { label: "document leak", weight: 5, regex: /דליפת?\s*מסמכ/g },
  { label: "weight manipulation", weight: 5, regex: /שינוי\s*משקלים/g },
  { label: "risk model", weight: 3, regex: /מודל\s*סיכונים/g },
  { label: "shell company", weight: 4, regex: /חברת?\s*קש/g },
  { label: "money flows (investigative)", weight: 3, regex: /זרימות?\s*כספיות?/g },
  { label: "logistics", weight: 2, regex: /לוגיסטיקה/g },
  { label: "import delay", weight: 4, regex: /עיכוב\s*יבוא/g },
  { label: "beneficial owner", weight: 4, regex: /נהנה\s*סופי/g },
  { label: "conflict of interest", weight: 4, regex: /ניגוד\s*עניינים/g },
  { label: "influence campaign", weight: 3, regex: /קמפיין\s*תודעה/g },
  { label: "supplier", weight: 2, regex: /ספק/g },
  { label: "procurement", weight: 2, regex: /רכש/g },
];

const OPERATIONAL_SIGNALS = [
  { label: "control report", weight: 4, regex: /דו["״]ח\s*בקרה/g },
  { label: "observation report", weight: 4, regex: /דו["״]ח\s*תצפית/g },
  { label: "decoding report", weight: 4, regex: /דו["״]ח\s*פענוח/g },
  { label: "operative force", weight: 4, regex: /כוח\s*מבצע/g },
  { label: "H-hour", weight: 4, regex: /שעת\s*שי"ן|שעת\s*שין/g },
  { label: "blocking", weight: 3, regex: /חסימה/g },
  { label: "operative recommendation", weight: 3, regex: /המלצה\s*אופרטיבית/g },
  { label: "plan approval", weight: 3, regex: /אישור\s*תוכנית/g },
];

const countMatches = (text: string, regex: RegExp): number => {
  const r = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  return Math.min(6, Array.from(text.matchAll(r)).length);
};

const scoreDomain = (text: string, signals: Array<{ label: string; weight: number; regex: RegExp }>): { score: number; hits: string[] } => {
  let score = 0;
  const hits: string[] = [];
  for (const signal of signals) {
    const count = countMatches(text, signal.regex);
    if (count > 0) {
      score += signal.weight * Math.min(count, 3);
      hits.push(signal.label);
    }
  }
  return { score, hits };
};

const countSecStrongSignals = (text: string): number =>
  SEC_STRONG_SIGNALS.filter((regex) => regex.test(text)).length;

export const detectDocumentDomain = (
  text: string,
  metadata?: { title?: string; filename?: string; classification?: string; source_orgs?: string; language?: string },
): DocumentDomainDetection => {
  const sample = [
    metadata?.title || "",
    metadata?.filename || "",
    metadata?.classification || "",
    metadata?.source_orgs || "",
    text.slice(0, 40000),
  ].join("\n");

  // SEC: requires ≥2 strong signals. Lone "SEC" word or money amounts are NOT enough.
  const secCount = countSecStrongSignals(sample);
  const isSecDocument = secCount >= 2;
  const secConfidence = Math.min(0.98, 0.3 + secCount * 0.14);

  if (isSecDocument && secConfidence >= 0.72) {
    return {
      domain: "financial_regulatory",
      confidence: secConfidence,
      signals: ["SEC strong signal count: " + secCount],
      negativeSignals: [],
      isMixedDomain: false,
      secondaryDomains: [],
      rationale: `SEC document confirmed by ${secCount} strong regulatory signals.`,
    };
  }

  const intel = scoreDomain(sample, INTEL_SIGNALS);
  const procurement = scoreDomain(sample, PROCUREMENT_SIGNALS);
  const operational = scoreDomain(sample, OPERATIONAL_SIGNALS);

  const totalInvestigative = intel.score + procurement.score + operational.score;

  // If we have any investigative signals, prefer that over financial
  if (totalInvestigative >= 4) {
    const isProcurement = procurement.score >= 8 || (procurement.score >= 4 && procurement.score > intel.score * 0.6);
    const isOperational = operational.score >= 8 && operational.score > intel.score;
    const isMixed = (isProcurement && intel.score >= 4) || (isOperational && intel.score >= 4);

    const domain: DocumentDomain = isOperational && !isProcurement
      ? "operational_report"
      : isProcurement
        ? "procurement_investigation"
        : "intelligence_investigative";

    const secondaryDomains: DocumentDomain[] = [];
    if (isMixed) {
      if (domain !== "intelligence_investigative" && intel.score >= 4) secondaryDomains.push("intelligence_investigative");
      if (domain !== "procurement_investigation" && isProcurement) secondaryDomains.push("procurement_investigation");
      if (domain !== "operational_report" && isOperational) secondaryDomains.push("operational_report");
    }

    const allHits = [...intel.hits, ...procurement.hits, ...operational.hits];
    const confidence = Math.min(0.95, 0.45 + totalInvestigative / 60);

    return {
      domain,
      confidence,
      signals: allHits,
      negativeSignals: isSecDocument ? [] : ["insufficient SEC evidence (found " + secCount + " of 2 required signals)"],
      isMixedDomain: isMixed,
      secondaryDomains,
      rationale: `${domain} detected via ${allHits.slice(0, 4).join(", ")} (intel=${intel.score}, procurement=${procurement.score}, operational=${operational.score}).`,
    };
  }

  // No strong signals — return unknown rather than defaulting to financial_regulatory
  return {
    domain: "unknown",
    confidence: 0.3,
    signals: [],
    negativeSignals: ["insufficient signals for domain classification"],
    isMixedDomain: false,
    secondaryDomains: [],
    rationale: "No domain signals detected; defaulting to unknown (not financial_regulatory).",
  };
};

export const isIntelligenceCompatibleDomain = (domain: DocumentDomain): boolean =>
  domain === "intelligence_investigative" ||
  domain === "procurement_investigation" ||
  domain === "operational_report" ||
  domain === "unknown" ||
  domain === "generic_document";

export const domainLabel = (domain: DocumentDomain): string => {
  switch (domain) {
    case "financial_regulatory": return "Financial / Regulatory";
    case "intelligence_investigative": return "Intelligence / Investigative";
    case "operational_report": return "Operational Report";
    case "procurement_investigation": return "Procurement Investigation";
    case "legal_contractual": return "Legal / Contractual";
    case "academic_research": return "Academic Research";
    case "generic_document": return "General Document";
    default: return "Unknown Document Type";
  }
};
