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
import { askLiveResearchQuestion, buildLiveResearchCorpus, type LiveResearchAnswer, type LiveResearchSource } from "../services/liveResearchService";

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

const buildSeedMessage = (studiesCount: number): string =>
  studiesCount > 0
    ? `Ask across ${studiesCount} stored studies. TEVEL will route the question through scoped retrieval, evidence packs, and citation checks before the local model answers.`
    : "No studies are currently loaded. Ingest data first, then use Live Research to chat with the corpus.";

const RealTimeDashboard: React.FC<RealTimeDashboardProps> = ({ studies = [] }) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [studyFilter, setStudyFilter] = useState("");
  const [selectedStudyIds, setSelectedStudyIds] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatting]);

  const toggleStudyScope = (studyId: string) => {
    setSelectedStudyIds((current) =>
      current.includes(studyId) ? current.filter((id) => id !== studyId) : [...current, studyId],
    );
  };

  const useWholeCorpus = () => setSelectedStudyIds([]);

  const submitQuestion = async (override?: string) => {
    const question = (override || input).trim();
    if (!question || isChatting) return;

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
                  Every question is routed through scoped case selection, evidence retrieval, citation verification, and the local model stack already embedded in the platform.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-slate-700 bg-black/20 px-3 py-1.5 text-slate-300">Scope: {activeScopeCount} studies</span>
                <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-cyan-200">Hybrid retrieval</span>
                <span className={`rounded-full border px-3 py-1.5 ${citationGuard === "active" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-amber-500/25 bg-amber-500/10 text-amber-200"}`}>
                  {citationGuard === "active" ? "Citation guard active" : "Citation guard limited"}
                </span>
                <span className="rounded-full border border-slate-700 bg-black/20 px-3 py-1.5 text-slate-300">Local model</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 grid gap-3 border-b border-slate-800/80 px-6 py-4 md:grid-cols-4">
              <StatCard label="Studies In Scope" value={String(corpusPreview.scope.scopedStudies)} hint="Cases available to the current routing layer." accent="cyan" />
              <StatCard label="Entities" value={String(corpusPreview.scope.totalEntities)} hint="Merged graph nodes reachable in the active scope." accent="slate" />
              <StatCard label="Evidence Hits" value={String(corpusPreview.scope.retrievalHits)} hint="Citation-capable evidence atoms currently available." accent="emerald" />
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
                            {buildSeedMessage(activeScopeCount)}
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
                            The chat searches the current corpus and narrows to the most relevant cases before the local model reasons over them.
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
                        {message.role === "user" ? "Analyst" : "Live Research"}
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-100" dir="auto">
                        {message.content}
                      </div>

                      {message.research?.verificationNote && (
                        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
                          {message.research.verificationNote}
                        </div>
                      )}

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
                        Routing across the scoped corpus, assembling evidence packs, and querying the local model...
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
                    </div>
                    <button
                      onClick={() => void submitQuestion()}
                      disabled={isChatting || !input.trim() || studies.length === 0}
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
            <div className="rounded-2xl border border-slate-800 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                {citationGuard === "active" ? <BadgeCheck size={16} className="text-emerald-300" /> : <AlertTriangle size={16} className="text-amber-300" />}
                Guardrail Stack
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-400">
                <div className="flex items-start gap-2">
                  <ChevronRight size={14} className="mt-0.5 shrink-0 text-cyan-300" />
                  <span>Local model reasoning over scoped corpus summaries, entities, and links.</span>
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
