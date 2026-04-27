
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Entity, RawMedia, Annotation } from '../types';
import { 
    FileText, 
    Image as ImageIcon, 
    Video, 
    Terminal, 
    File, 
    Download, 
    Maximize2, 
    Crosshair, 
    Pin, 
    Check, 
    Upload, 
    Plus, 
    Tag, 
    Target,
    MousePointer2,
    Save,
    Link,
    Search,
    ZoomIn,
    ZoomOut,
    Sun,
    Moon,
    Eye,
    EyeOff,
    Activity,
    RotateCcw,
    X,
    PanelLeftClose,
    PanelLeftOpen,
    ChevronRight,
    HelpCircle,
    Sparkles,
    Loader2,
    Scan,
    GripVertical,
    List,
    MoreHorizontal,
    Trash2,
    Monitor,
    User,
    Building2,
    MapPin,
    Box,
    Zap
} from 'lucide-react';

interface SourceViewProps {
  text: string;
  media?: RawMedia[];
  entities: Entity[];
  knownEntities?: Entity[];
  onEntityClick: (name: string) => void;
  onPinItem?: (type: 'file' | 'snippet', title: string, content: string, sourceId?: string) => void;
  onAddEntity?: (name: string, type: string) => void;
  onAddMedia?: (media: RawMedia) => void;
  isFocusMode?: boolean;
}

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

const SourceView: React.FC<SourceViewProps> = ({ 
    text, 
    media = [], 
    entities, 
    knownEntities = [], 
    onEntityClick, 
    onPinItem, 
    onAddEntity, 
    onAddMedia,
    isFocusMode
}) => {
  const allFiles: RawMedia[] = useMemo(() => [
    {
      id: 'main_report',
      type: 'text',
      title: 'RAW SOURCE TEXT',
      content: text,
      date: 'N/A',
      metadata: { 'Source': 'Ingestion', 'Format': 'Plain Text' }
    },
    ...media
  ], [text, media]);

  const [selectedFileId, setSelectedFileId] = useState<string>(allFiles[0].id);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [isTacticalMode, setIsTacticalMode] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  
  // Handle Focus Mode (Controlled or Uncontrolled)
  const [localFocusMode, setLocalFocusMode] = useState(false);
  const focusMode = isFocusMode !== undefined ? isFocusMode : localFocusMode;
  
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const [pendingAnnotation, setPendingAnnotation] = useState<{x: number, y: number} | null>(null);
  const [highlightedAnnotationId, setHighlightedAnnotationId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'NONE' | 'THERMAL' | 'NIGHT' | 'EDGE' | 'INVERT'>('NONE');

  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('ASSET');
  const [newDescription, setNewDescription] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkSuggestions, setShowLinkSuggestions] = useState(false);

  const imageContainerRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    const stopResizing = () => setIsResizing(false);
    const resize = (mouseEvent: MouseEvent) => {
        if (isResizing) {
            const newWidth = Math.max(200, Math.min(600, mouseEvent.clientX));
            setSidebarWidth(newWidth);
        }
    };
    if (isResizing) {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
    }
    return () => {
        window.removeEventListener('mousemove', resize);
        window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing]);

  const selectedFile = allFiles.find(f => f.id === selectedFileId) || allFiles[0];

  const handleAutoScan = () => {
    setIsScanning(true);
    setTimeout(() => {
        const mockAnnotations: Annotation[] = [
            {
                id: `auto_${Date.now()}_1`,
                x: 45, y: 35,
                label: 'Potential Asset',
                description: 'Auto-detected via Intelligence Vision (92% Confidence)',
                tags: ['CV-Detection']
            }
        ];
        setAnnotations(prev => ({ ...prev, [selectedFile.id]: [...(prev[selectedFile.id] || []), ...mockAnnotations] }));
        setIsScanning(false);
    }, 2000);
  };

  const handleImageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('.annotation-form')) return;
      if ((e.target as HTMLElement).closest('.imint-toolbar')) return;
      if ((e.target as HTMLElement).closest('.tactical-toolbar')) return;

      if (isTacticalMode && imageContainerRef.current) {
          const rect = imageContainerRef.current.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          setPendingAnnotation({ x, y });
          setNewLabel('');
          setNewDescription('');
      }
  };

  const saveAnnotation = () => {
      if (!newLabel || !pendingAnnotation) return;
      const annotation: Annotation = {
          id: Date.now().toString(),
          x: pendingAnnotation.x,
          y: pendingAnnotation.y,
          label: newLabel,
          description: newDescription,
          tags: [newType]
      };
      setAnnotations(prev => ({ ...prev, [selectedFile.id]: [...(prev[selectedFile.id] || []), annotation] }));
      if (onAddEntity) onAddEntity(newLabel, newType);
      setPendingAnnotation(null);
  };

  const renderAnnotationForm = () => {
    const style: React.CSSProperties = { position: 'absolute', zIndex: 1000 };
    // Smart positioning to avoid edge clipping
    if (pendingAnnotation!.x > 70) style.right = `${100 - pendingAnnotation!.x + 2}%`; else style.left = `${pendingAnnotation!.x + 2}%`;
    if (pendingAnnotation!.y > 70) style.bottom = `${100 - pendingAnnotation!.y}%`; else style.top = `${pendingAnnotation!.y}%`;

    const types = [
        { id: 'PERSON', icon: User, label: 'Person', color: 'text-rose-400', border: 'border-rose-500/50', bg: 'bg-rose-500/10' },
        { id: 'ORGANIZATION', icon: Building2, label: 'Org', color: 'text-sky-400', border: 'border-sky-500/50', bg: 'bg-sky-500/10' },
        { id: 'LOCATION', icon: MapPin, label: 'Location', color: 'text-emerald-400', border: 'border-emerald-500/50', bg: 'bg-emerald-500/10' },
        { id: 'ASSET', icon: Box, label: 'Asset', color: 'text-amber-400', border: 'border-amber-500/50', bg: 'bg-amber-500/10' },
        { id: 'EVENT', icon: Zap, label: 'Event', color: 'text-purple-400', border: 'border-purple-500/50', bg: 'bg-purple-500/10' }
    ];

    return (
        <div className="annotation-form absolute z-[100] w-80 animate-in fade-in zoom-in-95 duration-200" style={style}>
            {/* Visual Anchor Line */}
            <div className={`absolute w-8 h-px bg-[#05DF9C]/50 ${pendingAnnotation!.x > 70 ? '-right-8' : '-left-8'} top-4`}></div>

            <div className="bg-[#09090b]/95 backdrop-blur-xl border border-slate-700/50 rounded-lg shadow-[0_8px_30px_rgb(0,0,0,0.5)] overflow-hidden ring-1 ring-white/10">
                {/* Header */}
                <div className="h-9 bg-[#121212] border-b border-slate-800 flex justify-between items-center px-3">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-[#05DF9C] rounded-full animate-pulse shadow-[0_0_5px_#05DF9C]"></div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Target Acquisition</span>
                    </div>
                    <button onClick={() => setPendingAnnotation(null)} className="text-slate-500 hover:text-white transition-colors"><X size={14} /></button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Input */}
                    <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider ml-1">Entity Identifier</label>
                        <div className="relative group">
                            <input 
                                autoFocus 
                                className="w-full bg-black/50 border border-slate-700/50 rounded-md py-2 px-3 pl-8 text-sm text-white focus:border-[#05DF9C] focus:outline-none focus:bg-slate-900/50 transition-all font-mono placeholder-slate-700" 
                                placeholder="e.g. Commander X..."
                                value={newLabel}
                                onChange={e => setNewLabel(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && saveAnnotation()}
                            />
                            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-[#05DF9C] transition-colors">
                                <Tag size={14} />
                            </div>
                        </div>
                    </div>

                    {/* Type Selector Grid */}
                    <div className="space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider ml-1">Classification</label>
                        <div className="grid grid-cols-3 gap-2">
                            {types.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setNewType(t.id)}
                                    className={`
                                        flex flex-col items-center justify-center p-2 rounded-md border transition-all duration-200
                                        ${newType === t.id 
                                            ? `${t.bg} ${t.border} ${t.color} shadow-sm ring-1 ring-inset ring-white/10 scale-105` 
                                            : 'bg-slate-800/30 border-transparent text-slate-500 hover:bg-slate-800 hover:text-slate-300'}
                                    `}
                                >
                                    <t.icon size={16} className="mb-1" />
                                    <span className="text-[9px] font-bold uppercase">{t.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Action */}
                    <button 
                        onClick={saveAnnotation} 
                        disabled={!newLabel}
                        className="w-full bg-[#05DF9C] hover:bg-[#04c48a] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-2.5 rounded-md text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(5,223,156,0.15)] hover:shadow-[0_0_30px_rgba(5,223,156,0.3)] hover:scale-[1.02] active:scale-95"
                    >
                        <Crosshair size={14} /> Confirm Intel
                    </button>
                </div>
                
                {/* Footer Decor */}
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#05DF9C]/50 to-transparent opacity-50"></div>
            </div>
        </div>
    );
  };

  const renderIcon = (type: string) => {
    switch(type) {
      case 'image': return <ImageIcon size={16} className="text-emerald-400" />;
      case 'video': return <Video size={16} className="text-rose-400" />;
      default: return <FileText size={16} className="text-slate-400" />;
    }
  };

  return (
    <div className="h-full flex bg-[#121212] overflow-hidden">
        {/* SIDEBAR */}
        {!focusMode && (
            <div className="flex flex-col shrink-0 border-r border-slate-800 bg-[#121212] relative" style={{ width: isSidebarOpen ? sidebarWidth : 56 }}>
                {isSidebarOpen && <div className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-[#05DF9C] z-50" onMouseDown={startResizing} />}
                
                <div className="p-4 border-b border-slate-800 flex justify-between items-center overflow-hidden">
                    {isSidebarOpen && <span className="text-xs font-bold text-slate-500 uppercase whitespace-nowrap">Evidence Bench</span>}
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-slate-500 hover:text-white">
                        {isSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {allFiles.map(file => (
                        <button key={file.id} onClick={() => setSelectedFileId(file.id)} className={`w-full flex items-center p-3 rounded-lg transition-all border ${selectedFileId === file.id ? 'bg-[#05DF9C]/10 border-[#05DF9C]/50 text-white' : 'border-transparent text-slate-400 hover:bg-slate-800'}`}>
                            {renderIcon(file.type)}
                            {isSidebarOpen && <span className="ml-3 text-xs font-bold truncate">{file.title}</span>}
                        </button>
                    ))}
                </div>

                {isSidebarOpen && annotations[selectedFileId]?.length > 0 && (
                    <div className="h-1/3 border-t border-slate-800 bg-[#0f0f12] overflow-hidden flex flex-col">
                        <div className="p-3 border-b border-slate-800 flex justify-between items-center">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Detections</span>
                            <span className="text-[10px] text-[#05DF9C] font-mono">{annotations[selectedFileId].length}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {annotations[selectedFileId].map(ann => (
                                <div key={ann.id} onMouseEnter={() => setHighlightedAnnotationId(ann.id)} onMouseLeave={() => setHighlightedAnnotationId(null)} className={`p-2 rounded border cursor-pointer ${highlightedAnnotationId === ann.id ? 'bg-[#05DF9C]/10 border-[#05DF9C]' : 'bg-slate-900/50 border-slate-800 hover:border-slate-600'}`}>
                                    <div className="text-xs font-bold text-slate-300">{ann.label}</div>
                                    <div className="text-[9px] text-slate-500 uppercase mt-1">{ann.tags?.[0]}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* MAIN VIEW */}
        <div className="flex-1 flex flex-col min-w-0 relative">
            {/* TOOLBAR */}
            <div className="tactical-toolbar absolute top-4 right-4 z-[100] flex gap-2">
                {isFocusMode === undefined && (
                    <button onClick={() => setLocalFocusMode(!localFocusMode)} className={`p-2 rounded-lg border backdrop-blur-md transition-all ${focusMode ? 'bg-[#05DF9C] text-black' : 'bg-black/60 text-white border-slate-700'}`}>
                        {focusMode ? <Monitor size={16} /> : <Maximize2 size={16} />}
                    </button>
                )}
                <button onClick={() => setShowLabels(!showLabels)} className={`p-2 rounded-lg border backdrop-blur-md transition-all ${showLabels ? 'bg-slate-800 text-white' : 'bg-black/60 text-slate-500'}`}>
                    {showLabels ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={handleAutoScan} disabled={isScanning} className="bg-black/60 border border-slate-700 p-2 rounded-lg text-slate-300 hover:text-[#05DF9C]">
                    {isScanning ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                </button>
                <button onClick={() => setIsTacticalMode(!isTacticalMode)} className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-bold text-xs uppercase tracking-wider transition-all shadow-lg ${isTacticalMode ? 'bg-[#05DF9C] text-black border-[#05DF9C] shadow-[#05DF9C]/20' : 'bg-black/60 text-slate-300 border-slate-700 hover:bg-slate-800'}`}>
                    <Crosshair size={14} /> {isTacticalMode ? 'Active Mode' : 'Target Mode'}
                </button>
            </div>

            <div className="flex-1 bg-black overflow-hidden relative cursor-crosshair" onMouseDown={handleImageMouseDown} ref={imageContainerRef}>
                {isScanning && (
                    <div className="absolute inset-0 z-50 pointer-events-none">
                        <div className="absolute w-full h-1 bg-[#05DF9C]/50 shadow-[0_0_30px_#05DF9C] animate-[scan_2s_linear_infinite]" />
                    </div>
                )}
                
                <style>{`@keyframes scan { 0% { top: 0; } 100% { top: 100%; } }`}</style>

                {selectedFile.type === 'image' && selectedFile.url && (
                    <div className="h-full flex items-center justify-center relative">
                        <img src={selectedFile.url} className="max-h-full max-w-full object-contain select-none pointer-events-none" draggable={false} />
                        
                        {(annotations[selectedFile.id] || []).map(ann => (
                            <div 
                                key={ann.id} 
                                className="absolute w-0 h-0 flex items-center justify-center group"
                                style={{ left: `${ann.x}%`, top: `${ann.y}%` }}
                            >
                                {/* The Marker */}
                                <div className={`relative transition-all duration-300 ${highlightedAnnotationId === ann.id ? 'scale-125 z-50' : 'scale-100 z-10'}`}>
                                    {/* Animated Rings for Highlight */}
                                    {highlightedAnnotationId === ann.id && (
                                        <div className="absolute inset-0 -m-4 border border-[#05DF9C]/30 rounded-full animate-ping pointer-events-none"></div>
                                    )}
                                    
                                    {/* Tactical Crosshair/Bracket SVG */}
                                    <div className={`w-8 h-8 -ml-4 -mt-4 flex items-center justify-center cursor-pointer transition-colors ${highlightedAnnotationId === ann.id ? 'text-[#05DF9C]' : 'text-slate-400 hover:text-white'}`}
                                         onMouseEnter={() => setHighlightedAnnotationId(ann.id)} 
                                         onMouseLeave={() => setHighlightedAnnotationId(null)}
                                    >
                                         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                             <path d="M4 9V5a1 1 0 0 1 1-1h4" />
                                             <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
                                             <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
                                             <path d="M4 15v4a1 1 0 0 0 1 1h4" />
                                             <circle cx="12" cy="12" r="2" fill="currentColor" fillOpacity="0.5" />
                                         </svg>
                                    </div>
                                </div>

                                {/* The Label */}
                                {(showLabels || highlightedAnnotationId === ann.id) && (
                                    <div className={`
                                        absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center
                                        transition-all duration-200 origin-top
                                        ${highlightedAnnotationId === ann.id ? 'opacity-100 scale-100 z-50' : showLabels ? 'opacity-80 scale-90 z-20' : 'opacity-0 scale-75 pointer-events-none'}
                                    `}>
                                        {/* Connecting Line */}
                                        <div className="h-3 w-px bg-gradient-to-b from-[#05DF9C] to-transparent"></div>
                                        
                                        {/* Tag Box */}
                                        <div className="bg-[#09090b]/90 backdrop-blur border border-slate-700 px-3 py-1.5 rounded text-[10px] shadow-xl flex items-center gap-2 whitespace-nowrap group-hover:border-[#05DF9C]/50 transition-colors">
                                            <span className={`w-1.5 h-1.5 rounded-full ${ann.tags?.includes('PERSON') ? 'bg-rose-500' : ann.tags?.includes('LOCATION') ? 'bg-emerald-500' : 'bg-[#05DF9C]'}`}></span>
                                            <span className="font-bold text-slate-200 font-mono uppercase">{ann.label}</span>
                                            {ann.tags?.[0] && <span className="text-[8px] text-slate-500 border-l border-slate-700 pl-2 ml-1 tracking-wider">{ann.tags[0]}</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {pendingAnnotation && renderAnnotationForm()}
                    </div>
                )}
                
                {selectedFile.type === 'text' && (
                    <div className="p-8 h-full overflow-y-auto text-slate-300 font-mono text-sm leading-relaxed whitespace-pre-wrap">
                        {selectedFile.content}
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default SourceView;
