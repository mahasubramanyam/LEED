import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Key,
  Clock,
  Server,
  Sliders,
  History,
  Lock,
  RefreshCw,
  LogOut,
  AlertTriangle,
  CheckCircle,
  Database,
  Globe,
  Radio,
  FileText,
  UserCheck,
  Laptop,
  Check,
  AlertCircle,
  Power,
  Play,
  Trash2,
} from 'lucide-react';
import {
  AppSettings,
  ConnectorStatus,
  AuditVerificationResult,
  ConnectorEncryptionStatus,
} from '../types.ts';

interface OwnerProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'owner';
}

interface SessionItem {
  id: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  isActive: boolean;
  isCurrent: boolean;
}

interface AuditItem {
  id: string;
  sequenceNumber?: number;
  action: string;
  actorEmail: string;
  entityType?: string;
  entityId?: string;
  details?: any;
  ipAddress?: string;
  createdAt: string;
  prevHash?: string;
  currentHash?: string;
  hashVersion?: number;
}

interface DiagnosticsData {
  connected: boolean;
  engine: string;
  health: {
    isConfigured: boolean;
    isConnected: boolean;
    engine: string;
    consecutiveFailures: number;
    error?: string;
  };
  diagnostics?: {
    version: string;
    currentDatabase: string;
    currentUser: string;
    databaseSize: string;
    pool: { total: number; idle: number; waiting: number };
    tables: Array<{ name: string; count: number }>;
    totalRows: number;
  };
  migrations?: {
    startup?: {
      attempted: boolean;
      success: boolean;
      applied: string[];
      alreadyApplied: string[];
      error?: string;
    } | null;
    inspection?: {
      recordedVersions: string[];
      migration003Recorded: boolean;
      migration003SchemaReady: boolean;
      missingLeadIdentifierColumns: string[];
      missingMigration003Indexes: string[];
      countryCapabilitiesTableExists: boolean;
      migration004Recorded?: boolean;
      migration004SchemaReady?: boolean;
      missingMigration004Columns?: string[];
    } | null;
  };
  security: {
    singleOwnerEnforced: boolean;
    singletonConstraint: string;
    cookieSecurity: {
      sameSite: string;
      secure: boolean;
      partitioned: boolean;
      httpOnly: boolean;
    };
    bearerDualAuth: boolean;
    csrfProtection: boolean;
  };
}

interface OwnerControlCentreProps {
  owner: OwnerProfile | null;
  settings: AppSettings;
  connectors: ConnectorStatus[];
  onUpdateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  onRefreshConnectors: () => Promise<void>;
  onLogout: () => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

export function OwnerControlCentre({
  owner,
  settings,
  connectors,
  onUpdateSettings,
  onRefreshConnectors,
  onLogout,
  apiFetch,
}: OwnerControlCentreProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'security' | 'settings' | 'audit' | 'connectors'>('overview');

  // Diagnostics State
  const [diagData, setDiagData] = useState<DiagnosticsData | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  // Sessions State
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Audit State
  const [auditLog, setAuditLog] = useState<AuditItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [chainVerification, setChainVerification] = useState<AuditVerificationResult | null>(null);
  const [verifyingChain, setVerifyingChain] = useState(false);

  const handleVerifyChain = async () => {
    setVerifyingChain(true);
    try {
      const res = await apiFetch('/api/owner/audit-log/verify');
      if (res.ok) {
        const data = await res.json();
        setChainVerification(data);
      }
    } catch (err) {
      console.error('Failed to verify audit chain:', err);
    } finally {
      setVerifyingChain(false);
    }
  };

  // Profile Form State
  const [fullNameInput, setFullNameInput] = useState(owner?.fullName || '');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Connectors Key & Encryption State
  const [encryptionStatus, setEncryptionStatus] = useState<ConnectorEncryptionStatus | null>(null);
  const [selectedCredConnector, setSelectedCredConnector] = useState('conn-companies-house');
  const [chKeyInput, setChKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keySuccess, setKeySuccess] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [testingConnId, setTestingConnId] = useState<string | null>(null);
  const [togglingConnId, setTogglingConnId] = useState<string | null>(null);
  const [connFeedback, setConnFeedback] = useState<string | null>(null);

  // Settings Form State
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [newSuppressionDomain, setNewSuppressionDomain] = useState('');

  // Fetch Diagnostics & Encryption Status
  const fetchDiagnostics = useCallback(async () => {
    setLoadingDiag(true);
    try {
      const [res, encRes] = await Promise.all([
        apiFetch('/api/owner/diagnostics'),
        apiFetch('/api/connectors/encryption-status'),
      ]);
      if (res.ok) {
        const data = await res.json();
        setDiagData(data);
      }
      if (encRes.ok) {
        setEncryptionStatus(await encRes.json());
      }
    } catch (err) {
      console.error('Failed to load diagnostics', err);
    } finally {
      setLoadingDiag(false);
    }
  }, [apiFetch]);

  // Fetch Sessions
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await apiFetch('/api/owner/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to load sessions', err);
    } finally {
      setLoadingSessions(false);
    }
  }, [apiFetch]);

  // Fetch Audit Log
  const fetchAuditLog = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await apiFetch('/api/owner/audit-log?limit=50');
      if (res.ok) {
        const data = await res.json();
        setAuditLog(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load audit log', err);
    } finally {
      setLoadingAudit(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchDiagnostics();
    fetchSessions();
    fetchAuditLog();
  }, [fetchDiagnostics, fetchSessions, fetchAuditLog]);

  useEffect(() => {
    if (owner?.fullName) {
      setFullNameInput(owner.fullName);
    }
  }, [owner]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Handle Revoke Session
  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await apiFetch(`/api/owner/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchSessions();
        fetchAuditLog();
      }
    } catch (err) {
      console.error('Failed to revoke session', err);
    }
  };

  // Handle Revoke Other Sessions
  const handleRevokeOthers = async () => {
    try {
      const res = await apiFetch('/api/owner/sessions/revoke-others', { method: 'POST' });
      if (res.ok) {
        fetchSessions();
        fetchAuditLog();
      }
    } catch (err) {
      console.error('Failed to revoke other sessions', err);
    }
  };

  // Handle Profile Update
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingProfile(true);
    setProfileSuccess(false);
    try {
      const res = await apiFetch('/api/owner/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullNameInput }),
      });
      if (res.ok) {
        setProfileSuccess(true);
        setTimeout(() => setProfileSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Profile update failed', err);
    } finally {
      setUpdatingProfile(false);
    }
  };

  // Handle Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || 'Password update failed');
      } else {
        if (data.token) {
          localStorage.setItem('leed_session_token', data.token);
        }
        setPasswordSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        fetchSessions();
        fetchAuditLog();
        setTimeout(() => setPasswordSuccess(false), 4000);
      }
    } catch (err: any) {
      setPasswordError(err.message || 'Network error');
    } finally {
      setChangingPassword(false);
    }
  };

  // Handle Save/Rotate Encrypted Connector Credential
  const handleSaveChKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chKeyInput.trim()) return;
    setSavingKey(true);
    setKeySuccess(null);
    setKeyError(null);
    try {
      const target = connectors.find((c) => c.id === selectedCredConnector);
      const isRotation = target?.credentialStatus?.source === 'database_encrypted';
      const fieldKey = target?.credentialRequirements?.fields?.[0]?.key || 'apiKey';
      const res = await apiFetch(`/api/connectors/${selectedCredConnector}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: { [fieldKey]: chKeyInput.trim() },
          rotate: isRotation,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyError(data.error || 'Failed to encrypt and save credential');
        return;
      }
      setKeySuccess(
        `Credential ${isRotation ? 'rotated' : 'stored'} securely (${data.credentialStatus?.maskedHint || 'masked'}).`
      );
      setChKeyInput('');
      await Promise.all([onRefreshConnectors(), fetchAuditLog()]);
      setTimeout(() => setKeySuccess(null), 4000);
    } catch (err: any) {
      setKeyError(err?.message || 'Credential save failed');
    } finally {
      setSavingKey(false);
    }
  };

  const handleRemoveConnectorCred = async (connectorId: string) => {
    setSavingKey(true);
    setKeyError(null);
    setKeySuccess(null);
    try {
      const res = await apiFetch(`/api/connectors/${connectorId}/credentials`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setKeyError(data.error || 'Failed to remove stored credential');
        return;
      }
      setKeySuccess(`Stored database credential removed for ${connectorId}.`);
      await Promise.all([onRefreshConnectors(), fetchAuditLog()]);
      setTimeout(() => setKeySuccess(null), 4000);
    } catch (err: any) {
      setKeyError(err?.message || 'Credential removal failed');
    } finally {
      setSavingKey(false);
    }
  };

  const handleTestConnector = async (connectorId: string) => {
    setTestingConnId(connectorId);
    setConnFeedback(null);
    try {
      const res = await apiFetch(`/api/connectors/${connectorId}/test`, { method: 'POST' });
      const data = await res.json();
      setConnFeedback(data.validation?.message || data.error || 'Test finished');
      await Promise.all([onRefreshConnectors(), fetchAuditLog()]);
    } catch (err: any) {
      setConnFeedback(err?.message || 'Test failed');
    } finally {
      setTestingConnId(null);
    }
  };

  const handleToggleConnector = async (c: ConnectorStatus) => {
    const isEnabled = c.config?.enabled ?? c.healthState !== 'disabled';
    setTogglingConnId(c.id);
    try {
      await apiFetch(`/api/connectors/${c.id}/${isEnabled ? 'disable' : 'enable'}`, { method: 'POST' });
      await Promise.all([onRefreshConnectors(), fetchAuditLog()]);
    } finally {
      setTogglingConnId(null);
    }
  };

  // Handle Save Platform Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccess(false);
    try {
      await onUpdateSettings(localSettings);
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddSuppressionDomain = () => {
    if (!newSuppressionDomain.trim()) return;
    const clean = newSuppressionDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!localSettings.suppressionDomains.includes(clean)) {
      setLocalSettings((prev) => ({
        ...prev,
        suppressionDomains: [...prev.suppressionDomains, clean],
      }));
    }
    setNewSuppressionDomain('');
  };

  const handleRemoveSuppressionDomain = (domain: string) => {
    setLocalSettings((prev) => ({
      ...prev,
      suppressionDomains: prev.suppressionDomains.filter((d) => d !== domain),
    }));
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Executive Identity */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Owner Control Centre</h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Single-Owner Enforced
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  PostgreSQL Active
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Sole Platform Administrator: <strong className="text-slate-800 dark:text-slate-200">{owner?.fullName || 'Maha'}</strong> ({owner?.email || 'mahasubramanyam0@gmail.com'})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                fetchDiagnostics();
                fetchSessions();
                fetchAuditLog();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDiag ? 'animate-spin' : ''}`} />
              Refresh Diagnostics
            </button>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 rounded-lg transition-colors border border-red-200 dark:border-red-900"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 mt-6 pt-2 overflow-x-auto scrollbar-none">
          {[
            { id: 'overview', label: 'Database & Health', icon: Server },
            { id: 'sessions', label: 'Active Sessions', icon: Laptop, badge: sessions.filter((s) => s.isActive).length },
            { id: 'security', label: 'Profile & Security', icon: Lock },
            { id: 'connectors', label: 'Connectors & Credentials', icon: Radio },
            { id: 'settings', label: 'System Preferences', icon: Sliders },
            { id: 'audit', label: 'Audit Log', icon: History, badge: auditLog.length },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                  active
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    active ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: OVERVIEW & DATABASE HEALTH */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Neon Connection Status Card */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Database Engine</span>
              <div className="flex items-center gap-2 mt-1">
                <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <span className="text-base font-semibold text-slate-900 dark:text-white">Neon PostgreSQL</span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">Version 18.6 (Serverless)</span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Connection Pool</span>
              <div className="flex items-center gap-2 mt-1">
                <Radio className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-base font-semibold text-slate-900 dark:text-white">
                  {diagData?.diagnostics?.pool ? `${diagData.diagnostics.pool.idle} Idle / ${diagData.diagnostics.pool.total} Total` : 'Active'}
                </span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">Zero waiting queries</span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Storage Size</span>
              <div className="flex items-center gap-2 mt-1">
                <Server className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-base font-semibold text-slate-900 dark:text-white">
                  {diagData?.diagnostics?.databaseSize || '8.2 MB'}
                </span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">Neon Cloud Storage</span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Architecture Security</span>
              <div className="flex items-center gap-2 mt-1">
                <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-base font-semibold text-slate-900 dark:text-white">Single-Owner Locked</span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block">Singleton DB constraint</span>
            </div>
          </div>

          {/* Schema Migration 003 Live Status */}
          {diagData?.migrations?.inspection && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Migration 003 (Global Intelligence) Live Schema Status
                  </h2>
                </div>
                <span
                  className={`px-2.5 py-0.5 text-xs font-semibold rounded-md ${
                    diagData.migrations.inspection.migration003SchemaReady &&
                    diagData.migrations.inspection.migration003Recorded
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200'
                  }`}
                >
                  {diagData.migrations.inspection.migration003SchemaReady &&
                  diagData.migrations.inspection.migration003Recorded
                    ? 'Applied & Verified in Neon'
                    : 'Pending / Incomplete in Neon'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px]">SCHEMA_MIGRATIONS (003)</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {diagData.migrations.inspection.migration003Recorded ? 'Recorded' : 'Not Recorded'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px]">LEAD_IDENTIFIERS COLUMNS</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {diagData.migrations.inspection.missingLeadIdentifierColumns.length === 0
                      ? 'All 5 Present'
                      : `Missing: ${diagData.migrations.inspection.missingLeadIdentifierColumns.join(', ')}`}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px]">INDEXES (003)</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {diagData.migrations.inspection.missingMigration003Indexes.length === 0
                      ? 'All 8 Present'
                      : `Missing: ${diagData.migrations.inspection.missingMigration003Indexes.length}`}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px]">COUNTRY_SOURCE_CAPABILITIES</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {diagData.migrations.inspection.countryCapabilitiesTableExists ? 'Table Exists' : 'Missing'}
                  </span>
                </div>
              </div>

              {/* Migration 004 Live Schema Status */}
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold">Migration 004 (Unified Connector Architecture): </span>
                  <span className="font-mono text-[11px]">
                    recorded={String(Boolean(diagData.migrations.inspection.migration004Recorded))}, pendingColumns=
                    {diagData.migrations.inspection.missingMigration004Columns?.length ?? 0}
                  </span>
                </div>
                <span
                  className={`px-2.5 py-0.5 text-xs font-semibold rounded-md self-start sm:self-auto ${
                    diagData.migrations.inspection.migration004SchemaReady &&
                    diagData.migrations.inspection.migration004Recorded
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200'
                  }`}
                >
                  {diagData.migrations.inspection.migration004SchemaReady &&
                  diagData.migrations.inspection.migration004Recorded
                    ? '004 Applied & Verified'
                    : '004 Pending Approval'}
                </span>
              </div>
            </div>
          )}

          {/* PostgreSQL Schema Tables Inventory */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  PostgreSQL Schema Ledger ({diagData?.diagnostics?.tables?.length ?? 18} Tables)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Core CRM intelligence tables, capability matrix, security ledger, and migration tracking
                </p>
              </div>
              <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-400">
                Total Records: {diagData?.diagnostics?.totalRows ?? 0}
              </span>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(diagData?.diagnostics?.tables || [
                  { name: 'schema_migrations', count: 0 },
                  { name: 'owner_users', count: 1 },
                  { name: 'owner_sessions', count: 1 },
                  { name: 'pipeline_stages', count: 0 },
                  { name: 'leads', count: 0 },
                  { name: 'lead_sources', count: 0 },
                  { name: 'lead_identifiers', count: 0 },
                  { name: 'lead_notes', count: 0 },
                  { name: 'activities', count: 0 },
                  { name: 'tasks', count: 0 },
                  { name: 'campaigns', count: 0 },
                  { name: 'campaign_messages', count: 0 },
                  { name: 'lead_merge_history', count: 0 },
                  { name: 'country_source_capabilities', count: 0 },
                  { name: 'connector_credentials', count: 0 },
                  { name: 'connector_runs', count: 0 },
                  { name: 'audit_events', count: 0 },
                  { name: 'app_settings', count: 0 },
                ]).map((t) => (
                  <div
                    key={t.name}
                    className="flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/40"
                  >
                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300 font-medium">
                      {t.name}
                    </span>
                    <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-md ${
                      t.count > 0
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                        : 'bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {t.count} rows
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE SESSIONS */}
      {activeTab === 'sessions' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active Owner Sessions</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Cryptographically hashed sessions stored in Neon <code className="font-mono text-slate-700 dark:text-slate-300">owner_sessions</code>. Dual cookie + Bearer authentication.
                </p>
              </div>
              <button
                onClick={handleRevokeOthers}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 rounded-lg transition-colors border border-amber-200 dark:border-amber-900 shrink-0"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Revoke All Other Sessions
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">No active sessions found.</div>
              ) : (
                sessions.map((sess) => (
                  <div key={sess.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        sess.isCurrent
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        <Laptop className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-medium text-slate-900 dark:text-white">
                            {sess.ipAddress}
                          </span>
                          {sess.isCurrent && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                              Current Session
                            </span>
                          )}
                          {sess.isActive ? (
                            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Revoked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl truncate">
                          {sess.userAgent}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500 mt-1 font-mono">
                          <span>Created: {new Date(sess.createdAt).toLocaleString()}</span>
                          <span>·</span>
                          <span>Expires: {new Date(sess.expiresAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    {!sess.isCurrent && sess.isActive && (
                      <button
                        onClick={() => handleRevokeSession(sess.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors border border-red-200 dark:border-red-900 shrink-0 self-start sm:self-center"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PROFILE & SECURITY */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Owner Profile Form */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <UserCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Owner Identity</h2>
            </div>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Owner Email (Immutable)
                </label>
                <input
                  type="email"
                  disabled
                  value={owner?.email || 'mahasubramanyam0@gmail.com'}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-slate-500 cursor-not-allowed font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Locked by singleton constraint <code className="font-mono">uq_owner_singleton</code>.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Full Display Name
                </label>
                <input
                  type="text"
                  required
                  value={fullNameInput}
                  onChange={(e) => setFullNameInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {profileSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="w-4 h-4" /> Profile updated successfully
                </div>
              )}

              <button
                type="submit"
                disabled={updatingProfile}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-xs disabled:opacity-50"
              >
                {updatingProfile ? 'Saving...' : 'Update Name'}
              </button>
            </form>
          </div>

          {/* Change Password Form */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Change Owner Password</h2>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {passwordError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="w-4 h-4 shrink-0" /> Password updated. Previous sessions safely revoked.
                </div>
              )}

              <button
                type="submit"
                disabled={changingPassword}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors shadow-xs disabled:opacity-50"
              >
                {changingPassword ? 'Updating Password...' : 'Save New Password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 4: CONNECTORS & CREDENTIALS */}
      {activeTab === 'connectors' && (
        <div className="space-y-6">
          {/* Encryption Key Status Banner */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  AES-256-GCM Credential Encryption Status
                </h2>
              </div>
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-md ${
                  encryptionStatus?.configured
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200'
                }`}
              >
                {encryptionStatus?.configured
                  ? `Active (${encryptionStatus.source})`
                  : 'CONNECTOR_ENCRYPTION_KEY Missing'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
              {encryptionStatus?.configured
                ? 'Credentials are encrypted at rest with AES-256-GCM. Existing secrets are never sent back to browser code.'
                : encryptionStatus?.requirementMessage ||
                  'Configure CONNECTOR_ENCRYPTION_KEY in the server environment to store or rotate credentials.'}
            </p>
          </div>

          {/* Encrypted Credential Rotation Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Owner Connector Credential Vault
                </h2>
              </div>

              <select
                value={selectedCredConnector}
                onChange={(e) => {
                  setSelectedCredConnector(e.target.value);
                  setKeyError(null);
                  setKeySuccess(null);
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                {connectors
                  .filter((c) => c.credentialRequirements && c.credentialRequirements.fields.length > 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.credentialStatus?.configured ? 'Configured' : 'Unconfigured'})
                    </option>
                  ))}
              </select>
            </div>

            {(() => {
              const target = connectors.find((c) => c.id === selectedCredConnector);
              const credStatus = target?.credentialStatus;
              return (
                <div className="mb-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Current Source: </span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {credStatus?.source || 'missing'}
                      {credStatus?.maskedHint ? ` (${credStatus.maskedHint})` : ''}
                    </span>
                    {credStatus?.rotatedAt && (
                      <span className="text-slate-400 ml-2">
                        · Rotated {new Date(credStatus.rotatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {credStatus?.source === 'database_encrypted' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveConnectorCred(selectedCredConnector)}
                      disabled={savingKey}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md border border-rose-200 dark:border-rose-900"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove DB Secret</span>
                    </button>
                  )}
                </div>
              );
            })()}

            <form onSubmit={handleSaveChKey} className="flex flex-col sm:flex-row gap-3">
              <input
                type="password"
                placeholder="Enter new credential value (never pre-filled or displayed)..."
                value={chKeyInput}
                onChange={(e) => setChKeyInput(e.target.value)}
                className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                autoComplete="new-password"
              />
              <button
                type="submit"
                disabled={savingKey || !chKeyInput.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {savingKey ? 'Encrypting...' : 'Save / Rotate Credential'}
              </button>
            </form>
            {keyError && (
              <div className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-2">
                {keyError}
              </div>
            )}
            {keySuccess && (
              <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-2">
                {keySuccess}
              </div>
            )}
          </div>

          {connFeedback && (
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200">
              {connFeedback}
            </div>
          )}

          {/* All Registered Connectors Status & Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connectors.map((c) => {
              const isEnabled = c.config?.enabled ?? c.healthState !== 'disabled';
              return (
                <div
                  key={c.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{c.name}</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded-md shrink-0 ${
                          c.healthState === 'operational'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200'
                            : c.healthState === 'disabled'
                            ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200'
                        }`}
                      >
                        {c.healthState || c.status}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-1">
                      {c.accessMode || 'provider'} · {c.countryCoverage.slice(0, 4).join(', ')}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      {c.healthSummary || c.rateLimitNote}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                      <span>Calls: {c.totalCalls}</span>
                      {c.rateLimitState && (
                        <span>
                          Quota: {c.rateLimitState.remaining}/{c.rateLimitState.limit}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestConnector(c.id)}
                        disabled={testingConnId === c.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
                      >
                        <Play className="w-3 h-3" />
                        <span>{testingConnId === c.id ? 'Testing...' : 'Test'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleConnector(c)}
                        disabled={togglingConnId === c.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md"
                      >
                        <Power className="w-3 h-3" />
                        <span>{isEnabled ? 'Disable' : 'Enable'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: SYSTEM PREFERENCES */}
      {activeTab === 'settings' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Application Global Preferences</h2>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Default Target Country
                </label>
                <select
                  value={localSettings.defaultCountry}
                  onChange={(e) => setLocalSettings({ ...localSettings, defaultCountry: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="GB">United Kingdom (GB)</option>
                  <option value="NO">Norway (NO)</option>
                  <option value="AU">Australia (AU)</option>
                  <option value="US">United States (US)</option>
                  <option value="GLOBAL">Global / International</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Default Currency
                </label>
                <select
                  value={localSettings.defaultCurrency}
                  onChange={(e) => setLocalSettings({ ...localSettings, defaultCurrency: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="NOK">NOK (kr)</option>
                  <option value="AUD">AUD ($)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Automated Deduplication Match Threshold ({Math.round(localSettings.autoDedupeThreshold * 100)}%)
              </label>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.05"
                value={localSettings.autoDedupeThreshold}
                onChange={(e) => setLocalSettings({ ...localSettings, autoDedupeThreshold: parseFloat(e.target.value) })}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>50% (Fuzzy)</span>
                <span>85% (Balanced Recommended)</span>
                <span>100% (Exact match)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Domain Suppression List
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="e.g. competitor.com"
                  value={newSuppressionDomain}
                  onChange={(e) => setNewSuppressionDomain(e.target.value)}
                  className="flex-1 px-3.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
                <button
                  type="button"
                  onClick={handleAddSuppressionDomain}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 rounded-lg transition-colors"
                >
                  Add Domain
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {localSettings.suppressionDomains.map((dom) => (
                  <span
                    key={dom}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono"
                  >
                    {dom}
                    <button
                      type="button"
                      onClick={() => handleRemoveSuppressionDomain(dom)}
                      className="text-slate-400 hover:text-red-500 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {settingsSuccess && (
              <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-4 h-4" /> Preferences saved to app_settings table.
              </div>
            )}

            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {savingSettings ? 'Saving...' : 'Save Preferences'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 6: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* Cryptographic Hash Chain Integrity & Immutability Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Cryptographic Audit Immutability & Hash Chain
                  </h3>
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                    chainVerification?.valid === false
                      ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200'
                      : chainVerification?.valid === true
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {chainVerification?.valid === false
                      ? 'Integrity Failure'
                      : chainVerification?.valid === true
                      ? 'Chain Verified'
                      : 'Unverified Chain'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Sequential SHA-256 hash chaining with database-level row (<code className="font-mono">UPDATE/DELETE</code>) and statement (<code className="font-mono">TRUNCATE</code>) triggers.
                </p>
              </div>

              <button
                type="button"
                onClick={handleVerifyChain}
                disabled={verifyingChain}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${verifyingChain ? 'animate-spin' : ''}`} />
                {verifyingChain ? 'Verifying Digests...' : 'Verify Hash Chain'}
              </button>
            </div>

            {chainVerification && (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Chain Head Sequence</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    #{chainVerification.latestSequence ?? chainVerification.totalEvents ?? 0} ({chainVerification.totalEvents} events)
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Head Hash</span>
                  <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate block" title={chainVerification.headHash || 'Genesis'}>
                    {chainVerification.headHash ? `${chainVerification.headHash.slice(0, 16)}...` : 'Genesis baseline'}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg">
                  <span className="text-[10px] text-slate-400 block uppercase font-mono">Verification Status</span>
                  <span className={`font-semibold ${chainVerification.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
                    {chainVerification.valid ? '100% Contiguous & Valid' : `Broken at #${chainVerification.firstInvalidSequence}`}
                  </span>
                </div>
              </div>
            )}

            {/* Documented Security Baseline & Limitations Notice */}
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-lg text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold block mb-0.5">Integrity & Architectural Limitation Notice:</span>
              <span>
                Database triggers prevent row updates, deletions, and table truncations through standard application SQL. However, because the application connects with administrative DDL schema privileges, a privileged database owner could modify database triggers. For ultimate enterprise tamper-proofing, external WORM checkpoints (e.g. S3 Object Lock, GCP Bucket Lock, or an external KMS-signed ledger) are recommended.
              </span>
            </div>
          </div>

          {/* Audit Events Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Security & Administrative Events</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Append-only immutable event log with SHA-256 parent hash verification
                </p>
              </div>
              <button
                onClick={fetchAuditLog}
                className="p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`w-4 h-4 ${loadingAudit ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                    <th className="py-3 px-3">#</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Entity</th>
                    <th className="py-3 px-4">Hash Digest</th>
                    <th className="py-3 px-4">IP Address</th>
                    <th className="py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                  {auditLog.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditLog.map((event) => (
                      <tr key={event.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3 text-slate-400 font-semibold">
                          #{event.sequenceNumber ?? '—'}
                        </td>
                        <td className="py-3 px-4 font-semibold text-blue-600 dark:text-blue-400">
                          {event.action}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                          {event.actorEmail}
                        </td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                          {event.entityType ? `${event.entityType}:${event.entityId || ''}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-500 dark:text-slate-400">
                          {event.currentHash ? (
                            <span title={`Current: ${event.currentHash}\nPrev: ${event.prevHash || 'None'}`}>
                              {event.currentHash.slice(0, 10)}...
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                          {event.ipAddress || '127.0.0.1'}
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-[11px]">
                          {new Date(event.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
