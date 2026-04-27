import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Connect, Plugin } from "vite";

import { parseSourceInput } from "./services/sidecar/parsers";
import { runSmartExtractionPipeline } from "./services/sidecar/smartPipeline";
import { resolveLocationMentions } from "./services/sidecar/location/resolver";
import { getCaseMapResponse, getResolvedLocationById, persistResolvedLocations } from "./services/sidecar/location/store";
import { LocationMentionInput } from "./services/sidecar/location/types";
import { extractPersons, resolvePersons } from "./services/sidecar/person/resolver";
import { getCasePersons, getPersonDossier, getPersonEntity, persistPersonDossier, persistPersonExtraction, persistPersonResolution } from "./services/sidecar/person/store";
import { enrichKnowledgeForCase } from "./services/sidecar/knowledge/service";
import { getCaseKnowledge, getEntityReference } from "./services/sidecar/knowledge/store";
import { KnowledgeEnrichmentRequest } from "./services/sidecar/knowledge/contracts";
import { SourceDocumentMetadata } from "./services/sidecar/types";
import { buildEntityIntelligenceCase, regenerateEntitySummary } from "./services/sidecar/entityIntelligence/service";
import {
  getAmbiguousMentions,
  getCaseEntityGraph,
  getEntityCandidateDecisions,
  getEntityById,
  getEntityClaims,
  getEntityConflicts,
  getEntityDebugReport,
  getEntityIntelligenceCase,
  getEntityMentions,
  getEntityProfile,
  getEntityRelations,
  getEntitySummary,
  getEntityTimeline,
  mergeEntityRecords,
  splitEntityRecord,
} from "./services/sidecar/entityIntelligence/store";
import { SidecarExtractionPayload } from "./services/sidecar/types";

type JsonHandler = (payload: any) => Promise<unknown> | unknown;

const SIDE_CAR_PREFIX = "/api/sidecar";

const sendJson = (res: any, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
};

const readJsonBody = (req: any): Promise<any> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const normalizeFilename = (filename: string): string =>
  filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.bin";

const withTempFile = async <T,>(filename: string, content: Buffer, callback: (filePath: string) => Promise<T>): Promise<T> => {
  const tempDir = path.join(os.tmpdir(), "tevel-sidecar");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${Date.now()}_${normalizeFilename(filename)}`);
  fs.writeFileSync(tempPath, content);
  try {
    return await callback(tempPath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore temp cleanup failures
    }
  }
};

const normalizePlaceName = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenOverlap = (a: string, b: string): number => {
  const left = new Set(normalizePlaceName(a).split(" ").filter(Boolean));
  const right = new Set(normalizePlaceName(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  return overlap / Math.max(left.size, right.size);
};

const buildGeocodeQueries = (placeNameRaw: string): string[] => {
  const variants = new Set<string>();
  const trimmed = placeNameRaw.trim();
  if (!trimmed) return [];

  variants.add(trimmed);

  trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .forEach((part) => variants.add(part));

  const connectorMatches = trimmed.match(/\b(?:in|at|near)\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})/g) || [];
  connectorMatches.forEach((match) => {
    const simplified = match.replace(/\b(?:in|at|near)\s+/i, "").trim();
    if (simplified.length >= 3) variants.add(simplified);
  });

  const tailWords = trimmed.split(/\s+/).filter(Boolean);
  for (let size = 3; size >= 1; size -= 1) {
    if (tailWords.length >= size) {
      const candidate = tailWords.slice(-size).join(" ").trim();
      if (candidate.length >= 3) variants.add(candidate);
    }
  }

  return Array.from(variants);
};

const handleGeocode: JsonHandler = async (payload) => {
  const placeNameRaw = typeof payload.placeNameRaw === "string" ? payload.placeNameRaw.trim() : "";
  if (!placeNameRaw) {
    throw new Error("Missing place name");
  }

  const candidateMap = new Map<string, {
    place_name_raw: string;
    normalized_place_name: string;
    latitude: number | null;
    longitude: number | null;
    geocoder_source: string;
    geocoder_confidence: number;
    matched_address_label: string;
  }>();

  for (const query of buildGeocodeQueries(placeNameRaw)) {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Photon geocoding failed with status ${response.status}`);
    }

    const data = await response.json() as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: Record<string, unknown>;
      }>;
    };

    (data.features ?? []).forEach((feature) => {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties ?? {};
      const matchedLabel = [
        properties.name,
        properties.street,
        properties.city,
        properties.state,
        properties.country,
      ]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(", ");
      const overlap = tokenOverlap(placeNameRaw, matchedLabel);
      const queryOverlap = tokenOverlap(query, matchedLabel);
      const confidence = Math.max(
        0,
        Math.min(
          1,
          overlap * 0.68 +
            queryOverlap * 0.18 +
            (typeof properties.osm_value === "string" && ["city", "town", "village", "road", "street", "building", "house", "commercial"].includes(properties.osm_value)
              ? 0.12
              : 0.04),
        ),
      );

      const candidate = {
        place_name_raw: placeNameRaw,
        normalized_place_name: normalizePlaceName(placeNameRaw),
        latitude: Array.isArray(coordinates) ? coordinates[1] : null,
        longitude: Array.isArray(coordinates) ? coordinates[0] : null,
        geocoder_source: "photon",
        geocoder_confidence: confidence,
        matched_address_label: matchedLabel || query,
      };

      if (candidate.latitude == null || candidate.longitude == null) {
        return;
      }

      const key = `${candidate.latitude}:${candidate.longitude}:${candidate.matched_address_label}`;
      const existing = candidateMap.get(key);
      if (!existing || candidate.geocoder_confidence > existing.geocoder_confidence) {
        candidateMap.set(key, candidate);
      }
    });
  }

  const candidates = Array.from(candidateMap.values()).sort((left, right) => right.geocoder_confidence - left.geocoder_confidence);

  return {
    place_name_raw: placeNameRaw,
    candidates,
    accepted_candidate: candidates.find((candidate) => candidate.geocoder_confidence >= 0.62) ?? null,
  };
};

const handleParseUpload: JsonHandler = async (payload) => {
  const filename = typeof payload.filename === "string" ? payload.filename : "upload.bin";
  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : undefined;
  const sourceUri = typeof payload.sourceUri === "string" ? payload.sourceUri : undefined;
  const base64 = typeof payload.base64 === "string" ? payload.base64 : "";
  const metadata = (payload.metadata ?? {}) as SourceDocumentMetadata;

  if (!base64) {
    throw new Error("Missing upload payload");
  }

  const content = Buffer.from(base64, "base64");
  return withTempFile(filename, content, async (filePath) => {
    const parsed = parseSourceInput({
      source_doc_id: `upload_${Date.now()}`,
      file_path: filePath,
      source_mime_type: mimeType,
      source_uri: sourceUri,
      source_filename: filename,
      metadata,
    });

    return {
      raw_content: parsed.raw_content,
      source_input_content: parsed.source_input_content,
      source_parser: parsed.source_parser,
      metadata: parsed.metadata,
    };
  });
};

const handleSmartExtract: JsonHandler = async (payload) => {
  const rawContent = typeof payload.rawContent === "string" ? payload.rawContent : "";
  const sourceDocId = typeof payload.sourceDocId === "string" ? payload.sourceDocId : `browser_${Date.now()}`;
  if (!rawContent.trim()) {
    throw new Error("Missing raw content");
  }

  return runSmartExtractionPipeline({
    source_doc_id: sourceDocId,
    raw_content: rawContent,
    source_mime_type: typeof payload.sourceMimeType === "string" ? payload.sourceMimeType : undefined,
    source_uri: typeof payload.sourceUri === "string" ? payload.sourceUri : undefined,
    source_filename: typeof payload.sourceFilename === "string" ? payload.sourceFilename : undefined,
    metadata: (payload.metadata ?? {}) as SourceDocumentMetadata,
  });
};

const handleResolveLocations: JsonHandler = async (payload) => {
  const caseId = typeof payload.caseId === "string" && payload.caseId.trim() ? payload.caseId.trim() : `case_${Date.now()}`;
  const mentions = Array.isArray(payload.mentions) ? payload.mentions as LocationMentionInput[] : [];

  if (!mentions.length) {
    throw new Error("Missing location mentions");
  }

  const response = await resolveLocationMentions(caseId, mentions);
  persistResolvedLocations(response);
  return response;
};

const handleExtractPersons: JsonHandler = async (payload) => {
  const response = extractPersons({
    caseId: typeof payload.caseId === "string" ? payload.caseId : `case_${Date.now()}`,
    documentId: typeof payload.documentId === "string" ? payload.documentId : `doc_${Date.now()}`,
    rawText: typeof payload.rawText === "string" ? payload.rawText : "",
    chunks: Array.isArray(payload.chunks) ? payload.chunks : [],
    language: typeof payload.language === "string" ? payload.language : undefined,
  });
  persistPersonExtraction(response);
  return response;
};

const handleResolvePersons: JsonHandler = async (payload) => {
  const caseId = typeof payload.caseId === "string" ? payload.caseId : `case_${Date.now()}`;
  const extracted = payload.extracted;
  if (!extracted) throw new Error("Missing extracted person payload");
  const response = resolvePersons(caseId, extracted);
  persistPersonResolution(response);
  Object.values(response.dossiers || {}).forEach((dossier) => persistPersonDossier(dossier));
  return response;
};

const handleEnrichKnowledge: JsonHandler = async (payload) => {
  const request: KnowledgeEnrichmentRequest = {
    caseId: typeof payload.caseId === "string" ? payload.caseId : `case_${Date.now()}`,
    documentId: typeof payload.documentId === "string" ? payload.documentId : undefined,
    entities: Array.isArray(payload.entities) ? payload.entities : [],
    relations: Array.isArray(payload.relations) ? payload.relations : [],
    eventIds: Array.isArray(payload.eventIds) ? payload.eventIds : [],
  };
  if (!request.entities.length) {
    throw new Error("Missing entities for knowledge enrichment");
  }
  return enrichKnowledgeForCase(request);
};

const handleRunEntityIntelligence: JsonHandler = async (payload) => {
  const caseId = typeof payload.caseId === "string" ? payload.caseId : `case_${Date.now()}`;
  let extractionPayload: SidecarExtractionPayload | null = null;

  if (payload.payload && typeof payload.payload === "object") {
    extractionPayload = payload.payload as SidecarExtractionPayload;
  } else if (typeof payload.rawText === "string" && payload.rawText.trim()) {
    extractionPayload = runSmartExtractionPipeline({
      source_doc_id: typeof payload.documentId === "string" ? payload.documentId : `doc_${Date.now()}`,
      raw_content: payload.rawText,
      metadata: (payload.metadata ?? {}) as SourceDocumentMetadata,
    });
  }

  if (!extractionPayload) {
    throw new Error("Missing grounded extraction payload for entity intelligence");
  }

  return await buildEntityIntelligenceCase({
    caseId,
    payload: extractionPayload,
  });
};

const createSidecarMiddleware = (): Connect.NextHandleFunction => {
  const postRoutes = new Map<string, JsonHandler>([
    [`${SIDE_CAR_PREFIX}/parse-upload`, handleParseUpload],
    [`${SIDE_CAR_PREFIX}/smart-extract`, handleSmartExtract],
    [`${SIDE_CAR_PREFIX}/geocode`, handleGeocode],
    ["/api/locations/resolve", handleResolveLocations],
    ["/api/persons/extract", handleExtractPersons],
    ["/api/persons/resolve", handleResolvePersons],
    ["/api/knowledge/enrich", handleEnrichKnowledge],
    ["/api/resolution/run", handleRunEntityIntelligence],
  ]);

  return async (req, res, next) => {
    const method = req.method?.toUpperCase() || "GET";
    const url = req.url?.split("?")[0] || "";
    const documentExtractRoute = /^\/documents\/[^/]+\/extract-mentions$/.test(url);
    const entityMutationRoute = /^\/api\/entities\/[^/]+\/(?:merge|split|regenerate-summary)$/.test(url);
    const entityReadRoute = /^\/api\/entities\/[^/]+(?:\/(?:timeline|claims|mentions|relations|summary|conflicts|candidate-decisions|debug-report|reference))?$/.test(url);
    const caseEntityIntelligenceRoute = /^\/api\/cases\/[^/]+\/(?:entity-intelligence|entity-graph|ambiguous-mentions)$/.test(url);

    const locationMatch = method === "GET" ? url.match(/^\/api\/locations\/([^/]+)$/) : null;
    if (locationMatch) {
      const record = getResolvedLocationById(decodeURIComponent(locationMatch[1]));
      if (!record) {
        sendJson(res, 404, { error: "Location not found" });
        return;
      }
      sendJson(res, 200, record);
      return;
    }

    const personDossierMatch = method === "GET" ? url.match(/^\/api\/persons\/([^/]+)\/dossier$/) : null;
    if (personDossierMatch) {
      const dossier = getPersonDossier(decodeURIComponent(personDossierMatch[1]));
      if (!dossier) {
        sendJson(res, 404, { error: "Person dossier not found" });
        return;
      }
      sendJson(res, 200, dossier);
      return;
    }

    const personMatch = method === "GET" ? url.match(/^\/api\/persons\/([^/]+)$/) : null;
    if (personMatch) {
      const entity = getPersonEntity(decodeURIComponent(personMatch[1]));
      if (!entity) {
        sendJson(res, 404, { error: "Person not found" });
        return;
      }
      sendJson(res, 200, entity);
      return;
    }

    const caseMapMatch = method === "GET" ? url.match(/^\/api\/cases\/([^/]+)\/map$/) : null;
    if (caseMapMatch) {
      const response = getCaseMapResponse(decodeURIComponent(caseMapMatch[1]));
      if (!response) {
        sendJson(res, 404, { error: "Case map not found" });
        return;
      }
      sendJson(res, 200, response);
      return;
    }

    const casePersonsMatch = method === "GET" ? url.match(/^\/api\/cases\/([^/]+)\/persons$/) : null;
    if (casePersonsMatch) {
      const entities = getCasePersons(decodeURIComponent(casePersonsMatch[1]));
      sendJson(res, 200, entities);
      return;
    }

    const entityReferenceMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/reference$/) : null;
    if (entityReferenceMatch) {
      const profile = getEntityReference(decodeURIComponent(entityReferenceMatch[1]));
      if (!profile) {
        sendJson(res, 404, { error: "Entity reference knowledge not found" });
        return;
      }
      sendJson(res, 200, profile);
      return;
    }

    const caseKnowledgeMatch = method === "GET" ? url.match(/^\/api\/cases\/([^/]+)\/knowledge$/) : null;
    if (caseKnowledgeMatch) {
      const knowledge = getCaseKnowledge(decodeURIComponent(caseKnowledgeMatch[1]));
      if (!knowledge) {
        sendJson(res, 404, { error: "Case knowledge not found" });
        return;
      }
      sendJson(res, 200, knowledge);
      return;
    }

    const caseEntityIntelligenceMatch = method === "GET" ? url.match(/^\/api\/cases\/([^/]+)\/entity-intelligence$/) : null;
    if (caseEntityIntelligenceMatch) {
      const intelligence = await getEntityIntelligenceCase(decodeURIComponent(caseEntityIntelligenceMatch[1]));
      if (!intelligence) {
        sendJson(res, 404, { error: "Case entity intelligence not found" });
        return;
      }
      sendJson(res, 200, intelligence);
      return;
    }

    const caseEntityGraphMatch = method === "GET" ? url.match(/^\/api\/cases\/([^/]+)\/entity-graph$/) : null;
    if (caseEntityGraphMatch) {
      const graph = await getCaseEntityGraph(decodeURIComponent(caseEntityGraphMatch[1]));
      if (!graph) {
        sendJson(res, 404, { error: "Case entity graph not found" });
        return;
      }
      sendJson(res, 200, graph);
      return;
    }

    const ambiguousMentionsMatch = method === "GET" ? url.match(/^\/api\/cases\/([^/]+)\/ambiguous-mentions$/) : null;
    if (ambiguousMentionsMatch) {
      sendJson(res, 200, await getAmbiguousMentions(decodeURIComponent(ambiguousMentionsMatch[1])));
      return;
    }

    const entityTimelineMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/timeline$/) : null;
    if (entityTimelineMatch) {
      sendJson(res, 200, await getEntityTimeline(decodeURIComponent(entityTimelineMatch[1])));
      return;
    }

    const entityClaimsMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/claims$/) : null;
    if (entityClaimsMatch) {
      sendJson(res, 200, await getEntityClaims(decodeURIComponent(entityClaimsMatch[1])));
      return;
    }

    const entityMentionsMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/mentions$/) : null;
    if (entityMentionsMatch) {
      sendJson(res, 200, await getEntityMentions(decodeURIComponent(entityMentionsMatch[1])));
      return;
    }

    const entityRelationsMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/relations$/) : null;
    if (entityRelationsMatch) {
      sendJson(res, 200, await getEntityRelations(decodeURIComponent(entityRelationsMatch[1])));
      return;
    }

    const entitySummaryReadMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/summary$/) : null;
    if (entitySummaryReadMatch) {
      const summary = await getEntitySummary(decodeURIComponent(entitySummaryReadMatch[1]));
      if (!summary) {
        sendJson(res, 404, { error: "Entity summary not found" });
        return;
      }
      sendJson(res, 200, summary);
      return;
    }

    const entityConflictsMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/conflicts$/) : null;
    if (entityConflictsMatch) {
      sendJson(res, 200, await getEntityConflicts(decodeURIComponent(entityConflictsMatch[1])));
      return;
    }

    const entityCandidateMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/candidate-decisions$/) : null;
    if (entityCandidateMatch) {
      sendJson(res, 200, await getEntityCandidateDecisions(decodeURIComponent(entityCandidateMatch[1])));
      return;
    }

    const entityDebugMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)\/debug-report$/) : null;
    if (entityDebugMatch) {
      const report = await getEntityDebugReport(decodeURIComponent(entityDebugMatch[1]));
      if (!report) {
        sendJson(res, 404, { error: "Entity debug report not found" });
        return;
      }
      sendJson(res, 200, report);
      return;
    }

    const entityMatch = method === "GET" ? url.match(/^\/api\/entities\/([^/]+)$/) : null;
    if (entityMatch) {
      const entityId = decodeURIComponent(entityMatch[1]);
      const entity = await getEntityById(entityId);
      const profile = await getEntityProfile(entityId);
      if (!entity && !profile) {
        sendJson(res, 404, { error: "Entity not found" });
        return;
      }
      sendJson(res, 200, { entity, profile });
      return;
    }

    if (
      !url.startsWith(SIDE_CAR_PREFIX) &&
      url !== "/api/locations/resolve" &&
      url !== "/api/persons/extract" &&
      url !== "/api/persons/resolve" &&
      url !== "/api/knowledge/enrich" &&
      url !== "/api/resolution/run" &&
      !documentExtractRoute &&
      !entityMutationRoute &&
      !entityReadRoute &&
      !caseEntityIntelligenceRoute
    ) {
      next();
      return;
    }

    if (method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url === `${SIDE_CAR_PREFIX}/health`) {
      sendJson(res, 200, { ok: true, parserBridge: "python-sidecar" });
      return;
    }

    const handler = postRoutes.get(url);
    const documentExtractMatch = method === "POST" ? url.match(/^\/documents\/([^/]+)\/extract-mentions$/) : null;
    if (documentExtractMatch) {
      try {
        const payload = await readJsonBody(req);
        const rawText = typeof payload.rawText === "string" ? payload.rawText : "";
        if (!rawText.trim()) {
          throw new Error("Missing rawText for document extraction");
        }
        const intelligence = await buildEntityIntelligenceCase({
          caseId: typeof payload.caseId === "string" ? payload.caseId : `case_${Date.now()}`,
          payload: runSmartExtractionPipeline({
            source_doc_id: decodeURIComponent(documentExtractMatch[1]),
            raw_content: rawText,
            metadata: (payload.metadata ?? {}) as SourceDocumentMetadata,
          }),
        });
        sendJson(res, 200, {
          document_id: intelligence.result.documents[0]?.id,
          mentions: intelligence.result.mentions,
          evidence_spans: intelligence.result.evidence_spans,
          chunks: intelligence.result.document_chunks,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown extraction error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    const entityMergeMatch = method === "POST" ? url.match(/^\/api\/entities\/([^/]+)\/merge$/) : null;
    if (entityMergeMatch) {
      try {
        const payload = await readJsonBody(req);
        const merged = await mergeEntityRecords(
          String(payload.caseId || ""),
          decodeURIComponent(entityMergeMatch[1]),
          String(payload.sourceEntityId || ""),
          typeof payload.actor === "string" ? payload.actor : "system",
        );
        if (!merged) {
          sendJson(res, 404, { error: "Entity merge failed" });
          return;
        }
        sendJson(res, 200, merged);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown merge error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    const entitySplitMatch = method === "POST" ? url.match(/^\/api\/entities\/([^/]+)\/split$/) : null;
    if (entitySplitMatch) {
      try {
        const payload = await readJsonBody(req);
        const split = await splitEntityRecord(
          String(payload.caseId || ""),
          decodeURIComponent(entitySplitMatch[1]),
          Array.isArray(payload.mentionIds) ? payload.mentionIds : [],
          typeof payload.actor === "string" ? payload.actor : "system",
        );
        if (!split) {
          sendJson(res, 404, { error: "Entity split failed" });
          return;
        }
        sendJson(res, 200, split);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown split error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    const entitySummaryMatch = method === "POST" ? url.match(/^\/api\/entities\/([^/]+)\/regenerate-summary$/) : null;
    if (entitySummaryMatch) {
      try {
        const payload = await readJsonBody(req);
        const regenerated = await regenerateEntitySummary(String(payload.caseId || ""), decodeURIComponent(entitySummaryMatch[1]));
        if (!regenerated) {
          sendJson(res, 404, { error: "Entity summary regeneration failed" });
          return;
        }
        sendJson(res, 200, regenerated);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown summary regeneration error";
        sendJson(res, 500, { error: message });
      }
      return;
    }

    if (!handler || method !== "POST") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const result = await handler(payload);
      sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sidecar error";
      sendJson(res, 500, { error: message });
    }
  };
};

export const tevelSidecarPlugin = (): Plugin => {
  const middleware = createSidecarMiddleware();

  return {
    name: "tevel-sidecar-local-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
};
