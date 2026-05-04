import type { Relation } from "../../../types";
import type { SidecarExtractionPayload } from "../types";
import type { StructuredSummaryPanel } from "./contracts";
import type { TemporalEventRecord } from "../temporal/contracts";
import {
  buildRetrievalArtifactsFromPayload,
  type RetrievalArtifacts,
  type RetrievalEvidenceBundle,
} from "../retrieval";

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const unique = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

const getCaseHits = (bundle: RetrievalEvidenceBundle) => bundle.hits.filter((hit) => !hit.reference_only);
const getReferenceHits = (bundle: RetrievalEvidenceBundle) => bundle.hits.filter((hit) => hit.reference_only);

const summarizeBundle = (bundle: RetrievalEvidenceBundle): string => {
  const caseHits = getCaseHits(bundle);
  if (caseHits.length === 0) {
    return bundle.warnings[0] || `No evidence bundle is currently available for ${bundle.title.toLowerCase()}.`;
  }

  const topSnippets = caseHits
    .slice(0, 3)
    .map((hit) => hit.snippet)
    .filter(Boolean);

  if (bundle.kind === "case_brief") {
    return [
      `${caseHits.length} evidence-backed events and findings were retrieved for the active case scope.`,
      topSnippets.slice(0, 2).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (bundle.kind === "timeline_summary") {
    return topSnippets.join(" ");
  }

  if (bundle.kind === "contradiction_summary") {
    return bundle.contradictions.length > 0
      ? `${bundle.contradictions.join(" ")} ${topSnippets[0] || ""}`.trim()
      : "No explicit contradiction cluster was preserved in the current evidence pack.";
  }

  if (bundle.kind === "update_summary") {
    return [
      "Most recent evidence slice:",
      topSnippets[0] || "No recent update evidence is currently available.",
    ].join(" ");
  }

  if (bundle.kind === "relationship_brief") {
    return [
      "Cross-entity relationship evidence highlights:",
      topSnippets.slice(0, 2).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return topSnippets.join(" ");
};

const keyFindingsFromBundle = (bundle: RetrievalEvidenceBundle): string[] => {
  const caseHits = getCaseHits(bundle);
  if (bundle.contradictions.length > 0 && bundle.kind === "contradiction_summary") {
    return bundle.contradictions.slice(0, 5);
  }

  return unique(
    caseHits.slice(0, 5).map((hit) => {
      if (hit.item_type === "event" || hit.item_type === "relation" || hit.item_type === "claim") {
        return hit.snippet;
      }
      if (hit.related_entities.length > 0) {
        return hit.related_entities.slice(0, 2).join(" / ");
      }
      return hit.snippet;
    }),
  ).slice(0, 5);
};

const buildReferenceContext = (bundle: RetrievalEvidenceBundle): StructuredSummaryPanel["reference_context"] | undefined => {
  const referenceHits = getReferenceHits(bundle);
  if (!referenceHits.length) return undefined;

  return {
    summary_text: unique(referenceHits.slice(0, 2).map((hit) => hit.snippet)).join(" "),
    source_labels: unique(referenceHits.map((hit) => hit.source_namespace || "reference")),
    external_reference_ids: unique(referenceHits.flatMap((hit) => hit.external_reference_ids || [])),
  };
};

const bundleToPanel = (bundle: RetrievalEvidenceBundle): StructuredSummaryPanel => ({
  summary_id: `summary_${bundle.kind}_${stableHash(bundle.bundle_id)}`,
  kind: bundle.kind,
  title: bundle.title,
  summary_text: summarizeBundle(bundle),
  key_findings: keyFindingsFromBundle(bundle),
  cited_evidence_ids: bundle.cited_evidence_ids,
  version_state: bundle.version_state,
  validity_score: bundle.validity_score,
  citation_status: bundle.citation_status,
  confidence: bundle.confidence,
  evidence_clusters: bundle.evidence_clusters,
  analytical_synthesis: bundle.analytical_synthesis,
  bottom_line: bundle.bottom_line,
  uncertainty_notes: bundle.warnings,
  contradictions: bundle.contradictions,
  related_entities: bundle.related_entities,
  related_events: bundle.related_events,
  timeline_slice: {
    start: bundle.temporal_window?.start,
    end: bundle.temporal_window?.end,
    event_ids: bundle.related_events,
  },
  retrieval_bundle_id: bundle.bundle_id,
  retrieval_query: bundle.query,
  reference_context: buildReferenceContext(bundle),
});

export const buildSummaryPanelsFromRetrievalArtifacts = (
  retrievalArtifacts: RetrievalArtifacts,
): Record<string, StructuredSummaryPanel> =>
  Object.fromEntries(
    Object.entries(retrievalArtifacts.bundles).map(([key, bundle]) => [key, bundleToPanel(bundle)]),
  );

export const buildSummaryPanelsFromPayload = (
  payload: SidecarExtractionPayload,
  eventRecords: TemporalEventRecord[],
  relations: Relation[],
  resolveEntityName: (entityId: string) => string,
  referenceKnowledge?: import("../knowledge/contracts").ReferenceKnowledgeProfile[] | Record<string, import("../knowledge/contracts").ReferenceKnowledgeProfile>,
): Record<string, StructuredSummaryPanel> => {
  const normalizedReferenceKnowledge = Array.isArray(referenceKnowledge)
    ? Object.fromEntries(referenceKnowledge.map((profile) => [profile.entity_id, profile]))
    : referenceKnowledge;
  const retrievalArtifacts = buildRetrievalArtifactsFromPayload(
    payload,
    eventRecords,
    relations,
    resolveEntityName,
    normalizedReferenceKnowledge,
  );
  return buildSummaryPanelsFromRetrievalArtifacts(retrievalArtifacts);
};
