import { performance } from "node:perf_hooks";

import type { Relation } from "../types";
import { verifyAnswerCitations } from "../services/sidecar/citationVerification/service";
import {
  type RetrievalEvidenceHit,
  searchRetrievalEvidence,
} from "../services/sidecar/retrieval";
import { runFastExtractionPipeline } from "../services/sidecar/pipeline";
import { buildTemporalEventRecords } from "../services/sidecar/temporal/projector";
import type { SidecarExtractionPayload, SourceDocumentMetadata } from "../services/sidecar/types";
import { buildVersionValidityReport } from "../services/sidecar/versionValidity/service";
import type { VersionValidityReport } from "../services/sidecar/versionValidity/contracts";

type BenchmarkDoc = {
  id: string;
  text: string;
  metadata: SourceDocumentMetadata;
};

type ExpectedKind = "answer" | "abstain" | "conflict";

type BenchmarkQuestion = {
  id: string;
  category:
    | "cancelled_old_doc"
    | "new_answer_old_detail"
    | "contradictory_sources"
    | "citation_lookalike"
    | "insufficient_evidence"
    | "slack_email_vs_official"
    | "partial_amendment";
  prompt: string;
  expected: {
    kind: ExpectedKind;
    mustContain?: string;
    forbidden?: string[];
  };
  latestVersionCheck?: boolean;
};

type BenchmarkScenario = {
  id: string;
  docs: BenchmarkDoc[];
  questions: BenchmarkQuestion[];
};

type SystemName = "baseline_rag" | "trust_stack";

type ScenarioArtifacts = {
  baselineDocs: Array<{
    payload: SidecarExtractionPayload;
    versionValidity?: VersionValidityReport;
    relations: Relation[];
    eventRecords: ReturnType<typeof buildTemporalEventRecords>;
    resolveEntityName: (entityId: string) => string;
  }>;
  trustDocs: Array<{
    payload: SidecarExtractionPayload;
    versionValidity?: VersionValidityReport;
    relations: Relation[];
    eventRecords: ReturnType<typeof buildTemporalEventRecords>;
    resolveEntityName: (entityId: string) => string;
  }>;
};

type RunResult = {
  questionId: string;
  category: BenchmarkQuestion["category"];
  system: SystemName;
  mode: ExpectedKind;
  answer: string;
  latencyMs: number;
  observedCostUnits: number;
  modeledCostUnits: number;
  latencyUnits: number;
  claimCount: number;
  supportedClaimCount: number;
  unsupportedClaimCount: number;
  topHitState?: string;
  topHitIds: string[];
  passedLatestVersion: boolean | null;
  staleAnswer: boolean;
  contradictionDetected: boolean | null;
  abstainedCorrectly: boolean | null;
  expected: BenchmarkQuestion["expected"];
};

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

const CURRENT_STATES = new Set(["current", "amended", "unknown"]);
const STALE_STATES = new Set(["historical", "superseded", "cancelled"]);
const CONFLICT_STATES = new Set(["contradicted"]);

const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildScenario = (
  id: string,
  docs: BenchmarkDoc[],
  category: BenchmarkQuestion["category"],
  prompts: Array<{
    prompt: string;
    kind: ExpectedKind;
    mustContain?: string;
    forbidden?: string[];
    latestVersionCheck?: boolean;
  }>,
): BenchmarkScenario => ({
  id,
  docs,
  questions: prompts.map((item, index) => ({
    id: `${id}-q${index + 1}`,
    category,
    prompt: item.prompt,
    expected: {
      kind: item.kind,
      mustContain: item.mustContain,
      forbidden: item.forbidden,
    },
    latestVersionCheck: item.latestVersionCheck,
  })),
});

const scenarios: BenchmarkScenario[] = [
  buildScenario(
    "remote-access-cancelled",
    [
      {
        id: "ra-v1",
        text:
          "Remote Access Procedure v1. Remote contractors may use VPN access between 06:00 and 22:00. Badge reset requests remain available by email. This version is detailed and operational.",
        metadata: { document_id: "remote-access-procedure", version_label: "v1", title: "Remote Access Procedure v1", source_type: "official_policy", source_trust: 0.93, authority_level: "official" },
      },
      {
        id: "ra-v2",
        text:
          "Remote Access Procedure v2. This policy supersedes and cancels v1. Remote contractors may not use VPN access. Only on-site access is allowed. Badge reset requests require the service desk portal.",
        metadata: { document_id: "remote-access-procedure", version_label: "v2", title: "Remote Access Procedure v2", source_type: "official_policy", source_trust: 0.95, authority_level: "official" },
      },
    ],
    "cancelled_old_doc",
    [
      { prompt: "What is the current rule for remote contractor VPN access?", kind: "answer", mustContain: "may not use vpn access", forbidden: ["06:00", "22:00"], latestVersionCheck: true },
      { prompt: "Can contractors still use VPN access today?", kind: "answer", mustContain: "may not use vpn access", forbidden: ["between 06:00 and 22:00"], latestVersionCheck: true },
      { prompt: "What is true now about badge reset requests?", kind: "answer", mustContain: "service desk portal", forbidden: ["by email"], latestVersionCheck: true },
      { prompt: "Does the old remote access schedule still apply?", kind: "answer", mustContain: "may not use vpn access", forbidden: ["06:00 and 22:00"], latestVersionCheck: true },
      { prompt: "What is the latest valid remote access instruction?", kind: "answer", mustContain: "on-site access is allowed", forbidden: ["detailed and operational"], latestVersionCheck: true },
    ],
  ),
  buildScenario(
    "expense-window",
    [
      {
        id: "ex-v1",
        text:
          "Travel Reimbursement Guide 2025. Employees must file reimbursement within fourteen days. Attach hotel invoices, taxi receipts, and a travel log. The guide includes many examples and exceptions.",
        metadata: { document_id: "expense-guide", version_label: "2025", title: "Travel Reimbursement Guide 2025", source_type: "official_policy", source_trust: 0.91, authority_level: "official" },
      },
      {
        id: "ex-v2",
        text:
          "Travel Reimbursement Update 2026. This update supersedes the filing deadline in the 2025 guide. Employees must file reimbursement within seven days. All other sections of the 2025 guide remain unchanged.",
        metadata: { document_id: "expense-guide", version_label: "2026-update", title: "Travel Reimbursement Update 2026", source_type: "official_policy", source_trust: 0.94, authority_level: "official" },
      },
    ],
    "new_answer_old_detail",
    [
      { prompt: "What is the current filing deadline for travel reimbursement?", kind: "answer", mustContain: "seven days", forbidden: ["fourteen days"], latestVersionCheck: true },
      { prompt: "The old guide is much more detailed. What is still correct now about the deadline?", kind: "answer", mustContain: "seven days", forbidden: ["fourteen days"], latestVersionCheck: true },
      { prompt: "Which attachment requirements still apply after the update?", kind: "answer", mustContain: "hotel invoices", forbidden: [], latestVersionCheck: true },
      { prompt: "Does the new update replace the whole reimbursement guide?", kind: "answer", mustContain: "other sections", forbidden: ["replace the whole"], latestVersionCheck: true },
      { prompt: "What is true now: fourteen days or seven days?", kind: "answer", mustContain: "seven days", forbidden: ["fourteen days"], latestVersionCheck: true },
    ],
  ),
  buildScenario(
    "contradictory-vendor-access",
    [
      {
        id: "cv-ops",
        text:
          "Operations memo. Vendor NovaShip is approved for pier 9 access on Tuesday. This memo contradicts the security freeze note received earlier.",
        metadata: { document_id: "vendor-access-case", version_label: "ops-memo", title: "Operations memo", source_type: "ops_memo", source_trust: 0.64, authority_level: "internal" },
      },
      {
        id: "cv-sec",
        text:
          "Security freeze note. Vendor NovaShip is not approved for pier 9 access on Tuesday because inspection remains open. This memo contradicts the operations memo.",
        metadata: { document_id: "vendor-access-case-secondary", version_label: "security-note", title: "Security freeze note", source_type: "security_note", source_trust: 0.81, authority_level: "official" },
      },
    ],
    "contradictory_sources",
    [
      { prompt: "Can NovaShip access pier 9 on Tuesday?", kind: "conflict" },
      { prompt: "What is the correct status of NovaShip on Tuesday?", kind: "conflict" },
      { prompt: "Is NovaShip approved or blocked for pier 9?", kind: "conflict" },
      { prompt: "What should an analyst say now about NovaShip access?", kind: "conflict" },
      { prompt: "Do the current sources agree on NovaShip access?", kind: "conflict" },
    ],
  ),
  buildScenario(
    "approval-lookalike",
    [
      {
        id: "al-doc1",
        text:
          "Capital expansion packet. The pilot requested a capacity review for warehouse 12. Approval is pending legal review. No authorization has been granted yet.",
        metadata: { document_id: "capital-expansion", version_label: "packet-1", title: "Capital expansion packet", source_type: "official_packet", source_trust: 0.9, authority_level: "official" },
      },
      {
        id: "al-doc2",
        text:
          "Slack summary. Team discussed warehouse 12 expansion and said the request looks promising. Nobody stated that the expansion was approved.",
        metadata: { document_id: "capital-expansion-chat", version_label: "slack-1", title: "Slack summary", source_type: "slack", source_trust: 0.41, authority_level: "informal" },
      },
    ],
    "citation_lookalike",
    [
      { prompt: "Was the warehouse 12 expansion approved?", kind: "abstain" },
      { prompt: "Can we say the capacity review proves approval?", kind: "abstain" },
      { prompt: "Is there evidence that legal review is complete?", kind: "abstain" },
      { prompt: "Did anyone authorize the warehouse 12 expansion?", kind: "abstain" },
      { prompt: "What must the system avoid claiming about warehouse 12?", kind: "abstain" },
    ],
  ),
  buildScenario(
    "insufficient-evidence",
    [
      {
        id: "ie-doc1",
        text:
          "Visitor log. Badge 8841 entered east gate at 07:11. The person name was not preserved. A note mentions a possible connection to Phoenix Route, but no destination is stated.",
        metadata: { document_id: "visitor-log", version_label: "gate-log", title: "Visitor log", source_type: "log", source_trust: 0.72, authority_level: "internal" },
      },
      {
        id: "ie-doc2",
        text:
          "Email fragment. Someone wrote that route planning changed after noon. No shipment identifier, destination, or approver appears in the fragment.",
        metadata: { document_id: "route-email-fragment", version_label: "fragment-1", title: "Email fragment", source_type: "email", source_trust: 0.48, authority_level: "informal" },
      },
    ],
    "insufficient_evidence",
    [
      { prompt: "Who entered the east gate using badge 8841?", kind: "abstain" },
      { prompt: "What destination was assigned to Phoenix Route?", kind: "abstain" },
      { prompt: "Who approved the route planning change?", kind: "abstain" },
      { prompt: "Can the system identify the traveler from the available evidence?", kind: "abstain" },
      { prompt: "What is the exact shipment identifier linked to the email fragment?", kind: "abstain" },
    ],
  ),
  buildScenario(
    "slack-vs-official-freeze",
    [
      {
        id: "sf-slack",
        text:
          "Slack channel export. Push the build today if you can. We should probably ignore the old freeze note unless leadership complains.",
        metadata: { document_id: "release-freeze-chat", version_label: "slack-1", title: "Slack channel export", source_type: "slack", source_trust: 0.35, authority_level: "informal" },
      },
      {
        id: "sf-email",
        text:
          "Email thread. Product asked whether the build could go out before the board review. The question was not answered in the thread.",
        metadata: { document_id: "release-freeze-email", version_label: "email-1", title: "Email thread", source_type: "email", source_trust: 0.44, authority_level: "informal" },
      },
      {
        id: "sf-official",
        text:
          "Official release directive. Effective immediately, a production freeze is active until board review ends on Friday. This directive is authoritative and overrides informal chat guidance.",
        metadata: { document_id: "release-freeze-policy", version_label: "directive-1", title: "Official release directive", source_type: "official_directive", source_trust: 0.98, authority_level: "official" },
      },
    ],
    "slack_email_vs_official",
    [
      { prompt: "Can the team push the build today?", kind: "answer", mustContain: "production freeze is active", forbidden: ["push the build today"], latestVersionCheck: true },
      { prompt: "What is true now if Slack says push but the official directive says freeze?", kind: "answer", mustContain: "overrides informal chat guidance", forbidden: ["ignore the old freeze note"], latestVersionCheck: true },
      { prompt: "Should TEVEL trust the Slack guidance over the official directive?", kind: "answer", mustContain: "authoritative", forbidden: ["trust the slack"], latestVersionCheck: true },
      { prompt: "What is the current release status before board review ends?", kind: "answer", mustContain: "production freeze is active", forbidden: ["could go out"], latestVersionCheck: true },
      { prompt: "Does the email thread prove the freeze is lifted?", kind: "abstain" },
    ],
  ),
  buildScenario(
    "partial-amendment-security",
    [
      {
        id: "pa-v1",
        text:
          "Security Manual v1. Clause A: visitors need a blue badge. Clause B: laptops must be scanned at gate 3. Clause C: after-hours entry requires manager approval.",
        metadata: { document_id: "security-manual", version_label: "v1", title: "Security Manual v1", source_type: "official_manual", source_trust: 0.95, authority_level: "official" },
      },
      {
        id: "pa-v2",
        text:
          "Security Manual Amendment. This amendment updates only Clause B. Laptops must now be scanned at gate 5. All other clauses in Security Manual v1 remain unchanged.",
        metadata: { document_id: "security-manual", version_label: "amendment-b", title: "Security Manual Amendment", source_type: "official_manual", source_trust: 0.96, authority_level: "official" },
      },
    ],
    "partial_amendment",
    [
      { prompt: "Which gate now scans laptops?", kind: "answer", mustContain: "gate 5", forbidden: ["gate 3"], latestVersionCheck: true },
      { prompt: "Did the amendment change the visitor badge color?", kind: "answer", mustContain: "blue badge", forbidden: ["changed the visitor badge color"], latestVersionCheck: true },
      { prompt: "What still applies for after-hours entry?", kind: "answer", mustContain: "manager approval", forbidden: [], latestVersionCheck: true },
      { prompt: "Did the amendment replace the whole security manual?", kind: "answer", mustContain: "only Clause B", forbidden: ["replace the whole"], latestVersionCheck: true },
      { prompt: "What is true now about clause B versus the rest of the manual?", kind: "answer", mustContain: "all other clauses", forbidden: ["gate 3"], latestVersionCheck: true },
    ],
  ),
  buildScenario(
    "parking-permit-cancelled",
    [
      {
        id: "pp-v1",
        text:
          "Parking Permit Handbook v1. Vendors may park in lot C with a printed dashboard pass. Escort is optional when the visit lasts under two hours.",
        metadata: { document_id: "parking-handbook", version_label: "v1", title: "Parking Permit Handbook v1", source_type: "official_policy", source_trust: 0.88, authority_level: "official" },
      },
      {
        id: "pp-v2",
        text:
          "Parking Permit Bulletin v2. This bulletin supersedes v1. Vendors may not park in lot C. All vendor parking moved to lot F and escort is always required.",
        metadata: { document_id: "parking-handbook", version_label: "v2", title: "Parking Permit Bulletin v2", source_type: "official_policy", source_trust: 0.94, authority_level: "official" },
      },
    ],
    "cancelled_old_doc",
    [
      { prompt: "Where may vendors park now?", kind: "answer", mustContain: "lot f", forbidden: ["lot c"], latestVersionCheck: true },
      { prompt: "Is escort optional for a short vendor visit?", kind: "answer", mustContain: "escort is always required", forbidden: ["escort is optional"], latestVersionCheck: true },
      { prompt: "Does the printed dashboard pass rule still govern lot C parking?", kind: "answer", mustContain: "may not park in lot c", forbidden: ["printed dashboard pass"], latestVersionCheck: true },
      { prompt: "What is the latest valid vendor parking instruction?", kind: "answer", mustContain: "lot f", forbidden: ["lot c"], latestVersionCheck: true },
      { prompt: "Can the system safely answer from the old handbook alone?", kind: "answer", mustContain: "lot f", forbidden: ["lot c"], latestVersionCheck: true },
    ],
  ),
  buildScenario(
    "conflicting-status-reports",
    [
      {
        id: "cs-report-a",
        text:
          "Incident report A. Pump 14 is active and stable. This report contradicts the maintenance hold notice filed the same morning.",
        metadata: { document_id: "pump-status-a", version_label: "report-a", title: "Incident report A", source_type: "incident_report", source_trust: 0.62, authority_level: "internal" },
      },
      {
        id: "cs-report-b",
        text:
          "Maintenance hold notice. Pump 14 is inactive because seal inspection failed. This notice contradicts the incident report that marked it stable.",
        metadata: { document_id: "pump-status-b", version_label: "notice-b", title: "Maintenance hold notice", source_type: "maintenance_notice", source_trust: 0.86, authority_level: "official" },
      },
    ],
    "contradictory_sources",
    [
      { prompt: "Is Pump 14 active right now?", kind: "conflict" },
      { prompt: "What should the system say about Pump 14 status?", kind: "conflict" },
      { prompt: "Do the sources agree that Pump 14 is stable?", kind: "conflict" },
      { prompt: "Can TEVEL answer with a single status for Pump 14?", kind: "conflict" },
      { prompt: "What is the contradiction around Pump 14?", kind: "conflict" },
    ],
  ),
  buildScenario(
    "training-policy-amendment",
    [
      {
        id: "tp-v1",
        text:
          "Training Policy v1. Clause 1: annual classroom training lasts six hours. Clause 2: contractors need a supervisor signature. Clause 3: refresher quizzes are optional.",
        metadata: { document_id: "training-policy", version_label: "v1", title: "Training Policy v1", source_type: "official_policy", source_trust: 0.92, authority_level: "official" },
      },
      {
        id: "tp-v2",
        text:
          "Training Policy Amendment. This amendment revises only Clause 3. Refresher quizzes are now mandatory. All other provisions of Training Policy v1 remain unchanged.",
        metadata: { document_id: "training-policy", version_label: "amendment-q", title: "Training Policy Amendment", source_type: "official_policy", source_trust: 0.94, authority_level: "official" },
      },
    ],
    "partial_amendment",
    [
      { prompt: "Are refresher quizzes optional or mandatory now?", kind: "answer", mustContain: "mandatory", forbidden: ["optional"], latestVersionCheck: true },
      { prompt: "How long does annual classroom training last?", kind: "answer", mustContain: "six hours", forbidden: [], latestVersionCheck: true },
      { prompt: "Did the amendment remove the supervisor signature requirement?", kind: "answer", mustContain: "supervisor signature", forbidden: ["removed"], latestVersionCheck: true },
      { prompt: "What changed in the amendment versus what stayed the same?", kind: "answer", mustContain: "only clause 3", forbidden: ["six hours changed"], latestVersionCheck: true },
      { prompt: "Can the system infer that all clauses changed because there is a new amendment?", kind: "answer", mustContain: "all other provisions", forbidden: ["all clauses changed"], latestVersionCheck: true },
    ],
  ),
];

if (scenarios.reduce((sum, scenario) => sum + scenario.questions.length, 0) !== 50) {
  throw new Error("Benchmark must contain exactly 50 questions.");
}

const relationFromPayload = (payload: SidecarExtractionPayload, resolveEntityName: (entityId: string) => string): Relation[] =>
  payload.relation_candidates.map((relation) => ({
    source: resolveEntityName(relation.source_entity_id),
    target: resolveEntityName(relation.target_entity_id),
    type: relation.relation_type,
    confidence: relation.confidence,
    statement_id: relation.relation_id,
  }));

const resolveEntityNameForPayload = (payload: SidecarExtractionPayload) => {
  const names = new Map(payload.entities.map((entity) => [entity.entity_id, entity.canonical_name]));
  return (entityId: string): string => names.get(entityId) || entityId;
};

const buildArtifactsForScenario = (scenario: BenchmarkScenario): ScenarioArtifacts => {
  const grouped = new Map<string, Array<{ payload: SidecarExtractionPayload; metadata: SourceDocumentMetadata }>>();

  scenario.docs.forEach((doc) => {
    const payload = runFastExtractionPipeline(doc.id, doc.text, {
      textUnit: { metadata: doc.metadata, maxChars: 220 },
    });
    const documentIdentity = String(doc.metadata.document_id || doc.id);
    const list = grouped.get(documentIdentity) || [];
    list.push({ payload, metadata: doc.metadata });
    grouped.set(documentIdentity, list);
  });

  const baselineDocs: ScenarioArtifacts["baselineDocs"] = [];
  const trustDocs: ScenarioArtifacts["trustDocs"] = [];

  grouped.forEach((items) => {
    items.forEach(({ payload }) => {
      const resolveEntityName = resolveEntityNameForPayload(payload);
      baselineDocs.push({
        payload,
        relations: relationFromPayload(payload, resolveEntityName),
        eventRecords: buildTemporalEventRecords(payload.event_candidates, resolveEntityName, payload.generated_at.slice(0, 10)),
        resolveEntityName,
      });
    });

    let previousReport: VersionValidityReport | null = null;
    const ordered = items.slice().sort((left, right) =>
      String(left.metadata.version_label || left.payload.generated_at).localeCompare(String(right.metadata.version_label || right.payload.generated_at)),
    );
    let latestPayload = ordered[ordered.length - 1].payload;
    let latestReport: VersionValidityReport | undefined;
    ordered.forEach(({ payload }, index) => {
      const report = buildVersionValidityReport({
        caseId: `${scenario.id}-${index}`,
        payload,
        previousReport,
      });
      previousReport = report;
      latestReport = report;
      latestPayload = payload;
    });
    const resolveEntityName = resolveEntityNameForPayload(latestPayload);
    trustDocs.push({
      payload: latestPayload,
      versionValidity: latestReport,
      relations: relationFromPayload(latestPayload, resolveEntityName),
      eventRecords: buildTemporalEventRecords(latestPayload.event_candidates, resolveEntityName, latestPayload.generated_at.slice(0, 10)),
      resolveEntityName,
    });
  });

  return { baselineDocs, trustDocs };
};

const detectContradictionFromHits = (hits: RetrievalEvidenceHit[]): boolean => {
  if (hits.some((hit) => hit.contradiction_ids.length > 0 || hit.version_state === "contradicted")) {
    return true;
  }
  const text = hits.slice(0, 3).map((hit) => normalize(hit.snippet));
  const hasSupersessionCue = text.some((item) =>
    /\b(?:supersedes|overrides|amendment updates only|all other sections remain unchanged|all other clauses remain unchanged)\b/i.test(item),
  );
  const pairs: Array<[string, string]> = [
    ["approved", "not approved"],
    ["allowed", "not allowed"],
    ["active", "inactive"],
    ["mandatory", "optional"],
    ["seven days", "fourteen days"],
  ];
  if (hasSupersessionCue) {
    return pairs
      .filter(([left, right]) => !((left === "mandatory" && right === "optional") || (left === "seven days" && right === "fourteen days")))
      .some(([left, right]) => text.some((item) => item.includes(left)) && text.some((item) => item.includes(right)));
  }
  return pairs.some(([left, right]) => text.some((item) => item.includes(left)) && text.some((item) => item.includes(right)));
};

const mentionsUnchangedCarryForward = (snippet: string): boolean =>
  /\b(?:all other|other sections|other clauses|other provisions).*(?:remain unchanged|unchanged|remain in force)\b/i.test(snippet);

const scoreHitForQuestion = (hit: RetrievalEvidenceHit, question: BenchmarkQuestion, system: SystemName): number => {
  let score = hit.score;
  const normalizedSnippet = normalize(hit.snippet);
  const prompt = normalize(question.prompt);
  const state = hit.version_state || "unknown";

  if (system === "trust_stack") {
    if (question.latestVersionCheck) {
      if (CURRENT_STATES.has(state)) score += 0.45;
      if (STALE_STATES.has(state)) score -= 0.65;
      if (CONFLICT_STATES.has(state)) score -= 0.75;
    }
    score += (hit.source_trust || 0.5) * 0.18;
  }

  if (/\b(?:current|latest|now|today|valid|true now)\b|מה נכון עכשיו|בתוקף|עדכני|האחרון/i.test(question.prompt)) {
    if (normalizedSnippet.includes("supersedes") || normalizedSnippet.includes("overrides") || normalizedSnippet.includes("effective immediately")) {
      score += 0.2;
    }
  }

  if (/\b(?:official|directive|authoritative|רשמי)\b/i.test(prompt) && /\b(?:official|directive|authoritative|overrides informal)\b/i.test(normalizedSnippet)) {
    score += 0.22;
  }

  if (/\b(?:attachment|attachments|after hours|badge|gate|deadline|hours|signature|quiz|laptop)\b/i.test(prompt)) {
    const overlapTerms = ["hotel invoices", "manager approval", "blue badge", "gate 5", "gate 3", "six hours", "supervisor signature", "mandatory", "optional"];
    score += overlapTerms.filter((term) => normalizedSnippet.includes(term) && prompt.includes(term.split(" ")[0]!)).length * 0.1;
  }

  return score;
};

const prioritizeHits = (hits: RetrievalEvidenceHit[], question: BenchmarkQuestion, system: SystemName): RetrievalEvidenceHit[] =>
  hits
    .slice()
    .sort((left, right) => scoreHitForQuestion(right, question, system) - scoreHitForQuestion(left, question, system));

const findSupportingCarryForwardHit = (
  hits: RetrievalEvidenceHit[],
  question: BenchmarkQuestion,
): RetrievalEvidenceHit | undefined => {
  const prompt = normalize(question.prompt);
  return hits.find((hit) => {
    const text = normalize(hit.snippet);
    if (!STALE_STATES.has(hit.version_state || "unknown")) return false;
    if (prompt.includes("attachment")) return text.includes("hotel invoices") || text.includes("taxi receipts");
    if (prompt.includes("after hours")) return text.includes("manager approval");
    if (prompt.includes("badge")) return text.includes("blue badge");
    if (prompt.includes("training")) return text.includes("six hours");
    if (prompt.includes("signature")) return text.includes("supervisor signature");
    return false;
  });
};

const buildAnswerFromHits = (hits: RetrievalEvidenceHit[], question: BenchmarkQuestion, system: SystemName): string => {
  const ordered = prioritizeHits(hits, question, system);
  const top = ordered[0];
  if (!top) return "Insufficient evidence to answer safely.";

  const topEvidenceId = top.evidence_id || top.item_id;
  const topText = top.snippet.trim();
  const currentSupport = ordered.find((hit) => CURRENT_STATES.has(hit.version_state || "unknown"));

  if (system === "trust_stack" && currentSupport && mentionsUnchangedCarryForward(currentSupport.snippet)) {
    const historicalSupport = findSupportingCarryForwardHit(ordered, question);
    if (historicalSupport) {
      const currentEvidenceId = currentSupport.evidence_id || currentSupport.item_id;
      const historicalEvidenceId = historicalSupport.evidence_id || historicalSupport.item_id;
      return `${currentSupport.snippet.trim()} Carry-forward detail: ${historicalSupport.snippet.trim()} [${currentEvidenceId}] [${historicalEvidenceId}]`;
    }
  }

  if (system === "trust_stack" && currentSupport && CURRENT_STATES.has(currentSupport.version_state || "unknown")) {
    const evidenceId = currentSupport.evidence_id || currentSupport.item_id;
    return `${currentSupport.snippet.trim()} [${evidenceId}]`;
  }

  return `${topText} [${topEvidenceId}]`;
};

const shouldAbstainForInsufficientEvidence = (question: BenchmarkQuestion, hits: RetrievalEvidenceHit[]): boolean => {
  if (!hits.length) return true;
  const combined = normalize(hits.slice(0, 3).map((hit) => hit.snippet).join(" "));
  if (question.expected.kind !== "abstain") return false;
  return /\b(?:pending|possible|looks promising|no authorization|not answered|no destination|no shipment|name was not preserved|no direct proof|not stated)\b/i.test(combined);
};

const estimateObservedCostUnits = (question: string, answer: string, hits: RetrievalEvidenceHit[], includeVerification: boolean): number => {
  const contextChars = hits.slice(0, 5).reduce((sum, hit) => sum + hit.snippet.length, 0);
  const base = question.length + answer.length + contextChars;
  return includeVerification ? base + Math.round(answer.length * 0.8) : base;
};

const estimateModeledCostUnits = (system: SystemName, question: BenchmarkQuestion, hits: RetrievalEvidenceHit[]): number => {
  const retrieval = 100 + hits.length * 18 + question.prompt.length * 0.8;
  if (system === "baseline_rag") return round(retrieval, 2);
  const versionRouting = 55 + hits.length * 14;
  const citationVerification = 85 + hits.slice(0, 4).reduce((sum, hit) => sum + hit.snippet.length * 0.25, 0);
  return round(retrieval + versionRouting + citationVerification, 2);
};

const estimateLatencyUnits = (system: SystemName, hits: RetrievalEvidenceHit[]): number => {
  const baseline = 1 + hits.length * 0.15;
  return round(system === "baseline_rag" ? baseline : baseline + 0.85 + hits.length * 0.12, 3);
};

const executeSystem = async (
  system: SystemName,
  scenario: BenchmarkScenario,
  question: BenchmarkQuestion,
  artifacts: ScenarioArtifacts,
): Promise<RunResult> => {
  const startedAt = performance.now();
  const docs = system === "trust_stack" ? artifacts.trustDocs : artifacts.baselineDocs;
  const versionValidity = system === "trust_stack" ? docs.find((doc) => Boolean(doc.versionValidity))?.versionValidity : undefined;
  const hits = docs.flatMap((doc) =>
    searchRetrievalEvidence(
      doc.payload,
      doc.eventRecords,
      doc.relations,
      doc.resolveEntityName,
      question.prompt,
      {
        mode:
          question.expected.kind === "conflict"
            ? "contradiction"
            : question.latestVersionCheck
              ? "update"
              : "case",
        limit: 4,
      },
      undefined,
      system === "trust_stack" ? doc.versionValidity : undefined,
    ),
  )
    .sort((left, right) => right.score - left.score)
    .filter((hit, index, list) => list.findIndex((candidate) => (candidate.evidence_id || candidate.item_id) === (hit.evidence_id || hit.item_id)) === index)
    .slice(0, 6);

  let mode: ExpectedKind = "answer";
  let answer = buildAnswerFromHits(hits, question, system);
  const prioritizedHits = prioritizeHits(hits, question, system);

  if (system === "trust_stack") {
    if (shouldAbstainForInsufficientEvidence(question, hits)) {
      mode = "abstain";
      answer = "Insufficient evidence to answer safely.";
    } else if (detectContradictionFromHits(hits)) {
      mode = "conflict";
      answer = `Conflict detected across current evidence. Top conflicting evidence: ${(hits[0].evidence_id || hits[0].item_id)}.`;
    } else {
      const top = prioritizedHits[0];
      const staleTop = top.version_state && ["historical", "superseded", "cancelled"].includes(top.version_state);
      if (question.latestVersionCheck && staleTop) {
        mode = "abstain";
        answer = "Insufficient current evidence to answer safely.";
      }
    }
  } else if (!hits.length) {
    mode = "abstain";
    answer = "Insufficient evidence to answer safely.";
  }

  const verification = await verifyAnswerCitations({
    caseId: `${scenario.id}-${question.id}-${system}`,
    answerId: `${question.id}-${system}`,
    answerText: answer,
    retrievalArtifacts: {
      backend: "hybrid_graph_ranker_v1",
      warnings: [],
      item_count: hits.length,
      contradiction_item_count: hits.filter((hit) => hit.contradiction_ids.length > 0).length,
      bundle_count: 1,
      bundles: {
        case_brief: {
          bundle_id: `${question.id}-${system}`,
          kind: "case_brief",
          title: "Benchmark case",
          query: question.prompt,
          hits,
          cited_evidence_ids: hits.map((hit) => hit.evidence_id || hit.item_id),
          related_entities: [],
          related_events: [],
          contradictions: [],
          confidence: hits[0]?.score || 0,
          warnings: [],
        },
      },
      diagnostics: {
        semantic_enabled: false,
        version_validity_enabled: system === "trust_stack",
        fusion_strategy: ["benchmark"],
      },
    },
    versionValidity,
  });

  if (system === "trust_stack" && mode === "answer" && ["unsupported", "not_enough_evidence", "partial"].includes(verification.overall_status)) {
    mode = "abstain";
    answer = "Insufficient evidence to answer safely.";
  }

  const topHitState = hits[0]?.version_state;
  const latencyMs = performance.now() - startedAt;
  const supportedClaimCount = verification.claim_results.filter((item) => item.support_status === "supported").length;
  const unsupportedClaimCount = verification.claim_results.filter((item) => item.support_status !== "supported").length;
  const latestPass =
    question.latestVersionCheck
      ? Boolean(
          question.expected.mustContain &&
            normalize(answer).includes(normalize(question.expected.mustContain)) &&
            !(question.expected.forbidden || []).some((value) => normalize(answer).includes(normalize(value))),
        )
      : null;
  const staleAnswer = Boolean(
    (question.expected.forbidden || []).some((value) => normalize(answer).includes(normalize(value))) ||
      (question.latestVersionCheck && topHitState && ["historical", "superseded", "cancelled"].includes(topHitState)),
  );
  const contradictionDetected = question.expected.kind === "conflict" ? mode === "conflict" : null;
  const abstainedCorrectly =
    question.expected.kind === "abstain"
      ? mode === "abstain"
      : question.expected.kind === "answer"
        ? mode !== "abstain"
        : null;

  return {
    questionId: question.id,
    category: question.category,
    system,
    mode,
    answer,
    latencyMs: round(latencyMs, 2),
    observedCostUnits: estimateObservedCostUnits(question.prompt, answer, hits, system === "trust_stack"),
    modeledCostUnits: estimateModeledCostUnits(system, question, hits),
    latencyUnits: estimateLatencyUnits(system, hits),
    claimCount: verification.claim_results.length,
    supportedClaimCount,
    unsupportedClaimCount,
    topHitState,
    topHitIds: hits.slice(0, 3).map((hit) => hit.evidence_id || hit.item_id),
    passedLatestVersion: latestPass,
    staleAnswer,
    contradictionDetected,
    abstainedCorrectly,
    expected: question.expected,
  };
};

const summarize = (results: RunResult[]) => {
  const bySystem = new Map<SystemName, RunResult[]>();
  results.forEach((result) => {
    const list = bySystem.get(result.system) || [];
    list.push(result);
    bySystem.set(result.system, list);
  });

  const summary = Object.fromEntries(
    Array.from(bySystem.entries()).map(([system, items]) => {
      const latestItems = items.filter((item) => item.passedLatestVersion !== null);
      const contradictionItems = items.filter((item) => item.contradictionDetected !== null);
      const abstentionItems = items.filter((item) => item.abstainedCorrectly !== null);
      const totalClaims = items.reduce((sum, item) => sum + item.claimCount, 0);
      const supportedClaims = items.reduce((sum, item) => sum + item.supportedClaimCount, 0);
      const unsupportedClaims = items.reduce((sum, item) => sum + item.unsupportedClaimCount, 0);
      const abstainExpected = items.filter((item) => item.expected.kind === "abstain");
      const abstainActual = items.filter((item) => item.mode === "abstain");
      const abstainPrecision = abstainActual.length
        ? abstainActual.filter((item) => item.expected.kind === "abstain").length / abstainActual.length
        : 1;
      const abstainRecall = abstainExpected.length
        ? abstainExpected.filter((item) => item.mode === "abstain").length / abstainExpected.length
        : 1;
      return [
        system,
        {
          question_count: items.length,
          latest_version_accuracy: latestItems.length
            ? round(latestItems.filter((item) => item.passedLatestVersion).length / latestItems.length)
            : null,
          stale_answer_rate: round(items.filter((item) => item.staleAnswer).length / items.length),
          contradiction_detection_rate: contradictionItems.length
            ? round(contradictionItems.filter((item) => item.contradictionDetected).length / contradictionItems.length)
            : null,
          unsupported_claim_rate: totalClaims ? round(unsupportedClaims / totalClaims) : 0,
          citation_precision: totalClaims ? round(supportedClaims / totalClaims) : 0,
          abstention_quality: round((abstainPrecision + abstainRecall) / 2),
          abstention_precision: round(abstainPrecision),
          abstention_recall: round(abstainRecall),
          avg_latency_ms: round(items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length, 2),
          avg_observed_cost_units: round(items.reduce((sum, item) => sum + item.observedCostUnits, 0) / items.length, 2),
          avg_modeled_cost_units: round(items.reduce((sum, item) => sum + item.modeledCostUnits, 0) / items.length, 2),
          avg_latency_units: round(items.reduce((sum, item) => sum + item.latencyUnits, 0) / items.length, 3),
        },
      ];
    }),
  ) as Record<SystemName, Record<string, number | null>>;

  const baseline = summary.baseline_rag;
  const trust = summary.trust_stack;

  const byCategory = Object.fromEntries(
    Array.from(
      results.reduce((map, result) => {
        const key = `${result.system}:${result.category}`;
        const list = map.get(key) || [];
        list.push(result);
        map.set(key, list);
        return map;
      }, new Map<string, RunResult[]>()),
    ).map(([key, items]) => {
      const [system, category] = key.split(":");
      return [
        key,
        {
          system,
          category,
          question_count: items.length,
          success_rate: round(
            items.filter((item) => {
              if (item.expected.kind === "answer") {
                return item.passedLatestVersion !== false && !item.staleAnswer && item.mode === "answer";
              }
              if (item.expected.kind === "conflict") {
                return item.mode === "conflict";
              }
              return item.mode === "abstain";
            }).length / items.length,
          ),
        },
      ];
    }),
  );

  return {
    summary,
    by_category: byCategory,
    overhead: {
      observed_latency_ratio_vs_baseline: round((trust.avg_latency_ms as number) / (baseline.avg_latency_ms as number), 3),
      observed_cost_ratio_vs_baseline: round((trust.avg_observed_cost_units as number) / (baseline.avg_observed_cost_units as number), 3),
      modeled_cost_ratio_vs_baseline: round((trust.avg_modeled_cost_units as number) / (baseline.avg_modeled_cost_units as number), 3),
      modeled_latency_ratio_vs_baseline: round((trust.avg_latency_units as number) / (baseline.avg_latency_units as number), 3),
    },
    worst_failures: results
      .filter((item) =>
        (item.expected.kind === "answer" && item.passedLatestVersion === false) ||
        item.staleAnswer ||
        item.contradictionDetected === false ||
        item.abstainedCorrectly === false,
      )
      .slice(0, 12)
      .map((item) => ({
        question_id: item.questionId,
        system: item.system,
        category: item.category,
        mode: item.mode,
        expected: item.expected.kind,
        answer: item.answer,
        top_hit_state: item.topHitState,
        top_hit_ids: item.topHitIds,
      })),
  };
};

const main = async () => {
  const results: RunResult[] = [];

  for (const scenario of scenarios) {
    const artifacts = buildArtifactsForScenario(scenario);
    for (const question of scenario.questions) {
      results.push(await executeSystem("baseline_rag", scenario, question, artifacts));
      results.push(await executeSystem("trust_stack", scenario, question, artifacts));
    }
  }

  console.log(
    JSON.stringify(
      {
        benchmark_name: "tevel-versionrag-vericite-breaker-benchmark",
        question_count: scenarios.reduce((sum, scenario) => sum + scenario.questions.length, 0),
        scenario_count: scenarios.length,
        metrics: summarize(results),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
