import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  FileSearch,
  Filter,
  Loader2,
  MessageSquare,
  Radar,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
} from "lucide-react";

import type { ChatMessage, StudyItem } from "../types";
import {
  getReasoningEngineDescriptor,
  HAS_CONFIGURED_GEMINI_API_KEY,
  PRIMARY_REASONING_ENGINE,
  type ReasoningEngineId,
} from "../services/intelligenceService";
import {
  askLiveResearchQuestion,
  buildLiveResearchCorpus,
  type LiveResearchAnswer,
  type LiveResearchEngineTrace,
  type LiveResearchSource,
} from "../services/liveResearchService";

interface RealTimeDashboardProps {
  studies?: StudyItem[];
  onPublish?: (title: string) => void;
}

type ConversationMessage = {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: Date;
  research?: LiveResearchAnswer;
};

const QUICK_PROMPTS = [
  "Which entities recur across the highest-risk cases in the corpus?",
  "What contradictions or stale claims are visible across the active database?",
  "Summarize the most important operational network and cite the strongest evidence.",
  "What collection gaps are repeated across multiple cases right now?",
];

const ENGINE_STORAGE_KEY = "tevel.liveResearch.reasoningEngine";
const GEMINI_API_KEY_STORAGE_KEY = "tevel.liveResearch.geminiApiKey";

const readStoredReasoningEngine = (): ReasoningEngineId => {
  if (typeof window === "undefined") return PRIMARY_REASONING_ENGINE.id;
  const stored = window.localStorage.getItem(ENGINE_STORAGE_KEY);
  return stored === "gemini-cloud" || stored === "ollama-local" ? stored : PRIMARY_REASONING_ENGINE.id;
};

const readStoredGeminiApiKey = (): string => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || "";
};

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatStudyDate = (value: string): string => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

const SourceCard: React.FC<{ source: LiveResearchSource; compact?: boolean }> = ({ source, compact = false }) => (
  <div className={`rounded-2xl border border-slate-800/80 bg-[linear-gradient(180deg,rgba(9,14,23,0.96),rgba(4,8,14,0.98))] ${compact ? "p-3" : "p-4"}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-mono uppercase tracking-[0.22em] text-cyan-300/70">{source.source}</div>
        <div className="mt-1 text-sm font-semibold text-white" dir="auto">{source.title}</div>
        <div className="mt-1 text-[11px] text-slate-500">{formatStudyDate(source.date)}</div>
      </div>
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-mono text-cyan-200">
        {formatPercent(source.relevance)}
      </div>
    </div>

    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
      <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">Reliability {formatPercent(source.reliability || 0)}</span>
      <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{source.openQuestions} questions</span>
      <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{source.openTasks} tasks</span>
      <span className={`rounded-full border px-2 py-1 ${source.citationReady ? "border-emerald-500/30 text-emerald-200" : "border-amber-500/30 text-amber-200"}`}>
        {source.citationReady ? "Citation-ready" : "Limited citations"}
      </span>
    </div>

    {source.matchedSignals.length > 0 && (
      <div className="mt-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Matched Signals</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {source.matchedSignals.slice(0, compact ? 2 : 4).map((signal) => (
            <span key={`${source.id}-signal-${signal}`} className="rounded-full border border-slate-700/80 bg-black/20 px-2 py-1 text-[11px] text-slate-200" dir="auto">
              {signal}
            </span>
          ))}
        </div>
      </div>
    )}

    {source.evidencePreview.length > 0 && (
      <div className="mt-3 space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Evidence Preview</div>
        {source.evidencePreview.slice(0, compact ? 1 : 2).map((snippet, index) => (
          <div key={`${source.id}-evidence-${index}`} className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-slate-300" dir="auto">
            {snippet}
          </div>
        ))}
      </div>
    )}
  </div>
);

const StatCard: React.FC<{ label: string; value: string; hint: string; accent?: "emerald" | "cyan" | "amber" | "slate" }> = ({
  label,
  value,
  hint,
  accent = "slate",
}) => {
  const accentClass =
    accent === "emerald"
      ? "from-emerald-500/18 to-emerald-500/0 border-emerald-500/20"
      : accent === "cyan"
        ? "from-cyan-500/18 to-cyan-500/0 border-cyan-500/20"
        : accent === "amber"
          ? "from-amber-500/18 to-amber-500/0 border-amber-500/20"
          : "from-white/6 to-white/0 border-slate-800";

  return (
    <div className={`rounded-2xl border bg-[linear-gradient(180deg,rgba(8,12,19,0.98),rgba(5,8,14,0.98)),radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_45%)] ${accentClass} p-4`}>
      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-3 text-2xl font-bold text-white">{value}</div>
      <div className="mt-2 text-[11px] leading-relaxed text-slate-400">{hint}</div>
    </div>
  );
};

const formatEngineBadge = (engineLabel: string, engineSurface: LiveResearchEngineTrace["engineSurface"]): string =>
  engineSurface === "cloud" ? `${engineLabel} cloud` : `${engineLabel} local`;

const buildSeedMessage = (
  studiesCount: number,
  engineLabel = PRIMARY_REASONING_ENGINE.label,
  engineSurface: LiveResearchEngineTrace["engineSurface"] = PRIMARY_REASONING_ENGINE.surface,
): string => {
  if (studiesCount === 0) {
    return "No studies are currently loaded. Ingest data first, then use Live Research to chat with the corpus.";
  }

  const engineDescriptor =
    engineSurface === "cloud"
      ? `${engineLabel} cloud reasoning`
      : `the local model (${engineLabel})`;

  return `Ask across ${studiesCount} stored studies. TEVEL will route the question through scoped retrieval, evidence packs, and citation checks before ${engineDescriptor} answers.`;
};

const buildEngineNarrative = (
  engineTrace: LiveResearchEngineTrace | undefined,
  selectedEngineLabel: string,
  selectedEngineSurface: LiveResearchEngineTrace["engineSurface"],
): string => {
  const engineLabel = engineTrace?.engineLabel || selectedEngineLabel;
  const engineSurface = engineTrace?.engineSurface || selectedEngineSurface;

  if (engineTrace?.responseMode === "deterministic-fallback") {
    return `${engineTrace.failureMessage || "The reasoning engine was unavailable."} TEVEL returned a deterministic FCF-R3 synthesis from the selected evidence instead.`;
  }
  if (engineTrace?.responseMode === "verified-synthesis") {
    return `The selected reasoning engine answered, but TEVEL promoted the FCF-R3 verified synthesis because the model output did not cite the selected evidence strongly enough.`;
  }

  return engineSurface === "cloud"
    ? `${engineLabel} performs the deep reasoning pass over scoped corpus summaries, entities, and links.`
    : `The local model ${engineLabel} performs the deep reasoning pass over scoped corpus summaries, entities, and links.`;
};

const RealTimeDashboard: React.FC<RealTimeDashboardProps> = ({ studies = [] }) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [studyFilter, setStudyFilter] = useState("");
  const [selectedStudyIds, setSelectedStudyIds] = useState<string[]>([]);
  const [selectedEngineId, setSelectedEngineId] = useState<ReasoningEngineId>(readStoredReasoningEngine);
  const [geminiApiKey, setGeminiApiKey] = useState(readStoredGeminiApiKey);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const selectedEngine = useMemo(() => getReasoningEngineDescriptor(selectedEngineId), [selectedEngineId]);
  const geminiKeyForRequest = geminiApiKey.trim();
  const geminiConfigured = HAS_CONFIGURED_GEMINI_API_KEY || geminiKeyForRequest.length > 0;
  const isGeminiBlocked = selectedEngineId === "gemini-cloud" && !geminiConfigured;

  const filteredStudies = useMemo(() => {
    const query = studyFilter.trim().toLowerCase();
    if (!query) return studies;
    return studies.filter((study) => {
      const tags = (study.tags || []).join(" ").toLowerCase();
      return (
        study.title.toLowerCase().includes(query) ||
        study.source.toLowerCase().includes(query) ||
        tags.includes(query)
      );
    });
  }, [studies, studyFilter]);

  const corpusPreview = useMemo(
    () => buildLiveResearchCorpus("", studies, selectedStudyIds.length ? selectedStudyIds : undefined),
    [studies, selectedStudyIds],
  );

  const latestResearch = useMemo(
    () => [...messages].reverse().find((message) => message.role === "model" && message.research)?.research,
    [messages],
  );

  const activeScopeCount = selectedStudyIds.length > 0 ? selectedStudyIds.length : studies.length;
  const displaySources = latestResearch?.sources || corpusPreview.sources;
  const displayWarnings = latestResearch?.warnings || corpusPreview.warnings;
  const citationGuard = latestResearch?.citationGuard || (corpusPreview.package.retrieval_artifacts ? "active" : "limited");
  const fcfAudit = latestResearch?.fcfAudit;
  const engineTrace = latestResearch?.engineTrace;
  const engineBadge = formatEngineBadge(
    engineTrace?.engineLabel || selectedEngine.label,
    engineTrace?.engineSurface || selectedEngine.surface,
  );
  const reasoningOutcomeLabel =
    engineTrace?.responseMode === "deterministic-fallback"
      ? "Deterministic fallback"
      : engineTrace?.responseMode === "verified-synthesis"
        ? "FCF-R3 verified"
        : "Model answer";
  const supportedClaimsRate =
    typeof fcfAudit?.supported_claim_rate === "number" ? `${Math.round(fcfAudit.supported_claim_rate * 100)}% traced` : "Awaiting trace";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatting]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENGINE_STORAGE_KEY, selectedEngineId);
  }, [selectedEngineId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = geminiApiKey.trim();
    if (trimmed) {
      window.localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
  }, [geminiApiKey]);

  const toggleStudyScope = (studyId: string) => {
    setSelectedStudyIds((current) =>
      current.includes(studyId) ? current.filter((id) => id !== studyId) : [...current, studyId],
    );
  };

  const useWholeCorpus = () => setSelectedStudyIds([]);

  const submitQuestion = async (override?: string) => {
    const question = (override || input).trim();
    if (!question || isChatting) return;
    if (selectedEngineId === "gemini-cloud" && !geminiConfigured) {
      setMessages((current) => [
        ...current,
        {
          id: `model_${Date.now()}`,
          role: "model",
          content: "Gemini is selected, but no API key is configured. Paste the key in the Gemini field or set GEMINI_API_KEY before sending.",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    const history: ChatMessage[] = messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    }));

    const userMessage: ConversationMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsChatting(true);

    try {
      const response = await askLiveResearchQuestion(
        question,
        studies,
        history,
        selectedStudyIds.length ? selectedStudyIds : undefined,
        {
          reasoningEngineId: selectedEngineId,
          geminiApiKey: selectedEngineId === "gemini-cloud" ? geminiKeyForRequest || undefined : undefined,
        },
      );

      const modelMessage: ConversationMessage = {
        id: `model_${Date.now()}`,
        role: "model",
        content: response.answer,
        timestamp: new Date(),
        research: response,
      };

      setMessages((current) => [...current, modelMessage]);
    } catch (error) {
      const fallback =
        error instanceof Error ? error.message : "Live Research failed to reach the local reasoning stack.";
      setMessages((current) => [
        ...current,
        {
          id: `model_${Date.now()}`,
          role: "model",
          content: fallback,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsChatting(false);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion();
    }
  };

  return (
    <div className="h-full min-h-0 bg-[radial-gradient(circle_at_top_left,rgba(5,223,156,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.08),transparent_25%),linear-gradient(180deg,rgba(5,8,13,0.98),rgba(2,6,12,1))]">
      <div className="grid h-full min-h-0 gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <aside className="flex flex-col min-h-0 overflow-hidden rounded-[28px] border border-slate-800/80 bg-[linear-gradient(180deg,rgba(7,11,18,0.98),rgba(3,7,12,0.98))]">
          <div className="shrink-0 border-b border-slate-800/80 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-2 text-cyan-200">
                <Database size={18} />
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Corpus Scope</div>
                <div className="mt-1 text-lg font-semibold text-white">Database Routing</div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Route the chat across the whole database or narrow it to a deliberate case scope before retrieval starts.
            </p>
          </div>

          <div className="shrink-0 space-y-4 p-4">
            <button
              onClick={useWholeCorpus}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                selectedStudyIds.length === 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-white"
                  : "border-slate-800 bg-black/20 text-slate-300 hover:border-slate-700"
              }`}
            >
              <div>
                <div className="text-sm font-semibold">Use whole database</div>
                <div className="mt-1 text-[11px] text-slate-400">{studies.length} stored studies stay in scope</div>
              </div>
              {selectedStudyIds.length === 0 ? <CheckCircle2 size={16} className="text-emerald-300" /> : <ChevronRight size={16} />}
            </button>

            <div className="rounded-2xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2 text-slate-500">
                <Search size={14} />
                <input
                  value={studyFilter}
                  onChange={(event) => setStudyFilter(event.target.value)}
                  placeholder="Filter studies by title, source, or tag"
                  className="w-full bg-transparent py-1 text-sm text-white outline-none placeholder:text-slate-600"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col flex-1 min-h-0 px-4 pb-4">
            <div className="shrink-0 mb-3 flex items-center justify-between px-1">
              <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Scoped Cases</div>
              <div className="text-[11px] text-slate-500">{selectedStudyIds.length || studies.length} active</div>
            </div>
            <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
              {filteredStudies.map((study) => {
                const isSelected = selectedStudyIds.includes(study.id);
                const useAll = selectedStudyIds.length === 0;
                const active = useAll || isSelected;
                return (
                  <button
                    key={study.id}
                    onClick={() => toggleStudyScope(study.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-cyan-500/25 bg-cyan-500/8"
                        : "border-slate-800 bg-black/20 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{study.title}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{formatStudyDate(study.date)} · {study.source}</div>
                      </div>
                      <div className={`mt-0.5 h-3 w-3 rounded-full ${active ? "bg-cyan-300" : "bg-slate-700"}`}></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                      <span>{study.intelligence.entities.length} entities</span>
                      <span>{study.intelligence.relations.length} links</span>
                      <span>{formatPercent(study.intelligence.reliability || 0)} reliability</span>
                    </div>
                  </button>
                );
              })}

              {filteredStudies.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                  No studies matched the current filter.
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex flex-col min-h-0 overflow-hidden rounded-[30px] border border-slate-800/80 bg-[linear-gradient(180deg,rgba(8,12,19,0.98),rgba(3,6,11,1))]">
          <div className="shrink-0 border-b border-slate-800/80 px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-slate-500">Live Research Chat</div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-200">
                    <BrainCircuit size={18} />
                  </div>
                  <h2 className="text-2xl font-semibold text-white">Chat with the full TEVEL corpus</h2>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                  Every question is routed through scoped case selection, evidence retrieval, citation verification, and the primary reasoning engine already embedded in the platform.
                </p>
                <div className="mt-4 rounded-2xl border border-slate-800 bg-black/20 p-3">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Reasoning Engine</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Choose which model performs the analysis pass after FCF-R3 retrieval and citation assembly.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedEngineId("ollama-local")}
                        className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors ${
                          selectedEngineId === "ollama-local"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                            : "border-slate-700 bg-black/20 text-slate-300 hover:border-slate-600"
                        }`}
                      >
                        Local Ollama
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedEngineId("gemini-cloud")}
                        className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors ${
                          selectedEngineId === "gemini-cloud"
                            ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
                            : "border-slate-700 bg-black/20 text-slate-300 hover:border-slate-600"
                        }`}
                      >
                        Gemini Cloud
                      </button>
                    </div>
                  </div>

                  {selectedEngineId === "gemini-cloud" && (
                    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <input
                        value={geminiApiKey}
                        onChange={(event) => setGeminiApiKey(event.target.value)}
                        type="password"
                        placeholder={HAS_CONFIGURED_GEMINI_API_KEY ? "Gemini API key loaded from env" : "Paste Gemini API key for this browser"}
                        className="w-full rounded-2xl border border-slate-800 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/30"
                      />
                      <span className={`rounded-full border px-3 py-2 text-[11px] ${
                        geminiConfigured
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-500/25 bg-amber-500/10 text-amber-200"
                      }`}>
                        {geminiConfigured ? "Gemini key ready" : "Gemini key required"}
                      </span>
                      <div className="text-[11px] leading-relaxed text-slate-500 lg:col-span-2">
                        The key is stored only in this browser profile and is not written into the repository.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-slate-700 bg-black/20 px-3 py-1.5 text-slate-300">Scope: {activeScopeCount} studies</span>
                <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-cyan-200">Hybrid retrieval</span>
                <span className={`rounded-full border px-3 py-1.5 ${citationGuard === "active" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-amber-500/25 bg-amber-500/10 text-amber-200"}`}>
                  {citationGuard === "active" ? "Citation guard active" : "Citation guard limited"}
                </span>
                <span className="rounded-full border border-slate-700 bg-black/20 px-3 py-1.5 text-slate-300">{engineBadge}</span>
                <span className={`rounded-full border px-3 py-1.5 ${engineTrace?.responseMode === "deterministic-fallback" ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-slate-700 bg-black/20 text-slate-300"}`}>
                  {reasoningOutcomeLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 grid gap-3 border-b border-slate-800/80 px-6 py-4 md:grid-cols-4">
              <StatCard label="Routed Cases" value={String(latestResearch?.scope.selectedStudies || corpusPreview.scope.selectedStudies)} hint="Cases actually selected for the latest research pass." accent="cyan" />
              <StatCard label="Entities" value={String(corpusPreview.scope.totalEntities)} hint="Merged graph nodes reachable in the active scope." accent="slate" />
              <StatCard label="Selected Evidence" value={String(fcfAudit?.selected_count ?? corpusPreview.scope.retrievalHits)} hint="FCF-R3 evidence atoms selected for the latest answer." accent="emerald" />
              <StatCard label="Watchlist Hits" value={String(corpusPreview.scope.watchlistHits)} hint="External risk signals surfaced by reference knowledge." accent="amber" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col justify-between">
                  <div>
                    <div className="rounded-[28px] border border-slate-800/80 bg-[linear-gradient(180deg,rgba(12,18,28,0.96),rgba(4,8,14,0.96))] p-6">
                      <div className="flex items-start gap-4">
                        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-200">
                          <Radar size={18} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">Research posture</div>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                            {buildSeedMessage(
                              activeScopeCount,
                              engineTrace?.engineLabel || selectedEngine.label,
                              engineTrace?.engineSurface || selectedEngine.surface,
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="mt-6 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-800 bg-black/20 p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <ShieldCheck size={16} className="text-emerald-300" />
                            Evidence discipline
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-slate-400">
                            TEVEL answers from scoped evidence packs, research dossiers, summary panels, and citation-ready retrieval hits when they exist.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-black/20 p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <Workflow size={16} className="text-cyan-300" />
                            Database coverage
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-slate-400">
                            The chat searches the current corpus and narrows to the most relevant cases before the primary reasoning engine reasons over them.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Quick Starts</div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {QUICK_PROMPTS.map((prompt) => (
                          <button
                            key={prompt}
                            onClick={() => void submitQuestion(prompt)}
                            disabled={studies.length === 0}
                            className="rounded-2xl border border-slate-800 bg-black/20 px-4 py-4 text-left transition-colors hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <div className="flex items-start gap-3">
                              <Sparkles size={15} className="mt-1 shrink-0 text-cyan-300" />
                              <div className="text-sm leading-relaxed text-slate-200">{prompt}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`max-w-[92%] rounded-[26px] border px-5 py-4 ${
                        message.role === "user"
                          ? "ml-auto border-cyan-500/20 bg-cyan-500/10"
                          : "border-slate-800 bg-[linear-gradient(180deg,rgba(10,15,24,0.98),rgba(5,8,14,0.98))]"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">
                        {message.role === "user" ? <MessageSquare size={12} /> : <BrainCircuit size={12} />}
                        {message.role === "user" ? "You" : "TEVEL Intelligence"}
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-100" dir="auto">
                        {message.content}
                      </div>

                      {message.research?.engineTrace?.responseMode === "deterministic-fallback" && message.research.engineTrace.failureMessage && (
                        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          <span>FCF-R3 deterministic fallback engaged. {message.research.engineTrace.failureMessage}</span>
                        </div>
                      )}
                      {message.research?.engineTrace?.responseMode === "verified-synthesis" && (
                        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
                          <BadgeCheck size={13} className="mt-0.5 shrink-0" />
                          <span>FCF-R3 verified synthesis used because the model answer did not cite the selected evidence strongly enough.</span>
                        </div>
                      )}

                      {message.research?.verificationNote && (() => {
                          const note = message.research.verificationNote;
                          const pctMatch = note.match(/(\d+)%/);
                          const pct = pctMatch ? parseInt(pctMatch[1], 10) : null;
                          const isFullySupported = pct === 100;
                          if (isFullySupported) return null;
                          const label = pct === 0
                            ? "Answer grounded in retrieved context — independent claim verification not available for this query."
                            : pct !== null
                              ? `${pct}% of answer claims could be traced back to retrieved evidence.`
                              : note;
                          return (
                            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-slate-700/50 bg-slate-800/30 px-3 py-2 text-[11px] text-slate-400">
                              <span className="mt-0.5 shrink-0 text-slate-500">⚑</span>
                              <span>{label}</span>
                            </div>
                          );
                        })()}

                      {message.research && message.research.sources.length > 0 && (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">
                            <FileSearch size={12} />
                            Source Pack Used
                          </div>
                          <div className="grid gap-3 xl:grid-cols-2">
                            {message.research.sources.slice(0, 4).map((source) => (
                              <SourceCard key={`${message.id}-${source.id}`} source={source} compact />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {isChatting && (
                    <div className="max-w-[92%] rounded-[26px] border border-slate-800 bg-[linear-gradient(180deg,rgba(10,15,24,0.98),rgba(5,8,14,0.98))] px-5 py-4">
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">
                        <Loader2 size={12} className="animate-spin" />
                        Live Research
                      </div>
                      <div className="mt-3 text-sm text-slate-300">
                        Routing across the scoped corpus, assembling evidence packs, and querying the primary reasoning engine...
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="shrink-0 border-t border-slate-800/80 px-6 py-5">
              <div className="rounded-[28px] border border-slate-800/80 bg-[linear-gradient(180deg,rgba(8,12,19,0.98),rgba(4,8,14,0.98))] p-4">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">
                  <Target size={12} />
                  Ask The Corpus
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    rows={4}
                    placeholder="Ask about entities, contradictions, collection gaps, timelines, relationships, or operational pressure across the database..."
                    className="w-full resize-none rounded-2xl border border-slate-800 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-500/30"
                  />
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span className="rounded-full border border-slate-800 px-3 py-1.5">{activeScopeCount} studies in scope</span>
                      <span className="rounded-full border border-slate-800 px-3 py-1.5">{corpusPreview.scope.retrievalHits} retrieval hits available</span>
                      <span className="rounded-full border border-slate-800 px-3 py-1.5">{citationGuard === "active" ? "Citation verification on" : "Citation verification limited"}</span>
                      <span className={`rounded-full border px-3 py-1.5 ${isGeminiBlocked ? "border-amber-500/30 text-amber-200" : "border-slate-800 text-slate-500"}`}>
                        {isGeminiBlocked ? "Gemini key required" : engineBadge}
                      </span>
                    </div>
                    <button
                      onClick={() => void submitQuestion()}
                      disabled={isChatting || !input.trim() || studies.length === 0 || isGeminiBlocked}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#05DF9C] px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#39e5af] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      {isChatting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                      Send To Live Research
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex flex-col min-h-0 overflow-hidden rounded-[28px] border border-slate-800/80 bg-[linear-gradient(180deg,rgba(7,11,18,0.98),rgba(3,7,12,0.98))]">
          <div className="shrink-0 border-b border-slate-800/80 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-200">
                <BookOpen size={18} />
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">Provenance Rail</div>
                <div className="mt-1 text-lg font-semibold text-white">Latest Evidence Pack</div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Inspect the case packets, warnings, and guardrails that the current answer or scope is leaning on.
            </p>
          </div>

          <div className="shrink-0 grid gap-3 border-b border-slate-800/80 p-4 md:grid-cols-2 xl:grid-cols-1">
            <StatCard label="Selected Cases" value={String(latestResearch?.scope.selectedStudies || corpusPreview.scope.selectedStudies)} hint="Top cases sent into the latest reasoning pass." accent="cyan" />
            <StatCard label="Citation Ready" value={String(latestResearch?.scope.citationReadyStudies || corpusPreview.scope.citationReadyStudies)} hint="Studies in the active scope with retrieval artifacts." accent="emerald" />
          </div>

          <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4">
            {fcfAudit && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                  <Workflow size={15} />
                  FCF-R3 Read Path
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-emerald-50/90">
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Status</div>
                    <div className="mt-1 font-semibold">{fcfAudit.answer_status}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Route</div>
                    <div className="mt-1 font-semibold">{fcfAudit.route_mode}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Evidence</div>
                    <div className="mt-1 font-semibold">{fcfAudit.selected_count}/{fcfAudit.candidate_count}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Context</div>
                    <div className="mt-1 font-semibold">{fcfAudit.estimated_input_tokens} est. tokens</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Trace</div>
                    <div className="mt-1 font-semibold">{fcfAudit.persistence_status || "runtime"}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Engine</div>
                    <div className="mt-1 font-semibold">{engineBadge}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Claims Traced</div>
                    <div className="mt-1 font-semibold">{supportedClaimsRate}</div>
                  </div>
                  {fcfAudit.run_id && (
                    <div className="rounded-xl border border-emerald-500/15 bg-black/10 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/60">Run ID</div>
                      <div className="mt-1 truncate font-mono text-[11px] font-semibold">{fcfAudit.run_id}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-800 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                {citationGuard === "active" ? <BadgeCheck size={16} className="text-emerald-300" /> : <AlertTriangle size={16} className="text-amber-300" />}
                Guardrail Stack
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-400">
                <div className="flex items-start gap-2">
                  <ChevronRight size={14} className="mt-0.5 shrink-0 text-cyan-300" />
                  <span>{buildEngineNarrative(engineTrace, selectedEngine.label, selectedEngine.surface)}</span>
                </div>
                <div className="flex items-start gap-2">
                  <ChevronRight size={14} className="mt-0.5 shrink-0 text-cyan-300" />
                  <span>Hybrid retrieval routed through the evidence packs already attached to stored studies.</span>
                </div>
                <div className="flex items-start gap-2">
                  <ChevronRight size={14} className="mt-0.5 shrink-0 text-cyan-300" />
                  <span>{citationGuard === "active" ? "Citation verification remains active for the selected pack." : "Some scoped cases do not have citation-ready artifacts, so verification is limited."}</span>
                </div>
              </div>
            </div>

            {displayWarnings.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                  <AlertTriangle size={15} />
                  Active Warnings
                </div>
                <div className="mt-3 space-y-2 text-sm text-amber-50/90">
                  {displayWarnings.map((warning) => (
                    <div key={warning} className="rounded-xl border border-amber-500/15 bg-black/10 px-3 py-2" dir="auto">
                      {warning}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">
                <Filter size={12} />
                Source Pack
              </div>
              <div className="space-y-3">
                {displaySources.length > 0 ? (
                  displaySources.map((source) => <SourceCard key={`rail-${source.id}`} source={source} />)
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                    No scoped source pack is available yet. Ask a question to see the routed cases.
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default RealTimeDashboard;
