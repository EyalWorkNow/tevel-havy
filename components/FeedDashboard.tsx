
import React, { useState, useMemo } from 'react';
import { StudyItem } from '../types';
import {
  Search,
  Video,
  FileText,
  Calendar,
  Plus,
  LayoutGrid,
  Signal,
  Sparkles,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  GitMerge,
  ChevronRight,
  Activity,
} from 'lucide-react';
import { isEntityMatch } from '../services/intelligenceService';

interface FeedDashboardProps {
  studies: StudyItem[];
  onSelectStudy: (study: StudyItem) => void;
  onNewAnalysis: () => void;
  onDeleteStudy: (study: StudyItem) => void;
}

const calculateSynapseScore = (
  study: StudyItem,
  allStudies: StudyItem[],
): { score: number; reason: string; linkedEntities: string[] } => {
  const fcf = study.intelligence.fcf_ingestion_meta;

  let score = (study.intelligence.reliability || 0.5) * 40;

  if (fcf) {
    if (fcf.answer_status === 'current-supported') score += 20;
    else if (fcf.answer_status === 'conflict-detected') score += 12;
    else if (fcf.answer_status === 'human-review-required') score += 8;
    else score += 2;
    // density bonus: many selected evidence atoms
    score += Math.min(fcf.selected_count * 1.5, 10);
  } else {
    score += 10;
  }

  let connections = 0;
  const linkedEntities: string[] = [];
  const otherStudies = allStudies.filter((s) => s.id !== study.id);
  (study.intelligence.entities ?? []).forEach((entity) => {
    const isMatch = otherStudies.some((other) =>
      (other.intelligence.entities ?? []).some((otherEntity) =>
        isEntityMatch(entity.name, otherEntity.name),
      ),
    );
    if (isMatch) {
      connections++;
      if (linkedEntities.length < 3) linkedEntities.push(entity.name);
    }
  });
  score += Math.min(connections * 8, 30);
  score = Math.round(Math.min(100, score));

  let reason = 'Standard procedural review.';
  if (score > 90)
    reason = 'CRITICAL: Verified evidence, high reliability & network impact.';
  else if (score > 75)
    reason =
      `High priority.${fcf?.answer_status === 'current-supported' ? ' Evidence verified.' : ''}${linkedEntities.length > 0 ? ` Linked: ${linkedEntities.slice(0, 2).join(', ')}.` : ''}`.trim();
  else if (connections > 0)
    reason = `Cross-references ${connections} existing case${connections > 1 ? 's' : ''}.`;
  else if (fcf?.answer_status === 'current-supported')
    reason = 'Verified evidence quality. Ready for analysis.';
  else if (fcf?.answer_status === 'conflict-detected')
    reason = 'Conflicting evidence detected — review required.';

  return { score, reason, linkedEntities };
};

const ENTITY_TYPE_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  PERSON: { dot: 'bg-emerald-400', text: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/25' },
  ORGANIZATION: { dot: 'bg-sky-400', text: 'text-sky-300', bg: 'bg-sky-500/10 border-sky-500/25' },
  ORG: { dot: 'bg-sky-400', text: 'text-sky-300', bg: 'bg-sky-500/10 border-sky-500/25' },
  LOCATION: { dot: 'bg-amber-400', text: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/25' },
  FACILITY: { dot: 'bg-amber-400', text: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/25' },
  ASSET: { dot: 'bg-purple-400', text: 'text-purple-300', bg: 'bg-purple-500/10 border-purple-500/25' },
  VEHICLE: { dot: 'bg-purple-400', text: 'text-purple-300', bg: 'bg-purple-500/10 border-purple-500/25' },
  COMMUNICATION_CHANNEL: { dot: 'bg-violet-400', text: 'text-violet-300', bg: 'bg-violet-500/10 border-violet-500/25' },
  FINANCIAL_ACCOUNT: { dot: 'bg-green-400', text: 'text-green-300', bg: 'bg-green-500/10 border-green-500/25' },
  TRANSACTION: { dot: 'bg-green-400', text: 'text-green-300', bg: 'bg-green-500/10 border-green-500/25' },
  EVENT: { dot: 'bg-rose-400', text: 'text-rose-300', bg: 'bg-rose-500/10 border-rose-500/25' },
};
const ENTITY_TYPE_DEFAULT = { dot: 'bg-slate-400', text: 'text-slate-300', bg: 'bg-slate-500/10 border-slate-500/25' };

const getEntityStyle = (type: string) => ENTITY_TYPE_STYLE[type] ?? ENTITY_TYPE_DEFAULT;

const FCF_STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  'current-supported':        { label: 'VERIFIED',     icon: ShieldCheck,    cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  'conflict-detected':        { label: 'CONFLICT',     icon: AlertTriangle,  cls: 'text-amber-400   bg-amber-500/10   border-amber-500/30' },
  'human-review-required':    { label: 'REVIEW',       icon: AlertCircle,    cls: 'text-orange-400  bg-orange-500/10  border-orange-500/30' },
  'insufficient-evidence':    { label: 'PARTIAL',      icon: Clock,          cls: 'text-slate-400   bg-slate-500/10   border-slate-500/30' },
  'no-evidence':              { label: 'UNVERIFIED',   icon: AlertCircle,    cls: 'text-red-400     bg-red-500/10     border-red-500/30' },
  'historical-only':          { label: 'HISTORICAL',   icon: Clock,          cls: 'text-purple-400  bg-purple-500/10  border-purple-500/30' },
};
const FCF_STATUS_DEFAULT = { label: 'PENDING', icon: Activity, cls: 'text-slate-500 bg-slate-500/10 border-slate-500/20' };

const getFcfStatusConfig = (status?: string) =>
  status ? (FCF_STATUS_CONFIG[status] ?? FCF_STATUS_DEFAULT) : FCF_STATUS_DEFAULT;

const getPriorityConfig = (score: number) => {
  if (score > 90) return { label: 'CRITICAL', color: 'text-rose-400',  border: 'bg-rose-400' };
  if (score > 75) return { label: 'HIGH',     color: 'text-amber-400', border: 'bg-amber-400' };
  if (score > 50) return { label: 'ELEVATED', color: 'text-sky-400',   border: 'bg-sky-400' };
  return              { label: 'STANDARD',  color: 'text-slate-500',  border: 'bg-slate-600' };
};

const getSourceConfig = (source: string) => {
  switch (source) {
    case 'Signal':   return { icon: Signal,   color: 'text-amber-400', border: 'border-amber-500/50', bg: 'bg-amber-500/10' };
    case 'Telegram': return { icon: Video,    color: 'text-sky-400',   border: 'border-sky-500/50',   bg: 'bg-sky-500/10' };
    case 'News':     return { icon: Activity, color: 'text-rose-400',  border: 'border-rose-500/50',  bg: 'bg-rose-500/10' };
    default:         return { icon: FileText, color: 'text-emerald-400', border: 'border-emerald-500/50', bg: 'bg-emerald-500/10' };
  }
};

const getKeyText = (study: StudyItem): string => {
  const stmt = study.intelligence.statements?.[0]?.statement_text;
  if (stmt && stmt.length > 20) return stmt;
  const insight = study.intelligence.insights?.[0]?.text;
  if (insight && insight.length > 20) return insight;
  return study.intelligence.clean_text || '';
};

const FeedDashboard: React.FC<FeedDashboardProps> = ({
  studies,
  onSelectStudy,
  onNewAnalysis,
  onDeleteStudy,
}) => {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const studiesWithScores = useMemo(
    () =>
      studies
        .map((study) => ({ ...study, synapse: calculateSynapseScore(study, studies) }))
        .sort((a, b) => b.synapse.score - a.synapse.score),
    [studies],
  );

  const filteredStudies = studiesWithScores.filter((s) => {
    const lowerSearch = search.toLowerCase();
    const matchesSearch =
      s.title.toLowerCase().includes(lowerSearch) ||
      s.tags.some((t) => t.toLowerCase().includes(lowerSearch)) ||
      (s.intelligence.entities ?? []).some((e) => e.name.toLowerCase().includes(lowerSearch));
    const matchesFilter =
      filter === 'All' ||
      filter === s.source ||
      (filter === 'Verified' && s.intelligence.fcf_ingestion_meta?.answer_status === 'current-supported') ||
      (filter === 'Conflict' && s.intelligence.fcf_ingestion_meta?.answer_status === 'conflict-detected');
    return matchesSearch && matchesFilter;
  });

  const verifiedCount = studiesWithScores.filter(
    (s) => s.intelligence.fcf_ingestion_meta?.answer_status === 'current-supported',
  ).length;

  const conflictCount = studiesWithScores.filter(
    (s) => s.intelligence.fcf_ingestion_meta?.answer_status === 'conflict-detected',
  ).length;

  return (
    <div className="flex-1 h-full overflow-hidden flex flex-col tevel-page-wrap relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(120,184,255,0.12),transparent_28%),radial-gradient(circle_at_top_left,_rgba(83,242,194,0.10),transparent_24%)] pointer-events-none" />

      {/* Header */}
      <div className="px-8 pt-8 pb-6 z-20 shrink-0">
        <div className="tevel-card tevel-aurora p-8 mb-6">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="tevel-kicker mb-3 flex items-center gap-2">
                <span className="tevel-dot" />
                Intelligence Mission Feed
              </div>
              <h1 className="text-4xl xl:text-5xl font-bold text-white tevel-title tracking-tight mb-4 flex items-center gap-3">
                <LayoutGrid className="text-[#53f2c2]" size={30} />
                Mission Feed
              </h1>
              <p className="text-slate-300 text-base max-w-2xl leading-relaxed">
                תעדוף תיקים, זיהוי קישורים בין חקירות, ומצב ראייתי מלא לכל מסמך שהועלה — הכל בזמן אמת.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="tevel-badge px-3 py-1.5 text-[11px] font-mono">FCF-R3 evidence gating</span>
                <span className="tevel-badge px-3 py-1.5 text-[11px] font-mono">Cross-case triage</span>
                <span className="tevel-badge px-3 py-1.5 text-[11px] font-mono">Network-first prioritization</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 xl:w-[420px]">
              <div className="tevel-stat p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-mono">Active studies</div>
                <div className="mt-2 text-3xl font-bold text-white">{filteredStudies.length}</div>
              </div>
              <div className="tevel-stat p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-mono">High priority</div>
                <div className="mt-2 text-3xl font-bold text-amber-300">
                  {studiesWithScores.filter((s) => s.synapse.score > 75).length}
                </div>
              </div>
              <div className="tevel-stat p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-mono">FCF verified</div>
                <div className="mt-2 text-3xl font-bold text-emerald-300">{verifiedCount}</div>
              </div>
              <div className="tevel-stat p-4">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-mono">Conflicts</div>
                <div className="mt-2 text-3xl font-bold text-amber-400">{conflictCount}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="tevel-glass rounded-[24px] p-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between shadow-2xl max-w-6xl transition-all">
          <div className="relative flex-1 group">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#05DF9C] transition-colors"
              size={18}
            />
            <input
              type="text"
              placeholder="Search entities, keywords, locations..."
              className="w-full tevel-input rounded-2xl pl-12 pr-4 py-3.5 text-sm placeholder-slate-600 font-mono transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 bg-black/20 rounded-2xl p-1.5 border border-slate-800/80 flex-wrap">
            {['All', 'Verified', 'Conflict', 'Telegram', 'News', 'Signal'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-300 hover:scale-[1.02] active:scale-95 ${
                  filter === f
                    ? 'bg-white/[0.08] text-white shadow-lg shadow-black/50 border border-white/[0.08]'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={onNewAnalysis}
            className="group tevel-button-primary pl-5 pr-6 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 text-xs uppercase tracking-wider"
          >
            <Plus size={16} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" />
            New Intake
          </button>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-10 scrollbar-thin scrollbar-thumb-slate-800 hover:scrollbar-thumb-slate-600 transition-colors">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 pb-20">
          {filteredStudies.map((study) => {
            const srcCfg = getSourceConfig(study.source);
            const synapse = study.synapse;
            const priority = getPriorityConfig(synapse.score);
            const fcf = study.intelligence.fcf_ingestion_meta;
            const fcfCfg = getFcfStatusConfig(fcf?.answer_status);
            const FcfIcon = fcfCfg.icon;
            const topEntities = (study.intelligence.entities ?? []).slice(0, 4);
            const keyText = getKeyText(study);
            const SrcIcon = srcCfg.icon;

            return (
              <div
                key={study.id}
                onClick={() => onSelectStudy(study)}
                className="group relative tevel-card cursor-pointer transition-all duration-300 hover:-translate-y-1.5 flex flex-col hover:border-[#53f2c2]/30"
              >
                {/* Priority accent line */}
                <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-[inherit] ${priority.border} opacity-60 group-hover:opacity-100 transition-opacity`} />

                {/* Hover glow */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-[inherit]" />

                <div className="p-5 flex flex-col gap-3 relative z-10">

                  {/* Row 1: source + delete + priority */}
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-semibold ${srcCfg.bg} ${srcCfg.border} ${srcCfg.color}`}>
                      <SrcIcon size={12} />
                      {study.source}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold font-mono uppercase tracking-widest px-2 py-1 rounded border ${priority.color} border-current/30`}>
                        {priority.label}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteStudy(study); }}
                        className="tevel-delete-button"
                        aria-label={`Delete ${study.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Row 2: title */}
                  <h3
                    dir="auto"
                    className="text-sm font-bold text-slate-100 leading-snug group-hover:text-[#05DF9C] transition-colors line-clamp-2"
                  >
                    {study.title}
                  </h3>

                  {/* Row 3: key statement/insight text */}
                  <p
                    dir="auto"
                    className="text-[11px] text-slate-400 leading-relaxed line-clamp-3 group-hover:text-slate-300 transition-colors italic"
                  >
                    {keyText}
                  </p>

                  {/* Row 4: entity chips */}
                  {topEntities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {topEntities.map((entity, i) => {
                        const style = getEntityStyle(entity.type);
                        return (
                          <span
                            key={i}
                            className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${style.bg} ${style.text} max-w-[120px]`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                            <span className="truncate">{entity.name}</span>
                          </span>
                        );
                      })}
                      {(study.intelligence.entities?.length ?? 0) > 4 && (
                        <span className="text-[10px] font-mono text-slate-600 px-1 flex items-center">
                          +{(study.intelligence.entities?.length ?? 0) - 4}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Row 5: FCF evidence status */}
                  <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${fcfCfg.cls}`}>
                    <div className="flex items-center gap-1.5">
                      <FcfIcon size={11} />
                      <span className="text-[9px] font-bold font-mono uppercase tracking-widest">
                        {fcfCfg.label}
                      </span>
                    </div>
                    {fcf ? (
                      <span className="text-[9px] font-mono opacity-70">
                        {fcf.selected_count}/{fcf.candidate_count} atoms
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono opacity-50">no sweep</span>
                    )}
                  </div>

                  {/* Row 6: Triage recommendation */}
                  <div className="bg-black/40 border border-slate-800 rounded-lg px-3 py-2 group-hover:border-slate-700 transition-colors">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[9px] font-mono text-slate-600 uppercase tracking-wider flex items-center gap-1">
                        <Sparkles size={8} /> Triage
                      </span>
                      {synapse.linkedEntities.length > 0 && (
                        <span className="text-[9px] font-mono text-sky-400 flex items-center gap-1">
                          <GitMerge size={9} /> {synapse.linkedEntities.length} link{synapse.linkedEntities.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-medium text-slate-400 group-hover:text-slate-200 transition-colors line-clamp-2">
                      {synapse.reason}
                    </p>
                  </div>

                  {/* Row 7: footer metadata */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={10} />
                      {study.date}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelectStudy(study); }}
                      className="flex items-center gap-1 text-slate-500 hover:text-[#05DF9C] transition-colors"
                    >
                      Analyze <ChevronRight size={11} />
                    </button>
                  </div>

                  {/* Row 8: tags */}
                  {study.tags.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {study.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] font-mono bg-black/40 text-slate-600 px-2 py-0.5 rounded border border-slate-800 group-hover:border-[#05DF9C]/20 group-hover:text-slate-500 transition-colors whitespace-nowrap"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FeedDashboard;
