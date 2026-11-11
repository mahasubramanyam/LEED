import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Mail, AlertTriangle, KeyRound, CheckCircle2, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  mode: 'setup' | 'login' | 'change_password';
  onClose?: () => void;
  onSuccess: (owner: any, token?: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, mode: initialMode, onClose, onSuccess }) => {
  const [mode, setMode] = useState<'setup' | 'login' | 'change_password'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Sync mode if initialMode changes
  React.useEffect(() => {
    setMode(initialMode);
    setError(null);
    setSuccessMsg(null);
  }, [initialMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      if (mode === 'setup') {
        if (!fullName.trim() || !email.trim() || !password) {
          throw new Error('Please fill out all fields');
        }
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters long');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }

        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fullName, email, password }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Owner setup failed');

        onSuccess(data.owner, data.token);
      } else if (mode === 'login') {
        if (!email.trim() || !password) {
          throw new Error('Email and password are required');
        }

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Authentication failed');

        onSuccess(data.owner, data.token);
      } else if (mode === 'change_password') {
        if (!currentPassword || !password) {
          throw new Error('Current and new password are required');
        }
        if (password.length < 8) {
          throw new Error('New password must be at least 8 characters long');
        }
        if (password !== confirmPassword) {
          throw new Error('New passwords do not match');
        }

        // Retrieve CSRF token from cookie or header
        const csrfMatch = document.cookie.match(/leed_csrf=([^;]+)/);
        const csrfToken = csrfMatch ? csrfMatch[1] : '';
        const storedToken = localStorage.getItem('leed_session_token');

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-leed-csrf-token': csrfToken,
        };
        if (storedToken) {
          headers['Authorization'] = `Bearer ${storedToken}`;
        }

        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ currentPassword, newPassword: password }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to change password');

        if (data.token) {
          localStorage.setItem('leed_session_token', data.token);
        }

        setSuccessMsg('Password updated successfully. All other active sessions have been revoked.');
        setPassword('');
        setCurrentPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          if (onClose) onClose();
        }, 1800);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 sm:p-8 relative">
        {mode === 'change_password' && onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Modal Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 p-0.5 shadow-lg shadow-indigo-500/20 mb-3">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              {mode === 'setup' ? (
                <ShieldCheck className="w-6 h-6 text-cyan-400" />
              ) : mode === 'change_password' ? (
                <KeyRound className="w-6 h-6 text-indigo-400" />
              ) : (
                <Lock className="w-6 h-6 text-emerald-400" />
              )}
            </div>
          </div>

          <h2 className="text-xl font-bold text-white tracking-tight">
            {mode === 'setup'
              ? 'Initialize Owner Account'
              : mode === 'change_password'
              ? 'Change Owner Password'
              : 'Owner Authentication'}
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {mode === 'setup'
              ? 'LEED is a private single-owner platform. Setting your credentials locks the instance against public registration.'
              : mode === 'change_password'
              ? 'Enter your current password and choose a new secure password (min. 8 characters).'
              : 'Enter your private credentials to access pipeline records, live registry connectors, and AI tools.'}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'setup' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Owner Full Name</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Mahasubramanyam"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {mode !== 'change_password' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Owner Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@domain.com"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {mode === 'change_password' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Current Password</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              {mode === 'change_password' ? 'New Password' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {password && password.length < 8 && (
              <p className="text-[11px] text-amber-400 mt-1">Must be at least 8 characters</p>
            )}
          </div>

          {(mode === 'setup' || mode === 'change_password') && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : mode === 'setup' ? (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Initialize & Lock Instance</span>
              </>
            ) : mode === 'change_password' ? (
              <>
                <KeyRound className="w-4 h-4" />
                <span>Update Password</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Sign In as Owner</span>
              </>
            )}
          </button>
        </form>

        {/* Security Notice */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 text-[11px] text-slate-500 text-center flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Argon2/bcrypt 12-round hashing • HTTP-only secure cookie • CSRF protected</span>
        </div>
      </div>
    </div>
  );
};
