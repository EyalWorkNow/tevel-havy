
import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  Loader2, 
  X, 
  Terminal, 
  Activity, 
  AlignLeft, 
  UploadCloud, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Scan, 
  ShieldAlert, 
  Calendar, 
  Zap, 
  Lock, 
  FileCode, 
  Radio, 
  Cpu, 
  Globe, 
  Eye, 
  Signal, 
  MapPin, 
  Trash2, 
  AlertTriangle, 
  File as FileIcon, 
  Image as ImageIcon, 
  MousePointer2, 
  Users, 
  Target, 
  FileCheck, 
  Video, 
  Fingerprint, 
  Mic, 
  ScanFace,
  UserSquare,
  User,
  Link,
  Plus,
  Youtube,
  ImageIcon as ImgIcon,
  Hash
} from 'lucide-react';
import { RawMedia } from '../types';
import { parseUploadedFileWithSidecar } from '../services/sidecarClient';
import { composeIngestionAnalysisBody, IngestionArtifactContext } from '../services/ingestionContent';
import { RESEARCH_PROFILE_OPTIONS } from '../services/researchProfiles';
import type { ResearchProfileSelection } from '../services/researchProfiles';

interface IngestionPanelProps {
  onAnalyze: (text: string, title: string, media: RawMedia[]) => void | Promise<void>;
  isAnalyzing: boolean;
  onCancel: () => void;
  researchProfileId: ResearchProfileSelection;
  onResearchProfileChange: (value: ResearchProfileSelection) => void;
}

type Step = 1 | 2 | 3;
type Classification = 'TOP SECRET' | 'SECRET' | 'CONFIDENTIAL' | 'UNCLASSIFIED';
type SourceType = 'SIGINT' | 'HUMINT' | 'OSINT' | 'GEOINT' | 'CYBER' | 'MASINT';

const SUGGESTED_TAGS = ['Hamas', 'Hezbollah', 'IRGC', 'Finance', 'Smuggling', 'Cyber', 'Infra', 'Drones', 'Tunnel', 'Crypto'];
const TEXT_LIKE_EXTENSIONS = ['txt', 'md', 'log', 'json', 'csv', 'html', 'htm', 'xml'];
const PREVIEW_TEXT_LIMIT = 8_000;
const PREVIEW_SIGNAL_LIMIT = 10_000;
const BROWSER_TEXT_DECODER_CANDIDATES = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1255', 'windows-1256', 'windows-1252', 'iso-8859-8'];

const estimateTokenFootprint = (text: string): number => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.round(normalized.length / 4));
};

const buildPreviewAttachmentText = (header: string, extractedContent: string): string => {
  if (extractedContent.length <= PREVIEW_TEXT_LIMIT) {
    return `${header}\n[EXTRACTED_TEXT_START]\n${extractedContent}\n[EXTRACTED_TEXT_END]`;
  }

  const visiblePreview = extractedContent.slice(0, PREVIEW_TEXT_LIMIT).trimEnd();
  return `${header}\n[EXTRACTED_TEXT_PREVIEW]\n${visiblePreview}\n… [${extractedContent.length - PREVIEW_TEXT_LIMIT} more characters attached for analysis but hidden from the live editor to keep the page responsive]\n[EXTRACTED_TEXT_PREVIEW_END]`;
};

const getResponsiveContentMetrics = (text: string): { previewSlice: string; estimatedTokens: number } => ({
  previewSlice: text.slice(0, PREVIEW_SIGNAL_LIMIT),
  estimatedTokens: estimateTokenFootprint(text),
});

const getFileExtension = (name: string): string => {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
};

const scoreDecodedBrowserText = (text: string): number => {
  if (!text) return -1000;
  const length = Math.max(text.length, 1);
  const printable = Array.from(text).filter((char) => /[\n\r\t]/.test(char) || (char >= ' ' && char !== '\u007f')).length;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const mojibakeMarkers = (text.match(/[ÃÂÐØ×�]/g) || []).length;
  const letterCount = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return (printable / length) * 40 + (letterCount / length) * 25 - replacementCount * 12 - mojibakeMarkers * 2;
};

const decodeTextLikeFile = async (file: File): Promise<string | null> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) return null;

  const candidates = bytes[0] === 0xff && bytes[1] === 0xfe
    ? ['utf-16le', ...BROWSER_TEXT_DECODER_CANDIDATES]
    : bytes[0] === 0xfe && bytes[1] === 0xff
      ? ['utf-16be', ...BROWSER_TEXT_DECODER_CANDIDATES]
      : BROWSER_TEXT_DECODER_CANDIDATES;

  let bestText: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const encoding of candidates) {
    try {
      const decoded = new TextDecoder(encoding).decode(buffer);
      const score = scoreDecodedBrowserText(decoded);
      if (score > bestScore) {
        bestText = decoded;
        bestScore = score;
      }
    } catch {
      // ignore unsupported encodings in the current browser runtime
    }
  }

  return bestText?.trim() || null;
};

const HEAVY_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'doc', 'xls', 'ppt']);
const isHeavyFile = (file: File): boolean => {
  const ext = getFileExtension(file.name);
  return (
    file.type === 'application/pdf' ||
    file.type.includes('wordprocessingml') ||
    file.type.includes('presentationml') ||
    file.type.includes('spreadsheetml') ||
    HEAVY_EXTENSIONS.has(ext)
  );
};

const readFileContent = async (file: File): Promise<{ text: string | null; parserName?: string; parserView?: string }> => {
  // Only call the sidecar for heavy binary formats (PDF, DOCX, etc.)
  // Plain text files are decoded instantly by the browser — no round-trip needed
  if (isHeavyFile(file)) {
    const sidecarParsed = await parseUploadedFileWithSidecar(file, { title: file.name });
    if (sidecarParsed?.raw_content?.trim()) {
      return {
        text: sidecarParsed.raw_content.trim(),
        parserName: sidecarParsed.source_parser?.parser_name,
        parserView: sidecarParsed.source_parser?.parser_view,
      };
    }
    return { text: null };
  }

  const extension = getFileExtension(file.name);
  const isTextLike =
    file.type.startsWith('text/') ||
    file.type.includes('json') ||
    file.type.includes('xml') ||
    TEXT_LIKE_EXTENSIONS.includes(extension);

  if (!isTextLike) {
    return { text: null };
  }

  try {
    const content = await decodeTextLikeFile(file);
    return { text: content, parserName: 'browser_decoder', parserView: content ? 'raw_text' : undefined };
  } catch (error) {
    console.warn('Failed to read uploaded file content', error);
    return { text: null };
  }
};

const extractPreviewSignals = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const candidates = new Set<string>();
  const isoDates = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const slashDates = normalized.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [];
  const urls = normalized.match(/\b(?:https?:\/\/|www\.)\S+\b/g) || [];
  const emails = normalized.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  const titleCase = normalized.match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g) || [];
  const hebrewAnchors = normalized.match(/(?:חברת|קבוצת|נמל|מחסן|מבצע|מכולה|שרת|טלפון)\s+[א-תA-Za-z0-9"'׳״-]+(?:\s+[א-תA-Za-z0-9"'׳״-]+){0,2}/g) || [];

  [...isoDates, ...slashDates, ...urls, ...emails, ...titleCase, ...hebrewAnchors]
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 10)
    .forEach((item) => candidates.add(item));

  return Array.from(candidates).slice(0, 8);
};

const resetFileInputValue = (input: HTMLInputElement | null) => {
  if (input) {
    input.value = '';
  }
};

const IngestionPanel: React.FC<IngestionPanelProps> = ({
  onAnalyze,
  isAnalyzing,
  onCancel,
  researchProfileId,
  onResearchProfileChange,
}) => {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [isDragActive, setIsDragActive] = useState(false);
  
  // --- FORM STATE ---
  const [title, setTitle] = useState('');
  const [timestamp, setTimestamp] = useState(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  const [rawContent, setRawContent] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [location, setLocation] = useState('');
  const [classification, setClassification] = useState<Classification>('SECRET');
  const [sourceType, setSourceType] = useState<SourceType>('OSINT');
  
  // Admiralty Code (Reliability / Credibility)
  const [reliability, setReliability] = useState<'A'|'B'|'C'|'D'|'E'|'F'>('B');
  const [credibility, setCredibility] = useState<'1'|'2'|'3'|'4'|'5'|'6'>('2');

  // --- TAGGING STATE ---
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // --- BIOMETRIC STATE ---
  const [targetProfile, setTargetProfile] = useState(''); // Kelastron / Composite Sketch ID
  const [runFaceScan, setRunFaceScan] = useState(true);
  const [runVoiceScan, setRunVoiceScan] = useState(true);

  // STORE ACTUAL MEDIA OBJECTS
  const [uploadedMedia, setUploadedMedia] = useState<RawMedia[]>([]);
  const [artifactContexts, setArtifactContexts] = useState<IngestionArtifactContext[]>([]);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  
  // Hidden Input Refs for Buttons
  const textInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // --- DRAG & DROP HANDLERS ---
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handleFileSelect = async (file: File) => {
      // 1. Auto-fill title
      if (!title) setTitle(file.name.split('.')[0]);

      // 2. Determine Type
      let type: 'image' | 'video' | 'log' | 'text' | 'audio' = 'text';
      if (file.type.includes('image')) type = 'image';
      else if (file.type.includes('video')) type = 'video';
      else if (file.type.includes('audio')) type = 'audio';
      else if (file.name.endsWith('.log') || file.name.endsWith('.json')) type = 'log';

      // 3. Create Media Object (Mocking URL for POC)
      const extracted = await readFileContent(file);
      const extractedContent = extracted.text;
      const previewContent = extractedContent ? extractedContent.slice(0, 2000) : "Preview of uploaded file content unavailable.";
      const artifactId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const attachmentHeader = `[SYSTEM ATTACHMENT]\nFILENAME: ${file.name}\nTYPE: ${type.toUpperCase()}\nMETADATA: ${file.size} bytes`;
      const previewText = extractedContent
        ? buildPreviewAttachmentText(attachmentHeader, extractedContent)
        : `${attachmentHeader}\nNOTE: Full text extraction is not yet available for this file format in the browser intake path.`;
      const analysisText = extractedContent
        ? `${attachmentHeader}\n[EXTRACTED_TEXT_START]\n${extractedContent}\n[EXTRACTED_TEXT_END]`
        : `${attachmentHeader}\nNOTE: Full text extraction is not yet available for this file format in the browser intake path.`;

      const newMedia: RawMedia = {
          id: artifactId,
          type: type,
          title: file.name,
          date: new Date().toLocaleTimeString(),
          url: type === 'image' || type === 'video' || type === 'audio' ? URL.createObjectURL(file) : undefined, // For local preview
          content: type === 'text' || type === 'log' ? previewContent : undefined,
          metadata: {
              size: (file.size / 1024).toFixed(1) + ' KB',
              format: file.type || 'unknown',
              extractedText: extractedContent ? 'yes' : 'no',
              parser: extracted.parserName || 'browser',
              parserView: extracted.parserView || (extractedContent ? 'raw_text' : 'none'),
          }
      };

      setUploadedMedia(prev => [...prev, newMedia]);

      setArtifactContexts(prev => [
          ...prev,
          {
              id: artifactId,
              previewText,
              analysisText,
          }
      ]);
  };

  const handleFilesSelected = async (files: FileList | File[]) => {
      await Promise.all(Array.from(files).map((file) => handleFileSelect(file)));
  };

  const handleAddLink = () => {
      if (!linkInput.trim()) return;
      const artifactId = `link_${Date.now()}`;
      const analysisText = `[EXTERNAL LINK]\nURL: ${linkInput}`;

      const newMedia: RawMedia = {
          id: artifactId,
          type: 'text', // Treat as text source
          title: linkInput,
          date: new Date().toLocaleTimeString(),
          url: linkInput,
          metadata: { source: 'WEB_LINK', format: 'URL' }
      };

      setUploadedMedia(prev => [...prev, newMedia]);
      setArtifactContexts(prev => [
          ...prev,
          {
              id: artifactId,
              previewText: analysisText,
              analysisText,
          }
      ]);
      setLinkInput('');
  };

  const clearInput = () => {
      setRawContent('');
      setUploadedMedia([]);
      setArtifactContexts([]);
      setTitle('');
      resetFileInputValue(textInputRef.current);
      resetFileInputValue(imageInputRef.current);
      resetFileInputValue(videoInputRef.current);
      resetFileInputValue(audioInputRef.current);
  };

  // --- TAGGING HANDLERS ---
  const handleAddTag = () => {
      if (tagInput.trim() && !tags.includes(tagInput.trim())) {
          setTags(prev => [...prev, tagInput.trim()]);
          setTagInput('');
      }
  };

  const handleRemoveTag = (tagToRemove: string) => {
      setTags(prev => prev.filter(t => t !== tagToRemove));
  };

  const toggleSuggestedTag = (tag: string) => {
      if (tags.includes(tag)) {
          handleRemoveTag(tag);
      } else {
          setTags(prev => [...prev, tag]);
      }
  };

  // --- QUICK SCENARIOS ---
  const loadScenario = (type: 'RED_SEA' | 'CYBER' | 'HUMINT') => {
      const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      setTimestamp(time);
      setUploadedMedia([]); // Clear previous
      setArtifactContexts([]);
      
      if (type === 'RED_SEA') {
          setTitle(`Maritime Incident #${Math.floor(Math.random()*1000)}`);
          const scenarioText = `INTERCEPTED SIGNAL: 4922-Alpha
SOURCE: Houthi Coastal Battery, Hodeidah
TARGET: MV Chem Pluto (Commercial Tanker)

DETAILS:
Radar signature confirmed activation of anti-ship missile battery at grid 44R.
Simultaneous telemetry link detected from IRGC spy ship 'Behshad' (Stationary in Red Sea).
Drone Swarm (Samad-3) launched from inland launch site towards Eilat as diversion.`;
          setRawContent(scenarioText);
          setClassification('TOP SECRET');
          setSourceType('SIGINT');
          setReliability('A');
          setLocation('Red Sea / Hodeidah');
          setTags(['Houthi', 'Red Sea', 'Maritime', 'IRGC', 'UAV']);
      } 
      else if (type === 'CYBER') {
          setTitle(`BlackShadow Ransomware Analysis`);
          const scenarioText = `INCIDENT REPORT: Ziv Medical Center
VECTOR: RDP Brute Force (IP: 192.168.1.104)
PAYLOAD: MuddyWater variant (IRGC linked)

Attackers deployed ransomware encrypting patient DB.
Ransom Note demands payment to Wallet 0x4a...9f.
Traffic analysis shows C2 (Command & Control) server located in Tehran.`;
          setRawContent(scenarioText);
          setClassification('SECRET');
          setSourceType('CYBER');
          setReliability('B');
          setLocation('Tsfat, Israel');
          setTags(['Cyber', 'Ransomware', 'Hospital', 'IRGC']);
      }
      else {
          setTitle(`Jenin Interrogation: Abu Ali`);
          const scenarioText = `SUBJECT: Abu Ali (Courier)
LOCATION: Jordan Valley Crossing
CONFESSION:

Subject admits to transporting M4 Carbine parts concealed in agricultural fertilizer sacks.
Funding provided by 'The Accountant' in Jenin (linked to Islamic Jihad).
Weapon destination: Jenin Battalion storage facilities.`;
          setRawContent(scenarioText);
          setClassification('CONFIDENTIAL');
          setSourceType('HUMINT');
          setReliability('C');
          setLocation('Jordan Valley');
          setTags(['Smuggling', 'Jenin', 'Weapons', 'PIJ']);
      }
  };

  const steps = [
    { num: 1, label: 'Acquisition', icon: AlignLeft },
    { num: 2, label: 'Context', icon: ShieldAlert },
    { num: 3, label: 'Review', icon: FileCheck }
  ];

  const handleNext = () => { if (currentStep < 3) setCurrentStep(prev => (prev + 1) as Step); };
  const handleBack = () => { if (currentStep > 1) setCurrentStep(prev => (prev - 1) as Step); };
  const handleRawContentChange = (nextContent: string) => { setRawContent(nextContent); };

  const combinedAnalysisBody = composeIngestionAnalysisBody(rawContent, artifactContexts);
  const contentMetrics = getResponsiveContentMetrics(combinedAnalysisBody);

  const handleFinalSubmit = async () => {
      const analysisBody = combinedAnalysisBody;
      // Prepend metadata to the content so the AI considers it
      const enrichedContent = `
[METADATA_START]
TITLE: ${title}
SOURCE_TYPE: ${sourceType}
CLASSIFICATION: ${classification}
RELIABILITY: ${reliability}${credibility} (Admiralty Code)
LOCATION: ${location}
TIMESTAMP: ${timestamp}
ATTACHMENTS: ${uploadedMedia.length} files
TAGS: ${tags.join(', ')}
BIOMETRIC_TARGET: ${targetProfile || 'N/A'}
BIOMETRIC_SCAN_FACE: ${runFaceScan}
BIOMETRIC_SCAN_VOICE: ${runVoiceScan}
[METADATA_END]

${analysisBody}
      `;
      // Pass the text AND the actual media objects
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await Promise.resolve(onAnalyze(enrichedContent, title || `Ingestion ${timestamp}`, uploadedMedia));
  };

  // --- PROCESSING SIMULATION ---
  const [logLines, setLogLines] = useState<string[]>([]);
  useEffect(() => {
    if (isAnalyzing) {
        setLogLines([]);
        const visibleAnalysisText = combinedAnalysisBody;
        const previewSignals = extractPreviewSignals(visibleAnalysisText.slice(0, PREVIEW_SIGNAL_LIMIT));
        const messages = [
            `RESEARCH PROFILE: ${researchProfileId === 'AUTO' ? 'AUTO-DETECT' : researchProfileId}`,
            `SOURCE PROFILE: ${sourceType} // ${classification}`,
            title ? `CASE TITLE: ${title}` : "CASE TITLE: Untitled ingestion",
            location ? `LOCATION ANCHOR: ${location}` : "LOCATION ANCHOR: none supplied",
            tags.length ? `TAGGED LEADS: ${tags.slice(0, 5).join(", ")}` : "TAGGED LEADS: scanning for unnamed leads",
            uploadedMedia.length ? `MEDIA OBJECTS QUEUED: ${uploadedMedia.length}` : "MEDIA OBJECTS QUEUED: text-only ingest",
            `TEXT FOOTPRINT: ~${contentMetrics.estimatedTokens} tokens under review`,
            ...(previewSignals.length ? previewSignals.map((signal) => `SURFACED SIGNAL: ${signal}`) : ["SURFACED SIGNAL: extracting dates, actors, assets, and locations..."]),
            ...(runFaceScan ? ["BIOMETRIC MODE: facial scan requested"] : []),
            ...(runVoiceScan ? ["BIOMETRIC MODE: voice scan requested"] : []),
            "MAPPING domain entities, timeline anchors, and explicit links...",
            "Packaging structured research output for review...",
        ];
        
        let delay = 0;
        messages.forEach((msg, i) => {
            setTimeout(() => {
                setLogLines(prev => [...prev, msg]);
            }, delay);
            delay += i < 6 ? 300 : 420;
        });
    }
  }, [classification, combinedAnalysisBody, contentMetrics.estimatedTokens, isAnalyzing, location, researchProfileId, runFaceScan, runVoiceScan, sourceType, tags, title, uploadedMedia.length]);

  return (
    <div 
        className="flex flex-col h-full tevel-page-wrap relative animate-fadeIn overflow-hidden selection:bg-[#05DF9C]/30 selection:text-white"
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
    >
      
      {/* ANALYZING OVERLAY */}
      {isAnalyzing && (
          <div className="absolute inset-0 z-[100] bg-[#0a121c]/95 flex flex-col items-center justify-center font-mono backdrop-blur-xl">
              <div className="w-[560px] tevel-glass-strong rounded-[28px] p-8 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-[#05DF9C] animate-pulse"></div>
                   
                   <div className="flex items-center justify-center mb-8">
                       <div className="relative">
                            <Cpu size={64} className="text-[#05DF9C] animate-pulse" />
                            <div className="absolute inset-0 border-4 border-[#05DF9C] rounded-full opacity-20 animate-ping"></div>
                       </div>
                   </div>
                   
                   <h2 className="text-center text-white font-bold text-xl mb-6 tracking-widest flex items-center justify-center gap-3">
                       <Activity className="animate-spin text-emerald-500" size={20} />
                       PROCESSING RESEARCH
                   </h2>

                   <div className="space-y-2 font-mono text-xs border border-slate-800 bg-black/50 p-4 rounded h-48 overflow-y-auto scrollbar-none shadow-inner">
                       {logLines.map((line, i) => (
                           <div key={i} className="text-emerald-500 flex items-center gap-2 animate-fadeIn">
                               <span className="text-slate-600">{'>'}</span> {line}
                           </div>
                       ))}
                       <div className="animate-pulse text-[#05DF9C]">_</div>
                   </div>
              </div>
          </div>
      )}

      {/* DRAG OVERLAY */}
      {isDragActive && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm border-4 border-dashed border-[#05DF9C] m-8 rounded-3xl flex flex-col items-center justify-center animate-pulse">
              <UploadCloud size={80} className="text-[#05DF9C] mb-6" />
              <h2 className="text-3xl font-bold text-white tracking-widest">DROP RESEARCH FILE HERE</h2>
              <p className="text-[#05DF9C] font-mono mt-4 text-sm bg-[#05DF9C]/10 px-4 py-2 rounded border border-[#05DF9C]/20">IMAGES • VIDEOS • AUDIO • LOGS • TEXT</p>
          </div>
      )}

      {/* HEADER */}
      <div className="border-b border-slate-800/50 bg-[rgba(9,17,27,0.8)] backdrop-blur flex items-center justify-between px-8 py-6 shrink-0 z-20">
        <div>
           <div className="tevel-kicker mb-2 text-[10px]">Structured acquisition</div>
           <h1 className="text-2xl font-bold text-white flex items-center gap-3 tracking-tight tevel-title">
              <div className="p-2 bg-[#05DF9C]/10 rounded-2xl border border-[#05DF9C]/20">
                  <UploadCloud className="text-[#05DF9C]" size={20} />
              </div>
              Intake Studio
           </h1>
           <p className="text-sm text-slate-400 mt-2 max-w-2xl">קליטה רב-מקורית עם הקשר, מטא-דאטה, סיווג, וסקירת איכות לפני שמעבירים לחילוץ תובנות.</p>
        </div>
        <button 
          onClick={onCancel}
          disabled={isAnalyzing}
          className="text-slate-500 hover:text-white hover:bg-slate-800 transition-all p-2 rounded-full disabled:opacity-0"
        >
          <X size={24} />
        </button>
      </div>

      {/* STEP INDICATOR */}
      <div className="pt-6 pb-2 bg-transparent sticky top-0 z-10 shrink-0">
        <div className="flex items-center justify-center gap-4">
          {steps.map((s, idx) => {
            const isActive = s.num === currentStep;
            const isCompleted = s.num < currentStep;
            return (
              <div key={s.num} className="flex items-center">
                 <div 
                   className={`
                     relative flex items-center justify-center w-10 h-10 rounded-lg border transition-all duration-300
                     ${isActive 
                        ? 'bg-[#05DF9C] border-[#05DF9C] text-black shadow-[0_0_15px_rgba(5,223,156,0.4)] scale-110' 
                        : isCompleted 
                          ? 'bg-[#16181d] border-emerald-500 text-emerald-500' 
                          : 'bg-[#121212] border-slate-800 text-slate-600'}
                   `}
                 >
                    {isCompleted ? <CheckCircle2 size={18} /> : <s.icon size={18} />}
                 </div>
                 <div className={`text-[10px] font-bold uppercase tracking-wider ml-2 ${isActive ? 'text-white' : 'text-slate-600'}`}>{s.label}</div>
                 
                 {/* Connector */}
                 {idx < steps.length - 1 && (
                     <div className={`w-12 h-px mx-4 transition-colors duration-500 ${isCompleted ? 'bg-emerald-500' : 'bg-slate-800'}`}></div>
                 )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Research profile</div>
          <select
            className="bg-black/40 border border-slate-700/60 text-slate-100 text-xs rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            value={researchProfileId}
            onChange={(event) => onResearchProfileChange(event.target.value as ResearchProfileSelection)}
            disabled={isAnalyzing}
          >
            {RESEARCH_PROFILE_OPTIONS.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* MAIN CONTENT WRAPPER */}
      <div className="flex-1 overflow-hidden px-4 pb-4 pt-2">
         <div className="max-w-5xl mx-auto h-full flex flex-col">
            
            {/* CARD CONTAINER */}
            <div className="flex-1 tevel-card relative overflow-hidden flex flex-col transition-all duration-500">
                {/* Top Gradient Line */}
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#05DF9C] to-transparent opacity-50 z-10"></div>
                
                {/* SCROLLABLE CONTENT AREA */}
                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 p-8">
                    
                    {/* --- STEP 1: ACQUISITION --- */}
                    {currentStep === 1 && (
                        <div className="animate-slideIn flex flex-col h-full space-y-6">
                            {/* Header & Quick Actions */}
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Terminal className="text-[#05DF9C]" size={18} /> 
                                        RAW DATA ACQUISITION
                                    </h2>
                                    <p className="text-xs text-slate-500 font-mono mt-1">Select source files, paste links, or input raw text.</p>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest self-center mr-2">Quick Scenarios:</span>
                                    {[
                                        { id: 'RED_SEA', label: 'Red Sea', color: 'text-amber-400 border-amber-500/30 hover:bg-amber-900/20' },
                                        { id: 'CYBER', label: 'Cyber', color: 'text-rose-400 border-rose-500/30 hover:bg-rose-900/20' },
                                        { id: 'HUMINT', label: 'HUMINT', color: 'text-emerald-400 border-emerald-500/30 hover:bg-emerald-900/20' }
                                    ].map(sc => (
                                        <button 
                                            key={sc.id} 
                                            onClick={() => loadScenario(sc.id as any)} 
                                            className={`text-[10px] bg-slate-800/50 border px-3 py-1.5 rounded transition-all ${sc.color}`}
                                        >
                                            {sc.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Input Area */}
                            <div className="flex-1 relative group bg-[#181818] rounded-xl border border-slate-800 overflow-hidden flex flex-col min-h-[450px]">
                                
                                {/* 1. MULTI-SOURCE TOOLBAR */}
                                <div className="p-3 bg-[#121212] border-b border-slate-800 flex gap-4 items-center">
                                    {/* Link Input */}
                                    <div className="flex-1 flex gap-2">
                                        <div className="relative flex-1 group/link">
                                            <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within/link:text-[#05DF9C]" />
                                            <input 
                                                value={linkInput}
                                                onChange={(e) => setLinkInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddLink()}
                                                placeholder="Paste URL (Telegram, News, Social)..."
                                                className="w-full bg-[#181818] border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#05DF9C]"
                                            />
                                        </div>
                                        <button 
                                            onClick={handleAddLink}
                                            disabled={!linkInput}
                                            className="bg-slate-800 hover:bg-[#05DF9C] hover:text-black text-slate-300 p-2 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            <Plus size={16} />
                                        </button>
                                    </div>

                                    <div className="w-px h-6 bg-slate-800"></div>

                                    {/* Media Upload Buttons */}
                                    <div className="flex gap-2">
                                        <input type="file" ref={textInputRef} multiple accept=".txt,.pdf,.md,.doc,.docx,.log,.json,.csv" className="hidden" onChange={(e) => { const files = e.target.files; if (files?.length) { void handleFilesSelected(files); } e.currentTarget.value = ''; }} />
                                        <button onClick={() => textInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                            <FileText size={14} className="text-slate-400" /> Text
                                        </button>

                                        <input type="file" ref={imageInputRef} multiple accept="image/*" className="hidden" onChange={(e) => { const files = e.target.files; if (files?.length) { void handleFilesSelected(files); } e.currentTarget.value = ''; }} />
                                        <button onClick={() => imageInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                            <ImgIcon size={14} className="text-emerald-400" /> Image
                                        </button>

                                        <input type="file" ref={videoInputRef} multiple accept="video/*" className="hidden" onChange={(e) => { const files = e.target.files; if (files?.length) { void handleFilesSelected(files); } e.currentTarget.value = ''; }} />
                                        <button onClick={() => videoInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                            <Video size={14} className="text-rose-400" /> Video
                                        </button>

                                        <input type="file" ref={audioInputRef} multiple accept="audio/*" className="hidden" onChange={(e) => { const files = e.target.files; if (files?.length) { void handleFilesSelected(files); } e.currentTarget.value = ''; }} />
                                        <button onClick={() => audioInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                            <Mic size={14} className="text-sky-400" /> Audio
                                        </button>
                                    </div>
                                </div>

                                {/* 2. CONTENT PREVIEW & TEXT */}
                                {uploadedMedia.length > 0 ? (
                                    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-white font-bold text-sm flex items-center gap-2">
                                                <UploadCloud size={16} className="text-[#05DF9C]" /> 
                                                Attached Artifacts ({uploadedMedia.length})
                                            </h3>
                                            <button onClick={clearInput} className="text-xs text-slate-500 hover:text-rose-500 flex items-center gap-1 transition-colors"><Trash2 size={12} /> Clear All</button>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                            {uploadedMedia.map((media, idx) => (
                                                <div key={idx} className="bg-[#16181d] rounded-lg border border-slate-700 p-3 relative group/item">
                                                    {/* Media Preview Thumbnail */}
                                                    <div className="aspect-video bg-black/50 rounded flex items-center justify-center mb-2 overflow-hidden border border-slate-800 relative">
                                                        {media.type === 'image' && media.url ? (
                                                            <img src={media.url} className="w-full h-full object-cover opacity-80" />
                                                        ) : media.type === 'video' ? (
                                                            <Video className="text-rose-500" />
                                                        ) : media.type === 'audio' ? (
                                                            <Mic className="text-sky-500" />
                                                        ) : media.metadata?.source === 'WEB_LINK' ? (
                                                            <Globe className="text-blue-500" />
                                                        ) : (
                                                            <FileText className="text-slate-500" />
                                                        )}
                                                        
                                                        {/* BIOMETRIC INDICATORS */}
                                                        {['image', 'video'].includes(media.type) && (
                                                            <div className="absolute top-1 left-1 flex flex-col gap-1">
                                                                <div className="bg-black/60 backdrop-blur px-1.5 py-0.5 rounded border border-rose-500/50 text-[8px] font-bold text-rose-400 flex items-center gap-1">
                                                                    <ScanFace size={8} /> FACE ID
                                                                </div>
                                                            </div>
                                                        )}
                                                        {['video', 'audio'].includes(media.type) && (
                                                             <div className="absolute bottom-1 left-1 flex flex-col gap-1">
                                                                <div className="bg-black/60 backdrop-blur px-1.5 py-0.5 rounded border border-sky-500/50 text-[8px] font-bold text-sky-400 flex items-center gap-1">
                                                                    <Mic size={8} /> VOICE ID
                                                                </div>
                                                             </div>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] text-white font-bold truncate">{media.title}</div>
                                                    <div className="text-[9px] text-slate-500 font-mono flex justify-between">
                                                        <span>{media.type.toUpperCase()}</span>
                                                        <span>{media.metadata?.size || 'LINK'}</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {/* Text input continues below */}
                                        </div>

                                        {artifactContexts.length > 0 && (
                                            <div className="mt-4 pt-4 border-t border-slate-800">
                                                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Auto-extracted Context Included In Analysis</div>
                                                <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-black/20 p-3 scrollbar-thin scrollbar-thumb-slate-700">
                                                    {artifactContexts.map((context) => (
                                                        <div key={context.id} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                                                            {context.previewText}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="mt-4 pt-4 border-t border-slate-800">
                                            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Analyst Notes / Additional Context</div>
                                            <textarea 
                                                value={rawContent}
                                                onChange={(e) => handleRawContentChange(e.target.value)}
                                                className="w-full bg-transparent text-xs text-slate-300 font-mono h-24 focus:outline-none resize-none"
                                                placeholder="Add analyst notes, manual transcription, or extra context..."
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col">
                                        <textarea
                                            ref={textAreaRef}
                                            value={rawContent}
                                            onChange={(e) => handleRawContentChange(e.target.value)}
                                            placeholder="// PASTE TEXT REPORT HERE OR USE TOOLBAR ABOVE TO ATTACH MEDIA..."
                                            className="flex-1 w-full bg-transparent border-none p-6 text-slate-300 placeholder-slate-700 focus:outline-none font-mono text-sm resize-none leading-relaxed z-10"
                                            autoFocus
                                        />
                                        <div className="h-8 bg-[#121212] border-t border-slate-800 flex justify-between items-center px-4 shrink-0">
                                            <div className="text-[10px] text-slate-500 font-mono">Ln 1, Col 1</div>
                                            <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                                                {rawContent.length > 0 && <span className="text-[#05DF9C]">LIVE</span>}
                                                {rawContent.length} PREVIEW CHARS
                                            </div>
                                        </div>
                                        {/* Decoration */}
                                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-5">
                                            <UploadCloud size={120} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- STEP 2: CLASSIFICATION --- */}
                    {currentStep === 2 && (
                        <div className="animate-slideIn flex flex-col space-y-8 pb-4">
                             <div className="flex justify-between items-center">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <ShieldAlert className="text-[#05DF9C]" size={18} /> 
                                    CONTEXT & CLASSIFICATION
                                </h2>
                                <div className="text-xs font-mono text-slate-500">{new Date().toISOString().split('T')[0]}</div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                                {/* Left Column: Meta */}
                                <div className="col-span-1 md:col-span-7 space-y-6">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Operation / Event Title</label>
                                        <input 
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            placeholder="e.g. Northern Sector Anomaly"
                                            className="w-full bg-[#181818] border border-slate-700 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-[#05DF9C] font-bold shadow-inner transition-all placeholder-slate-700"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Source Type</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {(['SIGINT', 'HUMINT', 'OSINT', 'GEOINT', 'CYBER', 'MASINT'] as SourceType[]).map(type => {
                                                    const icons = { SIGINT: Signal, HUMINT: Users, OSINT: Globe, GEOINT: MapPin, CYBER: Cpu, MASINT: Activity };
                                                    const Icon = icons[type] || FileText;
                                                    return (
                                                        <button
                                                            key={type}
                                                            onClick={() => setSourceType(type)}
                                                            className={`
                                                                flex flex-col items-center justify-center p-2 rounded border transition-all
                                                                ${sourceType === type ? 'bg-[#05DF9C]/10 border-[#05DF9C] text-[#05DF9C]' : 'bg-[#121212] border-slate-800 text-slate-500 hover:border-slate-600'}
                                                            `}
                                                        >
                                                            <Icon size={14} className="mb-1" />
                                                            <span className="text-[9px] font-bold">{type}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                             <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Location</label>
                                                <div className="relative">
                                                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                                    <input 
                                                        value={location}
                                                        onChange={(e) => setLocation(e.target.value)}
                                                        placeholder="Unknown"
                                                        className="w-full bg-[#181818] border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:border-[#05DF9C] focus:outline-none"
                                                    />
                                                </div>
                                             </div>
                                             <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Timestamp</label>
                                                <div className="relative">
                                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                                    <input 
                                                        value={timestamp}
                                                        onChange={(e) => setTimestamp(e.target.value)}
                                                        className="w-full bg-[#181818] border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:border-[#05DF9C] focus:outline-none"
                                                    />
                                                </div>
                                             </div>
                                        </div>
                                    </div>

                                    {/* TAGGING SYSTEM */}
                                    <div className="bg-[#181818] border border-slate-800 rounded-xl p-4 relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Hash className="text-[#05DF9C]" size={16} />
                                            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Mission Tags / Keywords</h3>
                                        </div>
                                        
                                        {/* Tag Input */}
                                        <div className="relative group mb-3">
                                            <input 
                                                value={tagInput}
                                                onChange={(e) => setTagInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                                                placeholder="Type tag and press Enter..."
                                                className="w-full bg-[#121212] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-[#05DF9C] focus:outline-none placeholder-slate-600 font-mono"
                                            />
                                            <button 
                                                onClick={handleAddTag}
                                                disabled={!tagInput}
                                                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-[#05DF9C] disabled:opacity-30"
                                            >
                                                <Plus size={14} />
                                            </button>
                                        </div>

                                        {/* Active Tags */}
                                        {tags.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mb-4">
                                                {tags.map(tag => (
                                                    <span key={tag} className="flex items-center gap-1 bg-[#05DF9C]/10 text-[#05DF9C] text-[10px] font-bold px-2 py-1 rounded border border-[#05DF9C]/20">
                                                        #{tag}
                                                        <X size={10} className="cursor-pointer hover:text-white" onClick={() => handleRemoveTag(tag)} />
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {/* System Suggestions */}
                                        <div>
                                            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">System Suggestions</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {SUGGESTED_TAGS.map(tag => (
                                                    <button 
                                                        key={tag}
                                                        onClick={() => toggleSuggestedTag(tag)}
                                                        className={`text-[9px] font-mono px-2 py-1 rounded border transition-all ${tags.includes(tag) ? 'bg-slate-700 text-white border-slate-500' : 'bg-[#121212] text-slate-500 border-slate-800 hover:border-slate-600'}`}
                                                    >
                                                        {tag}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* BIOMETRIC TARGETING MODULE */}
                                    <div className="bg-[#181818] border border-slate-800 rounded-xl p-4 relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4">
                                            <ScanFace className="text-rose-400" size={16} />
                                            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Biometric Intelligence</h3>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Associate with Profile (Kelastron)</label>
                                                <div className="relative">
                                                    <UserSquare className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                                    <input 
                                                        value={targetProfile}
                                                        onChange={(e) => setTargetProfile(e.target.value)}
                                                        placeholder="Target ID / Name (Optional)"
                                                        className="w-full bg-[#121212] border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 focus:border-rose-500 focus:outline-none placeholder-slate-600"
                                                    />
                                                </div>
                                                <p className="text-[9px] text-slate-500 mt-1 ml-1">Leave empty for blind scan.</p>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                 <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Active Scanners</label>
                                                 <button 
                                                    onClick={() => setRunFaceScan(!runFaceScan)}
                                                    className={`w-full flex items-center justify-between px-3 py-2 rounded border text-[10px] font-bold transition-all ${runFaceScan ? 'bg-rose-500/10 border-rose-500 text-rose-400' : 'bg-[#121212] border-slate-800 text-slate-600'}`}
                                                 >
                                                     <div className="flex items-center gap-2"><ScanFace size={12}/> Facial Recognition</div>
                                                     <div className={`w-2 h-2 rounded-full ${runFaceScan ? 'bg-rose-500 animate-pulse' : 'bg-slate-700'}`}></div>
                                                 </button>
                                                 <button 
                                                    onClick={() => setRunVoiceScan(!runVoiceScan)}
                                                    className={`w-full flex items-center justify-between px-3 py-2 rounded border text-[10px] font-bold transition-all ${runVoiceScan ? 'bg-sky-500/10 border-sky-500 text-sky-400' : 'bg-[#121212] border-slate-800 text-slate-600'}`}
                                                 >
                                                     <div className="flex items-center gap-2"><Mic size={12}/> Voiceprint Analysis</div>
                                                     <div className={`w-2 h-2 rounded-full ${runVoiceScan ? 'bg-sky-500 animate-pulse' : 'bg-slate-700'}`}></div>
                                                 </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Grading */}
                                <div className="col-span-1 md:col-span-5 space-y-6">
                                     {/* Classification */}
                                     <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Classification</label>
                                        <div className="flex flex-col gap-2">
                                            {(['TOP SECRET', 'SECRET', 'CONFIDENTIAL', 'UNCLASSIFIED'] as Classification[]).map(cls => (
                                                <button
                                                    key={cls}
                                                    onClick={() => setClassification(cls)}
                                                    className={`
                                                        w-full text-left px-4 py-2.5 rounded-lg border text-xs font-bold transition-all relative overflow-hidden
                                                        ${classification === cls 
                                                            ? cls === 'TOP SECRET' ? 'bg-rose-950/40 border-rose-500 text-rose-400' 
                                                            : cls === 'SECRET' ? 'bg-amber-900/40 border-amber-500 text-amber-400'
                                                            : 'bg-emerald-900/40 border-emerald-500 text-emerald-400'
                                                            : 'bg-[#121212] border-slate-800 text-slate-500 hover:border-slate-600'}
                                                    `}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        {cls}
                                                        {classification === cls && <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Admiralty Code */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Admiralty Code</label>
                                            <span className="text-[10px] font-mono text-[#05DF9C]">{reliability}{credibility}</span>
                                        </div>
                                        <div className="bg-[#181818] border border-slate-800 rounded-lg p-3 grid grid-cols-2 gap-4">
                                            <div>
                                                <span className="text-[9px] text-slate-600 block mb-1">RELIABILITY</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {['A','B','C','D','E','F'].map(r => (
                                                        <button key={r} onClick={() => setReliability(r as any)} className={`w-6 h-6 rounded text-[10px] font-bold border ${reliability === r ? 'bg-slate-700 text-white border-slate-500' : 'text-slate-600 border-slate-800 hover:bg-slate-900'}`}>{r}</button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-slate-600 block mb-1">CREDIBILITY</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {['1','2','3','4','5','6'].map(c => (
                                                        <button key={c} onClick={() => setCredibility(c as any)} className={`w-6 h-6 rounded text-[10px] font-bold border ${credibility === c ? 'bg-slate-700 text-white border-slate-500' : 'text-slate-600 border-slate-800 hover:bg-slate-900'}`}>{c}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- STEP 3: REVIEW & SUBMIT --- */}
                    {currentStep === 3 && (
                        <div className="animate-slideIn flex flex-col h-full space-y-6">
                            
                            <div className="flex justify-between items-center">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <FileCheck className="text-[#05DF9C]" size={18} /> 
                                    MISSION SUMMARY
                                </h2>
                                <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">Ready to Process</div>
                            </div>

                            {/* Ticket / Summary Card */}
                            <div className="bg-[#121212] border border-slate-800 rounded-xl relative overflow-hidden group">
                                <div className="absolute top-0 left-0 w-1 h-full bg-[#05DF9C]"></div>
                                
                                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                                    
                                    {/* Left: Main Info */}
                                    <div className="space-y-4">
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Operation Title</div>
                                            <div className="text-lg font-bold text-white">{title || "Untitled Operation"}</div>
                                        </div>
                                        <div className="flex gap-4">
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Source</div>
                                                <div className="inline-flex items-center gap-2 bg-[#05DF9C]/10 text-[#05DF9C] px-2 py-1 rounded text-xs font-bold border border-[#05DF9C]/20">
                                                    {sourceType} <Signal size={12} />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Date</div>
                                                <div className="text-sm font-mono text-slate-300">{timestamp}</div>
                                            </div>
                                        </div>
                                        {tags.length > 0 && (
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Mission Tags</div>
                                                <div className="flex gap-1.5 flex-wrap">
                                                    {tags.map(t => (
                                                        <span key={t} className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[9px] font-mono border border-slate-700">#{t}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {uploadedMedia.length > 0 && (
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Attachments</div>
                                                <div className="flex gap-2 flex-wrap">
                                                    {uploadedMedia.map((m,i) => (
                                                        <div key={i} className="px-2 py-1 bg-slate-800 rounded text-[9px] font-mono text-slate-300 border border-slate-700">{m.type.toUpperCase()}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right: Security Meta */}
                                    <div className="space-y-4">
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Classification</div>
                                            <div className={`
                                                inline-block px-3 py-1 rounded text-[10px] font-bold border uppercase
                                                ${classification === 'TOP SECRET' ? 'bg-rose-950/30 text-rose-400 border-rose-500/30' : 
                                                  classification === 'SECRET' ? 'bg-amber-900/30 text-amber-400 border-amber-500/30' :
                                                  'bg-emerald-900/30 text-emerald-400 border-emerald-500/30'}
                                            `}>
                                                {classification}
                                            </div>
                                        </div>
                                        <div className="flex gap-6">
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Location</div>
                                                <div className="flex items-center gap-1 text-sm text-slate-300">
                                                    <MapPin size={14} className="text-emerald-500" /> {location || "N/A"}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reliability</div>
                                                <div className="font-mono text-sm text-[#05DF9C]">{reliability}{credibility}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Abstract decoration */}
                                <div className="absolute right-0 bottom-0 opacity-5 pointer-events-none">
                                    <Target size={120} />
                                </div>
                            </div>

                            {/* Checklist */}
                            <div className="bg-[#181818] border border-slate-800 rounded-xl p-6">
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Scan size={14} /> System Pre-Check
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-8">
                                    {[
                                        'Entity Extraction (NER) Module',
                                        `Facial Recognition (SCAN: ${runFaceScan ? 'ON' : 'OFF'})`,
                                        `Voiceprint Analysis (SCAN: ${runVoiceScan ? 'ON' : 'OFF'})`,
                                        'Relationship Mapping Engine',
                                        'Timeline Reconstruction',
                                        'Cross-Study Correlation'
                                    ].map((item, i) => (
                                        <div key={i} className="flex items-center gap-3 text-xs text-slate-400 py-1 border-b border-slate-800/50 last:border-0">
                                            <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/50 flex items-center justify-center shrink-0">
                                                <CheckCircle2 size={10} className="text-emerald-500" />
                                            </div>
                                            {item}
                                            <span className="ml-auto text-[9px] font-mono text-emerald-500">ONLINE</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Warning */}
                            <div className="bg-[#05DF9C]/5 border border-[#05DF9C]/20 rounded-lg p-4 flex gap-4 items-start">
                                 <AlertTriangle className="text-[#05DF9C] shrink-0" size={20} />
                                 <div className="text-xs text-[#05DF9C]/80 leading-relaxed">
                                     <strong>SYSTEM NOTE:</strong> You are about to ingest classified material into the Context Engine. 
                                     This action will trigger automated cross-referencing against all active databases.
                                 </div>
                             </div>
                        </div>
                    )}
                </div>

                {/* ACTION BAR (FIXED BOTTOM) */}
                <div className="p-6 border-t border-slate-800 bg-[#121212] flex justify-between items-center shrink-0 z-20 shadow-[0_-5px_20px_rgba(0,0,0,0.5)]">
                    <button 
                        onClick={handleBack}
                        disabled={currentStep === 1 || isAnalyzing}
                        className="text-slate-500 hover:text-white disabled:opacity-30 flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-4 py-3 hover:bg-slate-800 rounded-xl transition-all"
                    >
                        <ArrowLeft size={16} /> Back
                    </button>

                    <div className="flex gap-2">
                         {[1,2,3].map(step => (
                             <div key={step} className={`w-2 h-2 rounded-full transition-all ${currentStep === step ? 'bg-[#05DF9C] w-6' : 'bg-slate-800'}`}></div>
                         ))}
                    </div>

                    {currentStep < 3 ? (
                        <button 
                            onClick={handleNext}
                            disabled={!rawContent.trim() && uploadedMedia.length === 0}
                            className="bg-white text-black hover:bg-[#05DF9C] px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-white"
                        >
                            Continue <ArrowRight size={16} />
                        </button>
                    ) : (
                        <button
                            onClick={handleFinalSubmit}
                            disabled={isAnalyzing}
                            className={`
                              relative overflow-hidden bg-[#05DF9C] text-black px-10 py-3 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all shadow-[0_0_20px_rgba(5,223,156,0.4)]
                              ${isAnalyzing ? 'opacity-80 cursor-wait' : ''}
                            `}
                        >
                            {isAnalyzing ? <Loader2 className="animate-spin" /> : <Zap fill="black" size={16} />}
                            {isAnalyzing ? 'Processing...' : 'Execute Analysis'}
                        </button>
                    )}
                </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default IngestionPanel;
