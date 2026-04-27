
import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth'; // Modular SDK Type
import { 
    User as UserIcon, 
    Shield, 
    Bell, 
    Monitor, 
    Lock, 
    LogOut, 
    Save, 
    Check, 
    ToggleLeft, 
    ToggleRight, 
    CreditCard, 
    Cpu, 
    Globe, 
    Eye, 
    EyeOff, 
    Moon, 
    Sun, 
    Smartphone, 
    Fingerprint, 
    FileText, 
    Activity, 
    Clock, 
    Printer
} from 'lucide-react';

interface SettingsPageProps {
    user: User | null;
    onLogout: () => void;
    onBack: () => void;
}

type Tab = 'profile' | 'security' | 'notifications' | 'system';
type Theme = 'dark' | 'light' | 'system';

export const SettingsPage: React.FC<SettingsPageProps> = ({ user, onLogout, onBack }) => {
    const [activeTab, setActiveTab] = useState<Tab>('profile');
    const [isSaved, setIsSaved] = useState(false);
    
    // --- SYSTEM & THEME STATE ---
    // Initialize theme from localStorage if available
    const [system, setSystem] = useState({
        autoIngest: true,
        classificationDefault: 'SECRET',
        compactMode: false,
        theme: (localStorage.getItem('tevel-theme') as Theme) || 'dark'
    });

    // --- SECURITY / OPSEC STATE ---
    const [security, setSecurity] = useState({
        mfaEnabled: true,
        sessionTimeout: 15, // minutes
        forensicLogging: true,
        biometricReauth: false,
        watermarkExports: true
    });

    // --- NOTIFICATIONS STATE ---
    const [notifications, setNotifications] = useState({
        email: true,
        desktop: true,
        criticalAlerts: true,
        weeklyDigest: false
    });

    // --- THEME EFFECT ENGINE ---
    // This hook listens to changes in system.theme and applies them to the DOM
    useEffect(() => {
        const root = window.document.documentElement;
        
        // 1. Save preference
        localStorage.setItem('tevel-theme', system.theme);

        // 2. Determine effective theme (handle 'system' preference)
        let effectiveTheme = system.theme;
        if (effectiveTheme === 'system') {
            effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }

        // 3. Apply classes
        if (effectiveTheme === 'dark') {
            root.classList.add('dark');
            root.classList.remove('light');
        } else {
            root.classList.add('light');
            root.classList.remove('dark');
        }
    }, [system.theme]);

    const handleSave = () => {
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
    };

    const tabs: { id: Tab, label: string, icon: React.ElementType }[] = [
        { id: 'profile', label: 'Analyst Profile', icon: UserIcon },
        { id: 'security', label: 'Security & OPSEC', icon: Shield },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'system', label: 'System & Appearance', icon: Monitor },
    ];

    return (
        <div className="flex h-full tevel-page-wrap text-slate-900 dark:text-slate-200 font-sans overflow-hidden animate-fadeIn transition-colors duration-300">
            
            {/* SIDEBAR */}
            <div className="w-72 border-r border-slate-200/10 dark:border-slate-800 bg-[rgba(9,17,27,0.66)] backdrop-blur-xl flex flex-col shrink-0 transition-colors duration-300">
                <div className="p-6 border-b border-slate-200/10 dark:border-slate-800">
                    <div className="tevel-kicker mb-2 text-[10px]">Control center</div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight tevel-title">Settings</h2>
                    <p className="text-xs text-slate-500 font-mono mt-1">Platform Configuration</p>
                </div>
                <div className="flex-1 py-4 px-2 space-y-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === tab.id ? 'bg-[#05DF9C]/10 text-[#05DF9C] border border-[#05DF9C]/20 shadow-[0_10px_30px_rgba(83,242,194,0.08)]' : 'text-slate-500 hover:bg-slate-100/5 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white border border-transparent'}`}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                    <button onClick={onLogout} className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider text-rose-500 hover:bg-rose-500/10 transition-colors">
                        <LogOut size={16} /> Sign Out
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col min-w-0 bg-transparent transition-colors duration-300">
                <div className="flex-1 overflow-y-auto p-8 lg:p-12 max-w-5xl">
                    <div className="mb-8 tevel-card p-6">
                        <div className="tevel-kicker mb-2 text-[10px]">Workspace tuning</div>
                        <h3 className="text-3xl font-bold text-white tevel-title">Shape the platform around your workflow.</h3>
                        <p className="mt-3 text-sm text-slate-400 max-w-2xl">
                            הגדרות המערכת מאורגנות לפי משימות אמיתיות: זהות אנליסט, אבטחה תפעולית, התראות, וברירות מחדל שמשפיעות על קצב העבודה.
                        </p>
                    </div>
                    
                    {/* PROFILE TAB */}
                    {activeTab === 'profile' && (
                        <div className="space-y-8 animate-fadeIn">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Personal Information</h3>
                                <p className="text-xs text-slate-500">Manage your analyst identity and credentials.</p>
                            </div>
                            
                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex items-center gap-6 shadow-sm">
                                <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-[#05DF9C] flex items-center justify-center text-2xl font-bold text-[#05DF9C]">
                                    {user?.email?.[0].toUpperCase() || 'A'}
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900 dark:text-white">{user?.email?.split('@')[0] || 'Analyst'}</div>
                                    <div className="text-sm text-slate-500 font-mono">{user?.email}</div>
                                    <div className="flex gap-2 mt-2">
                                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 text-[10px] font-bold uppercase rounded border border-emerald-500/20">Active Clearance</span>
                                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase rounded border border-slate-200 dark:border-slate-700">Tier 1 Analyst</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Display Name</label>
                                    <input type="text" defaultValue={user?.email?.split('@')[0]} className="w-full bg-white dark:bg-[#181818] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-white focus:border-[#05DF9C] focus:outline-none transition-colors" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Department</label>
                                    <input type="text" defaultValue="Signal Intelligence (SIGINT)" className="w-full bg-white dark:bg-[#181818] border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-900 dark:text-white focus:border-[#05DF9C] focus:outline-none transition-colors" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* SECURITY & OPSEC TAB */}
                    {activeTab === 'security' && (
                        <div className="space-y-8 animate-fadeIn">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Operational Security (OPSEC)</h3>
                                <p className="text-xs text-slate-500">Access control, session management, and audit protocols.</p>
                            </div>

                            {/* Authentication Method */}
                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-sm">
                                <div className="flex items-center justify-between pb-6 border-b border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-600 dark:text-emerald-500"><Smartphone size={24} /></div>
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white text-sm">Two-Factor Authentication (2FA)</div>
                                            <div className="text-xs text-slate-500 mt-1">Hardware token or authenticator app required.</div>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => setSecurity(s => ({...s, mfaEnabled: !s.mfaEnabled}))}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold uppercase border transition-all ${security.mfaEnabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border-emerald-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-600'}`}
                                    >
                                        {security.mfaEnabled ? 'Enabled' : 'Disabled'}
                                    </button>
                                </div>

                                {/* Biometric Re-auth */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-slate-100 dark:bg-slate-800/50 rounded-lg text-slate-500"><Fingerprint size={24} /></div>
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white text-sm">Biometric Re-authentication</div>
                                            <div className="text-xs text-slate-500 mt-1">Require fingerprint/face ID for Critical actions.</div>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => setSecurity(s => ({ ...s, biometricReauth: !s.biometricReauth }))}
                                        className={`text-2xl transition-colors ${security.biometricReauth ? 'text-[#05DF9C]' : 'text-slate-300 dark:text-slate-600'}`}
                                    >
                                        {security.biometricReauth ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                                    </button>
                                </div>
                            </div>

                            {/* Session & Compliance */}
                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 shadow-sm">
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
                                            <Clock size={16} className="text-amber-500" /> Session Inactivity Timeout
                                        </div>
                                        <span className="text-xs font-mono text-[#05DF9C] bg-[#05DF9C]/10 px-2 py-1 rounded">{security.sessionTimeout} Minutes</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" max="60" step="1" 
                                        value={security.sessionTimeout}
                                        onChange={(e) => setSecurity({...security, sessionTimeout: parseInt(e.target.value)})}
                                        className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#05DF9C]"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-2">Workstation will auto-lock after specified duration of inactivity.</p>
                                </div>

                                <div className="border-t border-slate-200 dark:border-slate-800 pt-6 space-y-4">
                                    {/* Forensic Logging */}
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2"><Activity size={16} className="text-rose-500"/> Forensic Audit Logging</div>
                                            <div className="text-xs text-slate-500 mt-1">Log every entity view, search query, and export action.</div>
                                        </div>
                                        <button 
                                            onClick={() => setSecurity(s => ({ ...s, forensicLogging: !s.forensicLogging }))}
                                            className={`text-2xl transition-colors ${security.forensicLogging ? 'text-[#05DF9C]' : 'text-slate-300 dark:text-slate-600'}`}
                                        >
                                            {security.forensicLogging ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                                        </button>
                                    </div>

                                    {/* Watermarking */}
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2"><Printer size={16} className="text-sky-500"/> Export Watermarking</div>
                                            <div className="text-xs text-slate-500 mt-1">Embed user ID and timestamp into all PDF/Image exports.</div>
                                        </div>
                                        <button 
                                            onClick={() => setSecurity(s => ({ ...s, watermarkExports: !s.watermarkExports }))}
                                            className={`text-2xl transition-colors ${security.watermarkExports ? 'text-[#05DF9C]' : 'text-slate-300 dark:text-slate-600'}`}
                                        >
                                            {security.watermarkExports ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* SYSTEM & THEME TAB */}
                    {activeTab === 'system' && (
                        <div className="space-y-8 animate-fadeIn">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">System Configuration</h3>
                                <p className="text-xs text-slate-500">Interface appearance and analysis engine parameters.</p>
                            </div>

                            {/* Theme Selector - NOW FUNCTIONAL */}
                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-4">Interface Theme</h4>
                                <div className="grid grid-cols-3 gap-4">
                                    {[
                                        { id: 'dark', label: 'Dark Ops', icon: Moon },
                                        { id: 'light', label: 'Daylight', icon: Sun },
                                        { id: 'system', label: 'System', icon: Monitor },
                                    ].map((mode) => (
                                        <button
                                            key={mode.id}
                                            onClick={() => setSystem({ ...system, theme: mode.id as Theme })}
                                            className={`
                                                flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200
                                                ${system.theme === mode.id 
                                                    ? 'bg-[#05DF9C]/10 border-[#05DF9C] text-[#05DF9C]' 
                                                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'}
                                            `}
                                        >
                                            <mode.icon size={24} className="mb-2" />
                                            <span className="text-xs font-bold uppercase">{mode.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* General Settings */}
                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                                {[
                                    { label: 'Auto-Ingest New Feeds', desc: 'Automatically process incoming Telegram/Signal streams.', value: system.autoIngest, key: 'autoIngest' },
                                    { label: 'Compact Mode', desc: 'Reduce whitespace in dashboard views for high-density displays.', value: system.compactMode, key: 'compactMode' },
                                ].map((setting: any, i) => (
                                    <div key={i} className="p-6 border-b border-slate-200 dark:border-slate-800 last:border-0 flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white text-sm">{setting.label}</div>
                                            <div className="text-xs text-slate-500 mt-1">{setting.desc}</div>
                                        </div>
                                        <button 
                                            onClick={() => setSystem({ ...system, [setting.key]: !setting.value })}
                                            className={`text-2xl transition-colors ${setting.value ? 'text-[#05DF9C]' : 'text-slate-300 dark:text-slate-600'}`}
                                        >
                                            {setting.value ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                                        </button>
                                    </div>
                                ))}
                                
                                <div className="p-6 flex items-center justify-between">
                                    <div>
                                        <div className="font-bold text-slate-900 dark:text-white text-sm">Default Classification</div>
                                        <div className="text-xs text-slate-500 mt-1">Applied to unlabelled sources.</div>
                                    </div>
                                    <select 
                                        value={system.classificationDefault}
                                        onChange={(e) => setSystem({...system, classificationDefault: e.target.value})}
                                        className="bg-slate-50 dark:bg-[#181818] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white font-bold focus:outline-none focus:border-[#05DF9C] transition-colors"
                                    >
                                        <option value="UNCLASSIFIED">UNCLASSIFIED</option>
                                        <option value="CONFIDENTIAL">CONFIDENTIAL</option>
                                        <option value="SECRET">SECRET</option>
                                        <option value="TOP SECRET">TOP SECRET</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* NOTIFICATIONS TAB */}
                    {activeTab === 'notifications' && (
                        <div className="space-y-8 animate-fadeIn">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Notification Preferences</h3>
                                <p className="text-xs text-slate-500">Control how and when you are alerted.</p>
                            </div>
                            <div className="bg-white dark:bg-[#121212] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                                {Object.entries(notifications).map(([key, value]) => (
                                    <div key={key} className="p-6 border-b border-slate-200 dark:border-slate-800 last:border-0 flex items-center justify-between">
                                        <div className="capitalize font-bold text-slate-900 dark:text-white text-sm">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                                        <button 
                                            onClick={() => setNotifications({ ...notifications, [key]: !value })}
                                            className={`text-2xl transition-colors ${value ? 'text-[#05DF9C]' : 'text-slate-300 dark:text-slate-600'}`}
                                        >
                                            {value ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>

                {/* FOOTER */}
                <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#121212] flex justify-end">
                    <button 
                        onClick={handleSave}
                        className="bg-[#05DF9C] hover:bg-emerald-400 text-black px-8 py-3 rounded-xl font-bold uppercase text-xs tracking-widest flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(5,223,156,0.2)]"
                    >
                        {isSaved ? <Check size={16} /> : <Save size={16} />}
                        {isSaved ? 'Saved' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};
