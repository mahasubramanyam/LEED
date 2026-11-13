import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Settings,
  Key,
  Save,
  Globe2,
  RefreshCw,
  Power,
  Play,
  Sliders,
  History,
  Trash2,
  Lock,
  Filter,
} from 'lucide-react';
import {
  ConnectorStatus,
  AppSettings,
  ConnectorRunRecord,
  ConnectorEncryptionStatus,
  ConnectorHealthState,
  ConnectorAccessMode,
} from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';

interface ConnectorsViewProps {
  connectors: ConnectorStatus[];
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => Promise<void> | void;
  onRefreshConnectors: () => Promise<void> | void;
  onOpenMatrix?: () => void;
}

function formatHealthLabel(state?: ConnectorHealthState): {
  label: string;
  badgeClass: string;
} {
  switch (state) {
    case 'operational':
      return {
        label: 'Operational',
        badgeClass:
          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
      };
    case 'not_tested':
      return {
        label: 'Not Tested',
        badgeClass:
          'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      };
    case 'authentication_required':
      return {
        label: 'Auth Required',
        badgeClass:
          'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
      };
    case 'configuration_required':
      return {
        label: 'Config Required',
        badgeClass:
          'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
      };
    case 'rate_limited':
      return {
        label: 'Rate Limited',
        badgeClass:
          'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800',
      };
    case 'temporarily_unavailable':
      return {
        label: 'Unavailable',
        badgeClass:
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
      };
    case 'degraded':
      return {
        label: 'Degraded',
        badgeClass:
          'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
      };
    case 'disabled':
      return {
        label: 'Disabled',
        badgeClass:
          'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-700',
      };
    default:
      return {
        label: 'Registered',
        badgeClass:
          'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      };
  }
}

function formatAccessMode(mode?: ConnectorAccessMode, authType?: string): {
  label: string;
  toneClass: string;
} {
  switch (mode) {
    case 'live_api':
      return {
        label: authType === 'none_open' ? 'Live Open API' : 'Live API (Key)',
        toneClass:
          'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
      };
    case 'public_directory':
      return {
        label: 'Public Directory',
        toneClass:
          'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800',
      };
    case 'offline_reference':
      return {
        label: 'Offline Reference',
        toneClass:
          'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
      };
    case 'manual_portal':
      return {
        label: 'Manual Portal',
        toneClass:
          'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      };
    case 'internal_crawler':
      return {
        label: 'Internal Crawler',
        toneClass:
          'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
      };
    case 'ai_inference':
      return {
        label: 'AI Inference',
        toneClass:
          'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800',
      };
    default:
      return {
        label: 'Provider',
        toneClass:
          'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      };
  }
}

export const ConnectorsView: React.FC<ConnectorsViewProps> = ({
  connectors,
  settings,
  onUpdateSettings,
  onRefreshConnectors,
  onOpenMatrix,
}) => {
  const [activeTab, setActiveTab] = useState<'connectors' | 'runs' | 'settings'>('connectors');

  // Filter controls
  const [countryFilter, setCountryFilter] = useState('ALL');
  const [capabilityFilter, setCapabilityFilter] = useState('ALL');
  const [healthFilter, setHealthFilter] = useState('ALL');

  // Live encryption status & execution runs
  const [encryptionStatus, setEncryptionStatus] = useState<ConnectorEncryptionStatus | null>(null);
  const [runs, setRuns] = useState<ConnectorRunRecord[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runsConnectorFilter, setRunsConnectorFilter] = useState('ALL');

  // Action feedback
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Expanded per-connector drawers
  const [openCredId, setOpenCredId] = useState<string | null>(null);
  const [credInputs, setCredInputs] = useState<Record<string, string>>({});
  const [savingCred, setSavingCred] = useState(false);

  const [openConfigId, setOpenConfigId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<{
    timeoutMs: number;
    maxRetries: number;
    rateLimitMax: number;
    rateLimitWindowMs: number;
  }>({ timeoutMs: 10000, maxRetries: 2, rateLimitMax: 60, rateLimitWindowMs: 60000 });
  const [savingConfig, setSavingConfig] = useState(false);

  // Settings Tab State
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  const [ownerEmail, setOwnerEmail] = useState(settings.ownerEmail);
  const [defaultCountry, setDefaultCountry] = useState(settings.defaultCountry || 'GB');
  const [defaultCurrency, setDefaultCurrency] = useState(settings.defaultCurrency || 'USD');
  const [userAgent, setUserAgent] = useState(settings.userAgent);
  const [approvalRequired, setApprovalRequired] = useState(settings.outreachApprovalRequired);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setOwnerName(settings.ownerName);
    setOwnerEmail(settings.ownerEmail);
    setDefaultCountry(settings.defaultCountry || 'GB');
    setDefaultCurrency(settings.defaultCurrency || 'USD');
    setUserAgent(settings.userAgent);
    setApprovalRequired(settings.outreachApprovalRequired);
  }, [settings]);

  const loadEncryptionAndRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const [encRes, runsRes] = await Promise.all([
        apiFetch('/api/connectors/encryption-status'),
        apiFetch('/api/connectors/runs?limit=60'),
      ]);
      if (encRes.ok) {
        setEncryptionStatus(await encRes.json());
      }
      if (runsRes.ok) {
        const data = await runsRes.json();
        setRuns(data.runs || []);
      }
    } catch (err) {
      console.error('Failed to load connector telemetry:', err);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    loadEncryptionAndRuns();
  }, [loadEncryptionAndRuns]);

  const showBanner = (type: 'success' | 'error', text: string) => {
    setActionMessage({ type, text });
    setTimeout(() => setActionMessage(null), 5000);
  };

  const handleTestConnection = async (connectorId: string) => {
    setTestingId(connectorId);
    try {
      const res = await apiFetch(`/api/connectors/${connectorId}/test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Connection test failed');
      } else if (data.validation?.ok) {
        showBanner('success', `${data.connector?.shortName || connectorId}: ${data.validation.message}`);
      } else {
        showBanner('error', `${data.connector?.shortName || connectorId}: ${data.validation?.message || 'Validation failed'}`);
      }
      await Promise.all([onRefreshConnectors(), loadEncryptionAndRuns()]);
    } catch (err: any) {
      showBanner('error', err?.message || 'Connection test failed');
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (c: ConnectorStatus) => {
    const currentlyEnabled = c.config?.enabled ?? c.healthState !== 'disabled';
    setTogglingId(c.id);
    try {
      const endpoint = currentlyEnabled ? `/api/connectors/${c.id}/disable` : `/api/connectors/${c.id}/enable`;
      const res = await apiFetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Failed to update connector state');
      } else {
        showBanner('success', `${c.shortName || c.name} ${currentlyEnabled ? 'disabled' : 'enabled'}.`);
      }
      await onRefreshConnectors();
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to toggle connector');
    } finally {
      setTogglingId(null);
    }
  };

  const handleOpenCredentials = (c: ConnectorStatus) => {
    if (openCredId === c.id) {
      setOpenCredId(null);
      return;
    }
    setOpenConfigId(null);
    setOpenCredId(c.id);
    setCredInputs({});
  };

  const handleSaveCredentials = async (c: ConnectorStatus, e: React.FormEvent) => {
    e.preventDefault();
    setSavingCred(true);
    try {
      const isRotation = c.credentialStatus?.source === 'database_encrypted';
      const res = await apiFetch(`/api/connectors/${c.id}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: credInputs, rotate: isRotation }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Failed to store encrypted credentials');
        return;
      }
      setCredInputs({});
      setOpenCredId(null);
      showBanner(
        'success',
        `Encrypted credentials ${isRotation ? 'rotated' : 'saved'} for ${c.shortName || c.name}.`
      );
      await onRefreshConnectors();
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to store credentials');
    } finally {
      setSavingCred(false);
    }
  };

  const handleRemoveCredentials = async (c: ConnectorStatus) => {
    setSavingCred(true);
    try {
      const res = await apiFetch(`/api/connectors/${c.id}/credentials`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Failed to remove credentials');
        return;
      }
      setCredInputs({});
      setOpenCredId(null);
      showBanner('success', `Stored credentials removed for ${c.shortName || c.name}.`);
      await onRefreshConnectors();
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to remove credentials');
    } finally {
      setSavingCred(false);
    }
  };

  const handleOpenConfig = (c: ConnectorStatus) => {
    if (openConfigId === c.id) {
      setOpenConfigId(null);
      return;
    }
    setOpenCredId(null);
    setOpenConfigId(c.id);
    setConfigDraft({
      timeoutMs: c.config?.timeoutMs ?? 10000,
      maxRetries: c.config?.maxRetries ?? 2,
      rateLimitMax: c.config?.rateLimitMax ?? c.rateLimitState?.limit ?? 60,
      rateLimitWindowMs: c.config?.rateLimitWindowMs ?? c.rateLimitState?.windowMs ?? 60000,
    });
  };

  const handleSaveConfig = async (connectorId: string, e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await apiFetch(`/api/connectors/${connectorId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configDraft),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Failed to save connector execution policy');
        return;
      }
      setOpenConfigId(null);
      showBanner('success', 'Connector execution policy updated.');
      await onRefreshConnectors();
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to update configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onUpdateSettings({
        ownerName,
        ownerEmail,
        defaultCountry,
        defaultCurrency,
        userAgent,
        outreachApprovalRequired: approvalRequired,
      });
      showBanner('success', 'Application and crawler defaults saved successfully.');
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const filteredConnectors = connectors.filter((c) => {
    if (countryFilter !== 'ALL') {
      if (countryFilter === 'GLOBAL' && !c.supportsAllCountries && !c.countryCoverage.includes('GLOBAL')) {
        return false;
      }
      if (
        countryFilter !== 'GLOBAL' &&
        !c.supportsAllCountries &&
        !c.countryCoverage.includes(countryFilter)
      ) {
        return false;
      }
    }
    if (capabilityFilter !== 'ALL') {
      if (!c.capabilities?.includes(capabilityFilter as any)) return false;
    }
    if (healthFilter !== 'ALL') {
      if ((c.healthState || 'not_tested') !== healthFilter) return false;
    }
    return true;
  });

  const filteredRuns = runs.filter((r) => runsConnectorFilter === 'ALL' || r.connectorId === runsConnectorFilter);

  const operationalCount = connectors.filter((c) => c.healthState === 'operational').length;
  const authOrConfigNeeded = connectors.filter(
    (c) => c.healthState === 'authentication_required' || c.healthState === 'configuration_required'
  ).length;
  const disabledCount = connectors.filter((c) => c.healthState === 'disabled').length;
  const totalInvocations = connectors.reduce((sum, c) => sum + (c.totalCalls || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>Unified Connector Registry & Execution Hub</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Standardized provider contracts, AES-256-GCM credentials, rate-limit governance, and execution telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onOpenMatrix && (
            <button
              type="button"
              onClick={onOpenMatrix}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 transition"
            >
              <Globe2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Country Matrix</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('connectors')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'connectors'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            Providers ({connectors.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('runs');
              loadEncryptionAndRuns();
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 ${
              activeTab === 'runs'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Execution History ({runs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Crawler Defaults</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Verified Operational
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {operationalCount} / {connectors.length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Tested or executed cleanly
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Auth / Config Attention
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {authOrConfigNeeded}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {disabledCount} disabled by owner
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Recorded Executions
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {totalInvocations}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Backed by connector_runs ledger
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            At-Rest Encryption Key
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            <Lock
              className={`w-4 h-4 ${
                encryptionStatus?.configured
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            />
            <span
              className={
                encryptionStatus?.configured
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }
            >
              {encryptionStatus?.configured ? 'AES-256-GCM Ready' : 'Key Missing'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono truncate">
            {encryptionStatus?.configured
              ? encryptionStatus.source
              : 'Set CONNECTOR_ENCRYPTION_KEY'}
          </div>
        </div>
      </div>

      {/* Encryption Key Warning Banner (never invents a key) */}
      {encryptionStatus && !encryptionStatus.configured && (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Application Encryption Key Requirement</div>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              {encryptionStatus.requirementMessage}
            </p>
          </div>
        </div>
      )}

      {/* Action Feedback Banner */}
      {actionMessage && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* TAB 1: PROVIDERS REGISTRY */}
      {activeTab === 'connectors' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <Filter className="w-3.5 h-3.5" />
              <span>Filter Registry:</span>
            </div>

            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="ALL">All Countries</option>
              <option value="NO">Norway (NO)</option>
              <option value="GB">United Kingdom (GB)</option>
              <option value="AU">Australia (AU)</option>
              <option value="GLOBAL">Global Providers</option>
            </select>

            <select
              value={capabilityFilter}
              onChange={(e) => setCapabilityFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="ALL">All Capabilities</option>
              <option value="company_search">Company Search</option>
              <option value="registry_lookup">Registry Lookup</option>
              <option value="identifier_validation">Identifier Validation</option>
              <option value="poi_search">Maps & POI Search</option>
              <option value="website_inspection">Website Inspection</option>
              <option value="ai_analysis">AI Analysis</option>
              <option value="pagination">Pagination</option>
            </select>

            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="ALL">All Health States</option>
              <option value="operational">Operational</option>
              <option value="not_tested">Not Tested</option>
              <option value="authentication_required">Authentication Required</option>
              <option value="configuration_required">Configuration Required</option>
              <option value="rate_limited">Rate Limited</option>
              <option value="temporarily_unavailable">Temporarily Unavailable</option>
              <option value="degraded">Degraded</option>
              <option value="disabled">Disabled</option>
            </select>

            <button
              type="button"
              onClick={() => {
                onRefreshConnectors();
                loadEncryptionAndRuns();
              }}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {/* Connector Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredConnectors.map((c) => {
              const healthBadge = formatHealthLabel(c.healthState);
              const accessBadge = formatAccessMode(c.accessMode, c.authType);
              const isEnabled = c.config?.enabled ?? c.healthState !== 'disabled';
              const acceptsCredentials =
                c.credentialRequirements && c.credentialRequirements.fields.length > 0;

              return (
                <div
                  key={c.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {c.name}
                        </h3>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${accessBadge.toneClass}`}
                        >
                          {accessBadge.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] text-slate-400">{c.id}</span>
                        <span>·</span>
                        <span className="capitalize">
                          {(c.sourceCategory || c.category).replace(/_/g, ' ')}
                        </span>
                        <span>·</span>
                        <span>Coverage: {c.countryCoverage.slice(0, 6).join(', ')}</span>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-md border shrink-0 ${healthBadge.badgeClass}`}
                    >
                      {healthBadge.label}
                    </span>
                  </div>

                  {c.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {c.description}
                    </p>
                  )}

                  {/* Telemetry Box */}
                  <div className="bg-slate-50 dark:bg-slate-950/70 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Credentials</span>
                      <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200">
                        {c.credentialStatus?.source === 'none_required'
                          ? 'Open Access (No Key)'
                          : c.credentialStatus?.configured
                          ? `${c.credentialStatus.source === 'database_encrypted' ? 'Encrypted DB' : 'Environment'}${
                              c.credentialStatus.maskedHint ? ` (${c.credentialStatus.maskedHint})` : ''
                            }`
                          : c.credentialRequirements?.required
                          ? 'Missing Required Key'
                          : 'Optional / Offline Reference'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Invocations / Streak</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {c.totalCalls} runs
                        {typeof c.recentFailureCount === 'number' && c.recentFailureCount > 0
                          ? ` · ${c.recentFailureCount} errors`
                          : ''}
                      </span>
                    </div>

                    {c.rateLimitState && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 dark:text-slate-400">Rate Budget</span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300">
                          {c.rateLimitState.remaining} / {c.rateLimitState.limit} per{' '}
                          {Math.round(c.rateLimitState.windowMs / 1000)}s
                        </span>
                      </div>
                    )}

                    {c.lastRunAt && (
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400">Last Executed</span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {new Date(c.lastRunAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Health & Provenance Summary */}
                  <div className="space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {c.healthSummary && (
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Health: </span>
                        <span>{c.healthSummary}</span>
                      </div>
                    )}
                    <div>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Rate Policy: </span>
                      <span>{c.rateLimitNote}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Attribution: </span>
                        <span>{c.attribution}</span>
                      </div>
                      {c.homepageUrl && (
                        <a
                          href={c.homepageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 shrink-0"
                        >
                          <span>Docs</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {c.lastError && (
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg text-rose-800 dark:text-rose-300 text-[11px]">
                      <span className="font-semibold">
                        [{c.lastErrorCategory || 'error'}]{' '}
                      </span>
                      {c.lastError}
                    </div>
                  )}

                  {/* Owner Action Controls */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTestConnection(c.id)}
                      disabled={testingId === c.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
                    >
                      {testingId === c.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      <span>{testingId === c.id ? 'Testing...' : 'Test Connection'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(c)}
                      disabled={togglingId === c.id}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition disabled:opacity-50 ${
                        isEnabled
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{isEnabled ? 'Disable' : 'Enable'}</span>
                    </button>

                    {acceptsCredentials && (
                      <button
                        type="button"
                        onClick={() => handleOpenCredentials(c)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 transition"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>
                          {c.credentialStatus?.source === 'database_encrypted'
                            ? 'Rotate Key'
                            : 'Credentials'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenConfig(c)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-700 transition ml-auto"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Policy</span>
                    </button>
                  </div>

                  {/* Inline Credential Rotation Drawer */}
                  {openCredId === c.id && c.credentialRequirements && (
                    <form
                      onSubmit={(e) => handleSaveCredentials(c, e)}
                      className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span>Encrypted Credential Update (Never Shown Back)</span>
                        </span>
                        {c.credentialStatus?.maskedHint && (
                          <span className="font-mono text-[11px] text-slate-500">
                            Active: {c.credentialStatus.maskedHint}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {c.credentialRequirements.setupInstructions}
                      </p>

                      {c.credentialRequirements.fields.map((field) => (
                        <div key={field.key}>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {field.label} {field.required ? '*' : '(Optional)'}
                          </label>
                          <input
                            type={field.secret ? 'password' : 'text'}
                            required={field.required}
                            value={credInputs[field.key] || ''}
                            onChange={(e) =>
                              setCredInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
                            }
                            placeholder={field.placeholder || 'Enter new secret value...'}
                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                            autoComplete="new-password"
                          />
                        </div>
                      ))}

                      <div className="flex items-center justify-between gap-2 pt-1">
                        {c.credentialStatus?.source === 'database_encrypted' ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveCredentials(c)}
                            disabled={savingCred}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-900"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove Stored Key</span>
                          </button>
                        ) : (
                          <span />
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setOpenCredId(null)}
                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:underline"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingCred}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>{savingCred ? 'Encrypting...' : 'Save Encrypted'}</span>
                          </button>
                        </div>
                      </div>
                    </form>
                  )}

                  {/* Inline Execution Policy Config Drawer */}
                  {openConfigId === c.id && (
                    <form
                      onSubmit={(e) => handleSaveConfig(c.id, e)}
                      className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3"
                    >
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        Execution Policy Overrides
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Timeout (ms)</label>
                          <input
                            type="number"
                            min={500}
                            max={120000}
                            value={configDraft.timeoutMs}
                            onChange={(e) =>
                              setConfigDraft((p) => ({ ...p, timeoutMs: Number(e.target.value) }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Max Retries (0–5)</label>
                          <input
                            type="number"
                            min={0}
                            max={5}
                            value={configDraft.maxRetries}
                            onChange={(e) =>
                              setConfigDraft((p) => ({ ...p, maxRetries: Number(e.target.value) }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Rate Limit Max</label>
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            value={configDraft.rateLimitMax}
                            onChange={(e) =>
                              setConfigDraft((p) => ({ ...p, rateLimitMax: Number(e.target.value) }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Window (ms)</label>
                          <input
                            type="number"
                            min={500}
                            max={3600000}
                            value={configDraft.rateLimitWindowMs}
                            onChange={(e) =>
                              setConfigDraft((p) => ({
                                ...p,
                                rateLimitWindowMs: Number(e.target.value),
                              }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenConfigId(null)}
                          className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingConfig}
                          className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                        >
                          {savingConfig ? 'Saving...' : 'Save Policy'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: EXECUTION HISTORY LEDGER */}
      {activeTab === 'runs' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Connector Execution History
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Auditable record of searches, connection tests, enrichments, and classified errors.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={runsConnectorFilter}
                onChange={(e) => setRunsConnectorFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="ALL">All Providers</option>
                {connectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName || c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={loadEncryptionAndRuns}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                <RefreshCw className={`w-4 h-4 ${loadingRuns ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                  <th className="py-3 px-4">Connector</th>
                  <th className="py-3 px-3">Operation</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Discovered / Norm / Rej</th>
                  <th className="py-3 px-3 text-right">Duration</th>
                  <th className="py-3 px-4">Error Category & Summary</th>
                  <th className="py-3 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRuns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No connector executions recorded yet. Run a connection test or discovery query.
                    </td>
                  </tr>
                ) : (
                  filteredRuns.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                        {r.connectorId}
                      </td>
                      <td className="py-3 px-3 capitalize text-slate-600 dark:text-slate-300">
                        {r.operation.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                            r.status === 'success'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                              : r.status === 'cancelled'
                              ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                              : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {r.recordsDiscovered} / {r.recordsNormalized} / {r.recordsRejected}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {r.durationMs !== undefined ? `${r.durationMs}ms` : '—'}
                      </td>
                      <td className="py-3 px-4 max-w-md">
                        {r.errorCategory && (
                          <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400 mr-1.5">
                            [{r.errorCategory}]
                          </span>
                        )}
                        <span className="text-slate-600 dark:text-slate-300">
                          {r.diagnosticSummary || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CRAWLER & OWNER DEFAULTS */}
      {activeTab === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 max-w-2xl shadow-xs"
        >
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Single-Owner Application & Crawler Defaults</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Owner Name / Organization
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 focus:outline-none focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Owner Email
              </label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Default Discovery Jurisdiction
              </label>
              <select
                value={defaultCountry}
                onChange={(e) => setDefaultCountry(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg p-2.5"
              >
                <option value="GB">United Kingdom (GB)</option>
                <option value="NO">Norway (NO)</option>
                <option value="AU">Australia (AU)</option>
                <option value="US">United States (US)</option>
                <option value="DE">Germany (DE)</option>
                <option value="FR">France (FR)</option>
                <option value="CA">Canada (CA)</option>
                <option value="JP">Japan (JP)</option>
                <option value="IN">India (IN)</option>
                <option value="SG">Singapore (SG)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Default Pipeline Currency
              </label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg p-2.5"
              >
                <option value="USD">USD — US Dollar ($)</option>
                <option value="GBP">GBP — British Pound (£)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="NOK">NOK — Norwegian Krone (kr)</option>
                <option value="AUD">AUD — Australian Dollar ($)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Compliant HTTP User-Agent
            </label>
            <input
              type="text"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 font-mono"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Sent to OpenStreetMap Nominatim, Brreg, and safe web inspections to comply with open-data usage policies.
            </p>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
              />
              <span className="font-semibold">Enforce Human Approval before Outbound Messages</span>
            </label>
            <p className="text-[11px] text-slate-500 pl-6">
              Strict safeguard: prevents automated background outreach dispatch without explicit owner approval.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingSettings ? 'Saving...' : 'Save Defaults'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
