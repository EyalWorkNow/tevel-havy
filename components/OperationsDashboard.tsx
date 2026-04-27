
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Task, TeamMember, TeamMessage, StudyItem, Entity, GraphData } from '../types';
import GraphView from './GraphView'; 
import { 
    Layout, 
    CheckCircle2, 
    Clock, 
    AlertTriangle, 
    MoreHorizontal, 
    Plus, 
    Search,
    MessageSquare, 
    Send,
    Users,
    ChevronRight,
    GripVertical,
    Briefcase,
    Activity,
    Shield,
    Radio,
    Terminal,
    Hash,
    MoreVertical as MoreVerticalIcon,
    Globe,
    Filter,
    Map,
    Calendar,
    Target,
    BarChart3,
    X,
    UserPlus,
    Lock,
    SidebarClose,
    SidebarOpen,
    Eye,
    FileText,
    MonitorPlay,
    Share2,
    ChevronLeft,
    LayoutList,
    Columns,
    CalendarRange,
    ArrowUpRight,
    ArrowDownRight,
    Timer,
    ScreenShare,
    Mic,
    Pin,
    AlertOctagon,
    Cpu,
    Wifi,
    Power,
    Zap,
    Crosshair,
    FileQuestion,
    HelpCircle,
    Lightbulb,
    Check,
    ThumbsUp,
    ThumbsDown,
    ChevronsRight,
    Megaphone,
    ArrowRight
} from 'lucide-react';

const INITIAL_TEAM: TeamMember[] = [
    { id: 'u1', name: 'Alex R.', role: 'Senior Analyst', status: 'online', avatar: 'https://i.pravatar.cc/150?u=a' },
    { id: 'u2', name: 'Sarah K.', role: 'Cyber Intel', status: 'busy', avatar: 'https://i.pravatar.cc/150?u=b' },
    { id: 'u3', name: 'David L.', role: 'HUMINT', status: 'offline', avatar: 'https://i.pravatar.cc/150?u=c' },
    { id: 'u4', name: 'Mike T.', role: 'GEOINT', status: 'online', avatar: 'https://i.pravatar.cc/150?u=d' },
    { id: 'u5', name: 'Elena V.', role: 'SIGINT', status: 'online', avatar: 'https://i.pravatar.cc/150?u=e' },
];

const INITIAL_TASKS: Task[] = [
    { id: 't1', title: 'Verify Houthi Radar Signals', priority: 'CRITICAL', status: 'PROCESSING', assigneeId: 'u1', tag: 'SIGINT', dueDate: 'Today', relatedStudyId: '3' },
    { id: 't2', title: 'Geolocate Unit 102 Convoy', priority: 'HIGH', status: 'COLLECTION', assigneeId: 'u4', tag: 'GEOINT', dueDate: 'Tomorrow', relatedStudyId: '5' },
    { id: 't3', title: 'Translate Jenin Interrogations', priority: 'MEDIUM', status: 'REVIEW', assigneeId: 'u3', tag: 'HUMINT', dueDate: '14/07', relatedStudyId: '5' },
    { id: 't4', title: 'BlackShadow Malware Analysis', priority: 'HIGH', status: 'FINISHED', assigneeId: 'u2', tag: 'CYBER', dueDate: 'Yesterday', relatedStudyId: '1' },
    { id: 't5', title: 'Update Syrian Order of Battle', priority: 'LOW', status: 'COLLECTION', assigneeId: 'u1', tag: 'OSINT', relatedStudyId: '2' },
    { id: 't6', title: 'Monitor Red Sea Channel 16', priority: 'MEDIUM', status: 'COLLECTION', assigneeId: 'u5', tag: 'SIGINT', dueDate: 'Now', relatedStudyId: '3' }
];

const INITIAL_MESSAGES: TeamMessage[] = [
    { id: 'm1', senderId: 'u2', content: 'Uploaded the server logs from Ziv Hospital. Need a second pair of eyes.', timestamp: new Date(Date.now() - 1000 * 60 * 60) },
    { id: 'm2', senderId: 'u1', content: 'On it. Check the "Processing" column.', timestamp: new Date(Date.now() - 1000 * 60 * 55) },
    { id: 'm3', senderId: 'system', content: 'New Intelligence Alert: Red Sea Sector', timestamp: new Date(Date.now() - 1000 * 60 * 30), isSystem: true },
    { id: 'm4', senderId: 'u4', content: 'Satellite pass over Al-Bukamal confirmed movement.', timestamp: new Date(Date.now() - 1000 * 60 * 5) },
];

const INTEL_TICKER = [
    "INTERCEPT: High-freq transmission detected in Sector 4...",
    "GEOINT: New construction observed at Imam Ali Base...",
    "CYBER: MuddyWater C2 server active in Beirut...",
    "HUMINT: Courier crossing Allenby Bridge detained...",
];

interface OperationsDashboardProps {
    studies?: StudyItem[];
}

const OperationsDashboard: React.FC<OperationsDashboardProps> = ({ studies = [] }) => {
    const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
    const [team, setTeam] = useState<TeamMember[]>(INITIAL_TEAM);
    const [messages, setMessages] = useState<TeamMessage[]>(INITIAL_MESSAGES);
    
    // UI State
    const [chatInput, setChatInput] = useState('');
    const [sidebarTab, setSidebarTab] = useState<'chat' | 'team'>('chat');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
    const [viewMode, setViewMode] = useState<'board' | 'list' | 'timeline'>('board');

    // --- DRAG & DROP STATE ---
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

    // --- MIRROR SESSION STATE ---
    const [mirrorSession, setMirrorSession] = useState<{ member: TeamMember, task: Task } | null>(null);
    const [mirrorActivityLog, setMirrorActivityLog] = useState<string[]>([]);
    const [currentFocusEntity, setCurrentFocusEntity] = useState<Entity | null>(null);
    const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);

    // --- FILTER STATE ---
    const [filterPriority, setFilterPriority] = useState<string | null>(null);
    const [filterTag, setFilterTag] = useState<string | null>(null);
    const [searchTask, setSearchTask] = useState('');

    const [showNewTaskModal, setShowNewTaskModal] = useState(false);
    
    // New Task Form State
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskTag, setNewTaskTag] = useState('OSINT');
    const [newTaskPriority, setNewTaskPriority] = useState<'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'>('MEDIUM');

    // Ticker State
    const [tickerIndex, setTickerIndex] = useState(0);

    const chatEndRef = useRef<HTMLDivElement>(null);

    // Zulu Time
    const [zuluTime, setZuluTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setZuluTime(new Date()), 1000);
        const ticker = setInterval(() => setTickerIndex(prev => (prev + 1) % INTEL_TICKER.length), 5000);
        return () => { clearInterval(timer); clearInterval(ticker); };
    }, []);

    useEffect(() => {
        if (sidebarTab === 'chat' && isSidebarOpen) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, sidebarTab, isSidebarOpen]);

    // --- MIRROR LOGIC ---
    useEffect(() => {
        let logInterval: any;

        if (mirrorSession) {
            const relatedStudy = studies.find(s => s.id === mirrorSession.task.relatedStudyId);
            const studyEntities = relatedStudy?.intelligence.entities || [];

            setSessionStartTime(new Date());
            setMirrorActivityLog(['Session initiated...']);
            setCurrentFocusEntity(studyEntities[0] || null);

            const actions = [
                "Opened report: ",
                "Ran graph query for: ",
                "Cross-referencing entity: ",
                "Pinned insight about: ",
                "Switched to map view, focusing on: ",
                "Generating context card for: "
            ];
            
            logInterval = setInterval(() => {
                const randomAction = actions[Math.floor(Math.random() * actions.length)];
                const randomEntity = studyEntities[Math.floor(Math.random() * studyEntities.length)];
                if (randomEntity) {
                    setMirrorActivityLog(prev => [`${randomAction}${randomEntity.name}`, ...prev].slice(0, 20));
                }
            }, 3000);
            
            return () => {
                clearInterval(logInterval);
            };
        }
    }, [mirrorSession, studies]);
    
    const priorityMap = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };

    // Called from the user profile - it finds the highest priority task
    const handleOpenMirror = (member: TeamMember) => {
        const memberTasks = tasks.filter(t => t.assigneeId === member.id && t.status !== 'FINISHED');
        const activeTask = memberTasks.sort((a,b) => priorityMap[b.priority] - priorityMap[a.priority])[0] 
            || { id: 'mock', title: 'General Research', priority: 'LOW', status: 'PROCESSING', tag: 'MISC' } as Task;
        setMirrorSession({ member, task: activeTask });
    };

    // Called from clicking a specific task card in any view
    const handleOpenMirrorForTask = (task: Task) => {
        const member = team.find(u => u.id === task.assigneeId);
        if (member) {
            setMirrorSession({ member, task });
        }
    };

    const activeCount = tasks.filter(t => t.status !== 'FINISHED').length;
    const criticalCount = tasks.filter(t => t.priority === 'CRITICAL').length;

    const handleSendMessage = () => {
        if (!chatInput.trim()) return;
        const newMsg: TeamMessage = {
            id: Date.now().toString(),
            senderId: 'u1',
            content: chatInput,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, newMsg]);
        setChatInput('');
    };

    const handleCreateTask = () => {
        if(!newTaskTitle) return;
        const newTask: Task = {
            id: `t${Date.now()}`,
            title: newTaskTitle,
            priority: newTaskPriority,
            tag: newTaskTag,
            status: 'COLLECTION',
            assigneeId: undefined,
            dueDate: 'Pending'
        };
        setTasks(prev => [newTask, ...prev]);
        setShowNewTaskModal(false);
        setNewTaskTitle('');
    };

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStart = (e: React.DragEvent, taskId: string) => {
        setDraggedTaskId(taskId);
        e.dataTransfer.effectAllowed = "move";
        // Ghost image styling is handled by browser, but we track state
    };

    const handleDragOver = (e: React.DragEvent, status: string) => {
        e.preventDefault(); // Necessary to allow dropping
        setDragOverColumn(status);
    };

    const handleDrop = (e: React.DragEvent, status: string) => {
        e.preventDefault();
        setDragOverColumn(null);
        if (draggedTaskId) {
            setTasks(prev => prev.map(t => 
                t.id === draggedTaskId ? { ...t, status: status as any } : t
            ));
            setDraggedTaskId(null);
        }
    };

    const getPriorityStyles = (p: string) => {
        switch(p) {
            case 'CRITICAL': return { border: 'border-rose-500', text: 'text-rose-500', bg: 'bg-rose-500/10', bar: 'bg-rose-500', shadow: 'shadow-rose-500/20' };
            case 'HIGH': return { border: 'border-amber-500', text: 'text-amber-500', bg: 'bg-amber-500/10', bar: 'bg-amber-500', shadow: 'shadow-amber-500/20' };
            case 'MEDIUM': return { border: 'border-sky-500', text: 'text-sky-500', bg: 'bg-sky-500/10', bar: 'bg-sky-500', shadow: 'shadow-sky-500/20' };
            default: return { border: 'border-emerald-500', text: 'text-emerald-500', bg: 'bg-emerald-500/10', bar: 'bg-emerald-500', shadow: 'shadow-emerald-500/20' };
        }
    };

    const SessionTimer = ({ startTime }: { startTime: Date | null }) => {
        const [elapsed, setElapsed] = useState("00:00:00");
        useEffect(() => {
            if (!startTime) return;
            const timer = setInterval(() => {
                const diff = Date.now() - startTime.getTime();
                const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
                const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
                const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
                setElapsed(`${h}:${m}:${s}`);
            }, 1000);
            return () => clearInterval(timer);
        }, [startTime]);
        return <>{elapsed}</>;
    };

    // --- MEMOIZED DATA FOR MIRROR SESSION ---
    const mirroredStudyData = useMemo(() => {
        if (!mirrorSession) return null;
        
        const relatedStudy = studies.find(s => s.id === mirrorSession.task.relatedStudyId);
        if (!relatedStudy) return null;

        return {
            study: relatedStudy,
            pinnedItems: relatedStudy.intelligence.insights || [],
            intelGaps: relatedStudy.intelligence.tactical_assessment?.gaps || [],
            miniGraphData: relatedStudy.intelligence.graph || { nodes: [], edges: [] }
        };
    }, [mirrorSession, studies]);

    // --- RENDERERS ---

    const renderBoardColumn = (title: string, status: 'COLLECTION' | 'PROCESSING' | 'REVIEW' | 'FINISHED', icon: React.ReactNode) => {
        const columnTasks = tasks.filter(t => {
            const matchesStatus = t.status === status;
            const matchesPriority = !filterPriority || t.priority === filterPriority;
            const matchesTag = !filterTag || t.tag === filterTag;
            const matchesSearch = !searchTask || t.title.toLowerCase().includes(searchTask.toLowerCase());
            return matchesStatus && matchesPriority && matchesTag && matchesSearch;
        });

        const isOver = dragOverColumn === status;

        return (
            <div 
                className={`flex flex-col flex-1 min-w-[300px] max-w-[360px] bg-[#121212]/50 border rounded-2xl shadow-lg transition-all duration-300 ${isOver ? 'border-[#05DF9C] bg-[#05DF9C]/5 scale-[1.01]' : 'border-slate-800/50'}`}
                onDragOver={(e) => handleDragOver(e, status)}
                onDrop={(e) => handleDrop(e, status)}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-800/50 shrink-0">
                    <h3 className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${isOver ? 'text-[#05DF9C]' : 'text-slate-300'}`}>{icon} {title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold ${isOver ? 'bg-[#05DF9C] text-black' : 'bg-slate-900 text-slate-500'}`}>{columnTasks.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
                    {columnTasks.map(task => {
                        const assignee = team.find(u => u.id === task.assigneeId);
                        const priorityStyles = getPriorityStyles(task.priority);
                        const isDragging = draggedTaskId === task.id;

                        return (
                            <div 
                                key={task.id} 
                                draggable
                                onDragStart={(e) => handleDragStart(e, task.id)}
                                onClick={() => task.assigneeId && handleOpenMirrorForTask(task)}
                                className={`
                                    bg-[#181818] rounded-xl p-4 shadow-md group relative transition-all border
                                    ${isDragging ? 'opacity-50 scale-95 border-dashed border-white' : 'hover:-translate-y-1 hover:shadow-xl hover:border-slate-600 border-transparent'}
                                    ${priorityStyles.border}
                                `}
                            >
                                {/* Priority Stripe */}
                                <div className={`absolute top-4 bottom-4 left-0 w-1 rounded-r ${priorityStyles.bar}`}></div>

                                <div className="pl-3">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex gap-2 mb-1">
                                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${priorityStyles.bg} ${priorityStyles.text}`}>{task.priority}</span>
                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">{task.tag}</span>
                                        </div>
                                        {/* Hover Actions */}
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 absolute top-2 right-2 bg-[#181818] p-1 rounded shadow-lg">
                                            <button className="p-1 hover:text-[#05DF9C] hover:bg-slate-800 rounded" title="Mirror"><Eye size={12} /></button>
                                            <button className="p-1 hover:text-sky-400 hover:bg-slate-800 rounded" title="Message"><MessageSquare size={12} /></button>
                                        </div>
                                    </div>

                                    <p className="text-sm font-bold text-slate-200 leading-snug mb-3 group-hover:text-white transition-colors">{task.title}</p>
                                    
                                    <div className="flex justify-between items-center pt-3 border-t border-slate-800/50">
                                        {assignee ? (
                                            <div className="flex items-center gap-2">
                                                <img src={assignee.avatar} alt={assignee.name} className="w-5 h-5 rounded-md border border-slate-600 grayscale group-hover:grayscale-0 transition-all" />
                                                <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-300">{assignee.name}</span>
                                            </div>
                                        ) : (
                                            <button className="text-[10px] font-bold text-slate-500 hover:text-[#05DF9C] flex items-center gap-1 bg-slate-800/50 px-2 py-1 rounded hover:bg-slate-800"><UserPlus size={10} /> ASSIGN</button>
                                        )}
                                        <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
                                            <Clock size={10} /> {task.dueDate}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {columnTasks.length === 0 && (
                        <div className="h-24 border-2 border-dashed border-slate-800 rounded-xl flex items-center justify-center text-slate-600 text-xs font-bold uppercase tracking-widest">
                            No Active Ops
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderListView = () => {
        const listTasks = tasks.filter(t => !filterPriority || t.priority === filterPriority);

        return (
            <div className="bg-[#121212]/50 border border-slate-800/50 rounded-2xl overflow-hidden h-full flex flex-col">
                <table className="w-full text-left table-fixed">
                    <thead className="border-b border-slate-800/50 bg-black/30">
                        <tr>
                            <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-1/2">Task / Directive</th>
                            <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Assignee</th>
                            <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Priority</th>
                            <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Due Date</th>
                        </tr>
                    </thead>
                </table>
                <div className="overflow-y-auto flex-1">
                    <table className="w-full text-left table-fixed">
                        <tbody className="divide-y divide-slate-800/50">
                            {listTasks.map(task => {
                                const assignee = team.find(u => u.id === task.assigneeId);
                                const priorityStyles = getPriorityStyles(task.priority);
                                return (
                                    <tr 
                                        key={task.id} 
                                        onClick={() => task.assigneeId && handleOpenMirrorForTask(task)} 
                                        className={`transition-colors ${task.assigneeId ? 'hover:bg-slate-800/30 cursor-pointer' : ''}`}
                                    >
                                        <td className="p-4 w-1/2">
                                            <p className="text-sm font-bold text-slate-100 truncate">{task.title}</p>
                                            <span className="text-xs text-slate-500 font-mono">{task.tag}</span>
                                        </td>
                                        <td className="p-4">
                                            {assignee ? (
                                                <div className="flex items-center gap-2">
                                                    <img src={assignee.avatar} alt={assignee.name} className="w-6 h-6 rounded-full" />
                                                    <span className="text-xs text-slate-300">{assignee.name}</span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-600 italic">Unassigned</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${task.status === 'FINISHED' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-700 text-slate-300'}`}>{task.status}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`text-xs font-bold flex items-center gap-1.5 ${priorityStyles.text}`}>
                                                <div className={`w-1.5 h-1.5 rounded-full ${priorityStyles.bar}`}></div>
                                                {task.priority}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs font-mono text-slate-400">{task.dueDate || 'N/A'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };
    
    const renderTimelineView = () => {
        const timelineTasks = tasks
            .filter(t => !filterPriority || t.priority === filterPriority)
            .reduce((acc, task) => {
                const date = task.dueDate || 'Unscheduled';
                if (!acc[date]) {
                    acc[date] = [];
                }
                acc[date].push(task);
                return acc;
            }, {} as Record<string, Task[]>);

        const sortedDates = Object.keys(timelineTasks).sort((a, b) => {
            const order = ['Now', 'Today', 'Tomorrow'];
            const aIndex = order.indexOf(a);
            const bIndex = order.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            if (a === 'Unscheduled') return 1;
            if (b === 'Unscheduled') return -1;
            return a.localeCompare(b);
        });

        return (
            <div className="h-full overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-slate-700">
                <div className="relative border-l-2 border-slate-700/50 ml-6 pl-10 space-y-12">
                    {sortedDates.map(date => (
                        <div key={date} className="relative">
                            <div className="absolute -left-[49px] top-1 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center border-4 border-[#181818] z-10">
                                <CalendarRange size={12} className="text-slate-300" />
                            </div>
                            <h3 className="text-lg font-bold text-white mb-4">{date}</h3>
                            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                                {timelineTasks[date].map(task => {
                                    const assignee = team.find(u => u.id === task.assigneeId);
                                    const priorityStyles = getPriorityStyles(task.priority);
                                    return (
                                        <div 
                                            key={task.id} 
                                            onClick={() => task.assigneeId && handleOpenMirrorForTask(task)}
                                            className={`bg-[#121212] rounded-xl border-t-4 p-4 shadow-lg transition-all hover:-translate-y-1 ${priorityStyles.bar} ${task.assigneeId ? 'cursor-pointer' : 'cursor-default'}`}
                                        >
                                            <p className="text-sm font-bold text-slate-100">{task.title}</p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${priorityStyles.bg} ${priorityStyles.border} ${priorityStyles.text}`}>{task.priority}</span>
                                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{task.status}</span>
                                            </div>
                                            {assignee && (
                                                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800">
                                                    <img src={assignee.avatar} alt={assignee.name} className="w-6 h-6 rounded-full" />
                                                    <span className="text-xs text-slate-400">{assignee.name}</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderMirrorSession = () => {
        if (!mirrorSession || !mirroredStudyData) return null;
        const { member, task } = mirrorSession;
        const { pinnedItems, intelGaps, miniGraphData, study: relatedStudy } = mirroredStudyData;
        
        return (
            <div className="absolute inset-0 z-[100] bg-[#09090b] flex flex-col animate-fadeIn overflow-hidden">
                {/* TACTICAL HEADER */}
                <div className="h-16 bg-[#121212] border-b border-slate-800 flex justify-between items-center px-6 shadow-md relative z-20 shrink-0">
                    <div className="flex items-center gap-4">
                         <div className="flex items-center gap-3">
                             <div className="relative">
                                 <div className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shadow-[0_0_8px_#f43f5e]"></div>
                             </div>
                             <span className="font-mono text-sm font-bold text-rose-500 uppercase tracking-[0.1em]">LIVE OVERVIEW</span>
                         </div>
                         <div className="h-6 w-px bg-slate-800"></div>
                         <div className="text-xs text-slate-400 font-mono">
                             Monitoring: <span className="text-white font-bold">{member.name}</span>
                         </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="bg-slate-900 border border-slate-700 rounded px-4 py-1.5 flex flex-col items-end">
                            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Current Directive</span>
                            <span className="text-xs font-bold text-white truncate max-w-[200px]">{task.title}</span>
                        </div>
                        <button 
                            onClick={() => setMirrorSession(null)} 
                            className="bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white border border-slate-700 hover:border-rose-500 px-4 py-2 rounded-lg font-bold uppercase text-xs tracking-wider flex items-center gap-2 transition-all"
                        >
                            <Power size={14} /> End Session
                        </button>
                    </div>
                </div>

                {/* MAIN 3-COLUMN VIEWPORT */}
                <div className="flex-1 flex overflow-hidden p-6 gap-6">
                    {/* LEFT: MISSION & TELEMETRY */}
                    <div className="w-[350px] flex flex-col gap-6 shrink-0">
                         {/* Analyst & Mission */}
                         <div className="bg-[#121212] border border-slate-800 rounded-xl p-4 space-y-4">
                            <div className="flex items-center gap-3">
                                <img src={member.avatar} alt={member.name} className="w-12 h-12 rounded-lg border-2 border-slate-600 grayscale" />
                                <div>
                                    <div className="font-bold text-white leading-tight">{member.name}</div>
                                    <div className="text-xs text-[#05DF9C] font-mono">{member.role}</div>
                                </div>
                            </div>
                            <div className="bg-slate-900/50 p-3 rounded border border-slate-700">
                                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">Primary Directive</div>
                                <div className="text-xs text-white">{task.title}</div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center border-t border-slate-800 pt-3">
                                <div>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold">SESSION TIME</div>
                                    <div className="text-sm font-mono text-amber-400 font-bold"><SessionTimer startTime={sessionStartTime} /></div>
                                </div>
                                <div>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold">ENTITIES</div>
                                    <div className="text-sm font-mono text-sky-400 font-bold">{relatedStudy?.intelligence.entities.length || 0}</div>
                                </div>
                                <div>
                                    <div className="text-[9px] text-slate-500 uppercase font-bold">PINS</div>
                                    <div className="text-sm font-mono text-emerald-400 font-bold">{pinnedItems.length}</div>
                                </div>
                            </div>
                         </div>
                         {/* Activity Log */}
                         <div className="flex-1 bg-[#121212] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                             <div className="h-10 flex items-center px-4 border-b border-slate-800 shrink-0">
                                 <h3 className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-2"><Activity size={12}/> Activity Stream</h3>
                             </div>
                             <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
                                 {mirrorActivityLog.map((log, i) => (
                                     <div key={i} className={`flex gap-2 items-start ${i === 0 ? 'text-slate-200' : 'text-slate-500'} transition-colors`}>
                                         <span className="opacity-50">{new Date(Date.now() - i * 3000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                         <span>{log}</span>
                                     </div>
                                 ))}
                             </div>
                         </div>
                    </div>
                    
                    {/* CENTER: LIVE CANVAS */}
                    <div className="flex-1 flex flex-col gap-6">
                         {/* Current Focus */}
                         <div className="bg-[#121212] border border-[#05DF9C]/30 rounded-xl p-4 shadow-[0_0_30px_rgba(5,223,156,0.1)]">
                             <h3 className="text-[10px] text-[#05DF9C] font-bold uppercase tracking-widest mb-2 flex items-center gap-2"><Crosshair size={12} className="animate-pulse" /> Current Focus</h3>
                             <div className="text-2xl font-bold text-white transition-all duration-500">{currentFocusEntity?.name || "Initializing..."}</div>
                             <div className="text-xs text-slate-400 font-mono transition-all duration-500">{currentFocusEntity?.type || "..."}</div>
                         </div>
                         {/* Mini Graph */}
                         <div className="flex-1 bg-[#121212] rounded-xl border border-slate-800 overflow-hidden relative">
                             <GraphView 
                                data={miniGraphData} 
                                onNodeClick={() => {}} 
                                selectedNodeId={currentFocusEntity?.name || undefined}
                             />
                              <div className="absolute bottom-2 left-2 text-[8px] font-mono text-slate-600 bg-black/50 px-2 py-1 rounded">ANALYST WORKSPACE VIEW</div>
                         </div>
                         <div className="bg-[#121212] border border-slate-800 rounded-xl p-4 h-24">
                            <h3 className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1 flex items-center gap-2"><FileText size={12}/> Analyst Drafting...</h3>
                            <p className="text-xs text-slate-500 italic font-mono">"Cross-referencing financial data with Farm 7 manifest indicates..."<span className="animate-pulse">|</span></p>
                         </div>
                    </div>

                    {/* RIGHT: INTEL & INTERVENTION */}
                    <div className="w-[400px] flex flex-col gap-6 shrink-0">
                         {/* Pinned Evidence */}
                         <div className="flex-1 bg-[#121212] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                             <div className="h-10 flex items-center justify-between px-4 border-b border-slate-800">
                                 <h3 className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-2"><Pin size={12}/> Pinned Evidence</h3>
                                 <span className="bg-slate-800 text-[9px] px-1.5 rounded text-slate-400 font-mono">{pinnedItems.length}</span>
                             </div>
                             <div className="flex-1 p-3 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                                 {pinnedItems.map((item, i) => (
                                     <div key={i} className="bg-slate-900/50 p-2 rounded border border-slate-800">
                                         <div className="text-[9px] font-bold text-slate-500 uppercase mb-1">{item.type}</div>
                                         <div className="text-xs text-slate-300 line-clamp-2">"{item.text}"</div>
                                     </div>
                                 ))}
                             </div>
                         </div>
                         {/* Identified Gaps */}
                         <div className="bg-[#121212] border border-amber-500/30 rounded-xl flex flex-col overflow-hidden h-48">
                            <div className="h-10 flex items-center px-4 border-b border-amber-500/30">
                                <h3 className="text-[10px] text-amber-400 font-bold uppercase tracking-widest flex items-center gap-2"><FileQuestion size={12}/> Identified Gaps</h3>
                            </div>
                             <div className="flex-1 p-3 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                                {intelGaps.map((gap, i) => (
                                    <div key={i} className="text-xs text-amber-300/80 flex items-start gap-2">
                                        <HelpCircle size={12} className="shrink-0 mt-0.5" />
                                        <span>{gap}</span>
                                    </div>
                                ))}
                             </div>
                         </div>
                         {/* Intervention */}
                         <div className="bg-[#121212] border border-slate-800 rounded-xl p-4">
                             <h3 className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-3">Leadership Intervention</h3>
                             <div className="grid grid-cols-2 gap-2">
                                <button className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded font-bold text-[10px] uppercase transition-all flex items-center justify-center gap-2 border border-slate-700">
                                    <MessageSquare size={14} /> Send Note
                                </button>
                                <button className="bg-[#05DF9C]/10 hover:bg-[#05DF9C] text-[#05DF9C] hover:text-black border border-[#05DF9C]/30 py-2.5 rounded font-bold text-[10px] uppercase transition-all flex items-center justify-center gap-2">
                                    <Lightbulb size={14} /> Suggest Lead
                                </button>
                             </div>
                         </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderUserProfile = (member: TeamMember) => {
        const memberTasks = tasks.filter(t => t.assigneeId === member.id);
        const activeTasks = memberTasks.filter(t => t.status !== 'FINISHED');
        const reviewQueue = memberTasks.filter(t => t.status === 'REVIEW');
        const primaryDirective = activeTasks.sort((a,b) => (priorityMap[a.priority] > priorityMap[b.priority] ? -1 : 1))[0];
        
        const avgPriorityScore = activeTasks.length > 0 ? activeTasks.reduce((acc, t) => acc + priorityMap[t.priority], 0) / activeTasks.length : 0;
        const avgPriorityText = avgPriorityScore > 3.5 ? 'CRITICAL' : avgPriorityScore > 2.5 ? 'HIGH' : avgPriorityScore > 1.5 ? 'MEDIUM' : 'LOW';

        return (
            <div className="flex-1 bg-[#121212] p-0 flex flex-col h-full overflow-hidden animate-fadeIn">
                {/* Header */}
                <div className="p-6 bg-[#121212] border-b border-slate-800 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-[#05DF9C]"></div>
                    <button onClick={() => setSelectedMember(null)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"><X size={16} /></button>
                    <div className="flex items-center gap-4 relative z-10">
                        <div className="relative">
                            <img src={member.avatar} alt={member.name} className="w-16 h-16 rounded-xl border-2 border-slate-700 object-cover" />
                            <div className={`absolute -bottom-1 -right-1 w-4 h-4 border-2 border-[#121212] rounded-full ${member.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`}></div>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">{member.name}</h2>
                            <p className="text-xs font-mono text-[#05DF9C] uppercase tracking-wider">{member.role}</p>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Performance Cockpit */}
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg"><div className="text-2xl font-bold text-white">{activeTasks.length}</div><div className="text-[9px] font-mono text-slate-500 uppercase">Active Tasks</div></div>
                        <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg"><div className={`text-2xl font-bold ${getPriorityStyles(avgPriorityText).text}`}>{avgPriorityText}</div><div className="text-[9px] font-mono text-slate-500 uppercase">Avg. Priority</div></div>
                        <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg"><div className="text-2xl font-bold text-white">12</div><div className="text-[9px] font-mono text-slate-500 uppercase">7-Day T/P</div></div>
                    </div>
                    
                    {/* Live Workspace */}
                    <div className="bg-[#121212] border border-slate-800 rounded-xl p-4">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><MonitorPlay size={14} /> Live Status</h3>
                        {primaryDirective ? (
                            <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 space-y-2">
                                <div className="flex justify-between items-center"><span className="text-xs font-bold text-white">{primaryDirective.title}</span><span className={`text-[8px] font-bold px-2 py-0.5 rounded ${getPriorityStyles(primaryDirective.priority).bg} ${getPriorityStyles(primaryDirective.priority).text}`}>{primaryDirective.priority}</span></div>
                                <p className="text-[10px] text-slate-400 font-mono">Recent Activity: Cross-referencing entity: Project Zephyr...</p>
                            </div>
                        ) : (
                            <div className="text-xs text-slate-600 italic p-3">Analyst is idle.</div>
                        )}
                         <button onClick={() => handleOpenMirror(member)} className="w-full mt-3 bg-[#05DF9C]/10 backdrop-blur border border-[#05DF9C]/50 text-[#05DF9C] px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#05DF9C] hover:text-black transition-all"><Eye size={14} /> Mirror Session</button>
                    </div>

                    {/* Review Queue */}
                    {reviewQueue.length > 0 && (
                        <div>
                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Check size={14} /> Review Queue</h3>
                             {reviewQueue.map(task => (
                                 <div key={task.id} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 mb-2 flex justify-between items-center">
                                     <span className="text-xs font-bold text-white truncate pr-4">{task.title}</span>
                                     <div className="flex gap-2">
                                         <button className="p-1.5 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white rounded transition-colors"><ThumbsDown size={14} /></button>
                                         <button className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded transition-colors"><ThumbsUp size={14} /></button>
                                     </div>
                                 </div>
                             ))}
                        </div>
                    )}

                    {/* Inject Intel */}
                    <div>
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><ChevronsRight size={14} /> Inject Intel</h3>
                        <div className="bg-[#121212] border border-slate-800 rounded-xl p-4 space-y-3">
                             <textarea placeholder="Type priority note or lead..." className="w-full h-20 bg-slate-900/50 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-[#05DF9C] focus:outline-none resize-none font-mono"></textarea>
                             <button className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider transition-colors">Inject as Priority Task</button>
                        </div>
                    </div>
                </div>

                 {/* Footer Action */}
                 <div className="p-4 border-t border-slate-800 bg-[#121212]">
                     <button onClick={() => setShowNewTaskModal(true)} className="w-full bg-[#05DF9C] hover:bg-white text-black py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2">
                         <Plus size={14} /> Assign New Task
                     </button>
                 </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-[#181818] text-slate-200 overflow-hidden font-sans relative">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
            {mirrorSession && renderMirrorSession()}
            {showNewTaskModal && <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center animate-fadeIn"><div className="bg-[#121212] border border-slate-700 w-[500px] rounded-2xl shadow-2xl overflow-hidden"><div className="bg-[#121212] p-4 border-b border-slate-800 flex justify-between items-center"><h3 className="text-white font-bold flex items-center gap-2"><Plus size={16} className="text-[#05DF9C]" /> NEW INTEL REQUIREMENT</h3><button onClick={() => setShowNewTaskModal(false)} className="text-slate-500 hover:text-white"><X size={16} /></button></div><div className="p-6 space-y-4"><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Mission / Task Title</label><input autoFocus className="w-full bg-[#181818] border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-[#05DF9C] focus:outline-none" placeholder="e.g., Satellite surveillance of Sector 4..." value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} /></div><div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Priority</label><select className="w-full bg-[#181818] border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-[#05DF9C] focus:outline-none" value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value as any)}><option value="CRITICAL">CRITICAL</option><option value="HIGH">HIGH</option><option value="MEDIUM">MEDIUM</option><option value="LOW">LOW</option></select></div><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Discipline</label><select className="w-full bg-[#181818] border border-slate-700 rounded-lg p-3 text-sm text-white focus:border-[#05DF9C] focus:outline-none" value={newTaskTag} onChange={(e) => setNewTaskTag(e.target.value)}><option value="OSINT">OSINT</option><option value="SIGINT">SIGINT</option><option value="HUMINT">HUMINT</option><option value="GEOINT">GEOINT</option><option value="CYBER">CYBER</option></select></div></div><div><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Clearance Level</label><div className="flex gap-2">{['CONFIDENTIAL', 'SECRET', 'TOP SECRET'].map(l => <button key={l} className="flex-1 py-2 text-[10px] border border-slate-700 rounded hover:bg-slate-800 transition-colors font-bold uppercase">{l}</button>)}</div></div><button onClick={handleCreateTask} disabled={!newTaskTitle} className="w-full bg-[#05DF9C] hover:bg-white text-black font-bold py-3 rounded-xl uppercase tracking-widest transition-all mt-4 disabled:opacity-50">Initiate Task</button></div></div></div>}
            
            <div className="flex-1 flex flex-col min-h-0 relative z-10">
                
                {/* --- OPS CENTER HEADER (Redesigned) --- */}
                <div className="flex flex-col border-b border-slate-800 bg-[#121212]/90 backdrop-blur-md relative z-20 shadow-2xl">
                    <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800/50">
                         <div className="flex items-center gap-6">
                             <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                                 <Terminal className="text-[#05DF9C]" size={24} /> 
                                 <span className="tracking-wide">OPS CENTER</span>
                             </h1>
                             <div className="h-6 w-px bg-slate-800"></div>
                             
                             {/* Interactive Ticker */}
                             <div className="hidden lg:flex items-center gap-2 bg-black/40 border border-[#05DF9C]/20 rounded px-3 py-1.5 cursor-pointer hover:border-[#05DF9C]/50 transition-colors" title="Click to investigate alert">
                                 <Activity size={14} className="text-[#05DF9C] animate-pulse shrink-0" />
                                 <div className="overflow-hidden w-[400px] h-5 relative">
                                     <span className="text-xs font-mono text-[#05DF9C] whitespace-nowrap absolute animate-marquee">{INTEL_TICKER[tickerIndex]}</span>
                                 </div>
                             </div>
                         </div>
                         
                         <div className="flex items-center gap-6">
                             <div className="text-right">
                                 <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">ZULU TIME</div>
                                 <div className="text-lg font-mono text-white font-bold leading-none">{zuluTime.toISOString().split('T')[1].split('.')[0]}Z</div>
                             </div>
                             {/* Team Stack */}
                             <div className="flex -space-x-2">
                                 {team.slice(0,3).map(u => (
                                     <img key={u.id} src={u.avatar} alt={u.name} className="w-8 h-8 rounded-lg border-2 border-[#121212] grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-all z-0 hover:z-10 cursor-pointer" title={u.name} />
                                 ))}
                                 <div className="w-8 h-8 rounded-lg border-2 border-[#121212] bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 z-10 cursor-pointer">+{team.length-3}</div>
                             </div>
                         </div>
                    </div>

                    {/* --- TACTICAL TOOLBAR (Filters & Controls) --- */}
                    <div className="h-14 flex items-center justify-between px-6 bg-[#121212]/50">
                        <div className="flex items-center gap-4">
                            {/* View Switcher */}
                            <div className="flex bg-[#181818] p-1 rounded-lg border border-slate-800">
                                <button onClick={() => setViewMode('board')} className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-all ${viewMode === 'board' ? 'bg-[#05DF9C]/10 text-[#05DF9C] shadow-sm' : 'text-slate-500 hover:text-slate-300'}`} title="Kanban Board"><Columns size={14} /> Board</button>
                                <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-all ${viewMode === 'list' ? 'bg-[#05DF9C]/10 text-[#05DF9C] shadow-sm' : 'text-slate-500 hover:text-slate-300'}`} title="List View"><LayoutList size={14} /> Manifest</button>
                                <button onClick={() => setViewMode('timeline')} className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-all ${viewMode === 'timeline' ? 'bg-[#05DF9C]/10 text-[#05DF9C] shadow-sm' : 'text-slate-500 hover:text-slate-300'}`} title="Timeline"><Timer size={14} /> Chronos</button>
                            </div>
                            
                            <div className="h-6 w-px bg-slate-800"></div>
                            
                            {/* Smart Filters */}
                            <div className="flex items-center gap-2">
                                <div className="relative group">
                                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[#05DF9C]" />
                                    <input 
                                        type="text" 
                                        placeholder="Filter tasks..." 
                                        value={searchTask}
                                        onChange={(e) => setSearchTask(e.target.value)}
                                        className="bg-[#181818] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#05DF9C] transition-all w-40"
                                    />
                                </div>
                                {['CRITICAL', 'HIGH'].map(p => (
                                    <button 
                                        key={p} 
                                        onClick={() => setFilterPriority(filterPriority === p ? null : p)} 
                                        className={`text-[9px] font-bold px-3 py-1.5 rounded border transition-all ${filterPriority === p ? 'bg-slate-700 text-white border-slate-500 shadow-inner' : 'bg-[#181818] text-slate-500 border-slate-800 hover:border-slate-600'}`}
                                    >
                                        {p}
                                    </button>
                                ))}
                                {(filterPriority || searchTask) && (
                                    <button onClick={() => { setFilterPriority(null); setSearchTask(''); }} className="ml-1 p-1.5 rounded-full bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all"><X size={12} /></button>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-6">
                            <div className="flex gap-4 border-r border-slate-800 pr-4">
                                <div className="flex flex-col items-end">
                                    <span className="text-[9px] text-slate-500 font-bold uppercase">Active Ops</span>
                                    <span className="text-sm font-mono text-[#05DF9C] font-bold">{activeCount}</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[9px] text-slate-500 font-bold uppercase">Critical</span>
                                    <span className="text-sm font-mono text-rose-500 font-bold animate-pulse">{criticalCount}</span>
                                </div>
                            </div>
                            <button onClick={() => setShowNewTaskModal(true)} className="bg-[#05DF9C] hover:bg-white text-black pl-3 pr-4 py-2 rounded-lg shadow-[0_0_15px_rgba(5,223,156,0.2)] transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                                <Plus size={16} strokeWidth={3} /> New Mission
                            </button>
                            {!isSidebarOpen && (
                                <button onClick={() => setIsSidebarOpen(true)} className="border-l border-slate-700 pl-4 text-slate-400 hover:text-white transition-colors">
                                    <SidebarOpen size={20} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* --- MAIN CONTENT AREA --- */}
                <div className="flex-1 flex overflow-hidden min-w-0">
                    <div className="flex-1 overflow-x-auto p-8 bg-[#181818] scrollbar-thin scrollbar-thumb-slate-800">
                        {viewMode === 'board' && (
                            <div className="flex h-full gap-6 min-w-max">
                                {renderBoardColumn('Collection Phase', 'COLLECTION', <Search size={14} />)}
                                {renderBoardColumn('Processing Phase', 'PROCESSING', <Activity size={14} className="text-amber-400"/>)}
                                {renderBoardColumn('Analysis & Review', 'REVIEW', <CheckCircle2 size={14} className="text-sky-400"/>)}
                                {renderBoardColumn('Mission Complete', 'FINISHED', <Briefcase size={14} className="text-emerald-400"/>)}
                            </div>
                        )}
                        {viewMode === 'list' && renderListView()}
                        {viewMode === 'timeline' && renderTimelineView()}
                    </div>

                    {/* --- COLLAPSIBLE SIDEBAR (CHAT & TEAM) --- */}
                    <div className={`border-l border-slate-800 bg-[#121212]/95 backdrop-blur-md flex flex-col shrink-0 relative shadow-2xl z-20 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-[400px] translate-x-0' : 'w-0 translate-x-full opacity-0'}`}>
                        <div className="flex border-b border-slate-800 bg-black/40 pr-12 relative">
                            <button onClick={() => { setSidebarTab('chat'); setSelectedMember(null); }} className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all relative ${sidebarTab === 'chat' && !selectedMember ? 'text-white bg-[#121212]' : 'text-slate-600 hover:text-slate-400'}`}>
                                <MessageSquare size={14} className={sidebarTab === 'chat' && !selectedMember ? 'text-[#05DF9C]' : ''} /> COMMS
                                {sidebarTab === 'chat' && !selectedMember && <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#05DF9C] shadow-[0_0_10px_#05DF9C]"></div>}
                            </button>
                            <button onClick={() => { setSidebarTab('team'); setSelectedMember(null); }} className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all relative ${(sidebarTab === 'team' || selectedMember) ? 'text-white bg-[#121212]' : 'text-slate-600 hover:text-slate-400'}`}>
                                <Users size={14} className={(sidebarTab === 'team' || selectedMember) ? 'text-[#05DF9C]' : ''} /> UNIT
                                {(sidebarTab === 'team' || selectedMember) && <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#05DF9C] shadow-[0_0_10px_#05DF9C]"></div>}
                            </button>
                            <button onClick={() => setIsSidebarOpen(false)} className="absolute right-0 top-0 bottom-0 w-12 flex items-center justify-center text-slate-600 hover:text-white hover:bg-rose-950/30 transition-colors" title="Close Sidebar">
                                <SidebarClose size={16} />
                            </button>
                        </div>
                        
                        {selectedMember ? renderUserProfile(selectedMember) : (
                            <>
                                {sidebarTab === 'chat' && (
                                    <div className="flex-1 flex flex-col min-h-0 bg-[#121212]">
                                        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
                                            {messages.map(msg => {
                                                if (msg.isSystem) {
                                                    return (
                                                        <div key={msg.id} className="flex flex-col items-center justify-center my-4 animate-fadeIn">
                                                            <div className="flex items-center gap-2 text-[#05DF9C] mb-1">
                                                                <AlertTriangle size={12} className="animate-pulse" />
                                                                <span className="text-[10px] font-bold font-mono uppercase tracking-widest">System Alert</span>
                                                            </div>
                                                            <div className="text-[10px] font-mono text-[#05DF9C] bg-[#05DF9C]/5 px-4 py-2 rounded border border-[#05DF9C]/30 w-full text-center">
                                                                {msg.content}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                const isMe = msg.senderId === 'u1';
                                                const sender = team.find(u => u.id === msg.senderId);
                                                return (
                                                    <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''} group animate-fadeIn`}>
                                                        {!isMe && (
                                                            <div className="relative shrink-0 mt-1">
                                                                <img src={sender?.avatar} alt={sender?.name} className="w-8 h-8 rounded-lg object-cover border border-slate-700 opacity-80" />
                                                                <div className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 border-2 border-[#121212] rounded-full shadow-sm ${sender?.status === 'online' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                                                            </div>
                                                        )}
                                                        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%]`}>
                                                            <div className="flex items-baseline gap-2 mb-1">
                                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{sender?.name}</span>
                                                                <span className="text-[9px] text-slate-700 font-mono">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                            </div>
                                                            <div className={`p-3 text-xs leading-relaxed border shadow-md ${isMe ? 'bg-[#05DF9C]/10 text-[#05DF9C] border-[#05DF9C]/30 rounded-t-xl rounded-bl-xl' : 'bg-[#121212] text-slate-300 border-slate-700/50 rounded-t-xl rounded-br-xl'}`}>
                                                                {msg.content}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            <div ref={chatEndRef}></div>
                                        </div>
                                        <div className="p-4 border-t border-slate-800 bg-[#121212]">
                                            <div className="flex gap-2 bg-[#181818] border border-slate-700 rounded-xl p-2 focus-within:border-[#05DF9C]/50 focus-within:shadow-[0_0_15px_rgba(5,223,156,0.1)] transition-all">
                                                <input 
                                                    type="text" 
                                                    className="flex-1 bg-transparent border-none px-2 text-xs text-white focus:outline-none placeholder-slate-600 font-mono"
                                                    placeholder="Type encrypted message..."
                                                    value={chatInput}
                                                    onChange={(e) => setChatInput(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                                />
                                                <button onClick={handleSendMessage} disabled={!chatInput.trim()} className="bg-[#05DF9C] disabled:opacity-50 hover:bg-white text-black p-2.5 rounded-lg transition-colors shadow-[0_0_10px_rgba(5,223,156,0.2)]">
                                                    <Send size={14} strokeWidth={2.5}/>
                                                </button>
                                            </div>
                                            <div className="flex justify-between items-center mt-2 px-1">
                                                <div className="text-[9px] text-emerald-500 font-mono flex items-center gap-1 uppercase"><Lock size={10} /> AES-256 Encrypted</div>
                                                <div className="text-[9px] text-slate-600 font-mono">CHANNEL: OPS-ALPHA</div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {sidebarTab === 'team' && (
                                    <div className="flex-1 bg-[#121212] p-6 space-y-6 overflow-y-auto">
                                        <div className="bg-[#121212] rounded-xl border border-slate-800 p-1 relative overflow-hidden group">
                                            <div className="aspect-video bg-slate-900 rounded-lg relative overflow-hidden">
                                                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
                                                <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_10px_#10b981] animate-pulse"></div>
                                                <div className="absolute top-1/3 left-1/4 w-2 h-2 bg-sky-500 rounded-full shadow-[0_0_10px_#0ea5e9]"></div>
                                                <div className="absolute bottom-1/4 right-1/3 w-2 h-2 bg-amber-500 rounded-full shadow-[0_0_10px_#f59e0b]"></div>
                                                <div className="absolute top-2 left-2 text-[8px] font-mono text-slate-500">Global Asset Tracker</div>
                                            </div>
                                            <div className="absolute bottom-3 right-3 text-[#05DF9C] text-[10px] font-bold flex items-center gap-1 bg-black/50 px-2 py-1 rounded backdrop-blur border border-[#05DF9C]/30">
                                                <Globe size={10} className="animate-spin-slow" /> LIVE
                                            </div>
                                        </div>
                                        
                                        <div className="space-y-4">
                                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Users size={12} /> Active Personnel</h3>
                                            {team.map(member => (
                                                <div key={member.id} onClick={() => setSelectedMember(member)} className="flex items-center justify-between bg-[#121212] p-3 rounded-xl border border-slate-800 hover:border-[#05DF9C]/50 hover:bg-slate-800/80 cursor-pointer transition-all group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="relative">
                                                            <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-lg object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all" />
                                                            <div className={`absolute -bottom-1 -right-1 w-3 h-3 border-2 border-[#121212] rounded-full ${member.status === 'online' ? 'bg-emerald-500' : member.status === 'busy' ? 'bg-amber-500' : 'bg-slate-500'}`}></div>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-bold text-slate-200 group-hover:text-white">{member.name}</div>
                                                            <div className="text-[10px] text-slate-500 font-mono uppercase">{member.role}</div>
                                                        </div>
                                                    </div>
                                                    <button className="p-2 rounded-lg text-slate-500 hover:text-[#05DF9C] transition-colors"><ChevronRight size={16} /></button>
                                                </div>
                                            ))}
                                        </div>
                                        
                                        <div className="pt-4 border-t border-slate-800">
                                            <button className="w-full bg-slate-800/50 hover:bg-rose-900/30 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/50 p-3 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all group">
                                                <Megaphone size={14} className="group-hover:animate-pulse" /> Broadcast Alert
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OperationsDashboard;
