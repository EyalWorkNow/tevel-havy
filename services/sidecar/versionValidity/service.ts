import type {
  CandidateMetadataValue,
  EvidenceSpan,
  SidecarExtractionPayload,
  SidecarTextUnit,
} from "../types";
import {
  getVersionValidityReport,
  persistVersionValidityReport,
} from "./store";
import type {
  DocumentVersionRecord,
  EvidenceAtom,
  VersionDocumentRecord,
  VersionEdge,
  VersionEdgeType,
  VersionValidityBuildInput,
  VersionValidityReport,
  VersionValidityState,
} from "./contracts";

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

const metadataValue = (value: CandidateMetadataValue | undefined): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numericMetadataValue = (value: CandidateMetadataValue | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const collectMetadata = (payload: SidecarExtractionPayload): Record<string, CandidateMetadataValue> => ({
  ...(payload.text_units?.[0]?.metadata || {}),
  ...(payload.source_parser?.source_uri ? { source_uri: payload.source_parser.source_uri } : {}),
  ...(payload.source_parser?.source_filename ? { source_filename: payload.source_parser.source_filename } : {}),
  ...(payload.source_parser?.title ? { title: payload.source_parser.title } : {}),
  ...(payload.source_parser?.source_mime_type ? { source_type: payload.source_parser.source_mime_type } : {}),
});

export const deriveDocumentIdentity = (payload: SidecarExtractionPayload): string => {
  const metadata = collectMetadata(payload);
  const explicitDocumentId = metadataValue(metadata.document_id);
  if (explicitDocumentId) return explicitDocumentId;

  const sourceUri = metadataValue(metadata.source_uri) || payload.source_parser?.source_uri;
  if (sourceUri) return sourceUri;

  const filename = metadataValue(metadata.source_filename) || payload.source_parser?.source_filename;
  const title = metadataValue(metadata.title) || payload.source_parser?.title;
  if (filename || title) return [filename, title].filter(Boolean).join("::");

  return payload.source_doc_id;
};

export const deriveVersionLabel = (payload: SidecarExtractionPayload): string => {
  const metadata = collectMetadata(payload);
  return (
    metadataValue(metadata.version_label) ||
    payload.source_parser?.published_at ||
    payload.generated_at?.slice(0, 10) ||
    "v1"
  );
};

const deriveEffectiveDate = (payload: SidecarExtractionPayload): string | undefined => {
  const metadata = collectMetadata(payload);
  return (
    metadataValue(metadata.effective_date) ||
    payload.source_parser?.published_at ||
    payload.generated_at?.slice(0, 10)
  );
};

const deriveSourceTrust = (payload: SidecarExtractionPayload): number => {
  const metadata = collectMetadata(payload);
  const numericTrust = numericMetadataValue(metadata.source_trust) ?? numericMetadataValue(metadata.source_reliability);
  if (typeof numericTrust === "number") return Math.max(0.1, Math.min(1, numericTrust));

  const authority = metadataValue(metadata.authority_level)?.toLowerCase();
  if (!authority) return 0.68;
  if (/(official|authoritative|primary|high|רשמי|מוסמך)/i.test(authority)) return 0.92;
  if (/(draft|unverified|low|טיוטה|לא מאומת)/i.test(authority)) return 0.42;
  return 0.68;
};

const extractEvidenceIdsByTextUnit = (payload: SidecarExtractionPayload): Map<string, string> => {
  const map = new Map<string, string>();
  const addEvidence = (evidence?: EvidenceSpan) => {
    if (evidence?.source_text_unit_id && evidence.evidence_id && !map.has(evidence.source_text_unit_id)) {
      map.set(evidence.source_text_unit_id, evidence.evidence_id);
    }
  };
  payload.mentions.forEach((item) => addEvidence(item.evidence));
  payload.relation_candidates.forEach((item) => addEvidence(item.evidence));
  payload.event_candidates.forEach((item) => addEvidence(item.evidence));
  payload.claim_candidates.forEach((item) => addEvidence(item.evidence));
  payload.candidates.forEach((item) => addEvidence(item.evidence));
  return map;
};

const extractEntityAnchorsByTextUnit = (payload: SidecarExtractionPayload): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  payload.entities.forEach((entity) => {
    (entity.source_text_unit_ids || []).forEach((textUnitId) => {
      map.set(textUnitId, Array.from(new Set([...(map.get(textUnitId) || []), entity.canonical_name, ...entity.aliases])));
    });
  });
  payload.mentions.forEach((mention) => {
    map.set(
      mention.source_text_unit_id,
      Array.from(new Set([...(map.get(mention.source_text_unit_id) || []), mention.mention_text])),
    );
  });
  return map;
};

const extractTimeAnchors = (text: string): string[] => {
  const matches = [
    ...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g),
    ...text.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g),
    ...text.matchAll(/\b(?:19|20)\d{2}\b/g),
  ];
  return Array.from(new Set(matches.map((match) => match[0])));
};

const deriveTaskFamily = (unit: SidecarTextUnit): string => {
  const text = normalize(unit.text);
  if (/(price|cost|budget|fund|payment|כסף|תקציב|תשלום)/i.test(text)) return "financial";
  if (/(date|deadline|timeline|before|after|תאריך|לפני|אחרי)/i.test(text)) return "temporal";
  if (/(rule|policy|procedure|must|shall|מדיניות|נוהל|חייב)/i.test(text)) return "policy";
  if (/(risk|warning|threat|conflict|סתירה|איום|סיכון)/i.test(text)) return "risk";
  return "general";
};

const cuePatterns: Array<{ type: VersionEdgeType; pattern: RegExp; reason: string }> = [
  { type: "supersedes", pattern: /\b(?:supersedes|superseded by|overrides)\b|מחליף|מחליפה|גובר על/i, reason: "Explicit supersession cue detected." },
  { type: "replaces", pattern: /\b(?:replaces|replacement for)\b|מחליף את|במקום/i, reason: "Explicit replacement cue detected." },
  { type: "amends", pattern: /\b(?:amends|amended|updates|modifies)\b|מתקן|מתקנת|מעדכן|מעדכנת/i, reason: "Explicit amendment cue detected." },
  { type: "cancels", pattern: /\b(?:cancels|cancelled|revokes|withdraws|voids)\b|מבטל|מבוטל|בוטל/i, reason: "Explicit cancellation cue detected." },
  { type: "contradicts", pattern: /\b(?:contradicts|conflicts with|inconsistent with)\b|סותר|סתירה|מתנגש/i, reason: "Explicit contradiction cue detected." },
  { type: "confirms", pattern: /\b(?:confirms|reaffirms|validates)\b|מאשר|מאשרת|מתקף/i, reason: "Explicit confirmation cue detected." },
];

const buildVersionEdgeFromCue = (
  atom: EvidenceAtom,
  currentVersionId: string,
  cue: { type: VersionEdgeType; reason: string },
): VersionEdge => ({
  edge_id: `vedge_${stableHash(`${currentVersionId}:${atom.atom_id}:${cue.type}`)}`,
  source_version_id: currentVersionId,
  source_atom_id: atom.atom_id,
  edge_type: cue.type,
  confidence: cue.type === "contradicts" ? 0.74 : 0.68,
  evidence_text: atom.text.slice(0, 500),
  reason: cue.reason,
  detected_from: "explicit_cue",
  created_at: atom.created_at,
});

const stateForEdgeType = (edgeType: VersionEdgeType): VersionValidityState =>
  edgeType === "cancels"
    ? "cancelled"
    : edgeType === "amends"
      ? "amended"
      : edgeType === "supersedes" || edgeType === "replaces"
        ? "superseded"
        : edgeType === "contradicts"
          ? "contradicted"
          : "current";

const scoreForState = (state: VersionValidityState, sourceTrust: number): number => {
  const base =
    state === "current"
      ? 0.9
      : state === "amended"
        ? 0.68
        : state === "historical"
          ? 0.52
          : state === "superseded"
            ? 0.3
            : state === "cancelled"
              ? 0.18
              : state === "contradicted"
                ? 0.24
                : 0.5;
  return Number(Math.max(0.05, Math.min(1, base * 0.72 + sourceTrust * 0.28)).toFixed(4));
};

const buildAtoms = (
  payload: SidecarExtractionPayload,
  documentIdentity: string,
  versionId: string,
  sourceTrust: number,
  createdAt: string,
): EvidenceAtom[] => {
  const evidenceIdsByTextUnit = extractEvidenceIdsByTextUnit(payload);
  const entityAnchorsByTextUnit = extractEntityAnchorsByTextUnit(payload);
  return payload.text_units.map((unit) => ({
    atom_id: `atom_${stableHash(`${versionId}:${unit.text_unit_id}:${unit.stable_hash}`)}`,
    document_identity: documentIdentity,
    version_id: versionId,
    source_doc_id: payload.source_doc_id,
    source_text_unit_id: unit.text_unit_id,
    evidence_id: evidenceIdsByTextUnit.get(unit.text_unit_id),
    exact_pointer: {
      source_doc_id: payload.source_doc_id,
      source_text_unit_id: unit.text_unit_id,
      raw_start: unit.raw_start,
      raw_end: unit.raw_end,
      normalized_start: unit.normalized_start,
      normalized_end: unit.normalized_end,
    },
    text: unit.raw_text || unit.text,
    text_hash: stableHash(normalize(unit.text || unit.raw_text)),
    entity_anchors: entityAnchorsByTextUnit.get(unit.text_unit_id) || [],
    time_anchors: extractTimeAnchors(unit.text),
    source_trust: sourceTrust,
    task_family: deriveTaskFamily(unit),
    version_state: "current",
    validity_score: scoreForState("current", sourceTrust),
    version_edge_ids: [],
    created_at: createdAt,
  }));
};

const applyExplicitCueEdges = (atoms: EvidenceAtom[], currentVersionId: string): { atoms: EvidenceAtom[]; edges: VersionEdge[] } => {
  const edges: VersionEdge[] = [];
  const nextAtoms = atoms.map((atom) => {
    const cue = cuePatterns.find((candidate) => candidate.pattern.test(atom.text));
    if (!cue) return atom;
    const edge = buildVersionEdgeFromCue(atom, currentVersionId, cue);
    edges.push(edge);
    const state = stateForEdgeType(cue.type);
    return {
      ...atom,
      version_state: state,
      validity_score: scoreForState(state, atom.source_trust),
      version_edge_ids: [edge.edge_id],
    };
  });
  return { atoms: nextAtoms, edges };
};

const applyDiffEdges = (
  currentAtoms: EvidenceAtom[],
  previousReport: VersionValidityReport | null | undefined,
  currentVersionId: string,
): { atoms: EvidenceAtom[]; historicalAtoms: EvidenceAtom[]; edges: VersionEdge[] } => {
  if (!previousReport || previousReport.current_version_id === currentVersionId) {
    return { atoms: currentAtoms, historicalAtoms: [], edges: [] };
  }

  const currentHashes = new Set(currentAtoms.map((atom) => atom.text_hash));
  const previousAtoms = previousReport.atoms.filter((atom) => atom.document_identity === currentAtoms[0]?.document_identity);
  const historicalAtoms: EvidenceAtom[] = [];
  const edges: VersionEdge[] = [];

  previousAtoms.forEach((atom) => {
    if (currentHashes.has(atom.text_hash)) return;
    const edge: VersionEdge = {
      edge_id: `vedge_${stableHash(`${currentVersionId}:${atom.atom_id}:diff`)}`,
      source_version_id: currentVersionId,
      target_version_id: atom.version_id,
      target_atom_id: atom.atom_id,
      edge_type: "replaces",
      confidence: 0.58,
      evidence_text: atom.text.slice(0, 500),
      reason: "Atom was present in the previous version but absent from the current version.",
      detected_from: "diff",
      created_at: new Date().toISOString(),
    };
    edges.push(edge);
    historicalAtoms.push({
      ...atom,
      version_state: atom.version_state === "contradicted" ? "contradicted" : "historical",
      validity_score: scoreForState("historical", atom.source_trust),
      version_edge_ids: Array.from(new Set([...(atom.version_edge_ids || []), edge.edge_id])),
    });
  });

  return { atoms: currentAtoms, historicalAtoms, edges };
};

const deriveMetrics = (atoms: EvidenceAtom[], edges: VersionEdge[]) => {
  const average =
    atoms.length === 0 ? 0 : atoms.reduce((sum, atom) => sum + atom.validity_score, 0) / atoms.length;
  return {
    atom_count: atoms.length,
    current_atom_count: atoms.filter((atom) => atom.version_state === "current").length,
    historical_atom_count: atoms.filter((atom) => atom.version_state === "historical").length,
    edge_count: edges.length,
    contradicted_atom_count: atoms.filter((atom) => atom.version_state === "contradicted").length,
    average_validity_score: Number(average.toFixed(4)),
  };
};

export const buildVersionValidityReport = (input: VersionValidityBuildInput): VersionValidityReport => {
  const generatedAt = new Date().toISOString();
  const metadata = collectMetadata(input.payload);
  const documentIdentity = deriveDocumentIdentity(input.payload);
  const versionLabel = deriveVersionLabel(input.payload);
  const currentVersionId = `version_${stableHash(`${documentIdentity}:${versionLabel}:${input.payload.source_doc_id}`)}`;
  const sourceTrust = deriveSourceTrust(input.payload);
  const document: VersionDocumentRecord = {
    document_identity: documentIdentity,
    source_doc_id: input.payload.source_doc_id,
    title: metadataValue(metadata.title) || input.payload.source_parser?.title,
    source_uri: metadataValue(metadata.source_uri) || input.payload.source_parser?.source_uri,
    source_filename: metadataValue(metadata.source_filename) || input.payload.source_parser?.source_filename,
    source_type: metadataValue(metadata.source_type) || input.payload.source_parser?.source_mime_type,
    metadata,
  };
  const version: DocumentVersionRecord = {
    version_id: currentVersionId,
    document_identity: documentIdentity,
    source_doc_id: input.payload.source_doc_id,
    version_label: versionLabel,
    effective_date: deriveEffectiveDate(input.payload),
    created_at: generatedAt,
    text_hash: stableHash(normalize(input.payload.normalized_text || input.payload.raw_text)),
    text_unit_count: input.payload.text_units.length,
  };

  const cueResult = applyExplicitCueEdges(
    buildAtoms(input.payload, documentIdentity, currentVersionId, sourceTrust, generatedAt),
    currentVersionId,
  );
  const diffResult = applyDiffEdges(cueResult.atoms, input.previousReport, currentVersionId);
  const atoms = [...diffResult.atoms, ...diffResult.historicalAtoms];
  const edges = [...cueResult.edges, ...diffResult.edges];
  const versions = [
    ...(input.previousReport?.document_identity === documentIdentity ? input.previousReport.versions : []),
    version,
  ].filter((candidate, index, list) => list.findIndex((item) => item.version_id === candidate.version_id) === index);

  const warnings = [
    ...(input.previousReport && input.previousReport.document_identity === documentIdentity ? [] : ["No previous version baseline was available for this document identity."]),
    ...(edges.some((edge) => edge.edge_type === "contradicts") ? ["Explicit contradiction cues were detected in version evidence."] : []),
  ];

  return {
    case_id: input.caseId,
    document_identity: documentIdentity,
    generated_at: generatedAt,
    current_version_id: currentVersionId,
    documents: [document],
    versions,
    atoms,
    edges,
    metrics: deriveMetrics(atoms, edges),
    warnings,
  };
};

export const runVersionValidityEngine = async (input: Omit<VersionValidityBuildInput, "previousReport">): Promise<VersionValidityReport> => {
  const previousReport = await getVersionValidityReport(input.caseId);
  const report = buildVersionValidityReport({ ...input, previousReport });
  await persistVersionValidityReport(report);
  return report;
};

export const findVersionAtomForEvidence = (
  report: VersionValidityReport | undefined | null,
  params: { evidenceId?: string; textUnitId?: string; sourceDocId?: string },
): EvidenceAtom | undefined => {
  if (!report) return undefined;
  return report.atoms.find((atom) => {
    if (params.evidenceId && atom.evidence_id === params.evidenceId) return true;
    if (params.textUnitId && atom.source_text_unit_id === params.textUnitId) return true;
    return Boolean(params.sourceDocId && atom.source_doc_id === params.sourceDocId && !params.textUnitId && !params.evidenceId);
  });
};
