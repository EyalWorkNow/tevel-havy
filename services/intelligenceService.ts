import {
    IntelligencePackage,
    ChatMessage,
    ContextCard,
    PinnedItem,
    StudyItem,
    SynapseAnalysis,
    SynapseHypothesis,
    Entity,
    Relation,
    GraphData,
    NarrativeBlock,
    Statement,
    IntelQuestion,
    IntelTask,
    Insight,
    TimelineEvent,
    TacticalAssessment,
    DocumentMetadata,
} from "../types";
import { EntityCreationEngine, ExtractedEntityLike } from "./intelligence/entityCreation";
import { refineAnswerWithCitationVerification, verifyAnswerCitations } from "./sidecar/citationVerification/service";
import type { CitationVerificationRun } from "./sidecar/citationVerification/contracts";
import type { RetrievalEvidenceHit } from "./sidecar/retrieval";

type JsonSchema = Record<string, unknown>;

type OllamaResponse = {
    error?: string;
    message?: {
        content?: string;
    };
    response?: string;
};

type ExtractedEntity = {
    name: string;
    type: string;
    role?: string;
    confidence?: number;
};

type ExtractedRelation = {
    source: string;
    target: string;
    type: string;
    confidence?: number;
};

type ExtractedInsight = {
    type?: string;
    text?: string;
    importance?: number;
};

type ExtractedStatement = {
    knowledge?: string;
    category?: string;
    statement_text?: string;
    confidence?: number;
    assumption_flag?: boolean;
    intelligence_gap?: boolean;
    impact?: string;
    operational_relevance?: string;
    related_entities?: string[];
};

type ChunkAnalysisResponse = {
    title?: string;
    entities?: ExtractedEntity[];
    relations?: ExtractedRelation[];
    insights?: ExtractedInsight[];
    timeline?: TimelineEvent[];
    statements?: ExtractedStatement[];
};

type StrategicSynthesisResponse = {
    title?: string;
    summary?: string;
    insights?: ExtractedInsight[];
    tactical_assessment?: {
        ttps?: string[];
        recommendations?: string[];
        gaps?: string[];
    };
    intel_questions?: Array<{
        question_text?: string;
        priority?: string;
        owner?: string;
    }>;
    intel_tasks?: Array<{
        task_text?: string;
        urgency?: string;
        status?: string;
    }>;
    reliability?: number;
    document_metadata?: Partial<DocumentMetadata>;
};

type SynapseResponse = {
    summary?: string;
    results?: Array<{
        type?: string;
        title?: string;
        description?: string;
        confidence?: number;
        evidence?: Array<{
            sourceStudyId?: string;
            sourceStudyTitle?: string;
            text?: string;
        }>;
    }>;
};

type TimelineNarrativeResponse = {
    blocks?: Array<{
        insertAfterIndex?: number;
        title?: string;
        explanation?: string;
        type?: string;
    }>;
};

type MergedKnowledge = {
    title: string;
    entities: Entity[];
    relations: Relation[];
    insights: Insight[];
    timeline: TimelineEvent[];
    statements: Statement[];
    relationCounts: Map<string, number>;
    entityMetrics: Map<
        string,
        {
            mentions: number;
            degree: number;
            confidence: number;
            descriptions: string[];
        }
    >;
};

type ChunkPayload = {
    index: number;
    content: string;
};

type RuntimeCommunity = {
    id: string;
    label: string;
    summary: string;
    entityNames: string[];
    centralEntityNames: string[];
    relationTypes: string[];
};

type RuntimeEvidenceItem = {
    id: string;
    kind: "chunk" | "community" | "entity" | "insight" | "statement" | "timeline" | "relation";
    title: string;
    text: string;
    entityNames: string[];
    communityId?: string;
    graphWeight: number;
};

type RuntimeReasoningIndex = {
    chunks: RuntimeEvidenceItem[];
    communities: RuntimeCommunity[];
    evidence: RuntimeEvidenceItem[];
    centralEntityNames: string[];
    entityNeighbors: Map<string, string[]>;
};

export type QuestionAnswerOptions = {
    fastMode?: boolean;
    answerTimeoutMs?: number;
    maxKnowledgeSummaryChars?: number;
    caseId?: string;
    answerId?: string;
    reasoningEngineId?: ReasoningEngineId;
    geminiApiKey?: string;
    systemInstruction?: string;
    onCitationVerification?: (run: CitationVerificationRun) => void | Promise<void>;
    readPathContext?: {
        knowledgeSnapshot?: string;
        retrievalContext?: string;
        candidateEvidenceIds?: string[];
    };
};

const JSON_TYPES = {
    object: "object",
    array: "array",
    string: "string",
    number: "number",
    boolean: "boolean",
} as const;

const boundedEnvInt = (name: string, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseInt(process.env[name] || "", 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const getEnvVar = (key: string): string => {
    // @ts-ignore
    const viteEnv = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env[`VITE_${key}`] : undefined;
    const processEnv = typeof process !== "undefined" && process.env ? process.env[key] || process.env[`VITE_${key}`] : undefined;
    return viteEnv || processEnv || "";
};

const DEFAULT_OLLAMA_BASE_URL = getEnvVar("OLLAMA_BASE_URL") || "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = getEnvVar("OLLAMA_MODEL") || "qwen3.5:4b";
const DEFAULT_FAST_OLLAMA_MODEL = getEnvVar("OLLAMA_FAST_MODEL") || "qwen2.5:1.5b";
const DEFAULT_OLLAMA_EMBED_MODEL = getEnvVar("OLLAMA_EMBED_MODEL") || "embeddinggemma";

const DEFAULT_GEMINI_MODEL = getEnvVar("GEMINI_MODEL") || "gemini-2.5-flash";
const GEMINI_API_KEY = getEnvVar("GEMINI_API_KEY");
export const HAS_CONFIGURED_GEMINI_API_KEY = Boolean(GEMINI_API_KEY.trim());
export const USE_GEMINI_BY_DEFAULT = getEnvVar("TEVEL_USE_GEMINI") === "true";
export type ReasoningEngineId = "gemini-cloud" | "ollama-local";
export type ReasoningEngineSurface = "cloud" | "local";
export type ReasoningFailureKind = "timeout" | "offline";

export interface ReasoningEngineDescriptor {
    id: ReasoningEngineId;
    surface: ReasoningEngineSurface;
    label: string;
    model: string;
}

export interface ReasoningFailureDescriptor {
    kind: ReasoningFailureKind;
    message: string;
    engine: ReasoningEngineDescriptor;
}

const formatGeminiLabel = (model: string): string =>
    model
        .split("-")
        .filter((part) => part && part !== "gemini")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
        .replace(/^/, "Gemini ");

export const getReasoningEngineDescriptor = (engineId?: ReasoningEngineId): ReasoningEngineDescriptor => {
    const selectedEngineId = engineId || (USE_GEMINI_BY_DEFAULT ? "gemini-cloud" : "ollama-local");
    if (selectedEngineId === "gemini-cloud") {
        return {
            id: "gemini-cloud",
            surface: "cloud",
            label: formatGeminiLabel(DEFAULT_GEMINI_MODEL),
            model: DEFAULT_GEMINI_MODEL,
        };
    }

    return {
        id: "ollama-local",
        surface: "local",
        label: DEFAULT_OLLAMA_MODEL,
        model: DEFAULT_OLLAMA_MODEL,
    };
};

export const PRIMARY_REASONING_ENGINE: ReasoningEngineDescriptor = Object.freeze(getReasoningEngineDescriptor());

export const buildReasoningFailureMessage = (
    kind: ReasoningFailureKind,
    engine: ReasoningEngineDescriptor = PRIMARY_REASONING_ENGINE,
): string => {
    if (engine.surface === "cloud") {
        return kind === "timeout"
            ? "Cloud reasoning engine timed out while answering the question."
            : "Comms offline: unable to reach the cloud reasoning engine.";
    }

    return kind === "timeout"
        ? "Local model timed out while answering the question."
        : "Comms offline: unable to reach the local model.";
};

export const classifyReasoningFailure = (
    message: string,
    engine: ReasoningEngineDescriptor = PRIMARY_REASONING_ENGINE,
): ReasoningFailureDescriptor | null => {
    const normalized = String(message || "").trim();
    if (!normalized) return null;

    if (
        /timed out while answering|local model timed out|cloud reasoning engine timed out|reasoning engine timed out/i.test(normalized)
        || /Gemini API request timed out|Local model request timed out/i.test(normalized)
    ) {
        return {
            kind: "timeout",
            message: buildReasoningFailureMessage("timeout", engine),
            engine,
        };
    }

    if (
        /comms offline|unable to reach the (?:cloud reasoning engine|local model|reasoning engine)/i.test(normalized)
        || /Gemini Cloud Reasoning failed|All Gemini connectivity paths failed|Unable to reach the local model|Gemini API key is not configured/i.test(normalized)
    ) {
        return {
            kind: "offline",
            message: buildReasoningFailureMessage("offline", engine),
            engine,
        };
    }

    return null;
};

console.warn(
    USE_GEMINI_BY_DEFAULT
        ? `[TEVEL] CLOUD REASONING ACTIVE: Using ${formatGeminiLabel(DEFAULT_GEMINI_MODEL)} as the primary engine.`
        : `[TEVEL] LOCAL REASONING ACTIVE: Using Ollama ${DEFAULT_OLLAMA_MODEL} as the primary engine.`,
);

const REQUEST_TIMEOUT_MS = USE_GEMINI_BY_DEFAULT ? 45000 : boundedEnvInt("TEVEL_REASONING_TIMEOUT_MS", 120000, 15000, 300000);
const FAST_QA_TIMEOUT_MS = USE_GEMINI_BY_DEFAULT ? 30000 : boundedEnvInt("TEVEL_FAST_QA_TIMEOUT_MS", 90000, 10000, 180000);
const LOCAL_MODEL_ATTEMPT_TIMEOUT_MS = boundedEnvInt("TEVEL_LOCAL_MODEL_ATTEMPT_TIMEOUT_MS", 35000, 10000, 120000);
const MAX_CHUNK_CHARS = 4200;
const CHUNK_OVERLAP_CHARS = 320;
const MAX_CONTEXT_EXCERPT_CHARS = 8000;
const RETRIEVAL_CHUNK_CHARS = 1400;
const RETRIEVAL_CHUNK_OVERLAP_CHARS = 140;
const ANALYSIS_CHUNK_CONCURRENCY = USE_GEMINI_BY_DEFAULT ? 12 : boundedEnvInt("TEVEL_ANALYSIS_CONCURRENCY", 2, 1, 3);
const ENTITY_REFINEMENT_BATCH_SIZE = boundedEnvInt("TEVEL_ENTITY_BATCH_SIZE", 24, 12, 36);
const DEFAULT_RETRIEVAL_TOP_K = boundedEnvInt("TEVEL_RETRIEVAL_TOP_K", 10, 8, 14);
const MAX_EVIDENCE_ENTITY_NAMES = boundedEnvInt("TEVEL_MAX_EVIDENCE_ENTITIES", 18, 12, 28);
const EMBEDDING_MODEL_CANDIDATES = [
    DEFAULT_OLLAMA_EMBED_MODEL,
    "qwen3-embedding",
    "nomic-embed-text",
    "all-minilm",
].filter(Boolean);

const ALLOWED_INSIGHT_TYPES = new Set<Insight["type"]>(["key_event", "pattern", "anomaly", "summary"]);
const ALLOWED_KNOWLEDGE_TYPES = new Set<Statement["knowledge"]>([
    "FACT",
    "ASSESSMENT",
    "HYPOTHESIS",
    "TASK",
    "WARNING",
]);
const ALLOWED_STATEMENT_CATEGORIES = new Set<Statement["category"]>([
    "STRATEGIC",
    "FINANCIAL",
    "TACTICAL",
    "LOGISTICAL",
    "IDEOLOGICAL",
    "COLLECTION",
    "OTHER",
]);
const ALLOWED_IMPACT_LEVELS = new Set<Statement["impact"]>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const ALLOWED_URGENCY_LEVELS = new Set<IntelTask["urgency"]>(["LOW", "MEDIUM", "HIGH", "IMMEDIATE"]);
const ALLOWED_CONTEXT_SIGNIFICANCE = new Set<NonNullable<ContextCard["significance"]>>([
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
]);
const ALLOWED_CONTEXT_STATUS = new Set<NonNullable<ContextCard["status"]>>([
    "ACTIVE",
    "INACTIVE",
    "UNKNOWN",
    "DETAINED",
    "ELIMINATED",
]);
const ENTITY_TYPE_PRIORITY = [
    "PERSON",
    "ORGANIZATION",
    "ORG",
    "LOCATION",
    "ASSET",
    "EVENT",
    "DATE",
    "TIME",
    "MISC",
];

/**
 * ==================================================================================
 * PART 1: DATA ALGORITHM ENGINE
 * Handles graph construction and data normalization.
 * ==================================================================================
 */
class DataAlgorithmEngine {
    static buildGraph(entities: Entity[], relations: Relation[]): GraphData {
        const uniqueNodes = new Map<string, { id: string; group: number; type: string }>();
        const edges: Array<{ source: string; target: string; value: number; label?: string }> = [];

        entities.forEach((entity) => {
            const id = entity.name;
            if (!uniqueNodes.has(id)) {
                uniqueNodes.set(id, {
                    id,
                    group: this.getTypeGroup(entity.type),
                    type: entity.type,
                });
            }
        });

        relations.forEach((relation) => {
            const source = relation.source;
            const target = relation.target;

            if (!uniqueNodes.has(source)) {
                uniqueNodes.set(source, { id: source, group: 8, type: "MISC" });
            }
            if (!uniqueNodes.has(target)) {
                uniqueNodes.set(target, { id: target, group: 8, type: "MISC" });
            }

            edges.push({
                source,
                target,
                value: (relation.confidence || 0.5) * 5,
                label: relation.type,
            });
        });

        return {
            nodes: Array.from(uniqueNodes.values()),
            edges,
        };
    }

    static getTypeGroup(type: string) {
        const normalizedType = type?.toUpperCase() || "MISC";
        switch (normalizedType) {
            case "PERSON":
                return 1;
            case "ORG":
            case "ORGANIZATION":
            case "UNIT":
                return 2;
            case "LOCATION":
            case "REGION":
            case "FACILITY":
                return 3;
            case "VEHICLE":
                return 4;
            case "IDENTIFIER":
            case "FINANCIAL_ACCOUNT":
            case "COMMUNICATION_CHANNEL":
            case "DIGITAL_ASSET":
            case "DEVICE":
            case "DOCUMENT":
            case "CARGO":
            case "OBJECT":
            case "ASSET":
            case "WEAPON":
            case "SYSTEM":
                return 4;
            case "EVENT":
            case "INCIDENT":
                return 5;
            case "DATE":
            case "TIME":
                return 6;
            case "CAPABILITY":
            case "TECH":
            case "CYBER":
                return 7;
            default:
                return 8;
        }
    }

    static isEntityMatch(e1Name: string, e2Name: string): boolean {
        if (!e1Name || !e2Name) return false;
        const n1 = KnowledgeFusionEngine.normalizeEntityKey(e1Name);
        const n2 = KnowledgeFusionEngine.normalizeEntityKey(e2Name);
        return n1 === n2 || (n1.length > 4 && n2.length > 4 && (n1.includes(n2) || n2.includes(n1)));
    }
}

/**
 * ==================================================================================
 * PART 2: KNOWLEDGE FUSION ENGINE
 * Chunking, deduplication, shallow context generation, and fallbacks.
 * ==================================================================================
 */
class KnowledgeFusionEngine {
    static normalizeSourceText(text: string): string {
        return text
            .replace(/\r/g, "")
            .replace(/\t/g, " ")
            .replace(/[ \u00A0]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    static normalizeEntityKey(value: string): string {
        return value
            .normalize("NFKC")
            .toLowerCase()
            .replace(/['"״׳`]/g, "")
            .replace(/[()[\]{}]/g, " ")
            .replace(/[-_/]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    static splitIntoChunks(text: string, maxChars = MAX_CHUNK_CHARS, overlapChars = CHUNK_OVERLAP_CHARS): ChunkPayload[] {
        const normalized = this.normalizeSourceText(text);
        if (!normalized) return [];

        const paragraphs = normalized
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean);

        const segments = paragraphs.flatMap((paragraph) => this.splitLongSegment(paragraph, maxChars));
        const chunks: ChunkPayload[] = [];
        let current = "";

        const pushChunk = () => {
            const content = current.trim();
            if (!content) return;
            chunks.push({
                index: chunks.length,
                content,
            });
            current = content.slice(-overlapChars);
        };

        segments.forEach((segment) => {
            const next = current ? `${current}\n\n${segment}` : segment;
            if (next.length > maxChars && current) {
                pushChunk();
                current = current ? `${current}\n\n${segment}` : segment;
            } else {
                current = next;
            }

            if (current.length > maxChars * 1.2) {
                pushChunk();
            }
        });

        pushChunk();

        return chunks.filter((chunk, index, items) => {
            return index === 0 || chunk.content !== items[index - 1].content;
        });
    }

    static getAdaptiveAnalysisChunking(text: string): { maxChars: number; overlapChars: number } {
        const normalized = this.normalizeSourceText(text);
        if (normalized.length >= 45000) {
            return { maxChars: 3400, overlapChars: 420 };
        }
        if (normalized.length >= 22000) {
            return { maxChars: 3800, overlapChars: 360 };
        }
        return { maxChars: MAX_CHUNK_CHARS, overlapChars: CHUNK_OVERLAP_CHARS };
    }

    static async mapWithConcurrency<T, R>(
        items: T[],
        concurrency: number,
        worker: (item: T, index: number) => Promise<R>
    ): Promise<R[]> {
        if (!items.length) return [];

        const results = new Array<R>(items.length);
        let cursor = 0;
        const safeConcurrency = Math.min(Math.max(1, concurrency), items.length);

        await Promise.all(
            Array.from({ length: safeConcurrency }, async () => {
                while (cursor < items.length) {
                    const currentIndex = cursor;
                    cursor += 1;
                    results[currentIndex] = await worker(items[currentIndex], currentIndex);
                }
            })
        );

        return results;
    }

    private static splitLongSegment(segment: string, maxChars: number): string[] {
        if (segment.length <= maxChars) {
            return [segment];
        }

        const sentences = segment
            .split(/(?<=[.!?。！？])\s+/)
            .map((sentence) => sentence.trim())
            .filter(Boolean);

        if (sentences.length <= 1) {
            const parts: string[] = [];
            for (let offset = 0; offset < segment.length; offset += maxChars) {
                parts.push(segment.slice(offset, offset + maxChars).trim());
            }
            return parts;
        }

        const parts: string[] = [];
        let current = "";

        sentences.forEach((sentence) => {
            const next = current ? `${current} ${sentence}` : sentence;
            if (next.length > maxChars && current) {
                parts.push(current.trim());
                current = sentence;
            } else {
                current = next;
            }
        });

        if (current.trim()) {
            parts.push(current.trim());
        }

        return parts;
    }

    private static pickPreferredType(typeCounts: Map<string, number>): string {
        const entries = Array.from(typeCounts.entries());
        entries.sort((a, b) => {
            const aPriority = ENTITY_TYPE_PRIORITY.indexOf(a[0]);
            const bPriority = ENTITY_TYPE_PRIORITY.indexOf(b[0]);
            if (aPriority !== bPriority) {
                const normalizedA = aPriority === -1 ? ENTITY_TYPE_PRIORITY.length : aPriority;
                const normalizedB = bPriority === -1 ? ENTITY_TYPE_PRIORITY.length : bPriority;
                return normalizedA - normalizedB;
            }
            return b[1] - a[1];
        });
        return entries[0]?.[0] || "MISC";
    }

    private static findCanonicalEntityName(name: string, canonicalNames: string[]): string | null {
        const normalized = this.normalizeEntityKey(name);
        for (const candidate of canonicalNames) {
            if (DataAlgorithmEngine.isEntityMatch(candidate, name)) {
                return candidate;
            }
            if (this.normalizeEntityKey(candidate) === normalized) {
                return candidate;
            }
        }
        return null;
    }

    private static normalizeEntityType(type?: string): string {
        const normalized = (type || "MISC").toUpperCase().trim();
        if (normalized === "ORG") return "ORGANIZATION";
        if (normalized === "OBJECT") return "ASSET";
        if (normalized === "INCIDENT") return "EVENT";
        if (["URL", "EMAIL", "IP", "DOMAIN", "WALLET", "HOSTNAME"].includes(normalized)) return "DIGITAL_ASSET";
        if (["ACCOUNT", "BANK_ACCOUNT", "IBAN", "SWIFT", "CARD", "PAYMENT_ACCOUNT"].includes(normalized)) return "FINANCIAL_ACCOUNT";
        if (["PHONE", "TELEGRAM", "WHATSAPP", "SIGNAL", "HANDLE"].includes(normalized)) return "COMMUNICATION_CHANNEL";
        if (["SERVER", "ROUTER", "MODEM", "CAMERA", "RADIO", "LAPTOP", "TABLET", "HANDSET"].includes(normalized)) return "DEVICE";
        if (["REPORT", "FORM", "CONTRACT", "INVOICE", "PASSPORT", "MANIFEST", "LICENSE", "CERTIFICATE", "MEMO", "DOSSIER"].includes(normalized)) return "DOCUMENT";
        if (["CONTAINER", "PALLET", "SHIPMENT", "PARCEL", "CRATE"].includes(normalized)) return "CARGO";
        if (!normalized) return "MISC";
        return normalized;
    }

    private static normalizeInsightType(type?: string): Insight["type"] {
        const candidate = (type || "summary").toLowerCase().replace(/\s+/g, "_") as Insight["type"];
        return ALLOWED_INSIGHT_TYPES.has(candidate) ? candidate : "summary";
    }

    private static clampConfidence(value?: number, fallback = 0.75): number {
        if (typeof value !== "number" || Number.isNaN(value)) {
            return fallback;
        }
        return Math.min(1, Math.max(0, value));
    }

    private static coerceEnum<T extends string>(value: string | undefined, allowed: Set<T>, fallback: T): T {
        const candidate = (value || fallback).toUpperCase() as T;
        return allowed.has(candidate) ? candidate : fallback;
    }

    private static buildStatement(raw: ExtractedStatement, index: number): Statement | null {
        if (!raw.statement_text?.trim()) return null;
        return {
            statement_id: `stmt_${index}_${this.normalizeEntityKey(raw.statement_text).slice(0, 24)}`,
            knowledge: this.coerceEnum(raw.knowledge, ALLOWED_KNOWLEDGE_TYPES, "ASSESSMENT"),
            category: this.coerceEnum(raw.category, ALLOWED_STATEMENT_CATEGORIES, "OTHER"),
            statement_text: raw.statement_text.trim(),
            confidence: this.clampConfidence(raw.confidence, 0.7),
            assumption_flag: Boolean(raw.assumption_flag),
            intelligence_gap: Boolean(raw.intelligence_gap),
            impact: this.coerceEnum(raw.impact, ALLOWED_IMPACT_LEVELS, "MEDIUM"),
            operational_relevance: this.coerceEnum(raw.operational_relevance, ALLOWED_URGENCY_LEVELS, "MEDIUM"),
            related_entities: Array.isArray(raw.related_entities)
                ? raw.related_entities.filter(Boolean).map((item) => item.trim())
                : [],
        };
    }

    static mergeChunkResults(chunkResults: ChunkAnalysisResponse[]): MergedKnowledge {
        const entityMap = new Map<
            string,
            {
                names: Set<string>;
                typeCounts: Map<string, number>;
                descriptions: Set<string>;
                confidenceTotal: number;
                confidenceCount: number;
                mentions: number;
            }
        >();
        const relationMap = new Map<string, Relation>();
        const relationCounts = new Map<string, number>();
        const insightMap = new Map<string, Insight>();
        const timelineMap = new Map<string, TimelineEvent>();
        const statementMap = new Map<string, Statement>();
        let title = "Intelligence Report";

        chunkResults.forEach((chunkResult, chunkIndex) => {
            if (chunkResult.title && title === "Intelligence Report") {
                title = chunkResult.title.trim();
            }

            (chunkResult.entities || []).forEach((rawEntity) => {
                if (!rawEntity.name?.trim()) return;
                const existingNames = Array.from(entityMap.values()).flatMap((entry) => Array.from(entry.names));
                const canonicalName =
                    this.findCanonicalEntityName(rawEntity.name.trim(), existingNames) || rawEntity.name.trim();
                const key = this.normalizeEntityKey(canonicalName);
                const bucket =
                    entityMap.get(key) ||
                    {
                        names: new Set<string>(),
                        typeCounts: new Map<string, number>(),
                        descriptions: new Set<string>(),
                        confidenceTotal: 0,
                        confidenceCount: 0,
                        mentions: 0,
                    };

                bucket.names.add(canonicalName);
                bucket.names.add(rawEntity.name.trim());
                const type = this.normalizeEntityType(rawEntity.type);
                bucket.typeCounts.set(type, (bucket.typeCounts.get(type) || 0) + 1);
                if (rawEntity.role?.trim()) {
                    bucket.descriptions.add(rawEntity.role.trim());
                }
                bucket.confidenceTotal += this.clampConfidence(rawEntity.confidence, 0.75);
                bucket.confidenceCount += 1;
                bucket.mentions += 1;
                entityMap.set(key, bucket);
            });

            (chunkResult.relations || []).forEach((rawRelation) => {
                if (!rawRelation.source?.trim() || !rawRelation.target?.trim() || !rawRelation.type?.trim()) return;
                const sourceKey = this.findCanonicalEntityName(
                    rawRelation.source.trim(),
                    Array.from(entityMap.values()).flatMap((entry) => Array.from(entry.names))
                );
                const targetKey = this.findCanonicalEntityName(
                    rawRelation.target.trim(),
                    Array.from(entityMap.values()).flatMap((entry) => Array.from(entry.names))
                );
                const source = sourceKey || rawRelation.source.trim();
                const target = targetKey || rawRelation.target.trim();
                const type = rawRelation.type.trim();
                const key = `${this.normalizeEntityKey(source)}|${type.toLowerCase()}|${this.normalizeEntityKey(target)}`;
                const confidence = this.clampConfidence(rawRelation.confidence, 0.7);
                const existing = relationMap.get(key);
                if (existing) {
                    existing.confidence = Math.max(existing.confidence, confidence);
                } else {
                    relationMap.set(key, { source, target, type, confidence });
                }
                relationCounts.set(type, (relationCounts.get(type) || 0) + 1);
            });

            (chunkResult.insights || []).forEach((rawInsight) => {
                if (!rawInsight.text?.trim()) return;
                const normalizedText = this.normalizeEntityKey(rawInsight.text);
                const insight: Insight = {
                    type: this.normalizeInsightType(rawInsight.type),
                    text: rawInsight.text.trim(),
                    importance: typeof rawInsight.importance === "number" ? rawInsight.importance : 0.7,
                };
                const existing = insightMap.get(normalizedText);
                if (!existing || existing.importance < insight.importance) {
                    insightMap.set(normalizedText, insight);
                }
            });

            (chunkResult.timeline || []).forEach((event) => {
                if (!event.date?.trim() || !event.event?.trim()) return;
                const key = `${event.date.trim()}|${this.normalizeEntityKey(event.event)}`;
                if (!timelineMap.has(key)) {
                    timelineMap.set(key, {
                        date: event.date.trim(),
                        event: event.event.trim(),
                    });
                }
            });

            (chunkResult.statements || [])
                .map((statement, index) => this.buildStatement(statement, chunkIndex * 1000 + index))
                .filter((statement): statement is Statement => Boolean(statement))
                .forEach((statement) => {
                    const key = this.normalizeEntityKey(statement.statement_text);
                    if (!statementMap.has(key)) {
                        statementMap.set(key, statement);
                    }
                });
        });

        const entities: Entity[] = Array.from(entityMap.entries())
            .map(([key, entry]) => {
                const preferredName = Array.from(entry.names).sort((a, b) => b.length - a.length)[0];
                return {
                    id: preferredName,
                    name: preferredName,
                    type: this.pickPreferredType(entry.typeCounts),
                    description: Array.from(entry.descriptions)[0] || "",
                    confidence:
                        entry.confidenceCount > 0 ? entry.confidenceTotal / entry.confidenceCount : 0.75,
                };
            })
            .sort((a, b) => {
                const aEntry = entityMap.get(this.normalizeEntityKey(a.name));
                const bEntry = entityMap.get(this.normalizeEntityKey(b.name));
                return (bEntry?.mentions || 0) - (aEntry?.mentions || 0);
            });

        const relations = Array.from(relationMap.values());
        const entityMetrics = new Map<
            string,
            { mentions: number; degree: number; confidence: number; descriptions: string[] }
        >();

        entities.forEach((entity) => {
            const entityKey = this.normalizeEntityKey(entity.name);
            const rawMetrics = entityMap.get(entityKey);
            const degree = relations.filter(
                (relation) =>
                    DataAlgorithmEngine.isEntityMatch(relation.source, entity.name) ||
                    DataAlgorithmEngine.isEntityMatch(relation.target, entity.name)
            ).length;

            entityMetrics.set(entity.name, {
                mentions: rawMetrics?.mentions || 1,
                degree,
                confidence: entity.confidence || 0.75,
                descriptions: rawMetrics ? Array.from(rawMetrics.descriptions) : [],
            });
        });

        const insights = Array.from(insightMap.values()).sort((a, b) => b.importance - a.importance);
        const timeline = Array.from(timelineMap.values()).sort(
            (a, b) => this.parseTimelineDate(a.date) - this.parseTimelineDate(b.date)
        );
        const statements = Array.from(statementMap.values());

        return {
            title: title || "Intelligence Report",
            entities,
            relations,
            insights,
            timeline,
            statements,
            relationCounts,
            entityMetrics,
        };
    }

    static parseTimelineDate(dateStr: string): number {
        if (!dateStr) return Number.MAX_SAFE_INTEGER;

        const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (ddmmyyyy) {
            const [, day, month, year] = ddmmyyyy;
            return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
        }

        const parsed = new Date(dateStr);
        return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
    }

    static buildShallowContextCards(
        entities: Entity[],
        relations: Relation[],
        entityMetrics: MergedKnowledge["entityMetrics"]
    ): Record<string, ContextCard> {
        const relationLookup = new Map<string, string[]>();
        relations.forEach((relation) => {
            const sourceList = relationLookup.get(relation.source) || [];
            sourceList.push(`${relation.target} (${relation.type})`);
            relationLookup.set(relation.source, sourceList);

            const targetList = relationLookup.get(relation.target) || [];
            targetList.push(`${relation.source} (${relation.type})`);
            relationLookup.set(relation.target, targetList);
        });

        return entities.reduce<Record<string, ContextCard>>((cards, entity) => {
            const metrics = entityMetrics.get(entity.name);
            const related = (relationLookup.get(entity.name) || []).slice(0, 4);
            const significance = this.scoreSignificance(metrics?.degree || 0, metrics?.mentions || 1);

            cards[entity.name] = {
                entityName: entity.name,
                type: entity.type,
                summary:
                    entity.description?.trim() ||
                    `Entity appears ${metrics?.mentions || 1} times and is connected to ${
                        metrics?.degree || 0
                    } other nodes${related.length ? `, including ${related.join(", ")}` : ""}.`,
                key_mentions: related,
                role_in_document: entity.description?.trim() || `Detected as ${entity.type}`,
                significance,
                status: "UNKNOWN",
                isShallow: true,
            };

            return cards;
        }, {});
    }

    private static scoreSignificance(degree: number, mentions: number): NonNullable<ContextCard["significance"]> {
        const score = degree * 12 + mentions * 6;
        if (score >= 90) return "CRITICAL";
        if (score >= 45) return "HIGH";
        if (score >= 20) return "MEDIUM";
        return "LOW";
    }

    static rebuildEntityMetrics(
        entities: Entity[],
        relations: Relation[],
        baselineMetrics?: MergedKnowledge["entityMetrics"]
    ): MergedKnowledge["entityMetrics"] {
        const entityMetrics = new Map<
            string,
            { mentions: number; degree: number; confidence: number; descriptions: string[] }
        >();

        entities.forEach((entity) => {
            const matchedMetrics = baselineMetrics
                ? Array.from(baselineMetrics.entries())
                      .filter(
                          ([name]) =>
                              DataAlgorithmEngine.isEntityMatch(name, entity.name) ||
                              (entity.aliases || []).some((alias) => DataAlgorithmEngine.isEntityMatch(name, alias))
                      )
                      .map(([, value]) => value)
                : [];

            const degree = relations.filter(
                (relation) =>
                    DataAlgorithmEngine.isEntityMatch(relation.source, entity.name) ||
                    DataAlgorithmEngine.isEntityMatch(relation.target, entity.name)
            ).length;

            const descriptions = Array.from(
                new Set(
                    [
                        entity.description?.trim(),
                        ...matchedMetrics.flatMap((metric) => metric.descriptions),
                    ].filter(Boolean)
                )
            ) as string[];

            const baselineMentions = matchedMetrics.reduce((sum, metric) => sum + (metric.mentions || 0), 0);
            const evidenceMentions = entity.evidence?.length || 0;
            const chunkMentions = entity.source_chunks?.length || 0;

            entityMetrics.set(entity.name, {
                mentions: Math.max(1, baselineMentions, evidenceMentions, chunkMentions),
                degree,
                confidence:
                    typeof entity.confidence === "number"
                        ? entity.confidence
                        : matchedMetrics[0]?.confidence || 0.75,
                descriptions,
            });
        });

        return entityMetrics;
    }

    static buildStrategicPromptInput(merged: MergedKnowledge, chunkCount: number, sourceText: string): string {
        const topEntities = merged.entities
            .slice(0, 30)
            .map((entity) => {
                const metrics = merged.entityMetrics.get(entity.name);
                return {
                    name: entity.name,
                    type: entity.type,
                    role: entity.description || "",
                    mentions: metrics?.mentions || 1,
                    degree: metrics?.degree || 0,
                    confidence: entity.confidence || 0.75,
                };
            });

        const topRelations = merged.relations
            .slice()
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 50)
            .map((relation) => ({
                source: relation.source,
                target: relation.target,
                type: relation.type,
                confidence: relation.confidence,
            }));

        const topStatements = merged.statements.slice(0, 30).map((statement) => ({
            text: statement.statement_text,
            knowledge: statement.knowledge,
            category: statement.category,
            confidence: statement.confidence,
            impact: statement.impact,
            intelligence_gap: statement.intelligence_gap,
        }));

        return JSON.stringify(
            {
                chunkCount,
                sourceLength: sourceText.length,
                sourcePreview: sourceText.slice(0, 1200),
                mergedTitle: merged.title,
                entityCount: merged.entities.length,
                relationCount: merged.relations.length,
                timelineCount: merged.timeline.length,
                statementCount: merged.statements.length,
                topEntities,
                topRelations,
                topInsights: merged.insights.slice(0, 20),
                timeline: merged.timeline.slice(0, 25),
                statements: topStatements,
                relationTypes: Array.from(merged.relationCounts.entries()).map(([type, count]) => ({ type, count })),
            },
            null,
            2
        );
    }

    static buildFallbackSummary(merged: MergedKnowledge, sourceText: string): string {
        const topEntities = merged.entities.slice(0, 5).map((entity) => entity.name);
        const timelineLead = merged.timeline[0]?.event;
        const insightLead = merged.insights[0]?.text;

        const parts = [
            `${merged.entities.length} entities and ${merged.relations.length} relationships were extracted from the document.`,
            topEntities.length ? `Most prominent entities: ${topEntities.join(", ")}.` : "",
            timelineLead ? `Earliest timeline signal: ${timelineLead}.` : "",
            insightLead ? `Primary finding: ${insightLead}` : "",
        ].filter(Boolean);

        return parts.join(" ") || sourceText.slice(0, 200);
    }

    static buildFallbackTacticalAssessment(merged: MergedKnowledge): TacticalAssessment {
        const topRelationTypes = Array.from(merged.relationCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([type]) => type);

        const gapStatements = merged.statements.filter((statement) => statement.intelligence_gap).slice(0, 4);

        return {
            ttps: topRelationTypes.length ? topRelationTypes : ["Entity association mapping"],
            recommendations: [
                "Validate the highest-confidence relations against source material.",
                "Prioritize collection around the most connected entities in the graph.",
                "Review timeline anomalies for operational sequencing.",
            ],
            gaps: gapStatements.length
                ? gapStatements.map((statement) => statement.statement_text)
                : ["Need additional corroboration for operational intent and missing actors."],
        };
    }

    static buildFallbackQuestions(merged: MergedKnowledge): IntelQuestion[] {
        const gaps = merged.statements.filter((statement) => statement.intelligence_gap).slice(0, 4);
        return gaps.map((statement, index) => ({
            question_id: `iq_${index}_${this.normalizeEntityKey(statement.statement_text).slice(0, 16)}`,
            statement_id: statement.statement_id,
            question_text: statement.statement_text,
            priority: "HIGH",
        }));
    }

    static buildFallbackTasks(merged: MergedKnowledge): IntelTask[] {
        return merged.entities.slice(0, 4).map((entity, index) => ({
            task_id: `task_${index}_${this.normalizeEntityKey(entity.name).slice(0, 16)}`,
            task_text: `Collect additional corroboration on ${entity.name} and validate linked relationships.`,
            urgency: index === 0 ? "IMMEDIATE" : "HIGH",
            status: "OPEN",
        }));
    }

    static buildFallbackReliability(merged: MergedKnowledge): number {
        const confidences = [
            ...merged.entities.map((entity) => entity.confidence || 0.75),
            ...merged.relations.map((relation) => relation.confidence || 0.7),
        ];
        if (confidences.length === 0) return 0.5;
        return Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2));
    }

    static buildKnowledgeSnapshot(pkg: IntelligencePackage, compact = false, summaryCharLimit?: number): string {
        const entityLimit = compact ? 24 : 40;
        const relationLimit = compact ? 30 : 50;
        const insightLimit = compact ? 10 : 15;
        const timelineLimit = compact ? 10 : 20;
        const statementLimit = compact ? 12 : 20;
        const summaryLimit = compact ? summaryCharLimit ?? 1200 : undefined;

        return JSON.stringify(
            {
                summary: summaryLimit ? pkg.clean_text.slice(0, summaryLimit) : pkg.clean_text,
                entityCount: pkg.entities.length,
                relationCount: pkg.relations.length,
                entities: pkg.entities.slice(0, entityLimit).map((entity) => ({
                    name: entity.name,
                    type: entity.type,
                    description: entity.description,
                    confidence: entity.confidence,
                })),
                relations: pkg.relations.slice(0, relationLimit),
                insights: pkg.insights.slice(0, insightLimit),
                timeline: (pkg.timeline || []).slice(0, timelineLimit),
                tactical_assessment: pkg.tactical_assessment,
                statements: (pkg.statements || []).slice(0, statementLimit).map((statement) => ({
                    text: statement.statement_text,
                    category: statement.category,
                    impact: statement.impact,
                    intelligence_gap: statement.intelligence_gap,
                })),
            },
            null,
            2
        );
    }

    static extractRelevantPassages(source: string, needles: string[], maxChars = MAX_CONTEXT_EXCERPT_CHARS): string {
        const normalizedSource = this.normalizeSourceText(source);
        if (!normalizedSource) return "";

        const passages: string[] = [];
        const seen = new Set<string>();

        needles
            .filter(Boolean)
            .forEach((needle) => {
                const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const matcher = new RegExp(escaped, "ig");
                let match: RegExpExecArray | null = null;
                let iterations = 0;

                while ((match = matcher.exec(normalizedSource)) && iterations < 12) {
                    const start = Math.max(0, match.index - 280);
                    const end = Math.min(normalizedSource.length, match.index + needle.length + 360);
                    const excerpt = normalizedSource.slice(start, end).trim();
                    if (excerpt && !seen.has(excerpt)) {
                        passages.push(excerpt);
                        seen.add(excerpt);
                    }
                    iterations += 1;
                }
            });

        if (passages.length === 0) {
            passages.push(normalizedSource.slice(0, maxChars));
        }

        const combined = passages.join("\n\n---\n\n");
        return combined.slice(0, maxChars);
    }

    static summarizeLinkedStudies(studies: StudyItem[]): string {
        return JSON.stringify(
            studies.map((study) => ({
                id: study.id,
                title: study.title,
                date: study.date,
                summary: study.intelligence.clean_text,
                entities: study.intelligence.entities.slice(0, 20).map((entity) => entity.name),
                insights: study.intelligence.insights.slice(0, 5).map((insight) => insight.text),
                timeline: (study.intelligence.timeline || []).slice(0, 8),
            })),
            null,
            2
        );
    }
}

/**
 * ==================================================================================
 * PART 3: COGNITIVE GATEWAY (OLLAMA WRAPPER)
 * Routes all model calls to a locally running Ollama instance.
 * ==================================================================================
 */
class CognitiveGateway {
    private static buildBaseUrls(): string[] {
        const isBrowser = typeof window !== "undefined";
        if (isBrowser) {
            const configuredUrl = DEFAULT_OLLAMA_BASE_URL.trim();
            const browserUrls = configuredUrl.startsWith("/") ? [configuredUrl, "/ollama"] : ["/ollama"];
            return Array.from(new Set(browserUrls));
        }

        const urls = [DEFAULT_OLLAMA_BASE_URL];

        if (
            DEFAULT_OLLAMA_BASE_URL !== "/ollama" &&
            !DEFAULT_OLLAMA_BASE_URL.endsWith("/ollama")
        ) {
            urls.push("/ollama");
        }

        return Array.from(new Set(urls));
    }

    private static normalizeBaseUrl(baseUrl: string): string {
        return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    }

    private static buildSystemInstruction(systemInstruction?: string, schema?: JsonSchema): string {
        const instruction = systemInstruction || "You are TEVEL, an elite intelligence analyst.";

        if (!schema) {
            return instruction;
        }

        return `${instruction}

Return only valid JSON. If you must use markdown fences, use markdown code blocks.
Keep field names exactly as requested.
Use exhaustive recall when extracting entities and relations from a chunk.
Schema:
${JSON.stringify(schema, null, 2)}`;
    }

    private static extractJsonBlock(raw: string): string {
        const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");

        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch {
            // Continue to block extraction.
        }

        const startCandidates = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0);
        if (startCandidates.length === 0) {
            throw new Error("No JSON object found in model response.");
        }

        const start = Math.min(...startCandidates);
        const opening = trimmed[start];
        const closing = opening === "{" ? "}" : "]";
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = start; index < trimmed.length; index += 1) {
            const char = trimmed[index];

            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === "\\") {
                    escaped = true;
                } else if (char === "\"") {
                    inString = false;
                }
                continue;
            }

            if (char === "\"") {
                inString = true;
                continue;
            }

            if (char === opening) {
                depth += 1;
            } else if (char === closing) {
                depth -= 1;
                if (depth === 0) {
                    return trimmed.slice(start, index + 1);
                }
            }
        }

        throw new Error("Model returned malformed JSON.");
    }

    private static async requestGemini(params: {
        prompt: string;
        model: string;
        apiKey?: string;
        systemInstruction?: string;
        schema?: JsonSchema;
        timeoutMs?: number;
    }): Promise<string> {
        const apiKey = (params.apiKey || GEMINI_API_KEY).trim();
        if (!apiKey) {
            throw new Error("Gemini API key is not configured.");
        }

        const timeoutMs = params.timeoutMs || REQUEST_TIMEOUT_MS;
        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

        try {
            // Clean model name and paths
            const modelName = params.model.includes("gemini") ? params.model : DEFAULT_GEMINI_MODEL;
            const isBrowser = typeof window !== "undefined";
            
            // Try v1beta first as it is more feature-rich, then v1
            const urls = isBrowser 
                ? [
                    `/gemini/v1beta/models/${modelName}:generateContent`,
                    `/gemini/v1/models/${modelName}:generateContent`
                  ]
                : [
                    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
                    `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent`
                  ];

            let lastError: Error | null = null;
            for (const url of urls) {
                try {
                    const body = {
                        contents: [
                            {
                                parts: [
                                    { text: `SYSTEM INSTRUCTION:\n${this.buildSystemInstruction(params.systemInstruction, params.schema)}\n\nUSER PROMPT:\n${params.prompt}` }
                                ],
                            },
                        ],
                    };

                    console.info(`[CognitiveGateway] Attempting Gemini via: ${url.split('?')[0]}`);

                    const response = await fetch(url, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-goog-api-key": apiKey,
                        },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        const errorMsg = `Status ${response.status}: ${JSON.stringify(errorData)}`;
                        console.error(`[CognitiveGateway] Gemini request failed: ${errorMsg}`);
                        throw new Error(errorMsg);
                    }

                    const data = await response.json();
                    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

                    if (!content.trim()) {
                        throw new Error("Empty response from model");
                    }

                    console.info(`[CognitiveGateway] Gemini success (${content.length} chars)`);
                    return content.trim();
                } catch (e: any) {
                    lastError = e;
                    console.warn(`Gemini attempt to ${url.split('?')[0]} failed:`, e.message);
                    continue; // Try next URL
                }
            }
            throw lastError || new Error("All Gemini connectivity paths failed.");
        } catch (error: any) {
            if (error.name === "AbortError" || error.message?.includes("aborted")) {
                throw new Error("Gemini API request timed out.");
            }
            throw error instanceof Error ? error : new Error(String(error));
        } finally {
            globalThis.clearTimeout(timeoutId);
        }
    }

    private static async requestModel(params: {
        prompt: string;
        model: string;
        systemInstruction?: string;
        schema?: JsonSchema;
        format?: JsonSchema | "json";
        timeoutMs?: number;
        reasoningEngineId?: ReasoningEngineId;
        geminiApiKey?: string;
    }): Promise<string> {
        const explicitGeminiModel = params.model.includes("gemini");
        const forcedGemini = params.reasoningEngineId === "gemini-cloud";
        const forcedLocal = params.reasoningEngineId === "ollama-local";
        const shouldUseGemini = forcedGemini || (!forcedLocal && (USE_GEMINI_BY_DEFAULT || explicitGeminiModel));

        if (shouldUseGemini) {
            try {
                return await this.requestGemini({
                    prompt: params.prompt,
                    model: forcedGemini && !explicitGeminiModel ? DEFAULT_GEMINI_MODEL : params.model,
                    apiKey: params.geminiApiKey,
                    systemInstruction: params.systemInstruction,
                    schema: params.schema,
                    timeoutMs: params.timeoutMs,
                });
            } catch (error) {
                console.error("Gemini request failed:", error);
                console.warn("Gemini reasoning failed; falling back to local Ollama reasoning.");
                // Fall through to Ollama — do not re-throw. If the user explicitly selected
                // gemini-cloud but it's unavailable (no key, network error), Ollama is a
                // better answer than a raw deterministic atom dump.
            }
        }

        const timeoutMs = params.timeoutMs || REQUEST_TIMEOUT_MS;
        let lastError: Error | null = null;

        const ollamaModels = Array.from(new Set([params.model, DEFAULT_FAST_OLLAMA_MODEL].filter((model) => model && !model.includes("gemini"))));

        for (const model of ollamaModels) {
            for (const baseUrl of this.buildBaseUrls()) {
                const controller = new AbortController();
                const timeoutId = globalThis.setTimeout(() => controller.abort(), Math.min(timeoutMs, LOCAL_MODEL_ATTEMPT_TIMEOUT_MS));

                try {
                    console.info(`[CognitiveGateway] Attempting Ollama model ${model} via ${this.normalizeBaseUrl(baseUrl)}`);
                    const response = await fetch(`${this.normalizeBaseUrl(baseUrl)}/api/chat`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model,
                            stream: false,
                            format: params.format,
                            options: {
                                temperature: 0.15,
                                num_ctx: 6144,
                                num_predict: 1200,
                                repeat_penalty: 1.15,
                                think: false,
                            },
                            messages: [
                                {
                                    role: "system",
                                    content: this.buildSystemInstruction(params.systemInstruction, params.schema),
                                },
                                {
                                    role: "user",
                                    content: params.prompt,
                                },
                            ],
                        }),
                        signal: controller.signal,
                    });

                    if (!response.ok) {
                        throw new Error(`Ollama request failed with status ${response.status}.`);
                    }

                    const data = (await response.json()) as OllamaResponse;
                    if (data.error) {
                        throw new Error(data.error);
                    }

                    const content = data.message?.content || data.response || "";
                    if (!content.trim()) {
                        throw new Error("Local model returned an empty response.");
                    }

                    return content.trim();
                } catch (error: any) {
                    if (error.name === "AbortError" || error.message?.includes("aborted")) {
                        lastError = new Error(`Local model ${model} request timed out.`);
                    } else {
                        lastError = error instanceof Error ? error : new Error(String(error));
                    }
                    console.warn(`[CognitiveGateway] Ollama model ${model} failed:`, lastError.message);
                } finally {
                    globalThis.clearTimeout(timeoutId);
                }
            }
        }

        throw lastError || new Error("Unable to reach the local model.");
    }

    static async generate(params: {
        prompt: string;
        model?: string;
        systemInstruction?: string;
        schema?: JsonSchema;
        timeoutMs?: number;
        reasoningEngineId?: ReasoningEngineId;
        geminiApiKey?: string;
    }): Promise<string> {
        const selectedEngine = getReasoningEngineDescriptor(params.reasoningEngineId);
        const model = params.model || selectedEngine.model;
        const usingGemini = selectedEngine.id === "gemini-cloud" || model.includes("gemini");
        
        console.info(`[CognitiveGateway] Generating with ${usingGemini ? "Gemini (Cloud)" : `Ollama (${model})`}`);

        try {
            const content = await this.requestModel({
                prompt: params.prompt,
                model,
                systemInstruction: params.systemInstruction,
                schema: params.schema,
                format: params.schema,
                timeoutMs: params.timeoutMs,
                reasoningEngineId: params.reasoningEngineId,
                geminiApiKey: params.geminiApiKey,
            });

            return params.schema ? this.extractJsonBlock(content) : content;
        } catch (error) {
            if (!params.schema) {
                throw error;
            }

            const fallbackContent = await this.requestModel({
                prompt: `${params.prompt}

Return a valid JSON object only. Do not add explanations.`,
                model,
                systemInstruction: params.systemInstruction,
                schema: params.schema,
                format: "json",
                timeoutMs: params.timeoutMs,
                reasoningEngineId: params.reasoningEngineId,
                geminiApiKey: params.geminiApiKey,
            });

            return this.extractJsonBlock(fallbackContent);
        }
    }
}

async function generateStructured<T>(params: {
    prompt: string;
    systemInstruction?: string;
    schema: JsonSchema;
    fallback: T;
}): Promise<T> {
    try {
        const json = await CognitiveGateway.generate({
            prompt: params.prompt,
            systemInstruction: params.systemInstruction,
            schema: params.schema,
        });
        return JSON.parse(json) as T;
    } catch (error) {
        console.error("Structured generation failed, using fallback:", error);
        return params.fallback;
    }
}

/**
 * ==================================================================================
 * PART 4: RUNTIME REASONING INDEX
 * Hybrid retrieval inspired by Contextual Retrieval, GraphRAG/DRIFT, and late reranking.
 * ==================================================================================
 */
class RetrievalReasoningEngine {
    private static indexCache = new WeakMap<IntelligencePackage, RuntimeReasoningIndex>();
    private static embeddingModelPromise: Promise<string | null> | null = null;
    private static embeddingCache = new Map<string, number[]>();

    static async getIndex(pkg: IntelligencePackage): Promise<RuntimeReasoningIndex> {
        const cached = this.indexCache.get(pkg);
        if (cached) return cached;

        const index = this.buildIndex(pkg);
        this.indexCache.set(pkg, index);
        return index;
    }

    private static buildIndex(pkg: IntelligencePackage): RuntimeReasoningIndex {
        const sourceText = KnowledgeFusionEngine.normalizeSourceText(pkg.raw_text || pkg.clean_text);
        const retrievalChunks = KnowledgeFusionEngine.splitIntoChunks(
            sourceText,
            RETRIEVAL_CHUNK_CHARS,
            RETRIEVAL_CHUNK_OVERLAP_CHARS
        );
        const communities = this.buildCommunities(pkg);
        const communityByEntity = new Map<string, RuntimeCommunity>();
        communities.forEach((community) => {
            community.entityNames.forEach((entityName) => communityByEntity.set(entityName, community));
        });

        const entityNeighbors = new Map<string, string[]>();
        pkg.entities.forEach((entity) => {
            const neighbors = new Set<string>();
            pkg.relations.forEach((relation) => {
                if (DataAlgorithmEngine.isEntityMatch(relation.source, entity.name)) {
                    neighbors.add(relation.target);
                }
                if (DataAlgorithmEngine.isEntityMatch(relation.target, entity.name)) {
                    neighbors.add(relation.source);
                }
            });
            entityNeighbors.set(entity.name, Array.from(neighbors));
        });

        const chunks: RuntimeEvidenceItem[] = retrievalChunks.map((chunk) => {
            const entityNames = this.detectEntitiesInText(chunk.content, pkg.entities);
            const dominantCommunity = this.pickDominantCommunity(entityNames, communityByEntity);
            const contextualHeader = [
                `Document: ${pkg.document_metadata?.title || "Untitled Intelligence Package"}`,
                `Chunk: ${chunk.index + 1}/${retrievalChunks.length}`,
                entityNames.length ? `Entities: ${entityNames.slice(0, 10).join(", ")}` : "Entities: none detected",
                dominantCommunity ? `Community: ${dominantCommunity.label}` : "",
            ]
                .filter(Boolean)
                .join(" | ");

            return {
                id: `chunk_${chunk.index}`,
                kind: "chunk",
                title: `Evidence Chunk ${chunk.index + 1}`,
                text: `${contextualHeader}\n${chunk.content}`,
                entityNames,
                communityId: dominantCommunity?.id,
                graphWeight: entityNames.reduce(
                    (sum, entityName) => sum + (entityNeighbors.get(entityName)?.length || 0),
                    0
                ),
            };
        });

        const communityEvidence: RuntimeEvidenceItem[] = communities.map((community) => ({
            id: `community_${community.id}`,
            kind: "community",
            title: community.label,
            text: community.summary,
            entityNames: community.entityNames,
            communityId: community.id,
            graphWeight: community.centralEntityNames.length * 4 + community.entityNames.length,
        }));

        const insightEvidence: RuntimeEvidenceItem[] = (pkg.insights || []).map((insight, index) => ({
            id: `insight_${index}`,
            kind: "insight",
            title: `Insight: ${insight.type}`,
            text: insight.text,
            entityNames: this.detectEntitiesInText(insight.text, pkg.entities),
            graphWeight: Math.round((insight.importance || 0.5) * 10),
        }));

        const statementEvidence: RuntimeEvidenceItem[] = (pkg.statements || []).map((statement, index) => ({
            id: `statement_${index}`,
            kind: "statement",
            title: `Statement: ${statement.category}`,
            text: statement.statement_text,
            entityNames: statement.related_entities?.length
                ? statement.related_entities
                : this.detectEntitiesInText(statement.statement_text, pkg.entities),
            graphWeight: Math.round((statement.confidence || 0.6) * 10) + (statement.intelligence_gap ? 4 : 0),
        }));

        const timelineEvidence: RuntimeEvidenceItem[] = (pkg.timeline || []).map((event, index) => ({
            id: `timeline_${index}`,
            kind: "timeline",
            title: `Timeline: ${event.date}`,
            text: `${event.date} - ${event.event}`,
            entityNames: this.detectEntitiesInText(event.event, pkg.entities),
            graphWeight: 4,
        }));

        const entityEvidence: RuntimeEvidenceItem[] = pkg.entities.map((entity, index) => {
            const contextCard = pkg.context_cards?.[entity.name];
            return {
                id: `entity_${index}`,
                kind: "entity",
                title: `Entity: ${entity.name}`,
                text: [
                    contextCard?.summary || entity.description || `${entity.name} detected as ${entity.type}.`,
                    contextCard?.role_in_document ? `Role: ${contextCard.role_in_document}` : "",
                    entity.aliases?.length ? `Aliases: ${entity.aliases.join(", ")}` : "",
                    entity.evidence?.length ? `Evidence:\n${entity.evidence.join("\n\n")}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                entityNames: [entity.name],
                communityId: communityByEntity.get(entity.name)?.id,
                graphWeight:
                    Math.round((entity.salience || 0.45) * 10) +
                    (entityNeighbors.get(entity.name)?.length || 0) +
                    Math.min(4, entity.source_chunks?.length || 0),
            };
        });

        const relationEvidence: RuntimeEvidenceItem[] = pkg.relations.map((relation, index) => ({
            id: `relation_${index}`,
            kind: "relation",
            title: `Relation: ${relation.type}`,
            text: `${relation.source} ${relation.type} ${relation.target}`,
            entityNames: [relation.source, relation.target],
            communityId: communityByEntity.get(relation.source)?.id || communityByEntity.get(relation.target)?.id,
            graphWeight: Math.round((relation.confidence || 0.6) * 10),
        }));

        const evidence = [
            ...chunks,
            ...communityEvidence,
            ...entityEvidence,
            ...insightEvidence,
            ...statementEvidence,
            ...timelineEvidence,
            ...relationEvidence,
        ];

        const centralEntityNames = pkg.entities
            .slice()
            .sort(
                (a, b) =>
                    (entityNeighbors.get(b.name)?.length || 0) - (entityNeighbors.get(a.name)?.length || 0)
            )
            .slice(0, 12)
            .map((entity) => entity.name);

        return {
            chunks,
            communities,
            evidence,
            centralEntityNames,
            entityNeighbors,
        };
    }

    private static buildCommunities(pkg: IntelligencePackage): RuntimeCommunity[] {
        const adjacency = new Map<string, Set<string>>();
        pkg.entities.forEach((entity) => adjacency.set(entity.name, new Set()));
        pkg.relations.forEach((relation) => {
            if (!adjacency.has(relation.source)) adjacency.set(relation.source, new Set());
            if (!adjacency.has(relation.target)) adjacency.set(relation.target, new Set());
            adjacency.get(relation.source)!.add(relation.target);
            adjacency.get(relation.target)!.add(relation.source);
        });

        const visited = new Set<string>();
        const communities: RuntimeCommunity[] = [];

        for (const entityName of adjacency.keys()) {
            if (visited.has(entityName)) continue;
            const queue = [entityName];
            const component: string[] = [];
            visited.add(entityName);

            while (queue.length) {
                const current = queue.shift()!;
                component.push(current);
                (adjacency.get(current) || new Set()).forEach((neighbor) => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            }

            const relationTypes = Array.from(
                new Set(
                    pkg.relations
                        .filter(
                            (relation) =>
                                component.some((name) => DataAlgorithmEngine.isEntityMatch(name, relation.source)) &&
                                component.some((name) => DataAlgorithmEngine.isEntityMatch(name, relation.target))
                        )
                        .map((relation) => relation.type)
                )
            );

            const centralEntityNames = component
                .slice()
                .sort(
                    (a, b) => (adjacency.get(b)?.size || 0) - (adjacency.get(a)?.size || 0)
                )
                .slice(0, 4);

            const label =
                component.length === 1
                    ? `Entity Cell: ${component[0]}`
                    : `Community around ${centralEntityNames.join(", ")}`;

            const summary = [
                label,
                `Contains ${component.length} entities.`,
                centralEntityNames.length ? `Central actors: ${centralEntityNames.join(", ")}.` : "",
                relationTypes.length ? `Common link types: ${relationTypes.slice(0, 6).join(", ")}.` : "",
                pkg.insights.find((insight) =>
                    component.some((entityName) =>
                        this.detectEntitiesInText(insight.text, component.map((name) => ({ id: name, name, type: "MISC" } as Entity))).length > 0
                    )
                )?.text || "",
            ]
                .filter(Boolean)
                .join(" ");

            communities.push({
                id: `c_${communities.length}`,
                label,
                summary,
                entityNames: component,
                centralEntityNames,
                relationTypes,
            });
        }

        return communities;
    }

    private static detectEntitiesInText(text: string, entities: Entity[]): string[] {
        const normalizedText = KnowledgeFusionEngine.normalizeEntityKey(text);
        return entities
            .slice()
            .sort(
                (a, b) =>
                    (b.salience || 0) - (a.salience || 0) ||
                    (b.source_chunks?.length || 0) - (a.source_chunks?.length || 0) ||
                    b.name.length - a.name.length
            )
            .flatMap((entity) =>
                [entity.name, ...(entity.aliases || [])]
                    .filter(Boolean)
                    .map((candidate) => ({
                        canonicalName: entity.name,
                        candidate,
                    }))
            )
            .filter(({ candidate }) => {
                const normalizedName = KnowledgeFusionEngine.normalizeEntityKey(candidate);
                if (!normalizedName) return false;
                if (normalizedName.length <= 2) {
                    return normalizedText.split(" ").includes(normalizedName);
                }
                return normalizedText.includes(normalizedName);
            })
            .map(({ canonicalName }) => canonicalName)
            .filter((name, index, source) => source.findIndex((candidate) => candidate === name) === index)
            .sort((a, b) => b.length - a.length)
            .slice(0, MAX_EVIDENCE_ENTITY_NAMES);
    }

    private static pickDominantCommunity(
        entityNames: string[],
        communityByEntity: Map<string, RuntimeCommunity>
    ): RuntimeCommunity | undefined {
        const counts = new Map<string, number>();
        entityNames.forEach((entityName) => {
            const community = communityByEntity.get(entityName);
            if (!community) return;
            counts.set(community.id, (counts.get(community.id) || 0) + 1);
        });

        const topCommunityId = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
        return topCommunityId ? Array.from(communityByEntity.values()).find((item) => item.id === topCommunityId) : undefined;
    }

    private static normalizeQueryTerms(query: string): string[] {
        return KnowledgeFusionEngine.normalizeEntityKey(query)
            .split(" ")
            .map((item) => item.trim())
            .filter((item) => item.length > 1);
    }

    private static lexicalScore(queryTerms: string[], evidence: RuntimeEvidenceItem): number {
        if (!queryTerms.length) return 0;
        const haystack = KnowledgeFusionEngine.normalizeEntityKey(`${evidence.title} ${evidence.text}`);
        let score = 0;
        queryTerms.forEach((term) => {
            if (haystack.includes(term)) score += 1;
        });
        return score / queryTerms.length;
    }

    private static structuralScore(
        query: string,
        queryEntityNames: string[],
        evidence: RuntimeEvidenceItem,
        index: RuntimeReasoningIndex
    ): number {
        let score = evidence.graphWeight / 20;
        const matchedCentral = index.centralEntityNames.some(
            (entityName) =>
                query.toLowerCase().includes(entityName.toLowerCase()) ||
                evidence.entityNames.some((candidate) => DataAlgorithmEngine.isEntityMatch(candidate, entityName))
        );
        if (matchedCentral) score += 0.6;
        if (
            queryEntityNames.some((entityName) =>
                evidence.entityNames.some((candidate) => DataAlgorithmEngine.isEntityMatch(candidate, entityName))
            )
        ) {
            score += 0.45;
        }
        if (evidence.kind === "community") score += 0.25;
        if (evidence.kind === "statement" || evidence.kind === "insight") score += 0.2;
        if (evidence.kind === "entity" || evidence.kind === "relation") score += 0.08;
        return score;
    }

    private static async detectEmbeddingModel(): Promise<string | null> {
        if (this.embeddingModelPromise) {
            return this.embeddingModelPromise;
        }

        this.embeddingModelPromise = (async () => {
            const baseUrls = [DEFAULT_OLLAMA_BASE_URL, "/ollama"];
            for (const baseUrl of Array.from(new Set(baseUrls))) {
                try {
                    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
                    if (!response.ok) continue;
                    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
                    const modelNames = (payload.models || [])
                        .flatMap((model) => [model.name, model.model])
                        .filter((name): name is string => Boolean(name));

                    for (const candidate of EMBEDDING_MODEL_CANDIDATES) {
                        const match = modelNames.find((name) => name.includes(candidate));
                        if (match) return match;
                    }
                } catch (error) {
                    console.warn("Embedding model discovery failed:", error);
                }
            }
            this.embeddingModelPromise = null;
            return null;
        })();

        return this.embeddingModelPromise;
    }

    private static getShortlistTarget(index: RuntimeReasoningIndex): number {
        return Math.min(36, Math.max(18, Math.round(index.evidence.length * 0.08)));
    }

    private static getAdaptiveTopK(pkg: IntelligencePackage): number {
        return Math.min(14, Math.max(DEFAULT_RETRIEVAL_TOP_K, 8 + Math.ceil((pkg.entities.length || 0) / 40)));
    }

    private static dedupeEvidenceCandidates(
        candidates: Array<{ evidence: RuntimeEvidenceItem; lexical: number; structural: number }>
    ): Array<{ evidence: RuntimeEvidenceItem; lexical: number; structural: number }> {
        const deduped = new Map<string, { evidence: RuntimeEvidenceItem; lexical: number; structural: number }>();

        candidates.forEach((candidate) => {
            const existing = deduped.get(candidate.evidence.id);
            if (!existing) {
                deduped.set(candidate.evidence.id, candidate);
                return;
            }

            if (candidate.lexical + candidate.structural > existing.lexical + existing.structural) {
                deduped.set(candidate.evidence.id, candidate);
            }
        });

        return Array.from(deduped.values());
    }

    private static async embedTexts(texts: string[]): Promise<Map<string, number[]> | null> {
        const model = await this.detectEmbeddingModel();
        if (!model) return null;

        const uncached = texts.filter((text) => !this.embeddingCache.has(text));
        if (!uncached.length) {
            return new Map(texts.map((text) => [text, this.embeddingCache.get(text)!]));
        }

        const baseUrls = [DEFAULT_OLLAMA_BASE_URL, "/ollama"];
        for (const baseUrl of Array.from(new Set(baseUrls))) {
            try {
                const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embed`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model,
                        input: uncached,
                    }),
                });
                if (!response.ok) continue;

                const payload = (await response.json()) as { embeddings?: number[][] };
                (payload.embeddings || []).forEach((embedding, index) => {
                    this.embeddingCache.set(uncached[index], embedding);
                });

                const cachedEntries: Array<[string, number[]]> = texts.flatMap((text) => {
                    const value = this.embeddingCache.get(text);
                    return value ? [[text, value]] : [];
                });
                return new Map(cachedEntries);
            } catch (error) {
                console.warn("Embedding request failed:", error);
            }
        }

        return null;
    }

    private static cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        const length = Math.min(a.length, b.length);

        for (let index = 0; index < length; index += 1) {
            dot += a[index] * b[index];
            normA += a[index] * a[index];
            normB += b[index] * b[index];
        }

        if (!normA || !normB) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private static async rerank(query: string, candidates: RuntimeEvidenceItem[]): Promise<RuntimeEvidenceItem[]> {
        if (candidates.length <= 3) return candidates;

        const rerankSchema: JsonSchema = {
            type: JSON_TYPES.object,
            properties: {
                ranked_ids: {
                    type: JSON_TYPES.array,
                    items: { type: JSON_TYPES.string },
                },
            },
            required: ["ranked_ids"],
        };

        const response = await generateStructured<{ ranked_ids?: string[] }>({
            prompt: `Rank the following evidence items for answering the user query.

QUERY:
${query}

CANDIDATES:
${JSON.stringify(
                candidates.map((candidate) => ({
                    id: candidate.id,
                    title: candidate.title,
                    kind: candidate.kind,
                    text: candidate.text.slice(0, 500),
                })),
                null,
                2
            )}

Return candidate ids ordered from most useful to least useful.`,
            systemInstruction:
                "You are a retrieval reranker. Order the evidence items by usefulness for answering the query. Preserve exact ids.",
            schema: rerankSchema,
            fallback: { ranked_ids: candidates.map((candidate) => candidate.id) },
        });

        const rankMap = new Map((response.ranked_ids || []).map((id, index) => [id, index]));
        return candidates.slice().sort((a, b) => (rankMap.get(a.id) ?? 999) - (rankMap.get(b.id) ?? 999));
    }

    static async retrieve(
        query: string,
        pkg: IntelligencePackage,
        topK = 8,
        options?: QuestionAnswerOptions,
    ): Promise<RuntimeEvidenceItem[]> {
        const index = await this.getIndex(pkg);
        const queryTerms = this.normalizeQueryTerms(query);
        const queryEntityNames = this.detectEntitiesInText(query, pkg.entities);

        const baseScores = index.evidence.map((evidence) => ({
            evidence,
            lexical: this.lexicalScore(queryTerms, evidence),
            structural: this.structuralScore(query, queryEntityNames, evidence, index),
        }));

        const shortlistTarget = this.getShortlistTarget(index);
        const lexicalShortlist = baseScores
            .filter((item) => item.lexical > 0 || item.structural > 0.12)
            .sort((a, b) => b.lexical + b.structural - (a.lexical + a.structural))
            .slice(0, shortlistTarget);
        const graphBackfill = baseScores
            .slice()
            .sort(
                (a, b) =>
                    b.structural + b.evidence.graphWeight / 25 - (a.structural + a.evidence.graphWeight / 25)
            )
            .slice(0, Math.max(6, Math.ceil(shortlistTarget / 3)));
        const shortlist = this.dedupeEvidenceCandidates([...lexicalShortlist, ...graphBackfill]).slice(
            0,
            shortlistTarget
        );

        if (!shortlist.length) {
            if (options?.fastMode) {
                return index.evidence
                    .slice()
                    .sort((left, right) => right.graphWeight - left.graphWeight)
                    .slice(0, Math.max(4, Math.min(topK, 6)));
            }
            return index.evidence.slice(0, Math.max(topK, this.getAdaptiveTopK(pkg)));
        }

        if (options?.fastMode) {
            return shortlist
                .map((item) => ({
                    evidence: item.evidence,
                    score:
                        item.lexical * 0.58 +
                        item.structural * 0.3 +
                        (queryEntityNames.some((entityName) =>
                            item.evidence.entityNames.some((candidate) => DataAlgorithmEngine.isEntityMatch(candidate, entityName))
                        )
                            ? 0.12
                            : 0),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, Math.max(4, Math.min(topK, 6)))
                .map((item) => item.evidence);
        }

        const embeddingTexts = [query, ...shortlist.map((item) => item.evidence.text.slice(0, 1000))];
        const embeddings = await this.embedTexts(embeddingTexts);
        const queryEmbedding = embeddings?.get(query);

        const rescored = shortlist.map((item, index) => {
            const text = item.evidence.text.slice(0, 1000);
            const semantic =
                queryEmbedding && embeddings?.get(text)
                    ? this.cosineSimilarity(queryEmbedding, embeddings.get(text)!)
                    : 0;

            return {
                evidence: item.evidence,
                score:
                    item.lexical * 0.32 +
                    semantic * 0.38 +
                    item.structural * 0.2 +
                    (queryEntityNames.some((entityName) =>
                        item.evidence.entityNames.some((candidate) => DataAlgorithmEngine.isEntityMatch(candidate, entityName))
                    )
                        ? 0.1
                        : 0),
                semantic,
            };
        });

        const reranked = await this.rerank(
            query,
            rescored
                .sort((a, b) => b.score - a.score)
                .slice(0, Math.min(16, Math.max(10, Math.ceil(shortlist.length * 0.5))))
                .map((item) => item.evidence)
        );

        return reranked.slice(0, Math.max(topK, this.getAdaptiveTopK(pkg)));
    }

    private static selectRelevantCitableEvidence(
        query: string,
        pkg: IntelligencePackage,
        limit: number,
    ): RetrievalEvidenceHit[] {
        const queryTerms = this.normalizeQueryTerms(query);
        const queryEntityNames = this.detectEntitiesInText(query, pkg.entities);

        return Object.values(pkg.retrieval_artifacts?.bundles || {})
            .flatMap((bundle) => bundle.hits)
            .filter((hit) => !hit.reference_only && (hit.evidence_id || hit.item_id))
            .map((hit) => {
                const normalizedSnippet = KnowledgeFusionEngine.normalizeEntityKey(hit.snippet);
                const lexicalScore = queryTerms.length
                    ? queryTerms.filter((term) => normalizedSnippet.includes(term)).length / queryTerms.length
                    : 0;
                const entityScore = queryEntityNames.some((entityName) =>
                    hit.related_entities.some((candidate) => DataAlgorithmEngine.isEntityMatch(candidate, entityName))
                )
                    ? 0.6
                    : 0;
                const phraseScore = hit.related_entities.some((candidate) =>
                    KnowledgeFusionEngine.normalizeEntityKey(query).includes(KnowledgeFusionEngine.normalizeEntityKey(candidate))
                )
                    ? 0.45
                    : 0;

                return {
                    hit,
                    relevance: lexicalScore * 1.5 + entityScore + phraseScore + hit.score * 0.08,
                };
            })
            .filter((item) => item.relevance > 0)
            .sort((left, right) => right.relevance - left.relevance)
            .slice(0, limit)
            .map((item) => item.hit);
    }

    static async buildAnswerContext(query: string, pkg: IntelligencePackage, options?: QuestionAnswerOptions): Promise<string> {
        const index = await this.getIndex(pkg);
        const evidence = await this.retrieve(query, pkg, this.getAdaptiveTopK(pkg), options);
        const citableEvidence = this.selectRelevantCitableEvidence(query, pkg, options?.fastMode ? 6 : 10);
        const relevantCommunities = index.communities
            .filter((community) =>
                evidence.some((item) => item.communityId === community.id) ||
                community.centralEntityNames.some((entityName) =>
                    query.toLowerCase().includes(entityName.toLowerCase())
                )
            )
            .slice(0, 4);
        const citableSnippetLimit = options?.fastMode ? 280 : 700;
        const topEvidenceLimit = options?.fastMode ? 320 : 900;

        return [
            "COMMUNITY VIEW:",
            relevantCommunities.map((community) => `- ${community.summary}`).join("\n") || "- None",
            "",
            "CITABLE EVIDENCE:",
            citableEvidence.length
                ? citableEvidence
                      .map((item) => {
                          const id = item.evidence_id || item.item_id;
                          const state = item.version_state ? ` | version=${item.version_state}` : "";
                          return `[${id}${state}] ${item.snippet.slice(0, citableSnippetLimit)}`;
                      })
                      .join("\n\n")
                : "- No exact evidence atoms available; answer conservatively.",
            "",
            "TOP EVIDENCE:",
            evidence
                .map(
                    (item, index) =>
                        `[${index + 1}] ${item.title}\n${item.text.slice(0, topEvidenceLimit)}`
                )
                .join("\n\n"),
        ].join("\n");
    }

    static async buildCrossStudyMap(currentStudy: StudyItem, linkedStudies: StudyItem[]): Promise<string> {
        const currentEntities = currentStudy.intelligence.entities.map((entity) => entity.name);
        const overlaps = linkedStudies.map((study) => {
            const sharedEntities = study.intelligence.entities
                .map((entity) => entity.name)
                .filter((entityName) =>
                    currentEntities.some((currentName) => DataAlgorithmEngine.isEntityMatch(currentName, entityName))
                );

            return {
                id: study.id,
                title: study.title,
                sharedEntities,
                topInsights: study.intelligence.insights.slice(0, 3).map((insight) => insight.text),
            };
        });

        return JSON.stringify(overlaps, null, 2);
    }
}

/**
 * ==================================================================================
 * PART 5: SCHEMAS
 * ==================================================================================
 */
const CHUNK_ANALYSIS_SCHEMA: JsonSchema = {
    type: JSON_TYPES.object,
    properties: {
        title: { type: JSON_TYPES.string },
        entities: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    name: { type: JSON_TYPES.string },
                    type: { type: JSON_TYPES.string },
                    role: { type: JSON_TYPES.string },
                    confidence: { type: JSON_TYPES.number },
                },
                required: ["name", "type"],
            },
        },
        relations: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    source: { type: JSON_TYPES.string },
                    target: { type: JSON_TYPES.string },
                    type: { type: JSON_TYPES.string },
                    confidence: { type: JSON_TYPES.number },
                },
                required: ["source", "target", "type"],
            },
        },
        insights: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    type: { type: JSON_TYPES.string },
                    text: { type: JSON_TYPES.string },
                    importance: { type: JSON_TYPES.number },
                },
                required: ["text"],
            },
        },
        timeline: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    date: { type: JSON_TYPES.string },
                    event: { type: JSON_TYPES.string },
                },
                required: ["date", "event"],
            },
        },
        statements: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    knowledge: { type: JSON_TYPES.string },
                    category: { type: JSON_TYPES.string },
                    statement_text: { type: JSON_TYPES.string },
                    confidence: { type: JSON_TYPES.number },
                    assumption_flag: { type: JSON_TYPES.boolean },
                    intelligence_gap: { type: JSON_TYPES.boolean },
                    impact: { type: JSON_TYPES.string },
                    operational_relevance: { type: JSON_TYPES.string },
                    related_entities: {
                        type: JSON_TYPES.array,
                        items: { type: JSON_TYPES.string },
                    },
                },
                required: ["statement_text"],
            },
        },
    },
};

const STRATEGIC_SYNTHESIS_SCHEMA: JsonSchema = {
    type: JSON_TYPES.object,
    properties: {
        title: { type: JSON_TYPES.string },
        summary: { type: JSON_TYPES.string },
        insights: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    type: { type: JSON_TYPES.string },
                    text: { type: JSON_TYPES.string },
                    importance: { type: JSON_TYPES.number },
                },
                required: ["text"],
            },
        },
        tactical_assessment: {
            type: JSON_TYPES.object,
            properties: {
                ttps: {
                    type: JSON_TYPES.array,
                    items: { type: JSON_TYPES.string },
                },
                recommendations: {
                    type: JSON_TYPES.array,
                    items: { type: JSON_TYPES.string },
                },
                gaps: {
                    type: JSON_TYPES.array,
                    items: { type: JSON_TYPES.string },
                },
            },
        },
        intel_questions: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    question_text: { type: JSON_TYPES.string },
                    priority: { type: JSON_TYPES.string },
                    owner: { type: JSON_TYPES.string },
                },
                required: ["question_text"],
            },
        },
        intel_tasks: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    task_text: { type: JSON_TYPES.string },
                    urgency: { type: JSON_TYPES.string },
                    status: { type: JSON_TYPES.string },
                },
                required: ["task_text"],
            },
        },
        reliability: { type: JSON_TYPES.number },
        document_metadata: {
            type: JSON_TYPES.object,
            properties: {
                title: { type: JSON_TYPES.string },
                classification: { type: JSON_TYPES.string },
                author: { type: JSON_TYPES.string },
                source_orgs: { type: JSON_TYPES.string },
                language: { type: JSON_TYPES.string },
            },
        },
    },
};

const ENTITY_REFINEMENT_SCHEMA: JsonSchema = {
    type: JSON_TYPES.object,
    properties: {
        entities: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    canonical_name: { type: JSON_TYPES.string },
                    aliases: {
                        type: JSON_TYPES.array,
                        items: { type: JSON_TYPES.string },
                    },
                    type: { type: JSON_TYPES.string },
                    role: { type: JSON_TYPES.string },
                    confidence: { type: JSON_TYPES.number },
                    salience: { type: JSON_TYPES.number },
                    key_evidence: {
                        type: JSON_TYPES.array,
                        items: { type: JSON_TYPES.string },
                    },
                },
                required: ["canonical_name", "type"],
            },
        },
    },
};

const CONTEXT_CARD_SCHEMA: JsonSchema = {
    type: JSON_TYPES.object,
    properties: {
        entityName: { type: JSON_TYPES.string },
        type: { type: JSON_TYPES.string },
        summary: { type: JSON_TYPES.string },
        role_in_document: { type: JSON_TYPES.string },
        significance: { type: JSON_TYPES.string },
        affiliation: { type: JSON_TYPES.string },
        status: { type: JSON_TYPES.string },
        aliases: {
            type: JSON_TYPES.array,
            items: { type: JSON_TYPES.string },
        },
    },
    required: ["entityName", "summary", "role_in_document"],
};

const SYNAPSE_ANALYSIS_SCHEMA: JsonSchema = {
    type: JSON_TYPES.object,
    properties: {
        summary: { type: JSON_TYPES.string },
        results: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    type: { type: JSON_TYPES.string },
                    title: { type: JSON_TYPES.string },
                    description: { type: JSON_TYPES.string },
                    confidence: { type: JSON_TYPES.number },
                    evidence: {
                        type: JSON_TYPES.array,
                        items: {
                            type: JSON_TYPES.object,
                            properties: {
                                sourceStudyId: { type: JSON_TYPES.string },
                                sourceStudyTitle: { type: JSON_TYPES.string },
                                text: { type: JSON_TYPES.string },
                            },
                            required: ["sourceStudyId", "sourceStudyTitle", "text"],
                        },
                    },
                },
                required: ["type", "title", "description"],
            },
        },
    },
};

const TIMELINE_NARRATIVE_SCHEMA: JsonSchema = {
    type: JSON_TYPES.object,
    properties: {
        blocks: {
            type: JSON_TYPES.array,
            items: {
                type: JSON_TYPES.object,
                properties: {
                    insertAfterIndex: { type: JSON_TYPES.number },
                    title: { type: JSON_TYPES.string },
                    explanation: { type: JSON_TYPES.string },
                    type: { type: JSON_TYPES.string },
                },
                required: ["insertAfterIndex", "title", "explanation", "type"],
            },
        },
    },
};

const buildFallbackPackage = (text: string): IntelligencePackage => ({
    clean_text: text.slice(0, 160).trim() || "Local Analysis",
    raw_text: text,
    word_count: text.split(/\s+/).filter(Boolean).length,
    document_metadata: {
        title: "Local Analysis",
        classification: "UNKNOWN",
        author: "Unknown",
        source_orgs: "Unknown",
        language: "Unknown",
    },
    statements: [],
    intel_questions: [],
    intel_tasks: [],
    entities: [],
    relations: [],
    insights: [],
    timeline: [],
    tactical_assessment: {
        ttps: [],
        recommendations: [],
        gaps: [],
    },
    context_cards: {},
    graph: {
        nodes: [],
        edges: [],
    },
    reliability: 0.5,
});

/**
 * ==================================================================================
 * PART 5: PUBLIC API
 * ==================================================================================
 */

export const analyzeDocument = async (text: string): Promise<IntelligencePackage> => {
    const normalizedText = KnowledgeFusionEngine.normalizeSourceText(text);
    if (!normalizedText) {
        return buildFallbackPackage(text);
    }

    try {
        const chunking = KnowledgeFusionEngine.getAdaptiveAnalysisChunking(normalizedText);
        const chunks = KnowledgeFusionEngine.splitIntoChunks(
            normalizedText,
            chunking.maxChars,
            chunking.overlapChars
        );
        const chunkResults = await KnowledgeFusionEngine.mapWithConcurrency(
            chunks,
            ANALYSIS_CHUNK_CONCURRENCY,
            async (chunk) => {
                console.info(`Analyzing chunk ${chunk.index + 1}/${chunks.length}`);
                return generateStructured<ChunkAnalysisResponse>({
                prompt: `Analyze chunk ${chunk.index + 1} of ${chunks.length}.

TASK:
- Extract every materially distinct entity in this chunk. Do not cap the number of entities.
- Extract explicit relationships, local findings, timeline events, and notable statements.
- Prefer recall over brevity, but avoid duplicates within the same chunk.

CHUNK:
"""${chunk.content}"""`,
                systemInstruction:
                    "You are TEVEL's document extraction engine. Exhaustively extract entities, relations, insights, timeline events, and analyst-grade statements from the provided chunk.",
                schema: CHUNK_ANALYSIS_SCHEMA,
                fallback: {
                    title: "",
                    entities: [],
                    relations: [],
                    insights: [],
                    timeline: [],
                    statements: [],
                },
            });
            }
        );

        const merged = KnowledgeFusionEngine.mergeChunkResults(chunkResults);
        const rawChunkEntities: ExtractedEntityLike[] = chunkResults.flatMap((chunkResult, chunkIndex) =>
            (chunkResult.entities || []).map((entity) => ({
                ...entity,
                chunkIndex,
            }))
        );

        console.info(`Starting entity refinement for ${merged.entities.length} merged entities...`);
        const refinedEntities = await EntityCreationEngine.refineEntities({
            sourceText: normalizedText,
            mergedEntities: merged.entities,
            rawEntities: rawChunkEntities,
            relations: merged.relations,
            generateStructured,
            schema: ENTITY_REFINEMENT_SCHEMA,
            batchSize: USE_GEMINI_BY_DEFAULT ? 50 : ENTITY_REFINEMENT_BATCH_SIZE,
        });

        const mapToCanonicalEntity = (value: string): string => {
            const direct = refinedEntities.aliasMap.get(value);
            if (direct) return direct;
            const normalizedDirect = refinedEntities.aliasMap.get(KnowledgeFusionEngine.normalizeEntityKey(value));
            if (normalizedDirect) return normalizedDirect;

            const matched = Array.from(refinedEntities.aliasMap.entries()).find(([alias]) =>
                DataAlgorithmEngine.isEntityMatch(alias, value)
            );
            return matched?.[1] || value;
        };

        const remappedStatements = merged.statements.map((statement) => ({
            ...statement,
            related_entities: (statement.related_entities || [])
                .map((entityName) => mapToCanonicalEntity(entityName))
                .filter((entityName, index, source) =>
                    source.findIndex((candidate) => DataAlgorithmEngine.isEntityMatch(candidate, entityName)) === index
                ),
        }));

        const fusedKnowledge: MergedKnowledge = {
            ...merged,
            entities: refinedEntities.entities,
            relations: refinedEntities.relations,
            statements: remappedStatements,
            entityMetrics: KnowledgeFusionEngine.rebuildEntityMetrics(
                refinedEntities.entities,
                refinedEntities.relations,
                merged.entityMetrics
            ),
        };

        const synthesisFallback: StrategicSynthesisResponse = {
            title: fusedKnowledge.title,
            summary: KnowledgeFusionEngine.buildFallbackSummary(fusedKnowledge, normalizedText),
            insights: fusedKnowledge.insights.slice(0, 8),
            tactical_assessment: KnowledgeFusionEngine.buildFallbackTacticalAssessment(fusedKnowledge),
            intel_questions: KnowledgeFusionEngine.buildFallbackQuestions(fusedKnowledge).map((question) => ({
                question_text: question.question_text,
                priority: question.priority,
                owner: question.owner,
            })),
            intel_tasks: KnowledgeFusionEngine.buildFallbackTasks(fusedKnowledge).map((task) => ({
                task_text: task.task_text,
                urgency: task.urgency,
                status: task.status,
            })),
            reliability: KnowledgeFusionEngine.buildFallbackReliability(fusedKnowledge),
            document_metadata: {
                title: fusedKnowledge.title,
                classification: "UNKNOWN",
                author: "Unknown",
                source_orgs: "Unknown",
                language: "Unknown",
            },
        };

        console.info("Finalizing strategic synthesis and tactical assessment...");
        const synthesis = await generateStructured<StrategicSynthesisResponse>({
            prompt: `Create a strategic synthesis for this fused intelligence package.

DATA:
${KnowledgeFusionEngine.buildStrategicPromptInput(fusedKnowledge, chunks.length, normalizedText)}

OUTPUT REQUIREMENTS:
- Produce a concise executive summary.
- Prioritize high-signal findings over repetition.
- Produce tactical assessment fields that are actionable.
- Generate intelligence questions and tasks only when they add value.
- Reliability must be between 0 and 1.`,
            systemInstruction:
                "You are TEVEL's fusion layer. Turn chunk-level extraction into a coherent strategic intelligence product.",
            schema: STRATEGIC_SYNTHESIS_SCHEMA,
            fallback: synthesisFallback,
        });

        const tacticalAssessment: TacticalAssessment = {
            ttps: synthesis.tactical_assessment?.ttps?.filter(Boolean) || synthesisFallback.tactical_assessment?.ttps || [],
            recommendations:
                synthesis.tactical_assessment?.recommendations?.filter(Boolean) ||
                synthesisFallback.tactical_assessment?.recommendations ||
                [],
            gaps:
                synthesis.tactical_assessment?.gaps?.filter(Boolean) ||
                synthesisFallback.tactical_assessment?.gaps ||
                [],
        };

        const intelQuestions: IntelQuestion[] = (synthesis.intel_questions || []).map((question, index) => ({
            question_id: `iq_${index}_${Date.now()}`,
            question_text: question.question_text?.trim() || "Follow-up question required.",
            priority: KnowledgeFusionEngine["coerceEnum"](question.priority, ALLOWED_IMPACT_LEVELS, "HIGH"),
            owner: question.owner?.trim() || undefined,
        }));

        const intelTasks: IntelTask[] = (synthesis.intel_tasks || []).map((task, index) => ({
            task_id: `task_${index}_${Date.now()}`,
            task_text: task.task_text?.trim() || "Investigate the highest-confidence lead.",
            urgency: KnowledgeFusionEngine["coerceEnum"](task.urgency, ALLOWED_URGENCY_LEVELS, "HIGH"),
            status: task.status === "CLOSED" ? "CLOSED" : "OPEN",
        }));

        const insights = (synthesis.insights?.length ? synthesis.insights : synthesisFallback.insights || [])
            .filter((insight): insight is ExtractedInsight => Boolean(insight?.text))
            .map((insight) => ({
                type: KnowledgeFusionEngine["normalizeInsightType"](insight.type),
                text: insight.text!.trim(),
                importance:
                    typeof insight.importance === "number"
                        ? Math.min(1, Math.max(0, insight.importance))
                        : 0.75,
            }))
            .slice(0, 12);

        return {
            clean_text:
                synthesis.summary?.trim() ||
                synthesisFallback.summary ||
                KnowledgeFusionEngine.buildFallbackSummary(fusedKnowledge, normalizedText),
            raw_text: normalizedText,
            word_count: normalizedText.split(/\s+/).filter(Boolean).length,
            document_metadata: {
                title: synthesis.document_metadata?.title?.trim() || synthesis.title?.trim() || fusedKnowledge.title,
                classification: synthesis.document_metadata?.classification?.trim() || "UNKNOWN",
                author: synthesis.document_metadata?.author?.trim() || "Unknown",
                source_orgs: synthesis.document_metadata?.source_orgs?.trim() || "Unknown",
                language: synthesis.document_metadata?.language?.trim() || "Unknown",
            },
            statements: fusedKnowledge.statements,
            intel_questions:
                intelQuestions.length ? intelQuestions : KnowledgeFusionEngine.buildFallbackQuestions(fusedKnowledge),
            intel_tasks: intelTasks.length ? intelTasks : KnowledgeFusionEngine.buildFallbackTasks(fusedKnowledge),
            entities: fusedKnowledge.entities,
            relations: fusedKnowledge.relations,
            insights,
            timeline: fusedKnowledge.timeline,
            tactical_assessment: tacticalAssessment,
            context_cards: refinedEntities.contextCards,
            graph: DataAlgorithmEngine.buildGraph(fusedKnowledge.entities, fusedKnowledge.relations),
            reliability:
                typeof synthesis.reliability === "number"
                    ? Math.min(1, Math.max(0, synthesis.reliability))
                    : synthesisFallback.reliability,
        };
    } catch (error) {
        console.error("Analysis failed, using local fallback package:", error);
        return buildFallbackPackage(normalizedText);
    }
};

export const generateEntityContext = async (
    entityName: string,
    fullText: string
): Promise<ContextCard> => {
    const relevantContext = KnowledgeFusionEngine.extractRelevantPassages(fullText, [entityName]);

    const fallback: ContextCard = {
        entityName,
        summary: `Relevant passages were found for ${entityName}, but the local model could not produce a full context card.`,
        role_in_document: "Detected entity",
        significance: "MEDIUM",
        affiliation: "Unknown",
        status: "UNKNOWN",
        aliases: [],
        key_mentions: [],
        isShallow: false,
    };

    const card = await generateStructured<ContextCard>({
        prompt: `Build a focused context card for the entity "${entityName}".

Use only the evidence below and avoid speculation beyond the source material.

EVIDENCE:
"""${relevantContext}"""`,
        systemInstruction:
            "You are TEVEL's entity profiler. Produce a concise, evidence-grounded context card for the requested entity.",
        schema: CONTEXT_CARD_SCHEMA,
        fallback,
    });

    return {
        entityName: card.entityName?.trim() || entityName,
        type: card.type?.trim() || "UNKNOWN",
        summary: card.summary?.trim() || fallback.summary,
        role_in_document: card.role_in_document?.trim() || fallback.role_in_document,
        significance: ALLOWED_CONTEXT_SIGNIFICANCE.has(card.significance || "MEDIUM")
            ? card.significance
            : "MEDIUM",
        affiliation: card.affiliation?.trim() || "Unknown",
        status: ALLOWED_CONTEXT_STATUS.has(card.status || "UNKNOWN") ? card.status : "UNKNOWN",
        aliases: Array.isArray(card.aliases) ? card.aliases.filter(Boolean) : [],
        key_mentions: [],
        isShallow: false,
    };
};

export const askContextualQuestion = async (
    question: string,
    contextData: IntelligencePackage,
    history: ChatMessage[],
    options?: QuestionAnswerOptions,
): Promise<string> => {
    const reasoningEngine = getReasoningEngineDescriptor(options?.reasoningEngineId);
    try {
        const retrievalContext =
            options?.readPathContext?.retrievalContext ||
            await RetrievalReasoningEngine.buildAnswerContext(question, contextData, options);
        const historyLimit = options?.fastMode ? 4 : 6;
        const historyText = history
            .slice(-historyLimit)
            .map((item) => `${item.role}: ${item.content}`)
            .join("\n");
        const knowledgeSnapshot =
            options?.readPathContext?.knowledgeSnapshot ||
            KnowledgeFusionEngine.buildKnowledgeSnapshot(
                contextData,
                Boolean(options?.fastMode),
                options?.maxKnowledgeSummaryChars,
            );
        const answerTimeoutMs = options?.answerTimeoutMs || (
            reasoningEngine.surface === "cloud"
                ? (options?.fastMode ? 30000 : 45000)
                : (options?.fastMode ? FAST_QA_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
        );

        const prompt = `QUESTION TO ANSWER:
${question}

CONTEXT PACKAGE:
${knowledgeSnapshot}

RETRIEVAL CONTEXT:
${retrievalContext}

RECENT HISTORY:
${historyText || "No prior exchanges."}

Answer the question above. Use only the evidence provided in the retrieval context. Do not invent facts not present there.`;

        const startTime = Date.now();
        console.info("[askContextualQuestion] Starting generation...");
        const answer = await CognitiveGateway.generate({
            prompt,
            model: reasoningEngine.model,
            reasoningEngineId: reasoningEngine.id,
            geminiApiKey: options?.geminiApiKey,
            systemInstruction:
                options?.systemInstruction ||
                "You are TEVEL's intelligence analysis copilot. Answer strictly based on the provided context package and retrieved evidence. Do NOT invent facts, translations, or definitions not present in the context. Do NOT repeat yourself. If the context lacks relevant information, say so clearly and stop. Cite evidence IDs in square brackets when available. Be concise and direct.",
            timeoutMs: answerTimeoutMs,
        });
        console.info(`[askContextualQuestion] Generation finished in ${Date.now() - startTime}ms`);
        if (!contextData.retrieval_artifacts) return answer;

        const answerId = options?.answerId || `chat_${Date.now()}`;
        const verification = await verifyAnswerCitations({
            caseId: options?.caseId || contextData.version_validity?.case_id || answerId,
            answerId,
            answerText: answer,
            retrievalArtifacts: contextData.retrieval_artifacts,
            versionValidity: contextData.version_validity,
            candidateEvidenceIds: options?.readPathContext?.candidateEvidenceIds,
        });
        if (options?.onCitationVerification) {
            try {
                await options.onCitationVerification(verification);
            } catch (error) {
                console.warn("Citation verification callback failed", error);
            }
        }
        return refineAnswerWithCitationVerification(answer, verification);
    } catch (error) {
        console.error("Question answering failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        return buildReasoningFailureMessage(/timed out/i.test(message) ? "timeout" : "offline", reasoningEngine);
    }
};

export const generateStoryFromTimeline = async (events: any[]): Promise<string> => {
    const enrichedEvents = events.map((event, index) => ({
        index,
        date: event.date,
        event: event.event,
        isExternal: event._source === "external",
        sourceTitle: event._studyTitle,
        bridgeEntity: event._bridgeEntity,
        contextSummary: event._contextSummary,
    }));

    const prompt = `
You are a SENIOR INTELLIGENCE HISTORIAN crafting a Deep Causality Report.

OBJECTIVE:
Weave a coherent, analytical narrative that explains how historical events influenced current operations.

DATA STREAM:
${JSON.stringify(enrichedEvents, null, 2)}

RULES:
1. Start with the earliest context and build toward the current operational reality.
2. When an event is external, use contextSummary and bridgeEntity to explain why it matters.
3. Represent external event text as {{LINK:index}} where index matches the JSON.
4. Use plain paragraphs only. No markdown headers.
`;

    try {
        return await CognitiveGateway.generate({
            prompt,
            systemInstruction:
                "You are TEVEL's Chief Narrative Analyst. Connect the dots with depth and precision.",
        });
    } catch (error) {
        console.error("Story generation failed", error);
        return "Narrative generation unavailable. Check local uplink.";
    }
};

export const isEntityMatch = (a: string, b: string) => DataAlgorithmEngine.isEntityMatch(a, b);

export const reanalyzeEntityWithCrossReference = async (
    entityName: string,
    currentText: string,
    linkedStudies: StudyItem[]
): Promise<string> => {
    if (!linkedStudies.length) {
        return "Unable to deepen analysis: no cross-referenced studies were found for this entity.";
    }

    try {
        const currentEvidence = KnowledgeFusionEngine.extractRelevantPassages(currentText, [entityName], 5000);
        const externalContext = KnowledgeFusionEngine.summarizeLinkedStudies(linkedStudies);

        return await CognitiveGateway.generate({
            prompt: `Reassess the entity "${entityName}" using the current document evidence and linked studies.

CURRENT EVIDENCE:
"""${currentEvidence}"""

LINKED STUDIES:
${externalContext}

Return one concise analytical summary paragraph focused on what the cross-reference changes or strengthens.`,
            systemInstruction:
                "You are TEVEL's fusion analyst. Re-evaluate the entity using cross-document evidence and focus on what is newly supported or contradicted.",
        });
    } catch (error) {
        console.error("Cross-reference reanalysis failed:", error);
        return "Unable to deepen analysis: the reasoning engine could not complete the fusion scan.";
    }
};

export const generateExtendedEntityProfile = async (
    entityName: string,
    fullText: string
): Promise<string> => {
    try {
        const relevantContext = KnowledgeFusionEngine.extractRelevantPassages(fullText, [entityName]);
        return await CognitiveGateway.generate({
            prompt: `Create a deep-dive profile for "${entityName}" using only the source evidence below.

EVIDENCE:
"""${relevantContext}"""

FORMAT:
## Identity
## Network Role
## Indicators
## Risks
## Collection Priorities`,
            systemInstruction:
                "You are TEVEL's dossier writer. Produce a structured, evidence-grounded extended profile with practical intelligence value.",
        });
    } catch (error) {
        console.error("Extended profile generation failed:", error);
        return "## Identity\nProfile generation is unavailable.\n\n## Network Role\nThe reasoning engine could not expand this entity at the moment.";
    }
};

export const crossReferenceStudies = async (
    currentStudy: IntelligencePackage,
    externalStudies: StudyItem[]
): Promise<string> => {
    if (!externalStudies.length) {
        return "No additional studies were selected for fusion.";
    }

    try {
        const currentEntities = currentStudy.entities.map((entity) => entity.name);
        const overlapMap = externalStudies.map((study) => ({
            id: study.id,
            title: study.title,
            sharedEntities: study.intelligence.entities
                .map((entity) => entity.name)
                .filter((entityName) =>
                    currentEntities.some((currentName) =>
                        DataAlgorithmEngine.isEntityMatch(currentName, entityName)
                    )
                ),
            topRelationTypes: Array.from(
                new Set(study.intelligence.relations.slice(0, 20).map((relation) => relation.type))
            ),
            topInsights: study.intelligence.insights.slice(0, 3).map((insight) => insight.text),
        }));

        return await CognitiveGateway.generate({
            prompt: `Cross-reference the current study with the selected external studies and produce a fusion report.

CURRENT STUDY:
${KnowledgeFusionEngine.buildKnowledgeSnapshot(currentStudy)}

EXTERNAL STUDIES:
${KnowledgeFusionEngine.summarizeLinkedStudies(externalStudies)}

OVERLAP MAP:
${JSON.stringify(overlapMap, null, 2)}

Return a concise report with:
- shared entities or mechanisms
- reinforcing evidence
- contradictions or uncertainty
- highest-value next lead`,
            systemInstruction:
                "You are TEVEL's cross-study fusion engine. Highlight non-obvious connections, contradictions, and next leads.",
        });
    } catch (error) {
        console.error("Cross-reference synthesis failed:", error);
        return "Cross-reference report unavailable. Check local model connectivity.";
    }
};

export const generateTimelineNarrative = async (events: any[]): Promise<NarrativeBlock[]> => {
    if (!events.length) return [];

    const fallback: TimelineNarrativeResponse = { blocks: [] };
    const response = await generateStructured<TimelineNarrativeResponse>({
        prompt: `Generate short narrative bridge blocks for this ordered timeline.

TIMELINE:
${JSON.stringify(events, null, 2)}

Create only high-value blocks that explain causality or transitions.`,
        systemInstruction:
            "You are TEVEL's timeline analyst. Insert concise narrative bridges only where they help explain cause, context, or outcome.",
        schema: TIMELINE_NARRATIVE_SCHEMA,
        fallback,
    });

    return (response.blocks || [])
        .filter((block) => typeof block.insertAfterIndex === "number" && block.title && block.explanation)
        .map((block) => ({
            insertAfterIndex: Math.max(0, Math.floor(block.insertAfterIndex!)),
            title: block.title!.trim(),
            explanation: block.explanation!.trim(),
            type:
                block.type === "TRIGGER" || block.type === "RESULT" || block.type === "CONTEXT"
                    ? block.type
                    : "CONTEXT",
        }));
};

export const generateExecutiveBrief = async (contextData: IntelligencePackage): Promise<string> => {
    try {
        const index = await RetrievalReasoningEngine.getIndex(contextData);
        return await CognitiveGateway.generate({
            prompt: `Create an executive intelligence brief from this package.

PACKAGE:
${KnowledgeFusionEngine.buildKnowledgeSnapshot(contextData)}

COMMUNITY SUMMARIES:
${index.communities.slice(0, 6).map((community) => `- ${community.summary}`).join("\n")}

CENTRAL ENTITIES:
${index.centralEntityNames.join(", ")}

FORMAT:
1. Situation Summary
2. Key Risks
3. Most Important Entities
4. Recommended Actions`,
            systemInstruction:
                "You are TEVEL's briefing officer. Write a clear, decision-ready executive brief with operational focus.",
        });
    } catch (error) {
        console.error("Executive brief generation failed:", error);
        return "Executive briefing unavailable. Check local model connectivity.";
    }
};

export const generateSynthesis = async (pinnedItems: PinnedItem[]): Promise<string> => {
    if (!pinnedItems.length) {
        return "No pinned evidence available for synthesis.";
    }

    try {
        return await CognitiveGateway.generate({
            prompt: `Synthesize the pinned evidence into an analyst-ready narrative.

PINNED EVIDENCE:
${JSON.stringify(pinnedItems, null, 2)}

Return:
- the strongest hypothesis
- supporting evidence
- main uncertainty
- recommended next action`,
            systemInstruction:
                "You are TEVEL's synthesis engine. Connect the pinned evidence into a coherent, evidence-first assessment.",
        });
    } catch (error) {
        console.error("Pinned synthesis failed:", error);
        return "Synthesis unavailable. Check local model connectivity.";
    }
};

export const generateSynapseAnalysis = async (
    currentStudy: StudyItem,
    linkedStudies: StudyItem[]
): Promise<SynapseAnalysis> => {
    if (!linkedStudies.length) {
        return { summary: "No linked studies available for Synapse analysis.", results: [] };
    }

    const fallback: SynapseResponse = {
        summary: "Cross-study review completed with limited confidence.",
        results: linkedStudies.slice(0, 3).map((study) => ({
            type: "PATTERN",
            title: `Potential linkage with ${study.title}`,
            description: study.intelligence.insights[0]?.text || "Related entities appear across studies.",
            confidence: 0.6,
            evidence: [
                {
                    sourceStudyId: study.id,
                    sourceStudyTitle: study.title,
                    text: study.intelligence.insights[0]?.text || study.intelligence.clean_text,
                },
            ],
        })),
    };

    const response = await generateStructured<SynapseResponse>({
        prompt: `Run a strategic cross-study analysis.

CURRENT STUDY:
${JSON.stringify(
            {
                id: currentStudy.id,
                title: currentStudy.title,
                intelligence: JSON.parse(KnowledgeFusionEngine.buildKnowledgeSnapshot(currentStudy.intelligence)),
            },
            null,
            2
        )}

LINKED STUDIES:
${KnowledgeFusionEngine.summarizeLinkedStudies(linkedStudies)}

OVERLAP MAP:
${await RetrievalReasoningEngine.buildCrossStudyMap(currentStudy, linkedStudies)}

Produce 2-5 high-value findings with evidence objects that reference the source study ids and titles exactly.`,
        systemInstruction:
            "You are TEVEL's Synapse engine. Produce strategic hypotheses, patterns, and predictions grounded in evidence from the connected studies.",
        schema: SYNAPSE_ANALYSIS_SCHEMA,
        fallback,
    });

    const results: SynapseHypothesis[] = (response.results || [])
        .filter((result) => result.title && result.description)
        .map((result) => ({
            type:
                result.type === "HYPOTHESIS" || result.type === "PREDICTION" || result.type === "PATTERN"
                    ? result.type
                    : "PATTERN",
            title: result.title!.trim(),
            description: result.description!.trim(),
            confidence:
                typeof result.confidence === "number"
                    ? Math.min(1, Math.max(0, result.confidence))
                    : 0.65,
            evidence: (result.evidence || [])
                .filter((item) => item.sourceStudyId && item.sourceStudyTitle && item.text)
                .map((item) => ({
                    sourceStudyId: item.sourceStudyId!,
                    sourceStudyTitle: item.sourceStudyTitle!,
                    text: item.text!,
                })),
        }));

    return {
        summary: response.summary?.trim() || fallback.summary || "Synapse analysis completed.",
        results,
    };
};
