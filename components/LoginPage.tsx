
import React, { useState } from 'react';
import { auth } from '../services/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Eye, EyeOff, Check, Loader2 } from 'lucide-react';

const LOCAL_ADMIN_EMAIL = 'admin@admin.com';
const LOCAL_ADMIN_PASSWORD = '123123';
const LOCAL_ADMIN_SESSION_KEY = 'tevel-local-admin-session';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (email === LOCAL_ADMIN_EMAIL && password === LOCAL_ADMIN_PASSWORD) {
        window.localStorage.setItem(LOCAL_ADMIN_SESSION_KEY, '1');
        window.dispatchEvent(new Event('tevel-local-auth-changed'));
        return;
      }

      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Email already registered.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else {
        setError(err.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full tevel-app-bg tevel-aurora flex items-center justify-center p-4 text-slate-200">
      <div className="w-full max-w-6xl grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div className="tevel-card p-8 xl:p-10 flex flex-col justify-between min-h-[720px]">
            <div>
                <div className="flex items-center gap-4 mb-10">
                    <div className="w-14 h-14 rounded-2xl tevel-glass flex items-center justify-center">
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="10.5" y="2" width="3" height="20" rx="1.5" fill="#53f2c2" />
                            <rect x="10.5" y="2" width="3" height="20" rx="1.5" transform="rotate(45 12 12)" fill="#53f2c2" />
                            <rect x="10.5" y="2" width="3" height="20" rx="1.5" transform="rotate(90 12 12)" fill="#53f2c2" />
                            <rect x="10.5" y="2" width="3" height="20" rx="1.5" transform="rotate(135 12 12)" fill="#53f2c2" />
                        </svg>
                    </div>
                    <div>
                        <div className="text-white text-3xl font-black tevel-title">TEVEL</div>
                        <div className="tevel-kicker text-[10px] mt-1">Local-first context engine</div>
                    </div>
                </div>

                <div className="max-w-2xl">
                    <div className="tevel-kicker mb-4">Analyst workspace</div>
                    <h1 className="text-5xl xl:text-6xl font-bold text-white leading-[0.94] tevel-title">
                        Turn fragmented signals into connected intelligence.
                    </h1>
                    <p className="mt-6 text-lg text-slate-300 leading-relaxed max-w-xl">
                        סביבת עבודה אחת לקליטה, קישור, גרף ישויות, חקירה בזמן אמת ותוצרים אנליטיים על גבי מודל לוקאלי.
                    </p>
                </div>

                <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="tevel-stat p-5">
                        <div className="tevel-kicker text-[10px]">Entity intelligence</div>
                        <div className="text-white text-lg font-bold mt-2">Canonical entities with evidence</div>
                    </div>
                    <div className="tevel-stat p-5">
                        <div className="tevel-kicker text-[10px]">Cross-linking</div>
                        <div className="text-white text-lg font-bold mt-2">Graph-first synapse detection</div>
                    </div>
                    <div className="tevel-stat p-5">
                        <div className="tevel-kicker text-[10px]">Local AI</div>
                        <div className="text-white text-lg font-bold mt-2">Reasoning stays on your machine</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                <div className="rounded-[22px] border border-slate-800/80 bg-black/20 p-5">
                    <div className="tevel-kicker text-[10px] mb-3">Operational flow</div>
                    <div className="space-y-3 text-sm text-slate-300">
                        <div>1. Intake raw documents, media, or links.</div>
                        <div>2. Extract entities, relations, and evidence.</div>
                        <div>3. Fuse cases into a living context graph.</div>
                    </div>
                </div>
                <div className="rounded-[22px] border border-slate-800/80 bg-black/20 p-5">
                    <div className="tevel-kicker text-[10px] mb-3">Workspace promise</div>
                    <div className="space-y-3 text-sm text-slate-300">
                        <div>Designed for faster triage and fewer blind spots.</div>
                        <div>Built around clarity, provenance, and analyst control.</div>
                    </div>
                </div>
            </div>
        </div>

        <div className="tevel-glass-strong rounded-[30px] p-8 xl:p-10 flex flex-col justify-center">
        <div className="w-full max-w-[420px] mx-auto">
        <div className="mb-8">
          <div className="tevel-kicker mb-3">{isRegistering ? 'Create analyst access' : 'Secure analyst login'}</div>
          <h2 className="text-4xl font-bold text-white mb-3 tevel-title">
            {isRegistering ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p className="text-slate-400 text-sm">
            {isRegistering ? 'Create a new account to get started' : 'Enter your credentials to access the platform'}
          </p>
        </div>

        <form onSubmit={handleAuth} className="w-full space-y-5">
            
            {/* EMAIL */}
            <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-200 block">Email</label>
                <input 
                    type="email" 
                    required
                    placeholder="name@agency.local"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full tevel-input rounded-2xl px-4 py-3.5 text-sm placeholder-slate-500"
                />
            </div>

            {/* PASSWORD */}
            <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-200 block">Password<span className="text-[#05DF9C]">*</span></label>
                <div className="relative">
                    <input 
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Min. 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full tevel-input rounded-2xl px-4 py-3.5 text-sm placeholder-slate-500 pr-10"
                    />
                    <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                    >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                </div>
            </div>

            {/* ACTIONS ROW */}
            <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setKeepLoggedIn(!keepLoggedIn)}>
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${keepLoggedIn ? 'bg-[#05DF9C] border-[#05DF9C]' : 'bg-transparent border-slate-600'}`}>
                        {keepLoggedIn && <Check size={14} className="text-black" strokeWidth={3} />}
                    </div>
                    <span className="text-sm text-slate-300 select-none">Keep me logged in</span>
                </div>
                <button type="button" className="text-sm text-[#05DF9C] hover:text-[#04b882] font-medium transition-colors">
                    Forgot password?
                </button>
            </div>

            {/* ERROR MESSAGE */}
            {error && (
                <div className="text-rose-500 text-xs font-bold text-center bg-rose-500/10 py-2 rounded-lg border border-rose-500/20">
                    {error}
                </div>
            )}

            {/* SUBMIT BUTTON */}
            <button 
                type="submit" 
                disabled={loading}
                className="w-full tevel-button-primary font-bold text-sm py-4 rounded-2xl transition-all hover:shadow-[0_0_30px_rgba(5,223,156,0.3)] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {loading ? <Loader2 className="animate-spin" size={18} /> : (isRegistering ? 'Create Account' : 'Sign In')}
            </button>

        </form>

        {/* FOOTER TOGGLE */}
        <div className="mt-8 text-sm text-slate-400">
            {isRegistering ? 'Already have an account?' : 'Not registered yet?'}{' '}
            <button 
                onClick={() => { setIsRegistering(!isRegistering); setError(''); }} 
                className="text-white font-bold hover:text-[#05DF9C] transition-colors"
            >
                {isRegistering ? 'Sign In' : 'Create an Account'}
            </button>
        </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
