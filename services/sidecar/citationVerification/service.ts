import type { RetrievalArtifacts, RetrievalEvidenceHit } from "../retrieval";
import { findVersionAtomForEvidence } from "../versionValidity/service";
import type {
  CitationClaimResult,
  CitationSupportStatus,
  CitationVerificationRequest,
  CitationVerificationRun,
} from "./contracts";
import { persistCitationVerificationRun } from "./store";

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const isOperationalAnswerLine = (value: string): boolean => {
  const normalized = normalize(value);
  if (!normalized) return true;
  return (
    /^fcf r3 status/i.test(normalized) ||
    /^סטטוס fcf r3/i.test(normalized) ||
    /^selected \d+ evidence atoms/i.test(normalized) ||
    /^נבחרו \d+ ראיות/i.test(normalized) ||
    /^evidence grounded answer/i.test(normalized) ||
    /^תשובה מבוססת ראיות/i.test(normalized) ||
    /^limits/i.test(normalized) ||
    /^מגבלות/i.test(normalized) ||
    /^\[[^\]]+\]$/.test(value.trim()) ||
    /reasoning engine (?:was unavailable|did not answer in time)/i.test(value) ||
    /local model (?:was unavailable|did not answer in time)/i.test(value) ||
    /מנוע ההסקה בענן לא (?:היה זמין|החזיר תשובה בזמן)/.test(value) ||
    /המודל המקומי לא (?:היה זמין|החזיר תשובה בזמן)/.test(value)
  );
};

const claimSentences = (answerText: string): string[] =>
  answerText
    .split(/\n+/)
    .map((item) => item.trim())
    .flatMap((line) => (/^[-*]\s+/.test(line) && /\[[^\]]+\]/.test(line) ? [line] : line.split(/(?<=[.!?])\s+/)))
    .map((item) => item.trim())
    .filter((item) => item.length >= 18)
    .filter((item) => !/^[-*]\s*$/.test(item))
    .filter((item) => !isOperationalAnswerLine(item.replace(/^[-*]\s*/, "")))
    .slice(0, 16);

const extractCitedEvidenceIds = (claimText: string): string[] =>
  Array.from(
    new Set(
      [...claimText.matchAll(/\[([^\]]+)\]/g)]
        .flatMap((match) => match[1].split(/[,\s]+/))
        .map((item) => item.trim())
        .filter((item) => /^(?:ev|evidence|atom|claim|rel|event|mention|text|chunk)[\w:-]*/i.test(item)),
    ),
  );

const tokenSet = (value: string): Set<string> =>
  new Set(
    normalize(value)
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );

const tokenOverlap = (claimText: string, evidenceText: string): number => {
  const claimTokens = tokenSet(claimText);
  const evidenceTokens = tokenSet(evidenceText);
  if (!claimTokens.size || !evidenceTokens.size) return 0;
  let overlap = 0;
  claimTokens.forEach((token) => {
    if (evidenceTokens.has(token)) overlap += 1;
  });
  return overlap / Math.max(1, Math.min(claimTokens.size, 18));
};

const predicateTerms = (claimText: string): string[] => {
  const supportVerbs = new Set([
    "met",
    "funded",
    "paid",
    "sent",
    "received",
    "denied",
    "allowed",
    "cancelled",
    "canceled",
    "superseded",
    "replaced",
    "amended",
    "approved",
    "rejected",
    "signed",
    "reported",
    "claimed",
    "requested",
    "updated",
    "valid",
    "invalid",
  ]);
  return Array.from(tokenSet(claimText)).filter((token) => supportVerbs.has(token));
};

const predicateCoveragePenalty = (claimText: string, evidenceText: string): number => {
  const predicates = predicateTerms(claimText);
  if (!predicates.length) return 0;
  const evidenceTokens = tokenSet(evidenceText);
  return predicates.some((token) => evidenceTokens.has(token)) ? 0 : 0.28;
};

const allHits = (artifacts?: RetrievalArtifacts): RetrievalEvidenceHit[] =>
  Object.values(artifacts?.bundles || {}).flatMap((bundle) => bundle.hits);

const dedupeHits = (hits: RetrievalEvidenceHit[]): RetrievalEvidenceHit[] => {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = hit.evidence_id || hit.item_id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const statusRank: Record<CitationSupportStatus, number> = {
  supported: 5,
  partial: 4,
  not_enough_evidence: 3,
  unsupported: 2,
  contradicted: 1,
};

const overallStatus = (results: CitationClaimResult[]): CitationSupportStatus => {
  if (!results.length) return "not_enough_evidence";
  if (results.some((result) => result.support_status === "contradicted")) return "contradicted";
  if (results.some((result) => result.support_status === "unsupported")) return "unsupported";
  if (results.some((result) => result.support_status === "not_enough_evidence")) return "not_enough_evidence";
  if (results.some((result) => result.support_status === "partial")) return "partial";
  return "supported";
};

const candidateHitsForClaim = (
  claimText: string,
  hits: RetrievalEvidenceHit[],
  fallbackEvidenceIds: string[],
): RetrievalEvidenceHit[] => {
  const citedIds = extractCitedEvidenceIds(claimText);
  const ids = citedIds.length ? citedIds : fallbackEvidenceIds;
  const byId = ids.length
    ? hits.filter((hit) => ids.includes(hit.evidence_id || "") || ids.includes(hit.item_id))
    : [];
  if (byId.length) return byId;

  return hits
    .map((hit) => ({ hit, score: tokenOverlap(claimText, hit.snippet) }))
    .filter((entry) => entry.score > 0.12)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((entry) => entry.hit);
};

const verifyClaimDeterministically = (
  caseId: string,
  claimText: string,
  index: number,
  evidenceHits: RetrievalEvidenceHit[],
  request: CitationVerificationRequest,
): CitationClaimResult => {
  const fallbackEvidenceIds = request.candidateEvidenceIds || [];
  const candidates = candidateHitsForClaim(claimText, evidenceHits, fallbackEvidenceIds);
  const citedEvidenceIds = Array.from(new Set([
    ...extractCitedEvidenceIds(claimText),
    ...(fallbackEvidenceIds.length ? fallbackEvidenceIds : candidates.map((hit) => hit.evidence_id || hit.item_id)),
  ])).filter(Boolean);

  if (!candidates.length) {
    return {
      claim_id: `claim_${stableHash(`${caseId}:${index}:${claimText}`)}`,
      claim_text: claimText,
      cited_evidence_ids: citedEvidenceIds,
      support_status: "not_enough_evidence",
      support_score: 0,
      matched_evidence_ids: [],
      verifier_mode: "deterministic",
      reason: "No retrieved evidence span could be mapped to this claim.",
      warnings: ["Claim has no verifiable supporting evidence."],
    };
  }

  const scored = candidates
    .map((hit) => {
      const atom = findVersionAtomForEvidence(request.versionValidity, {
        evidenceId: hit.evidence_id,
        textUnitId: hit.source_text_unit_id,
        sourceDocId: hit.source_doc_id,
      });
      const freshnessPenalty =
        atom?.version_state === "cancelled" || atom?.version_state === "superseded"
          ? 0.22
          : atom?.version_state === "historical"
            ? 0.12
            : 0;
      const contradictionPenalty =
        hit.contradiction_ids.length > 0 || atom?.version_state === "contradicted" ? 0.35 : 0;
      const exactPointerBonus = atom || hit.evidence_id ? 0.12 : 0;
      return {
        hit,
        score: Math.max(0, tokenOverlap(claimText, hit.snippet) + exactPointerBonus - freshnessPenalty - contradictionPenalty - predicateCoveragePenalty(claimText, hit.snippet)),
        atom,
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  const supportStatus: CitationSupportStatus =
    scored.some((entry) => entry.hit.contradiction_ids.length > 0 || entry.atom?.version_state === "contradicted")
      ? "contradicted"
      : best.score >= 0.42
        ? "supported"
        : best.score >= 0.32
          ? "partial"
          : "unsupported";

  return {
    claim_id: `claim_${stableHash(`${caseId}:${index}:${claimText}`)}`,
    claim_text: claimText,
    cited_evidence_ids: citedEvidenceIds,
    support_status: supportStatus,
    support_score: Number(best.score.toFixed(4)),
    matched_evidence_ids: scored
      .filter((entry) => entry.score >= 0.18)
      .map((entry) => entry.hit.evidence_id || entry.hit.item_id),
    verifier_mode: "deterministic",
    reason:
      supportStatus === "supported"
        ? "Claim has lexical support from exact retrieved evidence."
        : supportStatus === "partial"
          ? "Claim has partial overlap with retrieved evidence and should remain caveated."
          : supportStatus === "contradicted"
            ? "Claim maps to evidence with contradiction or invalidity markers."
            : "Claim does not have enough lexical support from the cited evidence.",
    warnings: [
      ...(best.atom && best.atom.version_state !== "current" ? [`Best evidence is ${best.atom.version_state}.`] : []),
      ...(supportStatus === "unsupported" ? ["Unsupported claim should be removed or marked insufficient."] : []),
    ],
  };
};

const shouldUseOllamaVerifier = (): boolean => {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return env?.TEVEL_VERICITE_USE_OLLAMA === "true";
};

export const verifyAnswerCitations = async (request: CitationVerificationRequest): Promise<CitationVerificationRun> => {
  const evidenceHits = dedupeHits(allHits(request.retrievalArtifacts));
  const claims = claimSentences(request.answerText);
  const claimResults = claims.map((claim, index) =>
    verifyClaimDeterministically(request.caseId, claim, index, evidenceHits, request),
  );

  const supported = claimResults.filter((result) => result.support_status === "supported").length;
  const run: CitationVerificationRun = {
    run_id: `vericite_${stableHash(`${request.caseId}:${request.answerId || ""}:${request.answerText}`)}`,
    case_id: request.caseId,
    answer_id: request.answerId,
    generated_at: new Date().toISOString(),
    claim_results: claimResults.map((result) => ({
      ...result,
      verifier_mode: shouldUseOllamaVerifier() ? "ollama" : result.verifier_mode,
    })),
    overall_status: overallStatus(claimResults),
    supported_claim_rate: claimResults.length ? Number((supported / claimResults.length).toFixed(4)) : 0,
    warnings: [
      ...(evidenceHits.length ? [] : ["No retrieval evidence was available for citation verification."]),
      ...(claimResults.some((result) => statusRank[result.support_status] <= statusRank.unsupported)
        ? ["One or more claims failed citation support verification."]
        : []),
    ],
  };

  await persistCitationVerificationRun(run);
  return run;
};

const statusForBundle = (run: CitationVerificationRun, evidenceIds: string[]): CitationSupportStatus | undefined => {
  const related = run.claim_results.filter((claim) =>
    claim.cited_evidence_ids.some((evidenceId) => evidenceIds.includes(evidenceId)),
  );
  return related.length ? overallStatus(related) : undefined;
};

export const verifyRetrievalArtifacts = async (request: CitationVerificationRequest): Promise<{
  run: CitationVerificationRun;
  retrievalArtifacts?: RetrievalArtifacts;
}> => {
  const run = await verifyAnswerCitations(request);
  if (!request.retrievalArtifacts) return { run };

  const bundles = Object.fromEntries(
    Object.entries(request.retrievalArtifacts.bundles).map(([key, bundle]) => {
      const citationStatus = statusForBundle(run, bundle.cited_evidence_ids);
      return [
        key,
        {
          ...bundle,
          citation_status: citationStatus,
          hits: bundle.hits.map((hit) => ({
            ...hit,
            citation_status: hit.evidence_id && bundle.cited_evidence_ids.includes(hit.evidence_id)
              ? citationStatus
              : hit.citation_status,
          })),
        },
      ];
    }),
  );

  return {
    run,
    retrievalArtifacts: {
      ...request.retrievalArtifacts,
      bundles,
    },
  };
};

export const refineAnswerWithCitationVerification = (answerText: string, run: CitationVerificationRun): string => {
  const blocked = new Set(
    run.claim_results
      .filter((result) => result.support_status === "unsupported" || result.support_status === "contradicted")
      .map((result) => result.claim_text),
  );
  const retained = claimSentences(answerText).filter((sentence) => !blocked.has(sentence));
  const base = retained.length ? retained.join(" ") : answerText;
  if (run.overall_status === "supported") return base;
  return [
    base,
    "",
    `Citation verification: ${run.overall_status.replace(/_/g, " ")} (${Math.round(run.supported_claim_rate * 100)}% supported claims).`,
  ].join("\n");
};
