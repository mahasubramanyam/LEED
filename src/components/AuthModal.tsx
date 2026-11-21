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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1113]/80 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-[#192629] border border-slate-300 dark:border-[#3E5256] rounded-xl shadow-2xl p-6 sm:p-8 relative">
        {mode === 'change_password' && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-4 right-4 p-1 rounded-lg text-slate-500 dark:text-[#B8C7C4] hover:text-slate-950 dark:hover:text-[#F2F6F5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <div className="text-center mb-6">
          <div className="w-11 h-11 mx-auto rounded-xl bg-[#335C67] border border-[#C49A52]/50 flex items-center justify-center mb-3">
            {mode === 'setup' ? (
              <ShieldCheck className="w-5 h-5 text-[#DFB76D]" />
            ) : mode === 'change_password' ? (
              <KeyRound className="w-5 h-5 text-[#DFB76D]" />
            ) : (
              <Lock className="w-5 h-5 text-[#DFB76D]" />
            )}
          </div>

          <h2 className="text-2xl font-extrabold text-slate-950 dark:text-[#F2F6F5] tracking-tight">
            {mode === 'setup'
              ? 'Create Owner Account'
              : mode === 'change_password'
              ? 'Change Password'
              : 'Sign In to LEED'}
          </h2>
          <p className="text-xs font-medium text-slate-600 dark:text-[#B8C7C4] mt-1">
            {mode === 'setup'
              ? 'Set your private credentials to lock this single-owner workspace.'
              : mode === 'change_password'
              ? 'Enter your current password and a new password (min. 8 characters).'
              : 'Private single-owner workspace access.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[#F9EFEF] dark:bg-[#280D0F]/90 border border-[#8F3438]/70 text-[#662226] dark:text-[#F0C9CB] text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#8F3438] dark:text-[#E58E92] shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-[#EDF4F2] dark:bg-[#243638] border border-[#335C67] text-[#14282D] dark:text-[#F0F4F3] text-xs font-medium flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#335C67] dark:text-[#86BCC9] shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'setup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC] mb-1">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 dark:text-[#B8C7C4] absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#101719] border border-slate-300 dark:border-[#3E5256] rounded-lg text-sm font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:outline-none focus:border-[#C49A52]"
                />
              </div>
            </div>
          )}

          {mode !== 'change_password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC] mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 dark:text-[#B8C7C4] absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@domain.com"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#101719] border border-slate-300 dark:border-[#3E5256] rounded-lg text-sm font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:outline-none focus:border-[#C49A52]"
                />
              </div>
            </div>
          )}

          {mode === 'change_password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC] mb-1">
                Current Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 dark:text-[#B8C7C4] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#101719] border border-slate-300 dark:border-[#3E5256] rounded-lg text-sm font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:outline-none focus:border-[#C49A52]"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC] mb-1">
              {mode === 'change_password' ? 'New Password' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 dark:text-[#B8C7C4] absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#101719] border border-slate-300 dark:border-[#3E5256] rounded-lg text-sm font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:outline-none focus:border-[#C49A52]"
              />
            </div>
            {password && password.length < 8 && (
              <p className="text-xs font-medium text-[#8F3438] dark:text-[#E58E92] mt-1">
                Minimum 8 characters required
              </p>
            )}
          </div>

          {(mode === 'setup' || mode === 'change_password') && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC] mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 dark:text-[#B8C7C4] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#101719] border border-slate-300 dark:border-[#3E5256] rounded-lg text-sm font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:outline-none focus:border-[#C49A52]"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-[#335C67] hover:bg-[#3D6C79] disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 mt-2"
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
