import { ContextCard, Entity, Relation } from "../../types";

export type ExtractedEntityLike = {
    name: string;
    type: string;
    role?: string;
    confidence?: number;
    chunkIndex?: number;
    aliases?: string[];
};

export type EntityRefinementResponse = {
    entities?: Array<{
        canonical_name?: string;
        aliases?: string[];
        type?: string;
        role?: string;
        confidence?: number;
        salience?: number;
        key_evidence?: string[];
    }>;
};

type StructuredGenerator = <T>(params: {
    prompt: string;
    systemInstruction?: string;
    schema: Record<string, unknown>;
    fallback: T;
}) => Promise<T>;

type CandidateGroup = {
    canonicalName: string;
    aliases: Set<string>;
    descriptions: Set<string>;
    typeCounts: Map<string, number>;
    confidenceTotal: number;
    confidenceCount: number;
    mentions: number;
    sourceChunks: Set<number>;
    evidence: Set<string>;
};

const TITLE_CASE_CONNECTORS = new Set(["of", "the", "and", "for", "de", "del", "al", "bin", "ibn"]);
const TITLE_CASE_STOPWORDS = new Set([
    "report",
    "document",
    "summary",
    "section",
    "chapter",
    "appendix",
    "analysis",
    "assessment",
    "annex",
]);

export class EntityCreationEngine {
    private static sanitizeDeterministicCandidate(value: string, type?: string): string {
        let cleaned = value
            .trim()
            .replace(/^(?:with|near|at|by)\s+/i, "")
            .replace(/[.,;:!?]+$/g, "")
            .replace(/\s+(?:and|with|near|later|before|after).*$/i, "")
            .replace(/\s+ב(?:נמל|רציף|מחסן|מסוף|עיר|מתחם|כביש|רחוב|בניין|שדה התעופה).*$/u, "")
            .trim();

        if ((type || "").toUpperCase() === "PERSON") {
            cleaned = cleaned
                .replace(/^(?:investigator|investigators|reviewer|analyst|operator)\s+/i, "")
                .trim();
        }

        return cleaned;
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

    static isEntityMatch(a: string, b: string): boolean {
        if (!a || !b) return false;
        const n1 = this.normalizeEntityKey(a);
        const n2 = this.normalizeEntityKey(b);
        return n1 === n2 || (n1.length > 4 && n2.length > 4 && (n1.includes(n2) || n2.includes(n1)));
    }

    static extractDeterministicSignals(text: string): ExtractedEntityLike[] {
        const candidates = new Map<string, ExtractedEntityLike>();
        const upsertCandidate = (candidate: ExtractedEntityLike) => {
            const trimmed = this.sanitizeDeterministicCandidate(candidate.name, candidate.type);
            if (trimmed.length < 3) return;
            const key = this.normalizeEntityKey(trimmed);
            if (!key) return;

            const existing = candidates.get(key);
            if (!existing || (candidate.confidence || 0) > (existing.confidence || 0)) {
                candidates.set(key, {
                    ...candidate,
                    name: trimmed,
                });
            }
        };

        const patterns: Array<{ regex: RegExp; type: string; role: string; confidence: number }> = [
            { regex: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, type: "DATE", role: "Explicit date mention", confidence: 0.98 },
            { regex: /\b\d{4}-\d{2}-\d{2}\b/g, type: "DATE", role: "ISO date mention", confidence: 0.98 },
            { regex: /\b(?:https?:\/\/|www\.)\S+\b/g, type: "DIGITAL_ASSET", role: "URL or web resource", confidence: 0.94 },
            { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, type: "COMMUNICATION_CHANNEL", role: "Email address", confidence: 0.96 },
            { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, type: "DIGITAL_ASSET", role: "IP address", confidence: 0.94 },
            { regex: /\b0x[a-fA-F0-9]{8,}\b/g, type: "DIGITAL_ASSET", role: "Blockchain wallet or hash-like identifier", confidence: 0.92 },
            { regex: /(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}_]{4,32}/gu, type: "COMMUNICATION_CHANNEL", role: "Messaging handle or alias", confidence: 0.86 },
            { regex: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)\d{3,4}[-.\s]?\d{3,4}\b/g, type: "COMMUNICATION_CHANNEL", role: "Phone number or line", confidence: 0.82 },
            { regex: /\b[A-HJ-NPR-Z0-9]{17}\b/g, type: "IDENTIFIER", role: "VIN or durable equipment identifier", confidence: 0.91 },
            { regex: /\b[A-Z]{4}\d{7}\b/g, type: "CARGO", role: "Container or shipping unit identifier", confidence: 0.9 },
            { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, type: "FINANCIAL_ACCOUNT", role: "IBAN or banking account", confidence: 0.9 },
            { regex: /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, type: "FINANCIAL_ACCOUNT", role: "SWIFT/BIC identifier", confidence: 0.82 },
            { regex: /\b[A-Z]{2,}(?:[-_][A-Z0-9]+)*\b/g, type: "ORGANIZATION", role: "Uppercase coded entity", confidence: 0.62 },

            // ── Hebrew deterministic entity patterns ──────────────────────────────

            // Hebrew money amounts: €/$/ ₪/ש"ח/דולר/אירו/USDT before or after the number
            { regex: /(?:[€$₪]|ש["״]ח|דולר|אירו|USDT|קריפטו)\s*\d[\d,.]*(?:\s*(?:אלף|מיליון|מיליארד|k|m|bn))?\b|\b\d[\d,.]*\s*(?:[€$₪]|ש["״]ח|דולר|אירו|USDT)\b/g, type: "MONEY_AMOUNT", role: "Hebrew money amount", confidence: 0.92 },

            // Hebrew organizations: name ending with legal suffix or common company-type English suffix
            { regex: /[א-ת][א-ת\s\-"'׳]{1,30}(?:בע["״]מ|בע"מ)\b/g, type: "COMPANY", role: "Hebrew registered company", confidence: 0.88 },
            { regex: /[A-Z][A-Za-z\s]{2,35}(?:\b(?:GmbH|FZE|B\.V\.|S\.A\.|LLC|Ltd|Inc|Corp|Holdings|Logistics|Advisory|Maritime|Group|Shipping|Capital|Partners|Trading|Services|Investment|Management)\b)/g, type: "COMPANY", role: "Foreign-registered company with suffix", confidence: 0.86 },

            // Hebrew facilities / locations — use LOCATION type to match existing analysisService convention
            { regex: /(?:מחסן|נמל|פארק|דירת\s*מסתור|מפעל|מסגד|מעבר\s*גבול|רציף|מתחם|שדה\s*תעופה|אזור\s*תעשייה)\s+[א-ת][א-תA-Za-z0-9"']{1,}(?:\s+[א-ת][א-תA-Za-z0-9"']{0,}){0,2}/g, type: "LOCATION", role: "Hebrew facility or location", confidence: 0.84 },

            // Hebrew operations and codenames (after מבצע / פרויקט / תרחיש / תיק / מכרז / קוד / שם)
            { regex: /(?:מבצע|פרויקט|תרחיש|תיק|מכרז|קוד(?:שם)?|שם\s*(?:המבצע|הפרויקט))\s+["״]?[א-תA-Za-z\d][א-תA-Za-z\d\s\-"״]{1,28}["״]?/g, type: "OPERATION", role: "Hebrew operation, project or codename", confidence: 0.87 },

            // Hebrew communication channels
            { regex: /(?:טלגרם|וואטסאפ|VOIP|VPN|Wi-Fi|ערוץ\s*מוצפן|שרת\s*פרוקסי|כתובת\s*IP|ארנק\s*(?:קריפטו|USDT|ביטקויין))\b[^\n.،,]{0,40}/g, type: "COMMUNICATION_CHANNEL", role: "Hebrew communication channel or infrastructure", confidence: 0.83 },

            // Hebrew person names after context markers
            { regex: /(?:מאת|אל|על\s*החתום|בשם|מזוהה\s*כ|אחיו\s*של|דודו\s*של|סגנו\s*של|מפקד|האחראי|הגורם)\s*[:：]?\s*([א-ת][א-ת"׳\-]{1,10}(?:\s+[א-ת][א-ת"׳\-]{1,15}){1,2})/g, type: "PERSON", role: "Hebrew person identified by context marker", confidence: 0.82 },

            // Hebrew document types
            { regex: /(?:דו["״]ח|מסמך|טיוטה|פרוטוקול|הסכם|חוזה|מכרז|צו|הוראה|תכתובת|דו"ח\s*(?:מודיעין|תצפית|בקרה|פענוח|שטח))\s+[א-תA-Za-z0-9"״\-\s]{2,40}/g, type: "DOCUMENT", role: "Hebrew document reference", confidence: 0.79 },

            // Hebrew vehicle / license plate
            { regex: /לוחית\s*רישוי\s*[\d\-]{5,10}|רכב\s+(?:שירות|מסחרי|ממשלתי)\s*(?:\d[\d\-]{0,8})?/g, type: "VEHICLE", role: "Hebrew vehicle or plate number", confidence: 0.85 },

            // Hebrew Israeli agency names (deterministic)
            { regex: /\b(?:שב["״]כ|שב"כ|שב["״]ס|שב"ס|אמ["״]ן|אמ"ן|המוסד|משטרת\s*ישראל|מג["״]ב|מג"ב|ימ["״]מ|ימ"מ|יח[׳']?\s*\d+|יחידה\s+\d+|אגף\s+ביקורת|חמ["״]ל|חמ"ל|קמ["״]ן|קמ"ן)\b/g, type: "AGENCY", role: "Hebrew Israeli security / intelligence agency", confidence: 0.95 },

            // Hebrew committee / institutional body
            { regex: /(?:ועדת\s+[א-ת\s]{2,20}|רשות\s+[א-ת\s]{2,20}|מטה\s+[א-ת\s]{2,15}|אגף\s+[א-ת\s]{2,15})/g, type: "ORGANIZATION", role: "Hebrew committee or institutional body", confidence: 0.81 },

            // USDT / crypto wallet address patterns
            { regex: /\b[TU][A-Za-z0-9]{25,35}\b/g, type: "FINANCIAL_ACCOUNT", role: "Crypto wallet address (USDT/TRC20)", confidence: 0.88 },
        ];

        patterns.forEach(({ regex, type, role, confidence }) => {
            const matches = text.match(regex) || [];
            matches.forEach((match) => {
                upsertCandidate({
                    name: match.trim(),
                    type,
                    role,
                    confidence,
                });
            });
        });

        const titleCaseMatches = text.match(
            /\b(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?|\d+[A-Za-z-]*)(?:\s+(?:[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?|\d+[A-Za-z-]*|of|the|and|for|de|del|al|bin|ibn)){1,4}\b/g
        ) || [];

        titleCaseMatches.forEach((match) => {
            const candidate = this.sanitizeDeterministicCandidate(match, "PERSON");
            if (!this.isValidTitleCaseCandidate(candidate)) return;
            upsertCandidate({
                name: candidate,
                type: this.inferTitleCaseType(candidate),
                role: "Deterministic title-cased named entity candidate",
                confidence: this.isLikelyOrganizationName(candidate) ? 0.78 : 0.72,
            });
        });

        return Array.from(candidates.values());
    }

    static async refineEntities(params: {
        sourceText: string;
        mergedEntities: Entity[];
        rawEntities: ExtractedEntityLike[];
        relations: Relation[];
        generateStructured: StructuredGenerator;
        schema: Record<string, unknown>;
        batchSize?: number;
    }): Promise<{
        entities: Entity[];
        relations: Relation[];
        contextCards: Record<string, ContextCard>;
        aliasMap: Map<string, string>;
    }> {
        const groups = this.buildGroups(
            params.sourceText,
            params.mergedEntities,
            [...params.rawEntities, ...this.extractDeterministicSignals(params.sourceText)]
        );

        const groupList = Array.from(groups.values()).sort((a, b) => b.mentions - a.mentions);
        const batches = this.chunkGroups(groupList, params.batchSize || 18);
        const refinedGroups: CandidateGroup[] = [];

        for (let index = 0; index < batches.length; index += 1) {
            const batch = batches[index];
            const fallback: EntityRefinementResponse = {
                entities: batch.map((group) => this.buildFallbackRefinedEntity(group)),
            };

            const result = await params.generateStructured<EntityRefinementResponse>({
                prompt: `Refine these entity candidate groups into canonical intelligence entities.

TASK:
- Keep all legitimate entities. Do not discard real entities only because they look similar.
- Merge aliases only when they clearly refer to the same entity.
- Prefer precise canonical names.
- Improve the role description and assign a final type.
- Salience must be between 0 and 1 and reflect analytical importance inside the document.

BATCH ${index + 1} OF ${batches.length}
${JSON.stringify(
                    batch.map((group) => ({
                        canonical_candidate: group.canonicalName,
                        aliases: Array.from(group.aliases),
                        type_votes: Array.from(group.typeCounts.entries()),
                        role_hints: Array.from(group.descriptions),
                        mentions: group.mentions,
                        evidence: Array.from(group.evidence).slice(0, 3),
                    })),
                    null,
                    2
                )}`,
                systemInstruction:
                    "You are an entity resolution engine for intelligence analysis. Canonicalize aliases, preserve recall, and produce stable high-quality entity records.",
                schema: params.schema,
                fallback,
            });

            (result.entities || fallback.entities || []).forEach((item) => {
                if (!item.canonical_name?.trim()) return;
                const matchedGroup = batch.find((group) =>
                    this.isEntityMatch(group.canonicalName, item.canonical_name!.trim()) ||
                    Array.from(group.aliases).some((alias) => this.isEntityMatch(alias, item.canonical_name!.trim()))
                );

                refinedGroups.push({
                    canonicalName: item.canonical_name!.trim(),
                    aliases: new Set([
                        ...(item.aliases || []),
                        ...(matchedGroup ? Array.from(matchedGroup.aliases) : []),
                        item.canonical_name!.trim(),
                    ]),
                    descriptions: new Set([
                        item.role?.trim() || "",
                        ...(matchedGroup ? Array.from(matchedGroup.descriptions) : []),
                    ].filter(Boolean)),
                    typeCounts: new Map([
                        [
                            (item.type || matchedGroup?.typeCounts.keys().next().value || "MISC").toUpperCase(),
                            1,
                        ],
                    ]),
                    confidenceTotal:
                        typeof item.confidence === "number"
                            ? item.confidence
                            : matchedGroup
                            ? matchedGroup.confidenceTotal / Math.max(1, matchedGroup.confidenceCount)
                            : 0.75,
                    confidenceCount: 1,
                    mentions: matchedGroup?.mentions || 1,
                    sourceChunks: new Set(matchedGroup ? Array.from(matchedGroup.sourceChunks) : []),
                    evidence: new Set([
                        ...(item.key_evidence || []),
                        ...(matchedGroup ? Array.from(matchedGroup.evidence) : []),
                    ].filter(Boolean)),
                });
            });
        }

        const consolidatedGroups = this.consolidateGroups(refinedGroups.length ? refinedGroups : groupList);
        const aliasMap = this.buildAliasMap(consolidatedGroups);
        const relations = this.remapRelations(params.relations, aliasMap);
        const relationDegrees = this.buildRelationDegrees(relations);
        const entities = consolidatedGroups
            .map((group) => this.buildEntity(group, relationDegrees.get(this.normalizeEntityKey(group.canonicalName)) || 0))
            .sort(
                (a, b) =>
                    (b.salience || 0) - (a.salience || 0) ||
                    (b.source_chunks?.length || 0) - (a.source_chunks?.length || 0) ||
                    b.name.length - a.name.length
            );
        const contextCards = this.buildContextCards(entities, consolidatedGroups, relations);

        return {
            entities,
            relations,
            contextCards,
            aliasMap,
        };
    }

    private static buildGroups(
        sourceText: string,
        mergedEntities: Entity[],
        rawEntities: ExtractedEntityLike[]
    ): Map<string, CandidateGroup> {
        const groups = new Map<string, CandidateGroup>();

        const ensureGroup = (name: string): CandidateGroup => {
            const existingKey = Array.from(groups.keys()).find((key) => this.isEntityMatch(key, name));
            const key = existingKey || name;
            const group =
                groups.get(key) ||
                {
                    canonicalName: name,
                    aliases: new Set<string>([name]),
                    descriptions: new Set<string>(),
                    typeCounts: new Map<string, number>(),
                    confidenceTotal: 0,
                    confidenceCount: 0,
                    mentions: 0,
                    sourceChunks: new Set<number>(),
                    evidence: new Set<string>(),
                };
            groups.set(key, group);
            return group;
        };

        mergedEntities.forEach((entity) => {
            const group = ensureGroup(entity.name);
            group.aliases.add(entity.name);
            if (entity.aliases?.length) {
                entity.aliases.forEach((alias) => group.aliases.add(alias));
            }
            if (entity.description?.trim()) {
                group.descriptions.add(entity.description.trim());
            }
            const type = (entity.type || "MISC").toUpperCase();
            group.typeCounts.set(type, (group.typeCounts.get(type) || 0) + 1);
            group.confidenceTotal += entity.confidence || 0.75;
            group.confidenceCount += 1;
            group.mentions += 1;
        });

        rawEntities.forEach((rawEntity) => {
            if (!rawEntity.name?.trim()) return;
            const group = ensureGroup(rawEntity.name.trim());
            group.aliases.add(rawEntity.name.trim());
            if (rawEntity.role?.trim()) {
                group.descriptions.add(rawEntity.role.trim());
            }
            const type = (rawEntity.type || "MISC").toUpperCase();
            group.typeCounts.set(type, (group.typeCounts.get(type) || 0) + 1);
            group.confidenceTotal += rawEntity.confidence || 0.65;
            group.confidenceCount += 1;
            group.mentions += 1;
            if (typeof rawEntity.chunkIndex === "number") {
                group.sourceChunks.add(rawEntity.chunkIndex);
            }
        });

        Array.from(groups.values()).forEach((group) => {
            this.extractEvidence(sourceText, Array.from(group.aliases)).forEach((snippet) => group.evidence.add(snippet));
            const longestAlias = Array.from(group.aliases).sort((a, b) => b.length - a.length)[0];
            if (longestAlias) {
                group.canonicalName = longestAlias;
            }
        });

        return groups;
    }

    private static chunkGroups(groups: CandidateGroup[], batchSize: number): CandidateGroup[][] {
        const batches: CandidateGroup[][] = [];
        for (let index = 0; index < groups.length; index += batchSize) {
            batches.push(groups.slice(index, index + batchSize));
        }
        return batches;
    }

    private static buildFallbackRefinedEntity(group: CandidateGroup) {
        const topType = Array.from(group.typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "MISC";
        const confidence =
            group.confidenceCount > 0 ? group.confidenceTotal / group.confidenceCount : 0.75;
        const salience = Math.min(1, 0.25 + group.mentions * 0.06 + group.sourceChunks.size * 0.03);

        return {
            canonical_name: group.canonicalName,
            aliases: Array.from(group.aliases).filter((alias) => !this.isEntityMatch(alias, group.canonicalName)),
            type: topType,
            role: Array.from(group.descriptions)[0] || `Detected as ${topType}`,
            confidence,
            salience,
            key_evidence: Array.from(group.evidence).slice(0, 3),
        };
    }

    private static consolidateGroups(groups: CandidateGroup[]): CandidateGroup[] {
        const consolidated = new Map<string, CandidateGroup>();

        groups.forEach((group) => {
            const existingEntry = Array.from(consolidated.values()).find((candidate) =>
                this.isEntityMatch(candidate.canonicalName, group.canonicalName) ||
                Array.from(group.aliases).some((alias) =>
                    Array.from(candidate.aliases).some((candidateAlias) => this.isEntityMatch(alias, candidateAlias))
                )
            );

            if (!existingEntry) {
                consolidated.set(group.canonicalName, {
                    canonicalName: group.canonicalName,
                    aliases: new Set(group.aliases),
                    descriptions: new Set(group.descriptions),
                    typeCounts: new Map(group.typeCounts),
                    confidenceTotal: group.confidenceTotal,
                    confidenceCount: group.confidenceCount,
                    mentions: group.mentions,
                    sourceChunks: new Set(group.sourceChunks),
                    evidence: new Set(group.evidence),
                });
                return;
            }

            group.aliases.forEach((alias) => existingEntry.aliases.add(alias));
            group.descriptions.forEach((description) => existingEntry.descriptions.add(description));
            group.typeCounts.forEach((count, type) => {
                existingEntry.typeCounts.set(type, (existingEntry.typeCounts.get(type) || 0) + count);
            });
            group.sourceChunks.forEach((chunkIndex) => existingEntry.sourceChunks.add(chunkIndex));
            group.evidence.forEach((snippet) => existingEntry.evidence.add(snippet));
            existingEntry.confidenceTotal += group.confidenceTotal;
            existingEntry.confidenceCount += group.confidenceCount;
            existingEntry.mentions += group.mentions;

            const betterName = [existingEntry.canonicalName, group.canonicalName].sort((a, b) => b.length - a.length)[0];
            existingEntry.canonicalName = betterName;
        });

        return Array.from(consolidated.values()).sort((a, b) => b.mentions - a.mentions);
    }

    private static buildAliasMap(groups: CandidateGroup[]): Map<string, string> {
        const aliasMap = new Map<string, string>();
        groups.forEach((group) => {
            aliasMap.set(group.canonicalName, group.canonicalName);
            aliasMap.set(this.normalizeEntityKey(group.canonicalName), group.canonicalName);
            Array.from(group.aliases).forEach((alias) => {
                aliasMap.set(alias, group.canonicalName);
                aliasMap.set(this.normalizeEntityKey(alias), group.canonicalName);
            });
        });
        return aliasMap;
    }

    private static remapRelations(relations: Relation[], aliasMap: Map<string, string>): Relation[] {
        const remapped = new Map<string, Relation>();

        const mapEntity = (name: string) => {
            const direct = aliasMap.get(name);
            if (direct) return direct;
            const normalizedDirect = aliasMap.get(this.normalizeEntityKey(name));
            if (normalizedDirect) return normalizedDirect;
            const matched = Array.from(aliasMap.entries()).find(([alias]) => this.isEntityMatch(alias, name));
            return matched?.[1] || name;
        };

        relations.forEach((relation) => {
            const source = mapEntity(relation.source);
            const target = mapEntity(relation.target);
            const key = `${this.normalizeEntityKey(source)}|${relation.type.toLowerCase()}|${this.normalizeEntityKey(target)}`;
            const existing = remapped.get(key);
            if (!existing) {
                remapped.set(key, { ...relation, source, target });
                return;
            }
            existing.confidence = Math.max(existing.confidence, relation.confidence);
        });

        return Array.from(remapped.values());
    }

    private static buildRelationDegrees(relations: Relation[]): Map<string, number> {
        const degrees = new Map<string, number>();

        relations.forEach((relation) => {
            const source = this.normalizeEntityKey(relation.source);
            const target = this.normalizeEntityKey(relation.target);
            degrees.set(source, (degrees.get(source) || 0) + 1);
            degrees.set(target, (degrees.get(target) || 0) + 1);
        });

        return degrees;
    }

    private static buildEntity(group: CandidateGroup, relationDegree: number): Entity {
        const aliases = Array.from(group.aliases).filter((alias) => !this.isEntityMatch(alias, group.canonicalName));
        const type = Array.from(group.typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "MISC";
        const confidence =
            group.confidenceCount > 0 ? group.confidenceTotal / group.confidenceCount : 0.75;
        const salience = Math.min(
            1,
            0.18 + group.mentions * 0.04 + group.sourceChunks.size * 0.035 + relationDegree * 0.045
        );

        return {
            id: group.canonicalName,
            canonical_id: this.normalizeEntityKey(group.canonicalName),
            name: group.canonicalName,
            type,
            description: Array.from(group.descriptions)[0] || `Detected as ${type}`,
            confidence,
            aliases,
            salience,
            evidence: Array.from(group.evidence).slice(0, 4),
            source_chunks: Array.from(group.sourceChunks).sort((a, b) => a - b),
        };
    }

    private static buildContextCards(
        entities: Entity[],
        groups: CandidateGroup[],
        relations: Relation[]
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

        return entities.reduce<Record<string, ContextCard>>((acc, entity) => {
            const group = groups.find((item) => this.isEntityMatch(item.canonicalName, entity.name));
            const mentions = group?.mentions || 1;
            const relationCount = (relationLookup.get(entity.name) || []).length;
            const significance =
                relationCount >= 8 || (entity.salience || 0) >= 0.9
                    ? "CRITICAL"
                    : relationCount >= 4 || (entity.salience || 0) >= 0.7
                    ? "HIGH"
                    : relationCount >= 2 || (entity.salience || 0) >= 0.45
                    ? "MEDIUM"
                    : "LOW";

            acc[entity.name] = {
                entityName: entity.name,
                type: entity.type,
                summary:
                    entity.description ||
                    `Entity appears ${mentions} times with ${relationCount} known connections.`,
                key_mentions: entity.evidence || [],
                role_in_document: entity.description || `Detected as ${entity.type}`,
                significance,
                affiliation: entity.aliases?.length ? `Aliases: ${entity.aliases.join(", ")}` : "Unknown",
                aliases: entity.aliases || [],
                status: "UNKNOWN",
                isShallow: true,
            };

            return acc;
        }, {});
    }

    private static extractEvidence(sourceText: string, names: string[]): string[] {
        const snippets: string[] = [];
        const seen = new Set<string>();

        names.filter(Boolean).forEach((name) => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(escaped, "ig");
            let match: RegExpExecArray | null = null;
            let iterations = 0;

            while ((match = regex.exec(sourceText)) && iterations < 3) {
                const start = Math.max(0, match.index - 180);
                const end = Math.min(sourceText.length, match.index + name.length + 220);
                const snippet = sourceText.slice(start, end).trim();
                if (snippet && !seen.has(snippet)) {
                    snippets.push(snippet);
                    seen.add(snippet);
                }
                iterations += 1;
            }
        });

        return snippets.slice(0, 4);
    }

    private static isValidTitleCaseCandidate(candidate: string): boolean {
        const parts = candidate.split(/\s+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 5) return false;
        if (TITLE_CASE_CONNECTORS.has(parts[0].toLowerCase()) || TITLE_CASE_CONNECTORS.has(parts[parts.length - 1].toLowerCase())) return false;

        const meaningfulParts = parts.filter((part) => !TITLE_CASE_CONNECTORS.has(part.toLowerCase()));
        if (!meaningfulParts.length) return false;
        if (meaningfulParts.some((part) => TITLE_CASE_STOPWORDS.has(part.toLowerCase()))) return false;
        if (meaningfulParts.every((part) => /^\d+$/.test(part))) return false;

        return meaningfulParts.every(
            (part) =>
                /^[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)*$/.test(part) ||
                /^\d+[A-Za-z-]*$/.test(part)
        );
    }

    private static isLikelyOrganizationName(candidate: string): boolean {
        return /\b(?:Agency|Authority|Bank|Brokers|Committee|Company|Council|Customs|Department|Directorate|Finance|Foundation|Group|Holdings|Institute|Logistics|Ltd|Ministry|Office|Port|Procurement|Security|Services|Shipping|Telecom|University|Warehousing|Advisory|Maritime|Capital|Partners|Trading|Investment|Management|GmbH|FZE)\b/i.test(
            candidate
        ) || /(?:בע["״]מ|בע"מ|ועדת|רשות|משרד|מטה|יחידת|חברת|קבוצת)/u.test(candidate);
    }

    private static inferTitleCaseType(candidate: string): string {
        if (/\b(?:Warehouse|Terminal|Clinic|Hospital|University|Campus|Building|Tower|Station|Factory|Plant|Office|Laboratory|Garage|Hangar)\b/i.test(candidate)) {
            return "FACILITY";
        }
        if (/\b(?:Unit|Cell|Pier|Camp|Base|Harbor|Harbour|Port|Road|Avenue|Boulevard|Crossing|District|Valley)\b/i.test(candidate)) {
            return "LOCATION";
        }
        if (/\b(?:Toyota|Ford|Chevrolet|Mercedes(?:-Benz)?|BMW|Audi|Volkswagen|Honda|Hyundai|Kia|Nissan|Mazda|Mitsubishi|Isuzu|Volvo|Scania|Tesla|BYD|Renault|Peugeot|Citroen|Fiat|Skoda|MAN|DAF|Iveco|DJI|Caterpillar|Komatsu|John Deere|truck|sedan|pickup|van|bus|tractor|trailer|forklift|drone|excavator)\b/i.test(candidate)) {
            return "VEHICLE";
        }
        if (/\b(?:Phone|Handset|Server|Router|Modem|Laptop|Tablet|Drone|Camera|Repeater|Radio|Gateway)\b/i.test(candidate)) {
            return "DEVICE";
        }
        if (/\b(?:Report|Document|Form|Contract|Invoice|Passport|Manifest|Protocol|License|Certificate|Memo|Dossier)\b/i.test(candidate)) {
            return "DOCUMENT";
        }
        if (this.isLikelyOrganizationName(candidate)) {
            return "ORGANIZATION";
        }
        return "PERSON";
    }
}
