import React, { useState } from 'react';
import { ShieldCheck, Lock, User, Mail, AlertTriangle, KeyRound, CheckCircle2, X } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch.ts';

interface AuthModalProps {
  isOpen: boolean;
  mode: 'setup' | 'login' | 'change_password';
  onClose?: () => void;
  onSuccess: (owner: any, token?: string) => void;
}

export interface OwnerSetupPayloadInput {
  fullName: string;
  email: string;
  password: string;
  setupSecret?: string;
}

export interface OwnerSetupPayload {
  fullName: string;
  email: string;
  password: string;
  setupSecret?: string;
}

/**
 * Builds the POST /api/auth/setup payload.
 * Includes `setupSecret` only when non-empty so deployments without SETUP_SECRET remain compatible.
 */
export function buildOwnerSetupPayload(input: OwnerSetupPayloadInput): OwnerSetupPayload {
  const payload: OwnerSetupPayload = {
    fullName: input.fullName,
    email: input.email,
    password: input.password,
  };
  if (typeof input.setupSecret === 'string' && input.setupSecret.length > 0) {
    payload.setupSecret = input.setupSecret;
  }
  return payload;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, mode: initialMode, onClose, onSuccess }) => {
  const [mode, setMode] = useState<'setup' | 'login' | 'change_password'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    setMode(initialMode);
    setError(null);
    setSuccessMsg(null);
    setSetupSecret('');
  }, [initialMode]);

  React.useEffect(() => {
    if (!isOpen) {
      setSetupSecret('');
      setPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
      setError(null);
      setSuccessMsg(null);
    }
  }, [isOpen]);

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
          body: JSON.stringify(
            buildOwnerSetupPayload({ fullName, email, password, setupSecret })
          ),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Owner setup failed');

        setSetupSecret('');
        setPassword('');
        setConfirmPassword('');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#240202]/75 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-[#440303] border border-[#DFCECE] dark:border-[#8C2828] rounded-2xl shadow-2xl overflow-hidden relative">
        {/* Rich Maroon Top Banner Header */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#440303] via-[#690303] to-[#910303] px-6 py-6 sm:px-8 text-center text-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#CE0404]/30 blur-xl"
          />
          {mode === 'change_password' && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="absolute top-4 right-4 p-1 rounded-lg text-[#F2DADA] hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          <div className="relative z-10 w-11 h-11 mx-auto rounded-xl bg-white/15 border border-white/25 flex items-center justify-center mb-3 shadow-xs">
            {mode === 'setup' ? (
              <ShieldCheck className="w-5 h-5 text-white" />
            ) : mode === 'change_password' ? (
              <KeyRound className="w-5 h-5 text-white" />
            ) : (
              <Lock className="w-5 h-5 text-white" />
            )}
          </div>

          <h2 className="relative z-10 text-2xl font-extrabold text-white tracking-tight">
            {mode === 'setup'
              ? 'Create Owner Account'
              : mode === 'change_password'
              ? 'Change Password'
              : 'Sign In to LEED'}
          </h2>
          <p className="relative z-10 text-xs font-medium text-[#FAF0F0] mt-1">
            {mode === 'setup'
              ? 'Set your private credentials to lock this single-owner workspace.'
              : mode === 'change_password'
              ? 'Enter your current password and a new password (min. 8 characters).'
              : 'Private single-owner workspace access.'}
          </p>
        </div>

        <div className="p-6 sm:p-8">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[#FFF1F1] dark:bg-[#2A0303] border border-[#E52825] text-[#910303] dark:text-[#FFE0DF] text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#FA0502] shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-[#ECFDF5] dark:bg-[#0C3824] border border-[#167C4D] dark:border-[#1E9E63] text-[#0F4B30] dark:text-[#D1FAE5] text-xs font-medium flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#167C4D] dark:text-[#4ADE80] shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'setup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4] mb-1">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 dark:text-[#C9A7A7] absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] rounded-lg text-sm font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404]"
                />
              </div>
            </div>
          )}

          {mode !== 'change_password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4] mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 dark:text-[#C9A7A7] absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@domain.com"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] rounded-lg text-sm font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404]"
                />
              </div>
            </div>
          )}

          {mode === 'change_password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4] mb-1">
                Current Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 dark:text-[#C9A7A7] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] rounded-lg text-sm font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404]"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4] mb-1">
              {mode === 'change_password' ? 'New Password' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 dark:text-[#C9A7A7] absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] rounded-lg text-sm font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404]"
              />
            </div>
            {password && password.length < 8 && (
              <p className="text-xs font-medium text-[#CE0404] dark:text-[#FF9492] mt-1">
                Minimum 8 characters required
              </p>
            )}
          </div>

          {(mode === 'setup' || mode === 'change_password') && (
            <div>
              <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4] mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 dark:text-[#C9A7A7] absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] rounded-lg text-sm font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404]"
                />
              </div>
            </div>
          )}

          {mode === 'setup' && (
            <div>
              <label
                htmlFor="owner-setup-secret"
                className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4] mb-1"
              >
                Setup Secret <span className="font-normal text-slate-500 dark:text-[#C9A7A7]">(if configured)</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 dark:text-[#C9A7A7] absolute left-3 top-2.5" />
                <input
                  id="owner-setup-secret"
                  name="setupSecret"
                  type="password"
                  autoComplete="off"
                  value={setupSecret}
                  onChange={(e) => setSetupSecret(e.target.value)}
                  placeholder="Required if SETUP_SECRET is set on server"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] rounded-lg text-sm font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404]"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 bg-[#B30303] hover:bg-[#910303] disabled:opacity-60 text-white text-sm font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 mt-2"
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
    </div>
  );
};
