import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Mail, AlertTriangle, KeyRound, CheckCircle2, X } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch.ts';

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
          throw new Error('Password must be at least 8 characters');
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
          throw new Error('New password must be at least 8 characters');
        }
        if (password !== confirmPassword) {
          throw new Error('New passwords do not match');
        }

        const res = await apiFetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword: password }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to change password');

        if (data.token) {
          localStorage.setItem('leed_session_token', data.token);
        }

        setSuccessMsg('Password updated. Other active sessions have been revoked.');
        setPassword('');
        setCurrentPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          if (onClose) onClose();
        }, 1600);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F181B]/75 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 sm:p-8 relative">
        {mode === 'change_password' && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <div className="text-center mb-6">
          <div className="w-11 h-11 mx-auto rounded-xl bg-[#335C67] flex items-center justify-center mb-3">
            {mode === 'setup' ? (
              <ShieldCheck className="w-5 h-5 text-[#FFF3B0]" />
            ) : mode === 'change_password' ? (
              <KeyRound className="w-5 h-5 text-[#FFF3B0]" />
            ) : (
              <Lock className="w-5 h-5 text-[#FFF3B0]" />
            )}
          </div>

          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 tracking-tight">
            {mode === 'setup'
              ? 'Create Owner Account'
              : mode === 'change_password'
              ? 'Change Password'
              : 'Sign In to LEED'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {mode === 'setup'
              ? 'Set your private credentials to lock this single-owner workspace.'
              : mode === 'change_password'
              ? 'Enter your current password and a new password (min. 8 characters).'
              : 'Private single-owner workspace access.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[#FDF3F3] dark:bg-[#540B0E]/40 border border-[#9E2A2B]/40 text-[#540B0E] dark:text-[#F9E3E3] text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#9E2A2B] dark:text-[#E09D9E] shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-[#EFF5F4] dark:bg-[#162E2A]/60 border border-[#335C67]/40 text-[#1F3940] dark:text-[#B0CFC9] text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#335C67] dark:text-[#8AB0BA] shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'setup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#E09F3E]"
                />
              </div>
            </div>
          )}

          {mode !== 'change_password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@domain.com"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#E09F3E]"
                />
              </div>
            </div>
          )}

          {mode === 'change_password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Current Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#E09F3E]"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {mode === 'change_password' ? 'New Password' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#E09F3E]"
              />
            </div>
            {password && password.length < 8 && (
              <p className="text-xs text-[#9E2A2B] dark:text-[#E09D9E] mt-1">
                Minimum 8 characters required
              </p>
            )}
          </div>

          {(mode === 'setup' || mode === 'change_password') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#E09F3E]"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-[#335C67] hover:bg-[#25454E] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : mode === 'setup' ? (
              <span>Create Account</span>
            ) : mode === 'change_password' ? (
              <span>Update Password</span>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
