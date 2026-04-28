
import React, { useState, useEffect } from 'react';
import IngestionPanel from './components/IngestionPanel';
import { AnalysisDashboard } from './components/AnalysisDashboard';
import FeedDashboard from './components/FeedDashboard';
import OperationsDashboard from './components/OperationsDashboard';
import ManagementDashboard from './components/ManagementDashboard';
import RealTimeDashboard from './components/RealTimeDashboard';
import LoginPage from './components/LoginPage';
import { SettingsPage } from './components/SettingsPage'; // Import Settings Page
import IdentityResolutionApp from './identity-resolution/IdentityResolutionApp';
import { isEntityMatch } from './services/intelligenceService';
import { analyzeDocument, enrichIntelligencePackage } from './services/analysisService';
import { StudyService } from './services/studyService';
import { auth } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth'; // Modular SDK Imports
import { IntelligencePackage, StudyItem, Entity, RawMedia, GraphData } from './types';
import { AlertTriangle, LayoutGrid, PlusCircle, Settings, LogOut, Network, X, BarChart2, Cpu, ScanEye, Loader2, Terminal, Activity, Users } from 'lucide-react';

type ViewState = 'feed' | 'analysis' | 'ingest' | 'operations' | 'management' | 'realtime' | 'settings' | 'identity';

const LOCAL_ADMIN_SESSION_KEY = 'tevel-local-admin-session';
const buildLocalAdminUser = (): User =>
    ({
        uid: 'local-admin',
        email: 'admin@admin.com',
        displayName: 'Local Admin',
        emailVerified: true,
        isAnonymous: false,
        metadata: {},
        providerData: [],
        refreshToken: '',
        tenantId: null,
        delete: async () => undefined,
        getIdToken: async () => '',
        getIdTokenResult: async () => ({ token: '', authTime: '', issuedAtTime: '', expirationTime: '', signInProvider: null, signInSecondFactor: null, claims: {} }),
        reload: async () => undefined,
        toJSON: () => ({}),
        providerId: 'password',
        phoneNumber: null,
        photoURL: null,
    } as User);

// --- TEVEL ARCHITECTURE: CROSS-DOMAIN INTELLIGENCE DATASET ---

// Utility to create graph data from entities and relations
const createGraphData = (entities: Entity[], relations: any[]): GraphData => {
    const normalize = (s: string) => s ? s.trim().toLowerCase() : '';
    const entityMap = new Map<string, Entity>();
    entities.forEach(e => entityMap.set(normalize(e.name), e));

    const getTypeGroup = (type: string) => {
        switch (type) {
            case 'PERSON': return 1;
            case 'ORGANIZATION': return 2;
            case 'LOCATION': return 3;
            case 'ASSET': return 4;
            case 'EVENT': return 5;
            case 'DATE': return 6;
            default: return 7;
        }
    };

    const nodes = entities.map(e => ({
        id: e.name, 
        group: getTypeGroup(e.type),
        type: e.type
    }));
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: any[] = [];
    
    const seenEdges = new Set<string>();

    relations.forEach(r => {
        let sourceId = r.source;
        let targetId = r.target;
        const normalizeSource = normalize(sourceId);
        const normalizeTarget = normalize(targetId);

        if (!normalizeSource || normalizeSource === normalizeTarget) {
            return;
        }

        if (entityMap.has(normalizeSource)) sourceId = entityMap.get(normalizeSource)!.name;
        if (entityMap.has(normalizeTarget)) targetId = entityMap.get(normalizeTarget)!.name;

        const edgeKey = `${normalize(sourceId)}|${normalize(targetId)}|${String(r.type || '').toLowerCase()}`;
        if (seenEdges.has(edgeKey)) {
            return;
        }
        seenEdges.add(edgeKey);

        if (!nodeIds.has(sourceId)) {
            nodes.push({ id: sourceId, group: 8, type: 'MISC' });
            nodeIds.add(sourceId);
        }
        if (!nodeIds.has(targetId)) {
            nodes.push({ id: targetId, group: 8, type: 'MISC' });
            nodeIds.add(targetId);
        }

        edges.push({ source: sourceId, target: targetId, value: (r.confidence || 0.5) * 5 });
    });

    return { nodes, edges };
};

const createEmergencyFallbackIntelligence = (text: string, media: RawMedia[]): IntelligencePackage => {
    const fallback = enrichIntelligencePackage({
        clean_text: '',
        raw_text: text,
        word_count: text.split(/\s+/).filter(Boolean).length,
        entities: [],
        relations: [],
        insights: [],
        timeline: [],
        statements: [],
        intel_questions: [],
        intel_tasks: [],
        tactical_assessment: { ttps: [], recommendations: [], gaps: [] },
        context_cards: {},
        graph: { nodes: [], edges: [] },
        reliability: 0.45,
    }, text);

    return {
        ...fallback,
        media,
        clean_text: fallback.clean_text || 'Tevel returned a deterministic fallback package after an analysis failure.',
    };
};

// SHARED ENTITIES
const LINK_SILVER_IODIDE: Entity = { id: "Silver Iodide", name: "יודיד הכסף (AgI)", type: "ASSET" };
const LINK_PROJECT_ZEPHYR: Entity = { id: "Project Zephyr", name: "Project Zephyr", type: "ORGANIZATION" };
const LINK_EAST_EUROPE: Entity = { id: "East Europe", name: "מזרח אירופה", type: "LOCATION" };
const LINK_RF_TECH: Entity = { id: "High Power RF", name: "High Power RF", type: "ASSET" };
const LINK_CONDUCTIVE_DUST: Entity = { id: "Conductive Dust", name: "אבק מוליך", type: "ASSET" };

// --- MOCK DATA FOR SEEDING ---
const financeEntities: Entity[] = [
    LINK_PROJECT_ZEPHYR, { id: "ESMA", name: "ESMA", type: "ORGANIZATION" }, LINK_EAST_EUROPE,
    { id: "Wheat Futures", name: "חוזים עתידיים (חיטה)", type: "ASSET" }, { id: "Cayman Islands", name: "איי קיימן", type: "LOCATION" }, { id: "ECMWF", name: "ECMWF", type: "ORGANIZATION" }
];
const financeRelations = [
    { source: "Project Zephyr", target: "חוזים עתידיים (חיטה)", type: "short_selling", confidence: 1.0 },
    { source: "Project Zephyr", target: "מזרח אירופה", type: "targeting", confidence: 0.95 },
    { source: "Project Zephyr", target: "איי קיימן", type: "registered_location", confidence: 1.0 },
    { source: "ECMWF", target: "מזרח אירופה", type: "weather_forecast", confidence: 0.8 }
];
const DATA_FINANCE: IntelligencePackage = {
    clean_text: "ציח מחקרי מס' 1: פיננסים ומסחר אלגוריתמי...",
    word_count: 320, reliability: 0.95, entities: financeEntities, relations: financeRelations,
    timeline: [{ date: "10/08/2025", event: "זיהוי דפוס מסחר אנומלי ע\"י ESMA" }, { date: "12/08/2025", event: "Project Zephyr פותחת פוזיציית שורט" }, { date: "15/08/2025", event: "אירוע אקלים משמיד יבולים בניגוד לתחזית" }],
    insights: [{ type: "anomaly", importance: 0.99, text: "94% אחוזי הצלחה בחיזוי אירועי אקלים 'בלתי צפויים'." }, { type: "pattern", importance: 0.90, text: "קורלציה בין קואורדינטות GPS ספציפיות לפקודות מסחר HFT." }],
    tactical_assessment: { ttps: ["Short Selling ממונף", "שימוש במידע פנים (Exotic Data)"], recommendations: ["איתור מקור המידע", "בדיקת תקשורת לווינית"], gaps: ["מהו הטריגר הפיזי?", "מי מפעיל את הטריגר?"] },
    context_cards: {}, graph: createGraphData(financeEntities, financeRelations)
};

const agroEntities: Entity[] = [LINK_SILVER_IODIDE, LINK_EAST_EUROPE, { id: "Silver Necrosis", name: "תסמונת הנמק הכסוף", type: "EVENT" }, { id: "Polymer Nanoparticles", name: "ננו-חלקיקים פולימריים", type: "ASSET" }, { id: "National Agriculture Institute", name: "המכון הלאומי לחקר החקלאות", type: "ORGANIZATION" }];
const agroRelations = [{ source: "תסמונת הנמק הכסוף", target: "יודיד הכסף (AgI)", type: "caused_by", confidence: 0.9 }, { source: "תסמונת הנמק הכסוף", target: "מזרח אירופה", type: "observed_in", confidence: 1.0 }, { source: "יודיד הכסף (AgI)", target: "ננו-חלקיקים פולימריים", type: "found_with", confidence: 0.85 }];
const DATA_AGRO: IntelligencePackage = {
    clean_text: "ציח מחקרי מס' 2: אגרונומיה ופתולוגיה של הצומח...",
    word_count: 280, reliability: 0.85, entities: agroEntities, relations: agroRelations,
    timeline: [{ date: "20/08/2025", event: "זיהוי ראשוני של 'הנמק הכסוף'." }, { date: "25/08/2025", event: "דגימות קרקע נלקחות." }, { date: "28/08/2025", event: "תוצאות מעבדה מאשרות נוכחות AgI." }],
    insights: [{ type: "key_event", importance: 0.9, text: "הנזק אינו ביולוגי אלא כימי." }, { type: "pattern", importance: 0.95, text: "הופעת החומרים הרעילים דרך משקעים." }],
    tactical_assessment: { ttps: ["פיזור חומרים כימיים", "הסוואת פעולה כאירוע טבעי"], recommendations: ["ניתוח דגימות גשם", "איתור המקור"], gaps: ["מהו הפולימר הבלתי מזוהה?", "כיצד החומרים מפוזרים?"] },
    context_cards: {}, graph: createGraphData(agroEntities, agroRelations)
};

const energyEntities: Entity[] = [LINK_CONDUCTIVE_DUST, { id: "Power Grid", name: "רשת החשמל", type: "INFRASTRUCTURE" }, { id: "Flashover Event", name: "פריצה חשמלית", type: "EVENT" }, { id: "Ionized Cloud", name: "ענן מיונן", type: "MISC" }];
const energyRelations = [{ source: "אבק מוליך", target: "פריצה חשמלית", type: "causes", confidence: 0.9 }, { source: "ענן מיונן", target: "אבק מוליך", type: "contains", confidence: 0.8 }];
const DATA_ENERGY: IntelligencePackage = {
    clean_text: "ציח מחקרי מס' 3: הנדסת חשמל ותשתיות...",
    word_count: 250, reliability: 0.8, entities: energyEntities, relations: energyRelations,
    timeline: [{ date: "01/09/2025", event: "דיווח על עלייה חדה בתקלות ברשת החשמל." }],
    insights: [{ type: "anomaly", importance: 0.9, text: "כשלים חשמליים ללא סיבה טבעית, מקושרים לאבק מוליך." }],
    tactical_assessment: { gaps: ["מקור האבק?"], recommendations: ["ניתוח הרכב"], ttps: [] },
    context_cards: {}, graph: createGraphData(energyEntities, energyRelations)
};

const physicsEntities: Entity[] = [LINK_RF_TECH, { id: "Ionization Bubbles", name: "בועות יינון", type: "EVENT" }, { id: "Atmospheric Lensing", name: "עדשות אטמוספריות", type: "MISC" }, { id: "National Observatory", name: "המצפה האסטרונומי", type: "ORGANIZATION" }];
const physicsRelations = [{ source: "High Power RF", target: "בועות יינון", type: "creates", confidence: 0.95 }, { source: "בועות יינון", target: "עדשות אטמוספריות", type: "acts_as", confidence: 0.8 }];
const DATA_PHYSICS: IntelligencePackage = {
    clean_text: "ציח מחקרי מס' 4: מדעי האטמוספירה ופיזיקת חלל...",
    word_count: 240, reliability: 0.98, entities: physicsEntities, relations: physicsRelations,
    timeline: [{ date: "05/09/2025", event: "זיהוי אנומליות GPS וראדאר." }],
    insights: [{ type: "pattern", importance: 1.0, text: "שימוש ב-RF ליצירת עננים באופן מלאכותי." }],
    tactical_assessment: { gaps: ["מיקום משדר ה-RF?"], recommendations: ["סריקת RF"], ttps: ["שינוי מזג אוויר ב-RF"] },
    context_cards: {}, graph: createGraphData(physicsEntities, physicsRelations)
};

const farm7Entities: Entity[] = [{ id: "Farm 7", name: "חווה 7", type: "LOCATION" }, LINK_RF_TECH, LINK_SILVER_IODIDE, LINK_PROJECT_ZEPHYR, LINK_CONDUCTIVE_DUST, { id: "Jordan Valley", name: "בקעת הירדן", type: "LOCATION" }, { id: "PMC", name: "PMC", type: "ORGANIZATION" }];
const farm7Relations = [{ source: "חווה 7", target: "High Power RF", type: "houses", confidence: 1.0 }, { source: "חווה 7", target: "יודיד הכסף (AgI)", type: "stores", confidence: 1.0 }, { source: "חווה 7", target: "Project Zephyr", type: "communicates_with", confidence: 1.0 }, { source: "חווה 7", target: "אבק מוליך", type: "disperses", confidence: 0.9 }];
const DATA_FARM_7: IntelligencePackage = {
    clean_text: "ציח מבצעי: פשיטה על 'חווה 7'...",
    word_count: 410, reliability: 1.0, entities: farm7Entities, relations: farm7Relations,
    timeline: [{ date: "10/09/2025", event: "פשיטה על 'חווה 7' ואיסוף ראיות." }],
    insights: [{ type: "summary", importance: 1.0, text: "חווה 7 היא התשתית המבצעית המקשרת." }],
    tactical_assessment: { gaps: [], recommendations: ["השתלטות על הציוד"], ttps: ["הסוואת תשתית צבאית"] },
    context_cards: {}, graph: createGraphData(farm7Entities, farm7Relations),
    biometrics: { faces: [{ id: "F01", detectedName: "PMC Commander", matchConfidence: 0.92, imageUrl: "https://i.pravatar.cc/300?u=pmc", sourceFile: "drone_footage.mp4", watchlistStatus: "MATCH" }], voices: [{ id: "V01", speakerName: "Unknown Operator", matchConfidence: 0.85, language: "Russian", tone: "Calm", transcript: "Confirm target coordinates..." }] }
};

const INITIAL_MOCK_STUDIES: StudyItem[] = [
    { id: '1', title: 'Financial Anomalies in Soft Commodities', date: '01/09/2025', source: 'Report', status: 'Approved', tags: ['Finance', 'Trading', 'Anomaly', 'Project Zephyr'], intelligence: DATA_FINANCE },
    { id: '2', title: 'Pathology Report: "Silver Necrosis" in Crops', date: '03/09/2025', source: 'Report', status: 'Approved', tags: ['Agronomy', 'Science', 'Chemical'], intelligence: DATA_AGRO },
    { id: '3', title: 'Systemic Failures in National Power Grid', date: '04/09/2025', source: 'Signal', status: 'Review', tags: ['Infrastructure', 'Energy', 'Critical'], intelligence: DATA_ENERGY },
    { id: '4', title: 'Atmospheric Ionization Anomalies Detected', date: '06/09/2025', source: 'Report', status: 'Approved', tags: ['Physics', 'Atmosphere', 'RF', 'Urgent'], intelligence: DATA_PHYSICS },
    { id: '5', title: 'RAID ANALYSIS: "Farm 7" Compound', date: '11/09/2025', source: 'Report', status: 'Approved', tags: ['Raid', 'Critical', 'Golden Gun', 'PMC'], intelligence: DATA_FARM_7 }
];

const App: React.FC = () => {
    // --- AUTH STATE ---
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    const [view, setView] = useState<ViewState>('feed');
    const [studies, setStudies] = useState<StudyItem[]>([]);
    const [selectedStudy, setSelectedStudy] = useState<StudyItem | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isLoadingApp, setIsLoadingApp] = useState(true); // Initial Load
    const [networkAlert, setNetworkAlert] = useState<{ newStudy: StudyItem, linkedEntities: Entity[] } | null>(null);
    const [isNavExpanded, setIsNavExpanded] = useState(false);

    // --- AUTH LISTENER ---
    useEffect(() => {
        const syncLocalAuth = () => {
            const hasLocalSession =
                typeof window !== 'undefined' &&
                window.localStorage.getItem(LOCAL_ADMIN_SESSION_KEY) === '1';
            if (hasLocalSession) {
                setUser(buildLocalAdminUser());
                setAuthLoading(false);
                return true;
            }
            return false;
        };

        if (syncLocalAuth()) {
            const handler = () => {
                if (!syncLocalAuth()) {
                    setUser(null);
                }
            };
            window.addEventListener('tevel-local-auth-changed', handler);
            return () => window.removeEventListener('tevel-local-auth-changed', handler);
        }

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (!syncLocalAuth()) {
                setUser(currentUser);
            }
            setAuthLoading(false);
        });
        const handler = () => {
            if (!syncLocalAuth()) {
                setUser(null);
            }
        };
        window.addEventListener('tevel-local-auth-changed', handler);
        return () => {
            window.removeEventListener('tevel-local-auth-changed', handler);
            unsubscribe();
        };
    }, []);

    // --- DATA FETCHING (Only if Authenticated) ---
    useEffect(() => {
        if (!user) return; // Don't fetch if not logged in

        const init = async () => {
            setIsLoadingApp(true);
            try {
                // 1. Fetch from Supabase
                const dbStudies = await StudyService.getAllStudies();
                
                if (dbStudies.length === 0) {
                    console.log("Database empty or offline. Attempting to seed or use local fallback...");
                    // 2. If empty, try to seed mock data.
                    const seeded = await StudyService.seedStudies(INITIAL_MOCK_STUDIES);
                    
                    if (seeded) {
                        // RE-FETCH to get the confirmed DB data (with UUIDs)
                        const reloaded = await StudyService.getAllStudies();
                        setStudies(reloaded.length > 0 ? reloaded : INITIAL_MOCK_STUDIES);
                    } else {
                        // If seed failed (e.g. RLS or network), strictly use local fallback but DON'T crash
                        console.warn("Using local fallback data (Offline Mode)");
                        setStudies(INITIAL_MOCK_STUDIES);
                    }
                } else {
                    console.log(`Loaded ${dbStudies.length} studies from active Tevel persistence.`);
                    setStudies(dbStudies);
                }
            } catch (e) {
                console.error("Initialization error (continuing in Offline Mode):", e);
                // Absolute fallback to memory to prevent white screen
                setStudies(INITIAL_MOCK_STUDIES);
            } finally {
                setIsLoadingApp(false);
            }
        };
        init();
    }, [user]); // Re-run when user logs in

    const handleSetView = (newView: ViewState) => {
        setView(newView);
        setSelectedStudy(null);
    };

    const handleAnalyze = async (text: string, title: string, media: RawMedia[]) => {
        setView('ingest');
        setIsAnalyzing(true);
        await new Promise<void>((resolve) => {
            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(() => resolve());
                return;
            }
            setTimeout(resolve, 0);
        });
        try {
            let intelligence: IntelligencePackage;
            try {
                intelligence = await analyzeDocument(text);
            } catch (analysisError) {
                console.error("Primary analysis failed, switching to emergency fallback package:", analysisError);
                intelligence = createEmergencyFallbackIntelligence(text, media);
            }
            intelligence.media = media;
            
            if (intelligence.entities && intelligence.relations) {
                intelligence.graph = createGraphData(intelligence.entities, intelligence.relations);
            }

            const today = new Date();
            const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

            const newStudy: StudyItem = {
                id: `s_${Date.now()}`, // Temporary ID, DB will handle persistence and return UUID
                title: title,
                date: formattedDate,
                source: 'Report',
                status: 'Review',
                tags: ['New', 'AI-Generated'],
                intelligence: intelligence,
            };

            // Check Links
            const linkedEntities = newStudy.intelligence.entities.filter(newEntity =>
                studies.some(existingStudy =>
                    existingStudy.intelligence.entities.some(existingEntity =>
                        isEntityMatch(newEntity.name, existingEntity.name)
                    )
                )
            );
            
            if (linkedEntities.length > 0) {
                setNetworkAlert({ newStudy, linkedEntities });
            }

            // Update State
            setStudies(prev => [newStudy, ...prev]);
            
            // Go to Feed
            setView('feed');
            setSelectedStudy(null);

            // Persist in background so analysis UI is not blocked on network/database latency
            void StudyService.saveStudy(newStudy).then((savedId) => {
                if (!savedId) {
                    console.warn("Saved to local state only (DB persist failed)");
                    return;
                }
                setStudies((prev) =>
                    prev.map((study) => (study.id === newStudy.id ? { ...study, id: savedId } : study)),
                );
            });

        } catch (error) {
            console.error("Analysis Failed:", error);
            const fallbackIntelligence = createEmergencyFallbackIntelligence(text, media);
            fallbackIntelligence.graph = createGraphData(fallbackIntelligence.entities, fallbackIntelligence.relations);

            const today = new Date();
            const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
            const fallbackStudy: StudyItem = {
                id: `s_fallback_${Date.now()}`,
                title,
                date: formattedDate,
                source: 'Report',
                status: 'Review',
                tags: ['Fallback', 'Offline'],
                intelligence: fallbackIntelligence,
            };

            setStudies(prev => [fallbackStudy, ...prev]);
            setView('feed');
            setSelectedStudy(fallbackStudy);
        } finally {
            setIsAnalyzing(false);
        }
    };
    
    const handlePublishRealTimeStudy = async (title: string, intelligence: IntelligencePackage) => {
        const today = new Date();
        const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

        const newStudy: StudyItem = {
            id: `rt_${Date.now()}`,
            title: title || 'Real-Time Research Session',
            date: formattedDate,
            source: 'Report',
            status: 'Approved',
            tags: ['Real-Time', 'Analyst-Generated'],
            intelligence: intelligence
        };
        
        // Save and update ID
        const savedId = await StudyService.saveStudy(newStudy);
        if (savedId) {
            newStudy.id = savedId;
        }

        const linkedEntities = newStudy.intelligence.entities.filter(newEntity =>
            studies.some(existingStudy =>
                existingStudy.intelligence.entities.some(existingEntity =>
                    isEntityMatch(newEntity.name, existingEntity.name)
                )
            )
        );
        
        if (linkedEntities.length > 0) {
            setNetworkAlert({ newStudy, linkedEntities });
        }

        setStudies(prev => [newStudy, ...prev]);
        setView('feed');
    };

    const handleSelectStudy = (study: StudyItem) => {
        setSelectedStudy(study);
        setView('analysis');
    };

    const handleDeleteStudy = async (study: StudyItem) => {
        setStudies((prev) => prev.filter((item) => item.id !== study.id));
        if (selectedStudy?.id === study.id) {
            setSelectedStudy(null);
            setView('feed');
        }
        if (networkAlert?.newStudy.id === study.id) {
            setNetworkAlert(null);
        }

        const deleted = await StudyService.deleteStudy(study.id);
        if (!deleted) {
            console.warn(`Failed to fully delete study ${study.id}; local state may already be updated.`);
        }
    };

    const resetToFeed = () => {
        setSelectedStudy(null);
        setView('feed');
    };

    const handleLogout = () => {
        if (typeof window !== 'undefined' && window.localStorage.getItem(LOCAL_ADMIN_SESSION_KEY) === '1') {
            window.localStorage.removeItem(LOCAL_ADMIN_SESSION_KEY);
            window.dispatchEvent(new Event('tevel-local-auth-changed'));
            return;
        }
        auth.signOut();
    };

    // --- RENDER LOGIC ---

    if (authLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-screen w-screen bg-[#09090b] text-[#05DF9C] gap-4">
                <Loader2 size={48} className="animate-spin" />
                <div className="text-sm font-mono tracking-widest animate-pulse">AUTHENTICATING...</div>
            </div>
        );
    }

    if (!user) {
        return <LoginPage />;
    }

    const renderView = () => {
        if (isLoadingApp) return (
            <div className="flex flex-col items-center justify-center h-full w-full bg-[#09090b] text-[#05DF9C] gap-4">
                <Loader2 size={48} className="animate-spin" />
                <div className="text-xl font-bold tracking-widest animate-pulse">CONNECTING TO TEVEL CLOUD...</div>
                <div className="text-xs text-slate-500 font-mono">Synchronizing Intelligence Database</div>
            </div>
        );

        if (isAnalyzing) return <IngestionPanel onAnalyze={handleAnalyze} isAnalyzing={true} onCancel={() => { setIsAnalyzing(false); resetToFeed(); }} />;
        
        switch(view) {
            case 'ingest': return <IngestionPanel onAnalyze={handleAnalyze} isAnalyzing={false} onCancel={resetToFeed} />;
            case 'realtime': return <RealTimeDashboard studies={studies} onPublish={handlePublishRealTimeStudy} />;
            case 'settings': return <SettingsPage user={user} onLogout={handleLogout} onBack={() => handleSetView('feed')} />;
            case 'analysis':
                if (selectedStudy) {
                    return <AnalysisDashboard 
                              data={selectedStudy.intelligence} 
                              allStudies={studies}
                              onReset={resetToFeed} 
                              onSave={() => alert('Saved')}
                              onSelectStudy={handleSelectStudy} 
                              study={selectedStudy}
                           />;
                }
                return <FeedDashboard studies={studies} onSelectStudy={handleSelectStudy} onNewAnalysis={() => setView('ingest')} onDeleteStudy={handleDeleteStudy} />;
            case 'operations': return <OperationsDashboard studies={studies} />;
            case 'management': return <ManagementDashboard studies={studies} onNavigate={(v) => handleSetView(v as ViewState)} />;
            case 'identity': return <IdentityResolutionApp studies={studies} />;
            case 'feed':
            default: return <FeedDashboard studies={studies} onSelectStudy={handleSelectStudy} onNewAnalysis={() => setView('ingest')} onDeleteStudy={handleDeleteStudy} />;
        }
    };

    const navItems = [
      { id: 'feed', icon: LayoutGrid, label: 'Mission Feed', hint: 'Case queue and priority radar' },
      { id: 'operations', icon: Cpu, label: 'Ops Center', hint: 'Operational monitoring and response' },
      { id: 'management', icon: BarChart2, label: 'Command Deck', hint: 'Portfolio, risks and trends' },
      { id: 'ingest', icon: PlusCircle, label: 'Intake Studio', hint: 'Bring new intelligence in' },
      { id: 'realtime', icon: ScanEye, label: 'Live Research', hint: 'Interactive exploration workspace' },
      { id: 'identity', icon: Users, label: 'Identity Resolver', hint: 'Entity resolution and matching' }
    ];

    const bottomNavItems = [
      { id: 'settings', icon: Settings, label: 'Settings', action: () => handleSetView('settings') },
      { id: 'logout', icon: LogOut, label: 'Log Out', action: handleLogout }
    ];

    const totalEntities = studies.reduce((sum, current) => sum + (current.intelligence.entities?.length || 0), 0);
    const highPriorityStudies = studies.filter((current) => (current.intelligence.reliability || 0) >= 0.8).length;
    const viewMeta: Record<ViewState, { eyebrow: string; title: string; subtitle: string }> = {
        feed: {
            eyebrow: 'Daily workflow',
            title: 'Intelligence Mission Feed',
            subtitle: 'Triage incoming cases, surface cross-links, and move quickly from signal to assessment.',
        },
        analysis: {
            eyebrow: 'Case workspace',
            title: selectedStudy?.title || 'Deep Analysis',
            subtitle: 'Entity graph, timeline, evidence, and synthesis workbench for the active investigation.',
        },
        ingest: {
            eyebrow: 'Acquisition',
            title: 'Intake Studio',
            subtitle: 'Bring raw material in with cleaner context, metadata, and review flow before analysis.',
        },
        operations: {
            eyebrow: 'Operational posture',
            title: 'Operations Center',
            subtitle: 'Track active pressure points, runtime signals, and response-focused situational awareness.',
        },
        management: {
            eyebrow: 'Leadership view',
            title: 'Command Deck',
            subtitle: 'Portfolio-level oversight for trends, risk, and direction across the intelligence network.',
        },
        realtime: {
            eyebrow: 'Interactive research',
            title: 'Live Research Studio',
            subtitle: 'Run guided inquiry sessions over local intelligence with a faster loop from question to hypothesis.',
        },
        settings: {
            eyebrow: 'Preferences',
            title: 'Platform Settings',
            subtitle: 'Control workflow defaults, OPSEC posture, and the way the system looks and behaves.',
        },
        identity: {
            eyebrow: 'Identity intelligence',
            title: 'Identity Resolution Engine',
            subtitle: 'Detect, normalize, and match person identities across disconnected multilingual datasets.',
        },
    };
    const activeMeta = viewMeta[view];

    return (
        <div className="h-screen w-screen tevel-app-bg flex overflow-hidden">
            
            {networkAlert && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center animate-fadeIn">
                    <div className="tevel-glass-strong w-[560px] rounded-[28px] overflow-hidden">
                        <div className="p-6 border-b border-slate-800 bg-amber-950/20 text-center">
                            <Network size={32} className="text-amber-400 mx-auto mb-4 animate-pulse" />
                            <h2 className="text-xl font-bold text-white">ACTIVE SYNAPSE DETECTED</h2>
                            <p className="text-xs text-amber-300/80 font-mono mt-1">New intelligence has cross-referenced existing cases.</p>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-slate-400 mb-4">The document <strong className="text-white">"{networkAlert.newStudy.title}"</strong> contains links to active investigations via:</p>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                                {networkAlert.linkedEntities.map(e => (
                                    <div key={e.id} className="bg-slate-800/50 p-2 rounded text-xs text-slate-300 font-mono border border-slate-700">{e.name}</div>
                                ))}
                            </div>
                        </div>
                        <div className="p-4 bg-black/30 flex justify-end gap-3">
                            <button onClick={() => setNetworkAlert(null)} className="text-xs font-bold text-slate-400 hover:text-white px-4 py-2">Dismiss</button>
                            <button onClick={() => { handleSelectStudy(networkAlert.newStudy); setNetworkAlert(null); }} className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-xs font-bold">JUMP TO ANALYSIS</button>
                        </div>
                    </div>
                </div>
            )}
            
            <nav 
                onMouseEnter={() => setIsNavExpanded(true)}
                onMouseLeave={() => setIsNavExpanded(false)}
                className={`m-4 mr-0 rounded-[28px] tevel-glass-strong flex flex-col justify-between py-5 shrink-0 z-30 transition-all duration-300 ease-in-out ${isNavExpanded ? 'w-72' : 'w-20'}`}
            >
                <div className="flex flex-col gap-1 px-3">
                    <div className={`flex items-center min-h-[64px] mb-2 ${isNavExpanded ? 'px-4 justify-start' : 'justify-center'}`}>
                        <div className="shrink-0">
                           <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                               <defs><linearGradient id="tevel-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#05DF9C" /><stop offset="100%" stopColor="#04a777" /></linearGradient></defs>
                               <rect x="10.5" y="2" width="3" height="20" rx="1.5" fill="url(#tevel-gradient)" />
                               <rect x="10.5" y="2" width="3" height="20" rx="1.5" transform="rotate(45 12 12)" fill="url(#tevel-gradient)" />
                               <rect x="10.5" y="2" width="3" height="20" rx="1.5" transform="rotate(90 12 12)" fill="url(#tevel-gradient)" />
                               <rect x="10.5" y="2" width="3" height="20" rx="1.5" transform="rotate(135 12 12)" fill="url(#tevel-gradient)" />
                           </svg>
                        </div>
                        <div className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isNavExpanded ? 'max-w-[200px] opacity-100 ml-3' : 'max-w-0 opacity-0 ml-0'}`}>
                            <div className="text-white font-black text-2xl tracking-tight tevel-title">TEVEL</div>
                            <div className="tevel-kicker text-[10px] text-slate-500 mt-0.5">Local Context Engine</div>
                        </div>
                    </div>
                    <div className={`mx-2 rounded-2xl border border-slate-800/80 bg-[radial-gradient(circle_at_top_left,rgba(83,242,194,0.12),transparent_40%),linear-gradient(180deg,rgba(17,27,39,0.95),rgba(9,15,24,0.92))] transition-all duration-300 ${isNavExpanded ? 'opacity-100 max-h-48 p-4 mb-3' : 'opacity-0 max-h-0 overflow-hidden p-0 mb-0 border-transparent'}`}>
                        <div className="tevel-kicker text-[10px] mb-2">Mission posture</div>
                        <div className="text-white font-semibold leading-tight">Professional local-first intelligence workspace</div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
                                <div className="text-slate-500 text-[10px] uppercase">Cases</div>
                                <div className="text-white text-lg font-bold">{studies.length}</div>
                            </div>
                            <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
                                <div className="text-slate-500 text-[10px] uppercase">Entities</div>
                                <div className="text-white text-lg font-bold">{totalEntities}</div>
                            </div>
                        </div>
                    </div>
                    {navItems.map(item => (
                        <div key={item.id} className="relative group">
                            <button onClick={() => handleSetView(item.id as ViewState)} className={`flex items-center min-h-[52px] rounded-2xl transition-colors duration-200 text-sm font-bold w-full relative overflow-hidden ${isNavExpanded ? 'px-4 justify-start' : 'justify-center'} ${view === item.id ? 'bg-white/[0.06] border border-white/[0.08]' : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200 border border-transparent'}`}>
                                <div className={`absolute left-0 top-3 bottom-3 w-1 bg-[#05DF9C] rounded-r-full shadow-[0_0_16px_#05DF9C] transition-all duration-300 ${view === item.id ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0'}`}></div>
                                <item.icon size={20} className={`shrink-0 transition-colors ${view === item.id ? 'text-[#05DF9C]' : 'text-slate-500 group-hover:text-slate-200'}`}/>
                                <div className={`flex flex-col text-left whitespace-nowrap overflow-hidden transition-all duration-300 ${isNavExpanded ? 'max-w-[200px] opacity-100 ml-3' : 'max-w-0 opacity-0 ml-0'}`}>
                                    <div className={`${view === item.id ? 'text-white' : ''}`}>{item.label}</div>
                                    <div className="text-[10px] font-medium text-slate-500 mt-0.5">{item.hint}</div>
                                </div>
                            </button>
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-1 px-3">
                    <div className={`mx-2 rounded-2xl border border-slate-800/80 bg-black/20 transition-all duration-300 ${isNavExpanded ? 'opacity-100 max-h-40 p-3 mb-2' : 'opacity-0 max-h-0 overflow-hidden p-0 mb-0 border-transparent'}`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-white text-sm font-semibold">{user.email?.split('@')[0] || 'Analyst'}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{user.email}</div>
                            </div>
                            <Activity size={16} className="text-[#05DF9C]" />
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
                            <span className="tevel-dot"></span>
                            {highPriorityStudies} high-confidence cases active
                        </div>
                    </div>
                    {bottomNavItems.map(item => (
                        <div key={item.id} className="relative group">
                            <button 
                                onClick={item.action}
                                className={`flex items-center min-h-[48px] rounded-2xl transition-colors duration-200 text-sm font-bold w-full text-slate-500 hover:bg-white/[0.04] hover:text-slate-200 overflow-hidden ${isNavExpanded ? 'px-4 justify-start' : 'justify-center'} ${view === item.id ? 'bg-white/[0.05] text-white border border-white/[0.08]' : ''}`}
                            >
                                <item.icon size={20} className={`shrink-0 group-hover:text-slate-200 ${view === item.id ? 'text-[#05DF9C]' : ''}`}/>
                                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isNavExpanded ? 'max-w-[200px] opacity-100 ml-3' : 'max-w-0 opacity-0 ml-0'}`}>{item.label}</span>
                            </button>
                        </div>
                    ))}
                </div>
            </nav>

            <main className="flex-1 overflow-hidden p-4 pl-5">
                <div className="h-full rounded-[32px] tevel-glass overflow-hidden flex flex-col">
                    <div className="shrink-0 border-b border-slate-800/60 px-8 py-5 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                            <div className="max-w-3xl">
                                <div className="tevel-kicker mb-2">{activeMeta.eyebrow}</div>
                                <h1 className="text-3xl xl:text-4xl font-bold text-white tevel-title leading-none">{activeMeta.title}</h1>
                                <p className="mt-3 text-sm xl:text-[15px] text-slate-400 max-w-2xl">{activeMeta.subtitle}</p>
                            </div>
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 xl:min-w-[560px]">
                                <div className="tevel-stat p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-mono">Cases</div>
                                    <div className="mt-2 text-2xl font-bold text-white">{studies.length}</div>
                                </div>
                                <div className="tevel-stat p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-mono">Entities</div>
                                    <div className="mt-2 text-2xl font-bold text-white">{totalEntities}</div>
                                </div>
                                <div className="tevel-stat p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-mono">High Confidence</div>
                                    <div className="mt-2 text-2xl font-bold text-white">{highPriorityStudies}</div>
                                </div>
                                <div className="tevel-stat p-3">
                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-mono">Mode</div>
                                    <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
                                        <span className="tevel-dot"></span>
                                        Local AI
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 tevel-page-wrap">
                        {renderView()}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
