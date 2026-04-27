import React, { useEffect, useMemo, useState } from 'react';
import { IntelligencePackage, StudyItem } from '../types';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    BrainCircuit,
    BriefcaseBusiness,
    CheckCircle2,
    ChevronRight,
    Clock3,
    Crosshair,
    Database,
    Eye,
    Globe,
    LayoutDashboard,
    Link2,
    Radar,
    ScanSearch,
    ShieldAlert,
    Sparkles,
    Target,
    TimerReset,
    TrendingUp,
    Workflow,
} from 'lucide-react';

interface ManagementDashboardProps {
    studies: StudyItem[];
    onNavigate: (view: 'feed' | 'operations' | 'ingest') => void;
}

type DerivedTask = {
    id: string;
    text: string;
    urgency: string;
    status: string;
    sourceTitle: string;
    sourceId: string;
};

type DerivedQuestion = {
    id: string;
    text: string;
    priority: string;
    sourceTitle: string;
    sourceId: string;
};

type EntitySignal = {
    name: string;
    type: string;
    count: number;
    salience: number;
    reliabilityImpact: number;
    sources: string[];
};

type LinkedCase = {
    id: string;
    title: string;
    status: StudyItem['status'];
    reliability: number;
    dominantEntities: string[];
    openTasks: number;
    openQuestions: number;
    linkDensity: number;
    source: StudyItem['source'];
    date: string;
};

const STATUS_TONE: Record<StudyItem['status'], string> = {
    Approved: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    Review: 'text-amber-200 border-amber-500/30 bg-amber-500/10',
    Processing: 'text-sky-200 border-sky-500/30 bg-sky-500/10',
};

const formatPct = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const getReliability = (pkg: IntelligencePackage) => pkg.reliability || 0;

const getEntityWeight = (salience?: number, evidenceCount?: number, chunkCount?: number) =>
    (salience || 0.35) * 0.6 + Math.min((evidenceCount || 0) / 6, 1) * 0.25 + Math.min((chunkCount || 0) / 8, 1) * 0.15;

const LiveClock = () => {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    return (
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right shadow-[0_12px_40px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-end gap-2 text-[10px] uppercase tracking-[0.28em] text-slate-400">
                <TimerReset size={11} />
                Cycle Time
            </div>
            <div className="mt-1 font-mono text-base text-white">{now.toLocaleTimeString()}</div>
            <div className="mt-1 text-[11px] text-slate-500">{now.toLocaleDateString()}</div>
        </div>
    );
};

const SignalBar = ({ value, tone }: { value: number; tone: string }) => (
    <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(8, Math.min(100, value))}%` }} />
    </div>
);

const ManagementDashboard: React.FC<ManagementDashboardProps> = ({ studies, onNavigate }) => {
    const analytics = useMemo(() => {
        const portfolio = studies.map((study): LinkedCase => {
            const pkg = study.intelligence;
            const openTasks = (pkg.intel_tasks || []).filter((task) => task.status !== 'CLOSED').length;
            const openQuestions = (pkg.intel_questions || []).length;
            const dominantEntities = (pkg.entities || [])
                .slice()
                .sort((a, b) => (b.salience || 0) - (a.salience || 0))
                .slice(0, 4)
                .map((entity) => entity.name);

            return {
                id: study.id,
                title: study.title,
                status: study.status,
                reliability: getReliability(pkg),
                dominantEntities,
                openTasks,
                openQuestions,
                linkDensity:
                    pkg.entities.length > 0
                        ? pkg.relations.length / Math.max(pkg.entities.length, 1)
                        : 0,
                source: study.source,
                date: study.date,
            };
        });

        const pipeline = {
            ingest: studies.filter((study) => study.source === 'Signal' || study.source === 'Telegram').length,
            processing: studies.filter((study) => study.status === 'Processing').length,
            review: studies.filter((study) => study.status === 'Review').length,
            approved: studies.filter((study) => study.status === 'Approved').length,
        };

        const totalEntities = studies.reduce((sum, study) => sum + (study.intelligence.entities?.length || 0), 0);
        const totalRelations = studies.reduce((sum, study) => sum + (study.intelligence.relations?.length || 0), 0);
        const totalTasks = studies.reduce(
            (sum, study) => sum + (study.intelligence.intel_tasks || []).filter((task) => task.status !== 'CLOSED').length,
            0
        );
        const totalQuestions = studies.reduce((sum, study) => sum + (study.intelligence.intel_questions || []).length, 0);
        const avgReliability =
            studies.length > 0
                ? studies.reduce((sum, study) => sum + getReliability(study.intelligence), 0) / studies.length
                : 0;

        const entityMap = new Map<string, EntitySignal>();
        const questionStack: DerivedQuestion[] = [];
        const taskStack: DerivedTask[] = [];
        const gapSignals: Array<{ text: string; sourceId: string; sourceTitle: string; reliability: number }> = [];
        const insightSignals: Array<{ text: string; importance: number; sourceTitle: string }> = [];
        const domainScores: Record<string, number> = {
            Network: 0,
            Ops: 0,
            Finance: 0,
            Geo: 0,
            Assets: 0,
            Influence: 0,
        };

        studies.forEach((study) => {
            const pkg = study.intelligence;
            const reliability = getReliability(pkg);

            (pkg.entities || []).forEach((entity) => {
                const existing = entityMap.get(entity.name) || {
                    name: entity.name,
                    type: entity.type || 'UNKNOWN',
                    count: 0,
                    salience: 0,
                    reliabilityImpact: 0,
                    sources: [],
                };

                existing.count += 1;
                existing.salience += getEntityWeight(entity.salience, entity.evidence?.length, entity.source_chunks?.length);
                existing.reliabilityImpact += reliability;
                if (!existing.sources.includes(study.title)) existing.sources.push(study.title);
                entityMap.set(entity.name, existing);

                const type = (entity.type || '').toUpperCase();
                if (type.includes('ORG')) domainScores.Influence += 1.2;
                else if (type.includes('PERSON')) domainScores.Ops += 1;
                else if (type.includes('LOCATION')) domainScores.Geo += 1;
                else if (type.includes('ASSET')) domainScores.Assets += 1;
                else if (type.includes('EVENT')) domainScores.Network += 0.8;
                else domainScores.Finance += 0.5;
            });

            (pkg.relations || []).forEach((relation) => {
                const relationType = relation.type.toUpperCase();
                if (relationType.includes('FUND') || relationType.includes('OWN')) domainScores.Finance += 1.4;
                else if (relationType.includes('MOVE') || relationType.includes('OPERAT')) domainScores.Ops += 1.2;
                else if (relationType.includes('COMMUNICAT') || relationType.includes('ASSOCIAT')) domainScores.Network += 1.1;
                else domainScores.Influence += 0.6;
            });

            (pkg.tactical_assessment?.gaps || []).forEach((gap) => {
                if (!gap?.trim()) return;
                gapSignals.push({
                    text: gap.trim(),
                    sourceId: study.id,
                    sourceTitle: study.title,
                    reliability,
                });
            });

            (pkg.intel_questions || []).forEach((question) => {
                questionStack.push({
                    id: question.question_id,
                    text: question.question_text,
                    priority: question.priority,
                    sourceTitle: study.title,
                    sourceId: study.id,
                });
            });

            (pkg.intel_tasks || []).forEach((task) => {
                if (task.status === 'CLOSED') return;
                taskStack.push({
                    id: task.task_id,
                    text: task.task_text,
                    urgency: task.urgency,
                    status: task.status,
                    sourceTitle: study.title,
                    sourceId: study.id,
                });
            });

            (pkg.insights || []).forEach((insight) => {
                insightSignals.push({
                    text: insight.text,
                    importance: insight.importance || 0.5,
                    sourceTitle: study.title,
                });
            });
        });

        const topEntities = Array.from(entityMap.values())
            .sort(
                (a, b) =>
                    b.salience + b.reliabilityImpact * 0.3 - (a.salience + a.reliabilityImpact * 0.3)
            )
            .slice(0, 6);

        const linkedCases = portfolio
            .slice()
            .sort(
                (a, b) =>
                    b.openTasks +
                    b.openQuestions +
                    b.linkDensity +
                    b.reliability * 2 -
                    (a.openTasks + a.openQuestions + a.linkDensity + a.reliability * 2)
            )
            .slice(0, 5);

        const priorityGaps = gapSignals
            .slice()
            .sort((a, b) => b.reliability - a.reliability)
            .slice(0, 5);

        const activeTasks = taskStack
            .slice()
            .sort((a, b) => {
                const priority = { IMMEDIATE: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as Record<string, number>;
                return (priority[b.urgency] || 0) - (priority[a.urgency] || 0);
            })
            .slice(0, 6);

        const activeQuestions = questionStack
            .slice()
            .sort((a, b) => {
                const priority = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as Record<string, number>;
                return (priority[b.priority] || 0) - (priority[a.priority] || 0);
            })
            .slice(0, 5);

        const topInsights = insightSignals
            .slice()
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 4);

        const hottestCase = linkedCases[0] || null;
        const clearanceRate =
            studies.length > 0 ? pipeline.approved / Math.max(studies.length, 1) : 0;
        const threatState =
            totalTasks >= 6 || totalQuestions >= 6 || avgReliability >= 0.82
                ? 'High Attention'
                : totalTasks >= 3 || totalQuestions >= 3
                ? 'Elevated'
                : 'Stable';

        const velocity = studies
            .slice()
            .sort((a, b) => {
                const [da, ma, ya] = a.date.split('/').map(Number);
                const [db, mb, yb] = b.date.split('/').map(Number);
                return new Date(yb, (mb || 1) - 1, db || 1).getTime() - new Date(ya, (ma || 1) - 1, da || 1).getTime();
            })
            .slice(0, 8);

        return {
            pipeline,
            totalStudies: studies.length,
            totalEntities,
            totalRelations,
            totalTasks,
            totalQuestions,
            avgReliability,
            clearanceRate,
            topEntities,
            linkedCases,
            priorityGaps,
            activeTasks,
            activeQuestions,
            topInsights,
            domainScores,
            hottestCase,
            threatState,
            velocity,
        };
    }, [studies]);

    const threatTone =
        analytics.threatState === 'High Attention'
            ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
            : analytics.threatState === 'Elevated'
            ? 'text-amber-200 border-amber-500/30 bg-amber-500/10'
            : 'text-emerald-200 border-emerald-500/30 bg-emerald-500/10';

    return (
        <div className="relative h-full tevel-app-bg flex-1 overflow-y-auto px-4 py-5 md:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
                <section className="tevel-card overflow-hidden rounded-[30px] border border-white/10">
                    <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.45fr_0.9fr] lg:px-8 lg:py-8">
                        <div className="relative">
                            <div className="absolute -left-20 top-0 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(83,242,194,0.22),transparent_65%)] blur-2xl" />
                            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(120,184,255,0.22),transparent_60%)] blur-2xl" />
                            <div className="relative">
                                <div className="tevel-kicker mb-3 flex items-center gap-2">
                                    <LayoutDashboard size={12} />
                                    Command Deck
                                </div>
                                <div className="max-w-3xl">
                                    <h1 className="tevel-title text-4xl font-black tracking-[-0.06em] text-white md:text-5xl">
                                        Operational command surface for cross-case intelligence.
                                    </h1>
                                    <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
                                        This deck now prioritizes what the platform actually knows: high-salience entities,
                                        graph density, open collection gaps, analyst tasks, active questions and the cases
                                        with the strongest cross-link pressure.
                                    </p>
                                </div>

                                <div className="mt-6 flex flex-wrap items-center gap-3">
                                    <button
                                        onClick={() => onNavigate('operations')}
                                        className="tevel-button-primary rounded-2xl px-5 py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5"
                                    >
                                        Open Action Queue
                                    </button>
                                    <button
                                        onClick={() => onNavigate('feed')}
                                        className="tevel-button-secondary rounded-2xl px-5 py-3 text-sm font-semibold transition-colors hover:border-white/20"
                                    >
                                        Review Linked Cases
                                    </button>
                                    <div className={`tevel-badge rounded-full px-4 py-2 text-xs font-semibold ${threatTone}`}>
                                        {analytics.threatState}
                                    </div>
                                </div>

                                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                                    <div className="tevel-stat rounded-2xl px-4 py-4">
                                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                            <Database size={12} />
                                            Portfolio
                                        </div>
                                        <div className="mt-2 text-3xl font-black tracking-[-0.05em] text-white">
                                            {analytics.totalStudies}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">active intelligence packages</div>
                                    </div>
                                    <div className="tevel-stat rounded-2xl px-4 py-4">
                                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                            <Target size={12} />
                                            Entity Mesh
                                        </div>
                                        <div className="mt-2 text-3xl font-black tracking-[-0.05em] text-white">
                                            {analytics.totalEntities}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">{analytics.totalRelations} graph links in memory</div>
                                    </div>
                                    <div className="tevel-stat rounded-2xl px-4 py-4">
                                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                                            <ShieldAlert size={12} />
                                            Reliability
                                        </div>
                                        <div className="mt-2 text-3xl font-black tracking-[-0.05em] text-white">
                                            {formatPct(analytics.avgReliability)}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">portfolio confidence baseline</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            <LiveClock />
                            <div className="tevel-glass-strong rounded-[28px] p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="tevel-kicker">Mission Pulse</div>
                                        <div className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                            {analytics.hottestCase?.title || 'No active pressure cluster'}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-cyan-300">
                                        <Radar size={22} />
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Tasks</div>
                                        <div className="mt-1 text-2xl font-bold text-white">{analytics.totalTasks}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Questions</div>
                                        <div className="mt-1 text-2xl font-bold text-white">{analytics.totalQuestions}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Clearance</div>
                                        <div className="mt-1 text-2xl font-bold text-white">{formatPct(analytics.clearanceRate)}</div>
                                    </div>
                                </div>
                                {analytics.hottestCase && (
                                    <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-slate-200">
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold">Why it leads</span>
                                            <span className="text-xs text-cyan-200">
                                                {analytics.hottestCase.dominantEntities.slice(0, 2).join(' • ')}
                                            </span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-300">
                                            <div>{analytics.hottestCase.openTasks} open tasks</div>
                                            <div>{analytics.hottestCase.openQuestions} open questions</div>
                                            <div>{analytics.hottestCase.linkDensity.toFixed(1)} link density</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-4">
                    <div className="tevel-glass rounded-[24px] p-5">
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Ingest Queue</div>
                            <ScanSearch size={16} className="text-cyan-300" />
                        </div>
                        <div className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">{analytics.pipeline.ingest}</div>
                        <p className="mt-1 text-xs text-slate-500">signal or telegram entries waiting for conversion</p>
                    </div>
                    <div className="tevel-glass rounded-[24px] p-5">
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Processing</div>
                            <Workflow size={16} className="text-amber-300" />
                        </div>
                        <div className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">{analytics.pipeline.processing}</div>
                        <p className="mt-1 text-xs text-slate-500">packages still being normalized or fused</p>
                    </div>
                    <div className="tevel-glass rounded-[24px] p-5">
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Review Friction</div>
                            <AlertTriangle size={16} className="text-rose-300" />
                        </div>
                        <div className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">{analytics.pipeline.review}</div>
                        <p className="mt-1 text-xs text-slate-500">items that need analyst judgment now</p>
                    </div>
                    <div className="tevel-glass rounded-[24px] p-5">
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Approved</div>
                            <CheckCircle2 size={16} className="text-emerald-300" />
                        </div>
                        <div className="mt-3 text-3xl font-black tracking-[-0.05em] text-white">{analytics.pipeline.approved}</div>
                        <p className="mt-1 text-xs text-slate-500">packages cleared into operational memory</p>
                    </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
                    <div className="grid gap-6">
                        <div className="tevel-card rounded-[28px] p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="tevel-kicker">Cross-Case Pressure Map</div>
                                    <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                        Highest-value linked cases
                                    </h2>
                                </div>
                                <button
                                    onClick={() => onNavigate('feed')}
                                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
                                >
                                    Open Feed
                                </button>
                            </div>

                            <div className="mt-5 grid gap-3">
                                {analytics.linkedCases.map((study, index) => (
                                    <div
                                        key={study.id}
                                        className="group rounded-[22px] border border-white/10 bg-black/20 p-4 transition-transform hover:-translate-y-0.5 hover:border-cyan-400/30"
                                    >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-sm font-black text-cyan-200">
                                                        {index + 1}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h3 className="truncate text-base font-bold text-white">{study.title}</h3>
                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                            <span>{study.source}</span>
                                                            <span>•</span>
                                                            <span>{study.date}</span>
                                                            <span className={`rounded-full border px-2 py-0.5 ${STATUS_TONE[study.status]}`}>
                                                                {study.status}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="mt-4 flex flex-wrap gap-2">
                                                    {study.dominantEntities.map((entity) => (
                                                        <span
                                                            key={entity}
                                                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"
                                                        >
                                                            {entity}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="grid min-w-[240px] grid-cols-3 gap-2 text-center">
                                                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                                                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Tasks</div>
                                                    <div className="mt-1 text-xl font-bold text-white">{study.openTasks}</div>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                                                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Questions</div>
                                                    <div className="mt-1 text-xl font-bold text-white">{study.openQuestions}</div>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                                                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Links</div>
                                                    <div className="mt-1 text-xl font-bold text-white">{study.linkDensity.toFixed(1)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                            <div className="tevel-card rounded-[28px] p-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="tevel-kicker">Priority Entities</div>
                                        <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                            Graph-dominant targets
                                        </h2>
                                    </div>
                                    <Crosshair size={18} className="text-rose-300" />
                                </div>
                                <div className="mt-5 grid gap-3">
                                    {analytics.topEntities.map((entity) => (
                                        <div key={entity.name} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="truncate text-base font-bold text-white">{entity.name}</div>
                                                    <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                                                        {entity.type}
                                                    </div>
                                                </div>
                                                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                                                    {entity.count} cases
                                                </div>
                                            </div>
                                            <div className="mt-4 grid gap-2">
                                                <SignalBar value={entity.salience * 55} tone="bg-gradient-to-r from-cyan-400 to-sky-300" />
                                                <div className="flex justify-between text-[11px] text-slate-500">
                                                    <span>salience and recurrence</span>
                                                    <span>{entity.sources.length} linked packages</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="tevel-card rounded-[28px] p-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="tevel-kicker">Collection Gaps</div>
                                        <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                            What the system still needs
                                        </h2>
                                    </div>
                                    <Eye size={18} className="text-amber-300" />
                                </div>
                                <div className="mt-5 grid gap-3">
                                    {analytics.priorityGaps.map((gap, index) => (
                                        <button
                                            key={`${gap.sourceId}-${index}`}
                                            onClick={() => onNavigate('operations')}
                                            className="rounded-[22px] border border-white/10 bg-black/20 p-4 text-left transition-colors hover:border-amber-400/30"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="line-clamp-2 text-sm font-semibold text-white">{gap.text}</div>
                                                    <div className="mt-2 text-xs text-slate-500">{gap.sourceTitle}</div>
                                                </div>
                                                <ChevronRight size={16} className="mt-1 shrink-0 text-amber-200" />
                                            </div>
                                        </button>
                                    ))}
                                    {analytics.priorityGaps.length === 0 && (
                                        <div className="rounded-[22px] border border-emerald-500/20 bg-emerald-500/10 p-5 text-sm text-emerald-100">
                                            No major collection gaps are surfaced in the current portfolio.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-6">
                        <div className="tevel-card rounded-[28px] p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="tevel-kicker">Reasoning Domains</div>
                                    <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                        Analytical load by domain
                                    </h2>
                                </div>
                                <Globe size={18} className="text-cyan-300" />
                            </div>
                            <div className="mt-5 grid gap-3">
                                {Object.entries(analytics.domainScores)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([name, value]) => (
                                        <div key={name} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="font-semibold text-white">{name}</span>
                                                <span className="text-slate-400">{value.toFixed(1)}</span>
                                            </div>
                                            <div className="mt-3">
                                                <SignalBar value={(value / Math.max(...Object.values(analytics.domainScores), 1)) * 100} tone="bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-300" />
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        <div className="tevel-card rounded-[28px] p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="tevel-kicker">Action Queue</div>
                                    <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                        Open analyst tasks
                                    </h2>
                                </div>
                                <BriefcaseBusiness size={18} className="text-emerald-300" />
                            </div>
                            <div className="mt-5 grid gap-3">
                                {analytics.activeTasks.map((task) => (
                                    <button
                                        key={task.id}
                                        onClick={() => onNavigate('operations')}
                                        className="rounded-[22px] border border-white/10 bg-black/20 p-4 text-left transition-colors hover:border-emerald-400/30"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="line-clamp-2 text-sm font-semibold text-white">{task.text}</div>
                                                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                                                    <span>{task.sourceTitle}</span>
                                                    <span>•</span>
                                                    <span>{task.urgency}</span>
                                                </div>
                                            </div>
                                            <ArrowRight size={15} className="mt-1 shrink-0 text-emerald-200" />
                                        </div>
                                    </button>
                                ))}
                                {analytics.activeTasks.length === 0 && (
                                    <div className="rounded-[22px] border border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                                        No open analyst tasks are currently attached to the active portfolio.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                    <div className="tevel-card rounded-[28px] p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="tevel-kicker">Intelligence Questions</div>
                                <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                    Priority analyst asks
                                </h2>
                            </div>
                            <BrainCircuit size={18} className="text-violet-300" />
                        </div>
                        <div className="mt-5 grid gap-3">
                            {analytics.activeQuestions.map((question) => (
                                <button
                                    key={question.id}
                                    onClick={() => onNavigate('operations')}
                                    className="rounded-[22px] border border-white/10 bg-black/20 p-4 text-left transition-colors hover:border-violet-400/30"
                                >
                                    <div className="text-sm font-semibold text-white">{question.text}</div>
                                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                                        <span>{question.sourceTitle}</span>
                                        <span>•</span>
                                        <span>{question.priority}</span>
                                    </div>
                                </button>
                            ))}
                            {analytics.activeQuestions.length === 0 && (
                                <div className="rounded-[22px] border border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                                    No explicit intelligence questions are attached yet.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="tevel-card rounded-[28px] p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="tevel-kicker">Insight Stream</div>
                                <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                    Highest-signal findings
                                </h2>
                            </div>
                            <Sparkles size={18} className="text-cyan-300" />
                        </div>
                        <div className="mt-5 grid gap-4">
                            {analytics.topInsights.map((insight, index) => (
                                <div key={`${insight.sourceTitle}-${index}`} className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                                            <Link2 size={15} />
                                        </div>
                                        <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{insight.sourceTitle}</div>
                                    </div>
                                    <div className="mt-3 text-sm leading-7 text-slate-200">{insight.text}</div>
                                    <div className="mt-4">
                                        <SignalBar value={insight.importance * 100} tone="bg-gradient-to-r from-cyan-400 to-emerald-300" />
                                    </div>
                                </div>
                            ))}
                            {analytics.topInsights.length === 0 && (
                                <div className="rounded-[22px] border border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                                    No high-signal findings are available yet.
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <section className="tevel-card rounded-[28px] p-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div>
                            <div className="tevel-kicker">Recent Portfolio Movement</div>
                            <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                                Recent case arrivals and momentum
                            </h2>
                        </div>
                        <button
                            onClick={() => onNavigate('ingest')}
                            className="tevel-button-secondary inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
                        >
                            <TrendingUp size={15} />
                            Open Intake
                        </button>
                    </div>
                    <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {analytics.velocity.map((study) => (
                            <div key={study.id} className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center justify-between">
                                    <div className={`rounded-full border px-2 py-1 text-[11px] ${STATUS_TONE[study.status]}`}>
                                        {study.status}
                                    </div>
                                    <div className="text-xs text-slate-500">{study.date}</div>
                                </div>
                                <div className="mt-4 line-clamp-2 text-sm font-semibold text-white">{study.title}</div>
                                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                                    <Clock3 size={12} />
                                    {study.source}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-3">
                    <button
                        onClick={() => onNavigate('feed')}
                        className="tevel-glass group rounded-[24px] p-5 text-left transition-transform hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Case Review</div>
                            <ArrowRight size={16} className="text-slate-400 transition-colors group-hover:text-white" />
                        </div>
                        <div className="mt-3 text-lg font-bold text-white">Open investigation feed</div>
                        <div className="mt-1 text-sm text-slate-500">Drill into linked studies, context and source evidence.</div>
                    </button>
                    <button
                        onClick={() => onNavigate('operations')}
                        className="tevel-glass group rounded-[24px] p-5 text-left transition-transform hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Tasking</div>
                            <ArrowRight size={16} className="text-slate-400 transition-colors group-hover:text-white" />
                        </div>
                        <div className="mt-3 text-lg font-bold text-white">Resolve operational bottlenecks</div>
                        <div className="mt-1 text-sm text-slate-500">Move open tasks, collection gaps and review friction into action.</div>
                    </button>
                    <button
                        onClick={() => onNavigate('ingest')}
                        className="tevel-glass group rounded-[24px] p-5 text-left transition-transform hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between">
                            <div className="tevel-kicker">Expansion</div>
                            <ArrowRight size={16} className="text-slate-400 transition-colors group-hover:text-white" />
                        </div>
                        <div className="mt-3 text-lg font-bold text-white">Push new collection into the graph</div>
                        <div className="mt-1 text-sm text-slate-500">Feed the entity mesh with new source material and media.</div>
                    </button>
                </section>
            </div>
        </div>
    );
};

export default ManagementDashboard;
