
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import SourceView from './SourceView';
import GraphView from './GraphView';
import { Entity, GraphData, RawMedia, IntelligencePackage, StudyItem } from '../types';
import { isEntityMatch } from '../services/geminiService';
import { 
    ScanEye, 
    Network, 
    Activity, 
    Terminal, 
    Clock, 
    Database, 
    Hash, 
    Users, 
    MapPin, 
    Box, 
    Play, 
    Square, 
    Plane,
    FileCode,
    Satellite,
    UploadCloud,
    X,
    Send,
    AlertTriangle,
    Maximize,
    Minimize,
    StickyNote,
    CheckCircle2,
    XCircle,
    SidebarClose,
    SidebarOpen,
    Trash2,
    Layers,
    AlertOctagon,
    HelpCircle
} from 'lucide-react';

interface RealTimeDashboardProps {
    studies?: StudyItem[];
    onPublish?: (title: string, intelligence: IntelligencePackage) => void;
}

// Mock High Value Targets Database for Alerts
const WATCHLIST = ['Abu Ali', 'Project Zephyr', 'Unit 190', '192.168.1.105', 'MV Chem Pluto', 'Fajr-5'];

// --- UI HELPER: INFO TOOLTIP (PORTAL VERSION) ---
const InfoTooltip = ({ text, side = 'top' }: { text: string, side?: 'top' | 'bottom' | 'left' | 'right' }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const gap = 8;
        let top = 0;
        let left = 0;

        switch (side) {
            case 'top':
                top = rect.top - gap;
                left = rect.left + rect.width / 2;
                break;
            case 'bottom':
                top = rect.bottom + gap;
                left = rect.left + rect.width / 2;
                break;
            case 'left':
                top = rect.top + rect.height / 2;
                left = rect.left - gap;
                break;
            case 'right':
                top = rect.top + rect.height / 2;
                left = rect.right + gap;
                break;
        }
        setCoords({ top, left });
    }
  };

  return (
    <>
      <div 
        ref={triggerRef}
        className="inline-flex items-center ml-1.5 cursor-help text-slate-500 hover:text-[#05DF9C] transition-colors"
        onMouseEnter={() => { updatePosition(); setVisible(true); }}
        onMouseLeave={() => setVisible(false)}
      >
        <HelpCircle size={12} />
      </div>
      {visible && createPortal(
        <div 
            className="fixed z-[9999] w-48 p-2.5 bg-[#181818] border border-slate-700 rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] pointer-events-none animate-fadeIn"
            style={{ 
                top: coords.top, 
                left: coords.left,
                transform: side === 'top' ? 'translate(-50%, -100%)' : 
                           side === 'bottom' ? 'translate(-50%, 0)' :
                           side === 'left' ? 'translate(-100%, -50%)' : 
                           'translate(0, -50%)'
            }}
        >
            <div className="relative z-10">
                <p className="text-[10px] leading-relaxed text-slate-300 font-sans normal-case tracking-normal text-center shadow-sm">{text}</p>
            </div>
            {/* Arrow */}
            <div className={`
                absolute w-2 h-2 bg-[#181818] transform rotate-45
                ${side === 'top' ? '-bottom-1 left-1/2 -translate-x-1/2 border-b border-r border-slate-700' : 
                  side === 'bottom' ? '-top-1 left-1/2 -translate-x-1/2 border-t border-l border-slate-700' : 
                  side === 'left' ? '-right-1 top-1/2 -translate-y-1/2 border-t border-r border-slate-700' : 
                  '-left-1 top-1/2 -translate-y-1/2 border-b border-l border-slate-700'}
            `}></div>
        </div>,
        document.body
      )}
    </>
  );
};

const generateLiveGraph = (entities: Entity[], studies: StudyItem[] = []): GraphData => {
    const nodes = entities.map(e => ({
        id: e.name,
        group: e.type === 'PERSON' ? 1 : e.type === 'ORGANIZATION' ? 2 : e.type === 'LOCATION' ? 3 : e.type === 'ASSET' ? 4 : 7,
        type: e.type
    }));

    const edges: any[] = [];
    const nodeIds = new Set(nodes.map(n => n.id));

    // Linear narrative flow for current session
    if (nodes.length > 1) {
        for (let i = 0; i < nodes.length - 1; i++) {
             edges.push({
                 source: nodes[i].id,
                 target: nodes[i+1].id,
                 value: 1
             });
        }
    }

    // CROSS-REFERENCING with Historical Studies
    if (studies.length > 0) {
        entities.forEach(entity => {
            studies.forEach(study => {
                const match = study.intelligence.entities.find(studyEntity => isEntityMatch(studyEntity.name, entity.name));
                
                if (match) {
                    const studyNodeId = `CASE: ${study.title}`;
                    if (!nodeIds.has(studyNodeId)) {
                        nodes.push({
                            id: studyNodeId,
                            group: 8,
                            type: 'MISC' 
                        });
                        nodeIds.add(studyNodeId);
                    }

                    edges.push({
                        source: entity.name,
                        target: studyNodeId,
                        value: 5
                    });
                }
            });
        });
    }

    return { nodes, edges };
};

const RealTimeDashboard: React.FC<RealTimeDashboardProps> = ({ studies = [], onPublish }) => {
    // --- STATE ---
    const [entities, setEntities] = useState<{entity: Entity, status: 'unconfirmed' | 'confirmed'}[]>([]);
    const [media, setMedia] = useState<RawMedia[]>([]);
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [logs, setLogs] = useState<{time: string, msg: string, type: 'info'|'success'|'warning'|'alert'}[]>([]);
    
    // Session State
    const [isSessionActive, setIsSessionActive] = useState(true);
    const [sessionTime, setSessionTime] = useState(0);
    const [showIntro, setShowIntro] = useState(true);
    const [sessionTitle, setSessionTitle] = useState('Real-Time Operation #001');
    const [classification, setClassification] = useState('SECRET');
    
    // Tools State
    const [scratchpad, setScratchpad] = useState('');
    const [activeAlert, setActiveAlert] = useState<string | null>(null);
    const [focusMode, setFocusMode] = useState(false);
    const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
    
    // Derived Data
    const confirmedEntities = useMemo(() => entities.filter(e => e.status === 'confirmed').map(e => e.entity), [entities]);
    const unconfirmedEntities = useMemo(() => entities.filter(e => e.status === 'unconfirmed'), [entities]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const scratchpadRef = useRef<HTMLTextAreaElement>(null);

    // Initial Log
    useEffect(() => {
        if (logs.length === 0) {
            addLog("Initializing Real-Time Intelligence Session...", 'info');
            addLog("Secure Channel Established [TLS-1.3]", 'success');
            addLog("Watchlist Database Sync Complete", 'info');
        }
    }, []);

    // Timer
    useEffect(() => {
        let interval: any;
        if (isSessionActive) {
            interval = setInterval(() => {
                setSessionTime(prev => prev + 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isSessionActive]);

    // Calculate all global entities for linking
    const allGlobalEntities = useMemo(() => {
        return studies.flatMap(s => s.intelligence.entities);
    }, [studies]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const addLog = (msg: string, type: 'info'|'success'|'warning'|'alert' = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
        setLogs(prev => [{time, msg, type}, ...prev.slice(0, 50)]);
    };

    const handleAddEntity = (name: string, type: string) => {
        const newEntity: Entity = { id: name, name, type, confidence: 0.8 }; 
        const isWatchlist = WATCHLIST.some(w => name.toLowerCase().includes(w.toLowerCase()));
        
        setEntities(prev => {
            if (prev.some(e => e.entity.name === name)) return prev;
            return [...prev, { entity: newEntity, status: 'unconfirmed' }];
        });

        if (isWatchlist) {
            setActiveAlert(`HVT MATCH CONFIRMED: ${name}`);
            addLog(`WATCHLIST HIT: ${name}`, 'alert');
        } else {
            addLog(`OBJECT DETECTED: ${name} [${type}]`, 'info');
        }
    };

    const confirmEntity = (name: string) => {
        setEntities(prev => prev.map(e => e.entity.name === name ? { ...e, status: 'confirmed' } : e));
        addLog(`ENTITY CONFIRMED: ${name}`, 'success');
        
        // Update Graph only on confirm
        const updatedConfirmed = [...confirmedEntities, entities.find(e => e.entity.name === name)!.entity];
        setGraphData(generateLiveGraph(updatedConfirmed, studies));
    };

    const rejectEntity = (name: string) => {
        setEntities(prev => prev.filter(e => e.entity.name !== name));
        addLog(`ENTITY REJECTED: ${name}`, 'warning');
    };

    const handleAddMedia = (newMedia: RawMedia) => {
        setMedia(prev => [...prev, newMedia]);
        addLog(`MEDIA STREAM ADDED: ${newMedia.title}`, 'info');
        setShowIntro(false); // CRITICAL FIX: Close overlay on add
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const newMedia: RawMedia = {
                id: `upload_${Date.now()}`,
                type: file.type.includes('video') ? 'video' : file.type.includes('image') ? 'image' : file.type.includes('audio') ? 'audio' : 'log',
                title: file.name,
                url: URL.createObjectURL(file),
                date: new Date().toLocaleTimeString(),
                metadata: { 'Source': 'Manual Upload', 'Size': `${(file.size/1024).toFixed(1)} KB` },
                annotations: []
            };
            handleAddMedia(newMedia);
        }
    };

    const handlePublish = () => {
        if (!onPublish) return;
        const pkg: IntelligencePackage = {
            clean_text: `Real-time session log.\nTitle: ${sessionTitle}\nNotes:\n${scratchpad}`,
            word_count: scratchpad.split(' ').length,
            entities: confirmedEntities,
            relations: [],
            insights: [{ type: 'summary', importance: 1, text: 'Real-time analyst session data.' }],
            timeline: [],
            context_cards: {},
            graph: graphData,
            media: media,
            reliability: 1.0
        };
        onPublish(sessionTitle, pkg);
    };

    const handleResetSession = () => {
        if(confirm("Are you sure you want to clear the current session?")) {
            setEntities([]);
            setMedia([]);
            setGraphData({ nodes: [], edges: [] });
            setLogs([]);
            setSessionTime(0);
            setShowIntro(true);
            setScratchpad('');
        }
    };

    // Quick Scenario Injection
    const loadQuickScenario = (type: 'DRONE' | 'CYBER' | 'SAT') => {
        let newMedia: RawMedia;
        let newEntities: Entity[];

        if (type === 'DRONE') {
            setSessionTitle('UAV Surveillance: Sector 4');
            newMedia = {
                id: `sim_drone_${Date.now()}`,
                type: 'image',
                title: 'UAV Feed: Sector 4',
                url: 'https://images.unsplash.com/photo-1473968512647-3e447244af8f?q=80&w=2070&auto=format&fit=crop', 
                date: new Date().toLocaleTimeString(),
                metadata: { 'Source': 'MQ-9 Reaper', 'Altitude': '15,000ft', 'Coords': '34.55, 41.22' },
                annotations: []
            };
            newEntities = [
                { id: 'SUV_Toyota', name: 'Toyota Land Cruiser', type: 'ASSET', confidence: 0.95 },
                { id: 'Abu Ali', name: 'Abu Ali', type: 'PERSON', confidence: 0.99 }, 
                { id: 'Route_60', name: 'Route 60', type: 'LOCATION', confidence: 0.99 }
            ];
        } else if (type === 'CYBER') {
             setSessionTitle('Cyber Incident Response: SRV-01');
             newMedia = {
                id: `sim_log_${Date.now()}`,
                type: 'log',
                title: 'Server Access Logs',
                content: `[2023-10-27 14:22:01] AUTH_FAIL ip=192.168.1.105 user=admin\n[2023-10-27 14:22:03] AUTH_FAIL ip=192.168.1.105 user=root\n[2023-10-27 14:22:05] SUDO_EXEC cmd="/usr/bin/nmap -sS 10.0.0.1"\n[2023-10-27 14:22:10] DATA_EXFIL target=/var/www/html/confidential.db size=45MB\n[2023-10-27 14:22:15] CONNECTION_CLOSE origin=Tehran_VPN_Node`,
                date: new Date().toLocaleTimeString(),
                metadata: { 'Source': 'Syslog', 'Server': 'SRV-01' },
                annotations: []
            };
            newEntities = [
                { id: 'IP_Attacker', name: '192.168.1.105', type: 'ASSET', confidence: 1.0 }, 
                { id: 'DB_Target', name: 'confidential.db', type: 'ASSET', confidence: 0.9 },
                { id: 'VPN_Node', name: 'Tehran VPN', type: 'LOCATION', confidence: 0.85 }
            ];
        } else {
             setSessionTitle('Satellite Recon: Port Facility');
             newMedia = {
                id: `sim_sat_${Date.now()}`,
                type: 'image',
                title: 'SAT-IMG: Port Facility',
                url: 'https://images.unsplash.com/photo-1577017040065-65052831307b?q=80&w=2400&auto=format&fit=crop',
                date: new Date().toLocaleTimeString(),
                metadata: { 'Source': 'Sentinel-2', 'Resolution': '0.5m' },
                annotations: []
            };
            newEntities = [
                { id: 'Container_Ship', name: 'MV Star', type: 'ASSET', confidence: 0.92 },
                { id: 'Cargo_Crane', name: 'Crane #4', type: 'ASSET', confidence: 0.88 },
                { id: 'Dock_Zone', name: 'Loading Dock A', type: 'LOCATION', confidence: 0.95 }
            ];
        }

        handleAddMedia(newMedia);
        newEntities.forEach((e, i) => {
            setTimeout(() => handleAddEntity(e.name, e.type), i * 800 + 500);
        });
        addLog(`SIMULATION STARTED: ${type} SCENARIO`, 'warning');
    };

    const renderEntityIcon = (type: string) => {
        switch (type) {
            case 'PERSON': return <Users size={12} className="text-rose-400" />;
            case 'ORGANIZATION': return <Activity size={12} className="text-sky-400" />;
            case 'LOCATION': return <MapPin size={12} className="text-emerald-400" />;
            case 'ASSET': return <Box size={12} className="text-amber-400" />;
            default: return <Hash size={12} className="text-slate-400" />;
        }
    };

    return (
        <div className="h-full flex flex-col bg-[#09090b] overflow-hidden animate-fadeIn font-sans selection:bg-[#05DF9C]/30 relative">
            
            {/* ALERT OVERLAY */}
            {activeAlert && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] animate-bounceIn">
                    <div className="bg-rose-500/10 border border-rose-500 backdrop-blur-md px-6 py-4 rounded-lg shadow-[0_0_30px_rgba(244,63,94,0.4)] flex items-center gap-4">
                        <AlertTriangle className="text-rose-500 animate-pulse" size={24} />
                        <div>
                            <div className="text-rose-500 font-black text-lg tracking-widest uppercase">CRITICAL ALERT</div>
                            <div className="text-rose-200 text-xs font-mono">{activeAlert}</div>
                        </div>
                        <button onClick={() => setActiveAlert(null)} className="ml-4 bg-rose-500 text-white p-1 rounded hover:bg-rose-400"><X size={16}/></button>
                    </div>
                </div>
            )}

            {/* --- TOP HEADER: ANALYST COCKPIT --- */}
            <div className="h-16 border-b border-slate-800 bg-[#121212] flex items-center justify-between px-6 shrink-0 shadow-xl z-20 relative overflow-hidden">
                <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(5,223,156,0.02)_50%,transparent_100%)] animate-[shimmer_3s_infinite] pointer-events-none"></div>

                <div className="flex items-center gap-6 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl border shadow-sm transition-all ${isSessionActive ? 'bg-rose-500/10 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.1)]' : 'bg-slate-800 border-slate-700'}`}>
                            <ScanEye className={isSessionActive ? 'text-rose-500 animate-pulse' : 'text-slate-500'} size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <input 
                                    value={sessionTitle}
                                    onChange={(e) => setSessionTitle(e.target.value)}
                                    className="text-sm font-bold text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-[#05DF9C] focus:outline-none transition-colors w-64"
                                />
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[9px] font-bold text-slate-400 cursor-pointer hover:text-white" onClick={() => setClassification(c => c === 'SECRET' ? 'TOP SECRET' : 'SECRET')}>{classification}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Op-Center Live Feed</span>
                                <InfoTooltip text="Live feed status from operations center. Red indicates active recording and monitoring." side="bottom" />
                                <span className={`w-1.5 h-1.5 rounded-full ${isSessionActive ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'}`}></span>
                                <span className={`text-[10px] font-mono font-bold ${isSessionActive ? 'text-rose-500' : 'text-slate-500'}`}>{isSessionActive ? 'RECORDING' : 'PAUSED'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="h-8 w-px bg-slate-800 mx-2"></div>

                    {/* Timer */}
                    <div className="flex items-center gap-4 bg-black/40 px-4 py-1.5 rounded-lg border border-slate-800">
                        <div className="flex flex-col">
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Session Time</span>
                            <div className="font-mono text-xl font-bold text-white leading-none tracking-widest">
                                {formatTime(sessionTime)}
                            </div>
                        </div>
                        <button 
                            onClick={() => setIsSessionActive(!isSessionActive)}
                            className={`p-2 rounded-full transition-all ${isSessionActive ? 'text-rose-500 hover:bg-rose-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`}
                        >
                            {isSessionActive ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                        </button>
                    </div>
                </div>
                
                <div className="flex items-center gap-4 relative z-10">
                     <button 
                        onClick={() => setFocusMode(!focusMode)} 
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${focusMode ? 'bg-[#05DF9C]/20 border-[#05DF9C] text-[#05DF9C]' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                     >
                         {focusMode ? <Minimize size={14} /> : <Maximize size={14} />} {focusMode ? 'EXIT FOCUS' : 'FOCUS'}
                     </button>
                     
                     <button onClick={handleResetSession} className="text-slate-500 hover:text-rose-500 transition-colors p-2" title="Clear Session"><Trash2 size={16} /></button>

                     <button 
                        onClick={handlePublish}
                        disabled={confirmedEntities.length === 0 && media.length === 0}
                        className="bg-[#05DF9C] hover:bg-white text-black px-4 py-2 rounded-lg font-bold uppercase text-xs tracking-wider flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(5,223,156,0.2)] disabled:opacity-50 hover:shadow-[0_0_25px_rgba(5,223,156,0.4)]"
                     >
                         <Send size={14} /> PUBLISH
                     </button>
                     
                     <button 
                        onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} 
                        className="border-l border-slate-700 pl-4 text-slate-500 hover:text-white"
                        title="Toggle Intelligence Sidebar"
                     >
                         {isRightSidebarOpen ? <SidebarClose size={20} /> : <SidebarOpen size={20} />}
                     </button>
                </div>
            </div>

            <div className="flex-1 flex min-h-0 relative">
                
                {/* --- LEFT: MAIN WORKSPACE (SOURCE VIEW) --- */}
                <div className="flex-1 border-r border-slate-800 relative flex flex-col min-w-0 bg-[#09090b]">
                    {/* Source View Flex Container */}
                    <div className="flex-1 relative flex flex-col min-h-0">
                        <SourceView 
                            text="" 
                            media={media}
                            entities={confirmedEntities} // Only pass confirmed entities for highlighting
                            knownEntities={allGlobalEntities}
                            onEntityClick={() => {}}
                            onAddEntity={handleAddEntity}
                            onAddMedia={handleAddMedia}
                            isFocusMode={focusMode}
                        />
                    </div>

                    {/* Timeline Bar (NOW RELATIVE, NOT ABSOLUTE OVERLAY) */}
                    <div className="shrink-0 h-10 bg-[#121212] border-t border-slate-800 flex items-center px-4 gap-4 z-40">
                         <Clock size={12} className="text-slate-500" />
                         <div className="flex-1 h-1 bg-slate-800 rounded-full relative">
                             <div className="absolute top-0 left-0 h-full bg-[#05DF9C]" style={{width: '100%'}}></div>
                             {logs.filter(l=>l.type!=='info').map((l, i) => (
                                 <div 
                                    key={i} 
                                    className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-black ${l.type === 'alert' ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                                    style={{ left: `${Math.random() * 90}%` }}
                                    title={l.msg}
                                 ></div>
                             ))}
                         </div>
                         <div className="text-[9px] font-mono text-slate-500">SESSION TL</div>
                         <InfoTooltip text="Timeline of session events, including media uploads, alerts, and entity confirmations." side="top" />
                    </div>
                    
                    {/* Empty State Overlay */}
                    {media.length === 0 && showIntro && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-50 bg-[#09090b]/90 backdrop-blur-md">
                            <div className="bg-[#121212] p-8 rounded-3xl border border-slate-700/50 text-center shadow-2xl max-w-xl w-full relative overflow-hidden group pointer-events-auto">
                                <div className="absolute inset-0 bg-gradient-to-b from-[#05DF9C]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                                <button onClick={() => setShowIntro(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors z-20"><X size={20} /></button>
                                <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-700 group-hover:border-[#05DF9C]/50 group-hover:scale-110 transition-all duration-300 relative z-10"><ScanEye size={32} className="text-slate-400 group-hover:text-[#05DF9C] transition-colors" /></div>
                                <h3 className="text-white font-bold text-xl mb-2 tracking-tight relative z-10">Awaiting Signal Acquisition</h3>
                                <p className="text-slate-400 text-xs leading-relaxed mb-8 px-4 relative z-10">Upload visual intelligence or inject simulated data stream to initiate analysis loop.</p>
                                <div className="mb-8 relative z-10">
                                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} multiple accept="image/*,video/*,.log,.json,.txt" />
                                    <button onClick={() => fileInputRef.current?.click()} className="bg-[#05DF9C] hover:bg-white text-black px-8 py-4 rounded-xl font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(5,223,156,0.3)] transition-all flex items-center gap-3 mx-auto hover:scale-105 active:scale-95"><UploadCloud size={20} strokeWidth={2.5} /> Upload Intelligence Data</button>
                                </div>
                                <div className="relative z-10"><div className="flex items-center gap-4 mb-4"><div className="h-px bg-slate-800 flex-1"></div><span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Or Load Simulation</span><div className="h-px bg-slate-800 flex-1"></div></div><div className="grid grid-cols-3 gap-3"><button onClick={() => loadQuickScenario('DRONE')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-[#05DF9C]/50 rounded-lg p-3 flex flex-col items-center gap-2 transition-all group/btn"><Plane size={16} className="text-rose-400 group-hover/btn:scale-110 transition-transform" /><span className="text-[10px] font-bold text-slate-300 uppercase">UAV Feed</span></button><button onClick={() => loadQuickScenario('CYBER')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-[#05DF9C]/50 rounded-lg p-3 flex flex-col items-center gap-2 transition-all group/btn"><FileCode size={16} className="text-amber-400 group-hover/btn:scale-110 transition-transform" /><span className="text-[10px] font-bold text-slate-300 uppercase">Sys Logs</span></button><button onClick={() => loadQuickScenario('SAT')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-[#05DF9C]/50 rounded-lg p-3 flex flex-col items-center gap-2 transition-all group/btn"><Satellite size={16} className="text-sky-400 group-hover/btn:scale-110 transition-transform" /><span className="text-[10px] font-bold text-slate-300 uppercase">Sat Imag</span></button></div></div>
                            </div>
                        </div>
                    )}
                </div>

                {/* --- RIGHT: INTELLIGENCE SIDEBAR --- */}
                <div className={`
                    w-[400px] bg-[#121212] flex flex-col border-l border-slate-800 shadow-2xl z-10 transition-all duration-300
                    ${isRightSidebarOpen && !focusMode ? 'translate-x-0' : 'translate-x-full w-0 opacity-0 absolute right-0 top-0 bottom-0'}
                `}>
                    
                    {/* 1. SCRATCHPAD */}
                    <div className="h-40 border-b border-slate-800 p-4 bg-[#141414] flex flex-col shrink-0">
                        <div className="flex justify-between items-center mb-2">
                             <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><StickyNote size={12} /> Live Analyst Log</h4>
                             <div className="flex items-center gap-1">
                                <InfoTooltip text="Rapidly log observations. Use CTRL+ENTER to append timestamp automatically. Logs are included in the final report." side="left" />
                                <span className="text-[9px] text-slate-600 font-mono ml-2">CTRL+ENTER to SAVE</span>
                             </div>
                        </div>
                        <textarea 
                            ref={scratchpadRef}
                            value={scratchpad}
                            onChange={(e) => setScratchpad(e.target.value)}
                            className="flex-1 bg-[#09090b] border border-slate-800 rounded-lg p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-[#05DF9C] resize-none leading-relaxed"
                            placeholder="Type observations here..."
                        />
                    </div>

                    {/* 2. ENTITY STREAM */}
                    <div className="flex-1 flex flex-col min-h-0 border-b border-slate-800 bg-[#121212]">
                         <div className="px-4 py-3 border-b border-slate-800 bg-[#141414] flex justify-between items-center shadow-sm shrink-0">
                             <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                 <Database size={12} className="text-sky-400" /> Object Queue
                                 <InfoTooltip text="Entities detected via annotations or automated scan. Confirm to add to knowledge graph, Reject to discard." side="bottom" />
                             </h4>
                             <div className="flex gap-2">
                                 <span className="text-[9px] text-slate-500 font-bold">{unconfirmedEntities.length} PENDING</span>
                                 <span className="text-[9px] text-[#05DF9C] font-bold">{confirmedEntities.length} VERIFIED</span>
                             </div>
                         </div>
                         
                         <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-800">
                             {entities.length === 0 ? (
                                 <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
                                     <Activity size={24} className="opacity-20" />
                                     <span className="text-xs italic">Waiting for targets...</span>
                                 </div>
                             ) : (
                                 [...unconfirmedEntities, ...entities.filter(e => e.status === 'confirmed')].map((item, i) => {
                                     const { entity, status } = item;
                                     const isPending = status === 'unconfirmed';
                                     
                                     return (
                                     <div key={i} className={`flex flex-col bg-[#181818] rounded-lg border transition-all animate-slideIn ${isPending ? 'border-amber-500/30 bg-amber-950/10' : 'border-slate-800 hover:border-slate-600'}`}>
                                         <div className="flex items-center gap-3 p-3">
                                            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center shrink-0 border border-slate-700 relative">
                                                {renderEntityIcon(entity.type)}
                                                {isPending && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse border border-black"></div>}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex justify-between items-start">
                                                    <div className="text-xs font-bold text-slate-200 truncate">{entity.name}</div>
                                                    <span className="text-[9px] font-mono text-emerald-500">{(entity.confidence! * 100).toFixed(0)}%</span>
                                                </div>
                                                <div className="text-[9px] text-slate-500 uppercase font-mono tracking-wider mt-0.5">{entity.type}</div>
                                            </div>
                                         </div>
                                         
                                         {/* Action Buttons for Pending */}
                                         {isPending && (
                                             <div className="flex border-t border-amber-500/20 divide-x divide-amber-500/20">
                                                 <button onClick={() => confirmEntity(entity.name)} className="flex-1 py-1.5 hover:bg-emerald-500/10 text-[9px] font-bold text-emerald-500 flex items-center justify-center gap-1 transition-colors">
                                                     <CheckCircle2 size={10} /> CONFIRM
                                                 </button>
                                                 <button onClick={() => rejectEntity(entity.name)} className="flex-1 py-1.5 hover:bg-rose-500/10 text-[9px] font-bold text-rose-500 flex items-center justify-center gap-1 transition-colors">
                                                     <XCircle size={10} /> REJECT
                                                 </button>
                                             </div>
                                         )}

                                         {/* Geo-Widget for Locations */}
                                         {entity.type === 'LOCATION' && !isPending && (
                                             <div className="h-20 bg-black/50 border-t border-slate-800 relative overflow-hidden group">
                                                 <img src={`https://mt1.google.com/vt/lyrs=y&x=13&y=13&z=4`} className="w-full h-full object-cover opacity-50 group-hover:opacity-80 transition-opacity" alt="map" />
                                                 <div className="absolute bottom-1 left-1 bg-black/80 text-[8px] text-[#05DF9C] px-1 rounded font-mono border border-[#05DF9C]/30">SAT_LINK_ESTABLISHED</div>
                                             </div>
                                         )}
                                     </div>
                                 )})
                             )}
                         </div>
                    </div>

                    {/* 3. MINI GRAPH & LOGS */}
                    <div className="h-1/3 flex flex-col bg-[#09090b] border-t border-slate-800 min-h-[200px]">
                         <div className="flex border-b border-slate-800 bg-[#09090b] shrink-0">
                             <div className="flex-1 px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 border-r border-slate-800">
                                 <Terminal size={12} /> System Telemetry
                                 <InfoTooltip text="System events and automated alerts stream." side="top" />
                             </div>
                             <div className="flex-1 px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                 <Network size={12} /> Topology Preview
                                 <InfoTooltip text="Real-time visualization of entity relationships being built." side="top" />
                             </div>
                         </div>
                         
                         <div className="flex-1 flex overflow-hidden">
                             {/* Logs */}
                             <div className="w-1/2 overflow-y-auto p-3 space-y-1.5 font-mono text-[10px] scrollbar-thin scrollbar-thumb-slate-800 border-r border-slate-800">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-2 items-start opacity-80 hover:opacity-100 transition-opacity">
                                        <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                                        <span className={`break-all ${
                                            log.type === 'success' ? 'text-emerald-400' : 
                                            log.type === 'warning' ? 'text-amber-400' : 
                                            log.type === 'alert' ? 'text-rose-500 font-bold animate-pulse' :
                                            'text-slate-400'
                                        }`}>
                                            {log.msg}
                                        </span>
                                    </div>
                                ))}
                                <div className="animate-pulse text-emerald-500 font-bold mt-1">_</div>
                             </div>

                             {/* Mini Graph */}
                             <div className="w-1/2 bg-[#0f0f12] relative overflow-hidden flex flex-col">
                                 <GraphView data={graphData} onNodeClick={() => {}} searchTerm="" />
                                 <div className="absolute bottom-2 right-2 text-[8px] text-slate-600 font-mono bg-black/50 px-1 rounded pointer-events-none">LIVE_TOPOLOGY</div>
                             </div>
                         </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default RealTimeDashboard;
