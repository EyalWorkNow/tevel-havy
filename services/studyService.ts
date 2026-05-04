import { supabase, supabaseEnabled } from './supabaseClient';
import { ContextCard, Relation, StudyItem } from '../types';

const LOCAL_STUDIES_KEY = 'tevel.local.studies.v2';
const OFFLINE_MODE_KEY = 'tevel.persistence.offline.v1';

type LegacyStudyRow = {
    id: string;
    title: string;
    content?: string;
    date?: string;
    date_str?: string;
    source: StudyItem['source'];
    status: StudyItem['status'];
    tags?: string[];
    intelligence: StudyItem['intelligence'];
    super_intelligence?: Record<string, any>;
    knowledge_intelligence?: Record<string, any>;
    ['Super intelligence']?: Record<string, any>;
};

// Helper to generate UUIDs
export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const cloneStudy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const hasBrowserStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
        return String((error as { message?: unknown }).message);
    }
    return String(error ?? '');
};

/**
 * Handles persistence of Intelligence Studies to Supabase when available,
 * while maintaining a local offline-first cache so the UI stays usable if
 * the hosted database is unreachable.
 */
export class StudyService {
    private static connectionMode: 'unknown' | 'online' | 'offline' =
        hasBrowserStorage() && window.localStorage.getItem(OFFLINE_MODE_KEY) === 'true'
            ? 'offline'
            : 'unknown';
    private static offlineNoticeShown = false;
    private static memoryStudies: StudyItem[] = [];

    private static mapRowToStudy(row: LegacyStudyRow): StudyItem {
        return {
            id: row.id,
            title: row.title,
            date: row.date || row.date_str || 'Unknown Date',
            source: row.source,
            status: row.status,
            tags: row.tags || [],
            intelligence: row.intelligence,
            super_intelligence: row['Super intelligence'] || row.super_intelligence || {},
            knowledge_intelligence: row.knowledge_intelligence || {},
        };
    }

    private static readLocalStudies(): StudyItem[] {
        try {
            if (hasBrowserStorage()) {
                const stored = window.localStorage.getItem(LOCAL_STUDIES_KEY);
                if (!stored) return [];
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    return parsed as StudyItem[];
                }
                return [];
            }
            return cloneStudy(this.memoryStudies);
        } catch (error) {
            console.warn('Failed to read local Tevel study cache:', getErrorMessage(error));
            return [];
        }
    }

    private static writeLocalStudies(studies: StudyItem[]): void {
        const snapshot = cloneStudy(studies);
        try {
            if (hasBrowserStorage()) {
                try {
                    window.localStorage.setItem(LOCAL_STUDIES_KEY, JSON.stringify(snapshot));
                } catch (storageError) {
                    // Quota exceeded - try pruning oldest studies
                    if (studies.length > 5) {
                        console.warn('Pruning oldest studies to clear localStorage space...');
                        const pruned = studies.slice(0, 5);
                        window.localStorage.setItem(LOCAL_STUDIES_KEY, JSON.stringify(pruned));
                    } else {
                        throw storageError;
                    }
                }
                return;
            }
        } catch (error) {
            console.warn('Failed to write local Tevel study cache:', getErrorMessage(error));
        }
        this.memoryStudies = snapshot;
    }

    private static cacheStudies(studies: StudyItem[]): StudyItem[] {
        this.writeLocalStudies(studies);
        return studies;
    }

    private static upsertLocalStudy(study: StudyItem): StudyItem[] {
        const localStudies = this.readLocalStudies();
        const next = [...localStudies];
        const index = next.findIndex((existing) => existing.id === study.id);
        if (index >= 0) {
            next[index] = cloneStudy(study);
        } else {
            next.unshift(cloneStudy(study));
        }
        this.writeLocalStudies(next);
        return next;
    }

    private static updateLocalStudy(studyId: string, updater: (study: StudyItem) => StudyItem): boolean {
        const localStudies = this.readLocalStudies();
        const index = localStudies.findIndex((study) => study.id === studyId);
        if (index < 0) {
            return false;
        }
        localStudies[index] = cloneStudy(updater(localStudies[index]));
        this.writeLocalStudies(localStudies);
        return true;
    }

    private static removeLocalStudy(studyId: string): boolean {
        const localStudies = this.readLocalStudies();
        const next = localStudies.filter((study) => study.id !== studyId);
        if (next.length === localStudies.length) {
            return false;
        }
        this.writeLocalStudies(next);
        return true;
    }

    private static isFetchFailure(error: unknown): boolean {
        const message = getErrorMessage(error).toLowerCase();
        return (
            error instanceof TypeError ||
            message.includes('failed to fetch') ||
            message.includes('err_name_not_resolved') ||
            message.includes('load failed') ||
            message.includes('networkerror') ||
            message.includes('fetch')
        );
    }

    private static markOnline(): void {
        this.connectionMode = 'online';
        try {
            if (hasBrowserStorage()) {
                window.localStorage.removeItem(OFFLINE_MODE_KEY);
            }
        } catch {
            // ignore local storage errors
        }
    }

    private static markOffline(reason?: unknown): void {
        this.connectionMode = 'offline';
        try {
            if (hasBrowserStorage()) {
                window.localStorage.setItem(OFFLINE_MODE_KEY, 'true');
            }
        } catch {
            // ignore local storage errors
        }
        if (!this.offlineNoticeShown) {
            const suffix = reason ? ` (${getErrorMessage(reason)})` : '';
            console.warn(`Supabase unavailable, switching Tevel persistence to offline local cache${suffix}.`);
            this.offlineNoticeShown = true;
        }
    }

    private static shouldUseOfflineCache(): boolean {
        return !supabaseEnabled || this.connectionMode === 'offline';
    }

    private static buildLegacyPayload(study: StudyItem) {
        return {
            id: study.id,
            title: study.title,
            content: study.intelligence.clean_text || 'No content provided.',
            date: study.date,
            source: study.source,
            status: study.status,
            tags: study.tags,
            intelligence: study.intelligence,
            'Super intelligence': study.super_intelligence || {},
            knowledge_intelligence: study.knowledge_intelligence || {},
        };
    }

    private static async readRemoteStudies(): Promise<StudyItem[]> {
        const { data, error } = await supabase
            .from('studies')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        const studies = (data || []).map((row: any) => this.mapRowToStudy(row));
        this.markOnline();
        return this.cacheStudies(studies);
    }

    /**
     * Fetches all studies from Supabase when reachable, otherwise falls back to
     * the persisted local cache without repeatedly spamming failed network calls.
     */
    static async getAllStudies(): Promise<StudyItem[]> {
        if (this.shouldUseOfflineCache()) {
            return this.readLocalStudies();
        }

        try {
            return await this.readRemoteStudies();
        } catch (error) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return this.readLocalStudies();
            }
            console.error('Supabase fetch error:', getErrorMessage(error));
            return this.readLocalStudies();
        }
    }

    /**
     * Saves a new study. Local persistence is updated first so the UI remains
     * consistent even when the remote database is unavailable.
     */
    static async saveStudy(study: StudyItem): Promise<string | null> {
        let finalId = study.id;
        if (!finalId || finalId.startsWith('s_') || finalId.startsWith('rt_')) {
            finalId = generateUUID();
        }

        const studyWithId = { ...study, id: finalId };
        this.upsertLocalStudy(studyWithId);

        if (this.shouldUseOfflineCache()) {
            return finalId;
        }

        const legacySuccess = await this.saveToLegacyTable(studyWithId);

        if (legacySuccess) {
            this.saveNormalizedData(studyWithId).catch((err) =>
                console.warn('Normalized save failed (likely due to missing tables in this POC env), but local/UI save succeeded.', err)
            );
        }

        return finalId;
    }

    /**
     * Deletes a study from local cache immediately and removes it from Supabase
     * when the backend is reachable.
     */
    static async deleteStudy(studyId: string): Promise<boolean> {
        const localDeleted = this.removeLocalStudy(studyId);

        if (this.shouldUseOfflineCache()) {
            return localDeleted;
        }

        try {
            const { error } = await supabase
                .from('studies')
                .delete()
                .eq('id', studyId);

            if (error) {
                if (this.isFetchFailure(error)) {
                    this.markOffline(error);
                    return localDeleted;
                }
                console.error('Error deleting study from DB:', error);
                return localDeleted;
            }

            this.markOnline();
            return true;
        } catch (error) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return localDeleted;
            }
            console.error('Exception in deleteStudy:', error);
            return localDeleted;
        }
    }

    /**
     * Updates a specific ContextCard and keeps a local cache copy in sync.
     */
    static async updateStudyContextCard(studyId: string, entityName: string, updatedCard: ContextCard): Promise<boolean> {
        const localUpdated = this.updateLocalStudy(studyId, (study) => {
            const intelligence = cloneStudy(study.intelligence);
            if (!intelligence.context_cards) intelligence.context_cards = {};
            const existingKeys = Object.keys(intelligence.context_cards);
            const matchKey = existingKeys.find((key) => key.toLowerCase() === entityName.toLowerCase()) || entityName;
            intelligence.context_cards[matchKey] = updatedCard;
            return { ...study, intelligence };
        });

        if (this.shouldUseOfflineCache()) {
            return localUpdated;
        }

        try {
            const { data: currentData, error: fetchError } = await supabase
                .from('studies')
                .select('intelligence')
                .eq('id', studyId)
                .single();

            if (fetchError || !currentData) {
                if (this.isFetchFailure(fetchError)) {
                    this.markOffline(fetchError);
                    return localUpdated;
                }
                console.error('Error fetching study for update:', fetchError);
                return localUpdated;
            }

            const intelligence = currentData.intelligence || {};
            if (!intelligence.context_cards) {
                intelligence.context_cards = {};
            }

            const existingKeys = Object.keys(intelligence.context_cards);
            const matchKey = existingKeys.find((key) => key.toLowerCase() === entityName.toLowerCase()) || entityName;
            intelligence.context_cards[matchKey] = updatedCard;

            const { error: updateError } = await supabase
                .from('studies')
                .update({ intelligence })
                .eq('id', studyId);

            if (updateError) {
                if (this.isFetchFailure(updateError)) {
                    this.markOffline(updateError);
                    return localUpdated;
                }
                console.error('Error updating context card:', updateError);
            } else {
                this.markOnline();
            }

            return localUpdated || !updateError;
        } catch (error) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return localUpdated;
            }
            console.error('Exception in updateStudyContextCard:', error);
            return localUpdated;
        }
    }

    /**
     * Updates the 'Super intelligence' column while keeping the local cache live.
     */
    static async updateSuperIntelligence(studyId: string, entityName: string, content: any): Promise<boolean> {
        const localUpdated = this.updateLocalStudy(studyId, (study) => ({
            ...study,
            super_intelligence: {
                ...(study.super_intelligence || {}),
                [entityName]: { ...((study.super_intelligence || {})[entityName] || {}), ...content },
            },
        }));

        if (this.shouldUseOfflineCache()) {
            return localUpdated;
        }

        try {
            const { data: currentData, error: fetchError } = await supabase
                .from('studies')
                .select('*')
                .eq('id', studyId)
                .single();

            if (fetchError || !currentData) {
                if (this.isFetchFailure(fetchError)) {
                    this.markOffline(fetchError);
                    return localUpdated;
                }
                console.error('Error fetching study for Super Intelligence update:', fetchError);
                return localUpdated;
            }

            let superData = currentData['Super intelligence'] || currentData.super_intelligence || {};
            if (typeof superData !== 'object' || superData === null) {
                superData = {};
            }

            superData[entityName] = { ...(superData[entityName] || {}), ...content };

            const { error: updateError } = await supabase
                .from('studies')
                .update({ 'Super intelligence': superData })
                .eq('id', studyId);

            if (updateError) {
                if (this.isFetchFailure(updateError)) {
                    this.markOffline(updateError);
                    return localUpdated;
                }
                console.error('Error updating Super intelligence:', updateError);
            } else {
                this.markOnline();
            }

            return localUpdated || !updateError;
        } catch (error) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return localUpdated;
            }
            console.error('Exception in updateSuperIntelligence:', error);
            return localUpdated;
        }
    }

    /**
     * Updates the 'knowledge_intelligence' column in Supabase and local cache.
     */
    static async updateKnowledgeIntelligence(studyId: string, entityName: string, content: any): Promise<boolean> {
        const localUpdated = this.updateLocalStudy(studyId, (study) => ({
            ...study,
            knowledge_intelligence: {
                ...(study.knowledge_intelligence || {}),
                [entityName]: { ...((study.knowledge_intelligence || {})[entityName] || {}), ...content },
            },
        }));

        if (this.shouldUseOfflineCache()) {
            return localUpdated;
        }

        try {
            const { data: currentData, error: fetchError } = await supabase
                .from('studies')
                .select('*')
                .eq('id', studyId)
                .single();

            if (fetchError || !currentData) {
                if (this.isFetchFailure(fetchError)) {
                    this.markOffline(fetchError);
                    return localUpdated;
                }
                console.error('Error fetching study for Knowledge Intelligence update:', getErrorMessage(fetchError));
                return localUpdated;
            }

            let knowledgeData = currentData.knowledge_intelligence || {};
            if (typeof knowledgeData !== 'object' || knowledgeData === null) {
                knowledgeData = {};
            }

            knowledgeData[entityName] = { ...(knowledgeData[entityName] || {}), ...content };

            const { error: updateError } = await supabase
                .from('studies')
                .update({ knowledge_intelligence: knowledgeData })
                .eq('id', studyId);

            if (updateError) {
                if (this.isFetchFailure(updateError)) {
                    this.markOffline(updateError);
                    return localUpdated;
                }
                console.error('Error updating knowledge_intelligence:', getErrorMessage(updateError));
            } else {
                this.markOnline();
            }

            return localUpdated || !updateError;
        } catch (error) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return localUpdated;
            }
            console.error('Exception in updateKnowledgeIntelligence:', error);
            return localUpdated;
        }
    }

    private static async saveToLegacyTable(study: StudyItem): Promise<boolean> {
        try {
            const { error } = await supabase.from('studies').upsert(this.buildLegacyPayload(study), { onConflict: 'id' });

            if (error) {
                if (this.isFetchFailure(error)) {
                    this.markOffline(error);
                    return false;
                }
                console.error('Error saving study to DB:', getErrorMessage(error));
                return false;
            }

            this.markOnline();
            return true;
        } catch (error) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return false;
            }
            console.error('Exception in saveToLegacyTable:', error);
            return false;
        }
    }

    /**
     * Extracts data and writes to 'entities' and 'relations' tables.
     * This remains best-effort and does not block the UI path.
     */
    private static async saveNormalizedData(study: StudyItem): Promise<void> {
        const studyId = study.id;
        const uniqueEntities = new Map();

        study.intelligence.entities.forEach((entity) => {
            if (!uniqueEntities.has(entity.name)) {
                uniqueEntities.set(entity.name, {
                    study_id: studyId,
                    name: entity.name,
                    type: entity.type,
                    role: entity.description || 'Unknown',
                    metadata: { confidence: entity.confidence },
                });
            }
        });

        const entityRows = Array.from(uniqueEntities.values());
        const relationRows = study.intelligence.relations.map((relation: Relation) => ({
            study_id: studyId,
            source_entity: relation.source,
            target_entity: relation.target,
            relation_type: relation.type,
            confidence: relation.confidence,
        }));

        if (entityRows.length > 0) {
            const { error } = await supabase.from('entities').upsert(entityRows, { ignoreDuplicates: true });
            if (error) console.warn('Entity sync warning:', getErrorMessage(error));
        }

        if (relationRows.length > 0) {
            const { error } = await supabase.from('relations').upsert(relationRows, { ignoreDuplicates: true });
            if (error) console.warn('Relation sync warning:', getErrorMessage(error));
        }
    }

    /**
     * Batch inserts initial mock data. Local cache is always warmed so the app
     * can bootstrap even when the hosted DB is unreachable.
     */
    static async seedStudies(studies: StudyItem[]): Promise<boolean> {
        const seededStudies = studies.map((study) => ({
            ...study,
            id: study.id && !study.id.startsWith('s_') && !study.id.startsWith('rt_') ? study.id : generateUUID(),
        }));

        this.cacheStudies(seededStudies);

        if (this.shouldUseOfflineCache()) {
            return true;
        }

        try {
            const payload = seededStudies.map((study) => this.buildLegacyPayload(study));
            const { error } = await supabase.from('studies').upsert(payload, { onConflict: 'title' });

            if (error) {
                if (this.isFetchFailure(error)) {
                    this.markOffline(error);
                    return true;
                }
                console.error('Seed error message:', getErrorMessage(error));
                return false;
            }

            this.markOnline();
            return true;
        } catch (error: any) {
            if (this.isFetchFailure(error)) {
                this.markOffline(error);
                return true;
            }
            console.error('Exception in seedStudies:', getErrorMessage(error));
            return false;
        }
    }

    static __resetForTests(): void {
        this.connectionMode = 'unknown';
        this.offlineNoticeShown = false;
        this.memoryStudies = [];
        try {
            if (hasBrowserStorage()) {
                window.localStorage.removeItem(LOCAL_STUDIES_KEY);
                window.localStorage.removeItem(OFFLINE_MODE_KEY);
            }
        } catch {
            // ignore test cleanup failures
        }
    }
}
