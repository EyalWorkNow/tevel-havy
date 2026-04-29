import { SidecarExtractionPayload, SourceDocumentMetadata, SourceParserInfo } from "./sidecar/types";
import {
  CaseMapResponse,
  LocationMentionInput,
  LocationResolutionResponse,
  ResolvedLocationRecord,
} from "./sidecar/location/types";
import {
  KnowledgeEnrichmentRequest,
  KnowledgeEnrichmentResult,
  ReferenceKnowledgeProfile,
} from "./sidecar/knowledge/contracts";
import {
  EntityIntelligenceCaseResult,
  EntityIntelligenceDebugReport,
} from "./sidecar/entityIntelligence/types";
import { PersonDossier, PersonExtractionResponse, PersonResolutionResponse } from "./sidecar/person/types";
import { VersionValidityReport } from "./sidecar/versionValidity/contracts";
import { CitationVerificationRun } from "./sidecar/citationVerification/contracts";
import { RetrievalArtifacts } from "./sidecar/retrieval";

type ParseUploadResponse = {
  raw_content: string;
  source_input_content?: string;
  source_parser?: SourceParserInfo;
  metadata?: SourceDocumentMetadata;
};

export type GeocodeCandidate = {
  place_name_raw: string;
  normalized_place_name: string;
  latitude: number | null;
  longitude: number | null;
  geocoder_source: string;
  geocoder_confidence: number;
  matched_address_label: string;
};

type GeocodeResponse = {
  place_name_raw: string;
  candidates: GeocodeCandidate[];
  accepted_candidate: GeocodeCandidate | null;
};

const SIDE_CAR_PREFIX = "/api/sidecar";
const SIDE_CAR_TIMEOUT_MS = 60000;
const SIDE_CAR_PARSE_TIMEOUT_MS = 60000;
const SIDE_CAR_HEAVY_PARSE_TIMEOUT_MS = 300000;
const SIDE_CAR_PERSON_TIMEOUT_MS = 60000;
const SIDE_CAR_SMART_EXTRACT_BASE_TIMEOUT_MS = 1800000;
const SIDE_CAR_SMART_EXTRACT_MAX_TIMEOUT_MS = 1800000;
const SIDE_CAR_PERSON_EXTRACT_BASE_TIMEOUT_MS = 1800000;
const SIDE_CAR_PERSON_EXTRACT_MAX_TIMEOUT_MS = 1800000;
const SIDE_CAR_AVAILABILITY_CACHE_TTL_MS = 5000;

let availabilityPromise: Promise<boolean> | null = null;
let availabilityCheckedAt = 0;
let availabilityValue: boolean | null = null;

export const __resetSidecarAvailabilityCacheForTests = (): void => {
  availabilityPromise = null;
  availabilityCheckedAt = 0;
  availabilityValue = null;
};

const createSidecarTimeoutError = (label: string, timeoutMs: number): Error => {
  const error = new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s while waiting for ${label}`);
  error.name = "SidecarTimeoutError";
  return error;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const estimateTextAwareTimeoutMs = (
  text: string,
  options: {
    baseMs: number;
    charsPerStep: number;
    msPerStep: number;
    maxMs: number;
  },
): number => {
  const length = text.trim().length;
  if (!length) return options.baseMs;
  const steps = Math.ceil(length / options.charsPerStep);
  return clamp(options.baseMs + steps * options.msPerStep, options.baseMs, options.maxMs);
};

const estimateSmartExtractTimeoutMs = (rawContent: string): number =>
  estimateTextAwareTimeoutMs(rawContent, {
    baseMs: SIDE_CAR_SMART_EXTRACT_BASE_TIMEOUT_MS,
    charsPerStep: 2200,
    msPerStep: 500,
    maxMs: SIDE_CAR_SMART_EXTRACT_MAX_TIMEOUT_MS,
  });

const estimatePersonExtractTimeoutMs = (rawText: string): number =>
  estimateTextAwareTimeoutMs(rawText, {
    baseMs: SIDE_CAR_PERSON_EXTRACT_BASE_TIMEOUT_MS,
    charsPerStep: 2400,
    msPerStep: 450,
    maxMs: SIDE_CAR_PERSON_EXTRACT_MAX_TIMEOUT_MS,
  });

export const __estimateSmartExtractTimeoutMsForTests = estimateSmartExtractTimeoutMs;
export const __estimatePersonExtractTimeoutMsForTests = estimatePersonExtractTimeoutMs;

const describeSidecarError = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

const withTimeout = async <T,>(
  label: string,
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutError = createSidecarTimeoutError(label, timeoutMs);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) {
        throw reason;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw timeoutError;
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const postJson = async <T,>(path: string, payload: unknown, timeoutMs: number): Promise<T> =>
  withTimeout(path, async (signal) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Sidecar request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }, timeoutMs);

const fileToBase64 = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to convert file to base64"));
        return;
      }

      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

const isHeavyDocumentParse = (file: File): boolean => {
  const lowerName = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".pptx") ||
    lowerName.endsWith(".xlsx")
  );
};

export const isLocalSidecarAvailable = async (): Promise<boolean> => {
  const now = Date.now();
  if (availabilityValue === true) {
    return true;
  }
  if (availabilityValue === false && now - availabilityCheckedAt < SIDE_CAR_AVAILABILITY_CACHE_TTL_MS) {
    return false;
  }

  if (!availabilityPromise) {
    availabilityPromise = withTimeout(`${SIDE_CAR_PREFIX}/health`, async (signal) => {
      const response = await fetch(`${SIDE_CAR_PREFIX}/health`, { signal });
      return response.ok;
    }, 1200)
      .catch(() => false)
      .then((value) => {
        availabilityValue = value;
        availabilityCheckedAt = Date.now();
        return value;
      })
      .finally(() => {
        availabilityPromise = null;
      });
  }

  return availabilityPromise;
};

export const parseUploadedFileWithSidecar = async (
  file: File,
  metadata?: SourceDocumentMetadata,
): Promise<ParseUploadResponse | null> => {
  if (!(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    const base64 = await fileToBase64(file);
    return await postJson<ParseUploadResponse>(
      `${SIDE_CAR_PREFIX}/parse-upload`,
      {
        filename: file.name,
        mimeType: file.type,
        base64,
        metadata,
      },
      isHeavyDocumentParse(file) ? SIDE_CAR_HEAVY_PARSE_TIMEOUT_MS : SIDE_CAR_PARSE_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Local sidecar parse failed, falling back to browser intake", describeSidecarError(error));
    return null;
  }
};

export const analyzeWithLocalSidecar = async (
  rawContent: string,
  metadata?: SourceDocumentMetadata,
): Promise<SidecarExtractionPayload | null> => {
  if (!rawContent.trim() || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await postJson<SidecarExtractionPayload>(
      `${SIDE_CAR_PREFIX}/smart-extract`,
      {
        sourceDocId: `browser_${Date.now()}`,
        rawContent,
        metadata,
      },
      estimateSmartExtractTimeoutMs(rawContent),
    );
  } catch (error) {
    console.warn("Local sidecar extraction failed, using browser fallback", describeSidecarError(error));
    return null;
  }
};

export const geocodePlaceWithSidecar = async (placeNameRaw: string): Promise<GeocodeResponse | null> => {
  if (!placeNameRaw.trim() || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await postJson<GeocodeResponse>(
      `${SIDE_CAR_PREFIX}/geocode`,
      { placeNameRaw },
      SIDE_CAR_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Local sidecar geocoding failed, skipping remote geocode", error);
    return null;
  }
};

export const resolveLocationsWithSidecar = async (
  caseId: string,
  mentions: LocationMentionInput[],
): Promise<LocationResolutionResponse | null> => {
  if (!mentions.length || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await postJson<LocationResolutionResponse>(
      "/api/locations/resolve",
      { caseId, mentions },
      SIDE_CAR_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Location resolution failed, using heuristic fallback", error);
    return null;
  }
};

export const getResolvedLocationById = async (locationId: string): Promise<ResolvedLocationRecord | null> => {
  if (!locationId || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await withTimeout(`/api/locations/${encodeURIComponent(locationId)}`, async (signal) => {
      const response = await fetch(`/api/locations/${encodeURIComponent(locationId)}`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Location lookup failed with status ${response.status}`);
      }
      return response.json() as Promise<ResolvedLocationRecord>;
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Location lookup failed", error);
    return null;
  }
};

export const getCaseMapWithSidecar = async (caseId: string): Promise<CaseMapResponse | null> => {
  if (!caseId || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/map`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/map`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Case map request failed with status ${response.status}`);
      }
      return response.json() as Promise<CaseMapResponse>;
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Case map request failed", error);
    return null;
  }
};

export const extractPersonsWithSidecar = async (payload: {
  caseId: string;
  documentId: string;
  rawText: string;
  chunks: Array<{ chunkId: string; text: string; page?: number }>;
  language?: string;
}): Promise<PersonExtractionResponse | null> => {
  if (!payload.rawText.trim() || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await postJson<PersonExtractionResponse>(
      "/api/persons/extract",
      payload,
      estimatePersonExtractTimeoutMs(payload.rawText),
    );
  } catch (error) {
    console.warn("Person extraction failed, using browser fallback", describeSidecarError(error));
    return null;
  }
};

export const resolvePersonsWithSidecar = async (
  caseId: string,
  extracted: PersonExtractionResponse,
): Promise<PersonResolutionResponse | null> => {
  if (!(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await postJson<PersonResolutionResponse>("/api/persons/resolve", { caseId, extracted }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Person resolution failed, using browser fallback", error);
    return null;
  }
};

export const getPersonWithSidecar = async (personId: string): Promise<import("./sidecar/person/types").PersonEntity | null> => {
  if (!personId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/persons/${encodeURIComponent(personId)}`, async (signal) => {
      const response = await fetch(`/api/persons/${encodeURIComponent(personId)}`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Person request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Person lookup failed", error);
    return null;
  }
};

export const getPersonDossierWithSidecar = async (personId: string): Promise<PersonDossier | null> => {
  if (!personId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/persons/${encodeURIComponent(personId)}/dossier`, async (signal) => {
      const response = await fetch(`/api/persons/${encodeURIComponent(personId)}/dossier`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Person dossier request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Person dossier lookup failed", error);
    return null;
  }
};

export const getCasePersonsWithSidecar = async (caseId: string): Promise<import("./sidecar/person/types").PersonEntity[] | null> => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/persons`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/persons`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Case persons request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Case persons lookup failed", error);
    return null;
  }
};

export const enrichKnowledgeWithSidecar = async (
  payload: KnowledgeEnrichmentRequest,
): Promise<KnowledgeEnrichmentResult | null> => {
  if (!payload.entities?.length || !(await isLocalSidecarAvailable())) {
    return null;
  }

  try {
    return await postJson<KnowledgeEnrichmentResult>("/api/knowledge/enrich", payload, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Reference knowledge enrichment failed, continuing without external knowledge", error);
    return null;
  }
};

export const getEntityReferenceWithSidecar = async (
  entityId: string,
): Promise<ReferenceKnowledgeProfile | null> => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/reference`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/reference`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity reference request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity reference lookup failed", error);
    return null;
  }
};

export const getCaseKnowledgeWithSidecar = async (
  caseId: string,
): Promise<KnowledgeEnrichmentResult | null> => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/knowledge`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/knowledge`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Case knowledge request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Case knowledge lookup failed", error);
    return null;
  }
};

export const runEntityIntelligenceWithSidecar = async (payload: {
  caseId: string;
  payload?: SidecarExtractionPayload;
  rawText?: string;
  documentId?: string;
  metadata?: SourceDocumentMetadata;
}): Promise<{ result: EntityIntelligenceCaseResult; debug_reports: Record<string, EntityIntelligenceDebugReport> } | null> => {
  if (!(await isLocalSidecarAvailable())) return null;
  if (!payload.payload && !payload.rawText?.trim()) return null;
  try {
    return await postJson<{ result: EntityIntelligenceCaseResult; debug_reports: Record<string, EntityIntelligenceDebugReport> }>(
      "/api/resolution/run",
      payload,
      SIDE_CAR_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Entity intelligence run failed", error);
    return null;
  }
};

export const runVersionValidityWithSidecar = async (payload: {
  caseId: string;
  payload: SidecarExtractionPayload;
}): Promise<VersionValidityReport | null> => {
  if (!payload.payload || !(await isLocalSidecarAvailable())) return null;
  try {
    return await postJson<VersionValidityReport>("/api/version-validity/run", payload, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Version validity run failed", error);
    return null;
  }
};

export const getVersionValidityWithSidecar = async (caseId: string): Promise<VersionValidityReport | null> => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/version-validity`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/version-validity`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Version validity request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Version validity lookup failed", error);
    return null;
  }
};

export const verifyCitationsWithSidecar = async (payload: {
  caseId: string;
  answerId?: string;
  answerText: string;
  retrievalArtifacts?: RetrievalArtifacts;
  versionValidity?: VersionValidityReport;
  candidateEvidenceIds?: string[];
}): Promise<CitationVerificationRun | null> => {
  if (!payload.answerText.trim() || !(await isLocalSidecarAvailable())) return null;
  try {
    return await postJson<CitationVerificationRun>("/api/citation/verify", payload, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Citation verification failed", error);
    return null;
  }
};

export const getCitationVerificationWithSidecar = async (caseId: string): Promise<CitationVerificationRun | null> => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/citation-verification`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/citation-verification`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Citation verification request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Citation verification lookup failed", error);
    return null;
  }
};

export const extractDocumentMentionsWithSidecar = async (payload: {
  caseId: string;
  documentId: string;
  rawText: string;
  metadata?: SourceDocumentMetadata;
}): Promise<{
  document_id: string;
  mentions: EntityIntelligenceCaseResult["mentions"];
  evidence_spans: EntityIntelligenceCaseResult["evidence_spans"];
  chunks: EntityIntelligenceCaseResult["document_chunks"];
} | null> => {
  if (!payload.rawText.trim() || !(await isLocalSidecarAvailable())) return null;
  try {
    return await postJson(`/documents/${encodeURIComponent(payload.documentId)}/extract-mentions`, payload, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Document mention extraction failed", error);
    return null;
  }
};

export const getEntityIntelligenceCaseWithSidecar = async (
  caseId: string,
): Promise<EntityIntelligenceCaseResult | null> => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/entity-intelligence`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/entity-intelligence`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Case entity intelligence request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Case entity intelligence lookup failed", error);
    return null;
  }
};

export const getCaseEntityGraphWithSidecar = async (caseId: string) => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/entity-graph`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/entity-graph`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Case entity graph request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Case entity graph lookup failed", error);
    return null;
  }
};

export const getAmbiguousMentionsWithSidecar = async (caseId: string) => {
  if (!caseId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/cases/${encodeURIComponent(caseId)}/ambiguous-mentions`, async (signal) => {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/ambiguous-mentions`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Ambiguous mentions request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Ambiguous mentions lookup failed", error);
    return null;
  }
};

export const getEntityWithSidecar = async (
  entityId: string,
): Promise<{ entity: EntityIntelligenceCaseResult["canonical_entities"][number] | null; profile: EntityIntelligenceCaseResult["entity_profiles"][string] | null } | null> => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity lookup failed", error);
    return null;
  }
};

export const getEntityTimelineWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/timeline`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/timeline`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity timeline request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity timeline lookup failed", error);
    return null;
  }
};

export const getEntityClaimsWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/claims`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/claims`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity claims request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity claims lookup failed", error);
    return null;
  }
};

export const getEntityMentionsWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/mentions`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/mentions`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity mentions request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity mentions lookup failed", error);
    return null;
  }
};

export const getEntityRelationsWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/relations`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/relations`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity relations request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity relations lookup failed", error);
    return null;
  }
};

export const getEntitySummaryWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/summary`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/summary`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity summary request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity summary lookup failed", error);
    return null;
  }
};

export const getEntityConflictsWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/conflicts`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/conflicts`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity conflicts request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity conflicts lookup failed", error);
    return null;
  }
};

export const getEntityCandidateDecisionsWithSidecar = async (entityId: string) => {
  if (!entityId || !(await isLocalSidecarAvailable())) return null;
  try {
    return await withTimeout(`/api/entities/${encodeURIComponent(entityId)}/candidate-decisions`, async (signal) => {
      const response = await fetch(`/api/entities/${encodeURIComponent(entityId)}/candidate-decisions`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Entity candidate decisions request failed with status ${response.status}`);
      return response.json();
    }, SIDE_CAR_TIMEOUT_MS);
  } catch (error) {
    console.warn("Entity candidate decisions lookup failed", error);
    return null;
  }
};

export const mergeEntityWithSidecar = async (payload: {
  caseId: string;
  targetEntityId: string;
  sourceEntityId: string;
  actor?: string;
}) => {
  if (!(await isLocalSidecarAvailable())) return null;
  try {
    return await postJson(
      `/api/entities/${encodeURIComponent(payload.targetEntityId)}/merge`,
      {
        caseId: payload.caseId,
        sourceEntityId: payload.sourceEntityId,
        actor: payload.actor,
      },
      SIDE_CAR_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Entity merge failed", error);
    return null;
  }
};

export const splitEntityWithSidecar = async (payload: {
  caseId: string;
  entityId: string;
  mentionIds: string[];
  actor?: string;
}) => {
  if (!(await isLocalSidecarAvailable())) return null;
  try {
    return await postJson(
      `/api/entities/${encodeURIComponent(payload.entityId)}/split`,
      {
        caseId: payload.caseId,
        mentionIds: payload.mentionIds,
        actor: payload.actor,
      },
      SIDE_CAR_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Entity split failed", error);
    return null;
  }
};

export const regenerateEntitySummaryWithSidecar = async (payload: {
  caseId: string;
  entityId: string;
}) => {
  if (!(await isLocalSidecarAvailable())) return null;
  try {
    return await postJson(
      `/api/entities/${encodeURIComponent(payload.entityId)}/regenerate-summary`,
      { caseId: payload.caseId },
      SIDE_CAR_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn("Entity summary regeneration failed", error);
    return null;
  }
};
