import React, { useState, useEffect } from 'react';
import {
  Globe2,
  Search,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Key,
  Lock,
  Info,
  Clock,
  RefreshCw,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Ban,
  Wrench,
  Database,
} from 'lucide-react';
import { CountrySourceCapability, SevenStateRegistryStatus } from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';
import { formatDateLocale, formatNumberLocale } from '../../shared/localization.ts';
import { WorkspaceToolbar } from './ui/SunsetUI.tsx';

interface CountryMatrixViewProps {
  onNavigateToDiscovery?: (countryCode: string) => void;
}

const SEVEN_STATE_META: Record<
  SevenStateRegistryStatus,
  {
    label: string;
    shortLabel: string;
    badgeClass: string;
    dotClass: string;
  }
> = {
  live_and_operational: {
    label: 'Live & Operational',
    shortLabel: 'Live',
    badgeClass:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
  live_auth_required: {
    label: 'Live (Auth Required)',
    shortLabel: 'Auth Req.',
    badgeClass:
      'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-800',
    dotClass: 'bg-blue-500',
  },
  configuration_required: {
    label: 'Configuration Required',
    shortLabel: 'Config Req.',
    badgeClass:
      'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800',
    dotClass: 'bg-amber-500',
  },
  offline_reference_only: {
    label: 'Offline Reference Only',
    shortLabel: 'Offline Ref.',
    badgeClass:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
    dotClass: 'bg-slate-400',
  },
  public_access_unavailable: {
    label: 'Public Access Unavailable',
    shortLabel: 'Restricted',
    badgeClass:
      'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800',
    dotClass: 'bg-rose-500',
  },
  not_implemented: {
    label: 'Not Implemented',
    shortLabel: 'Unbuilt',
    badgeClass:
      'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800',
    dotClass: 'bg-indigo-500',
  },
  temporarily_unavailable: {
    label: 'Temporarily Unavailable',
    shortLabel: 'Temp. Down',
    badgeClass:
      'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border border-orange-300 dark:border-orange-800',
    dotClass: 'bg-orange-500',
  },
};

function inferSevenStateFallback(cap: CountrySourceCapability): SevenStateRegistryStatus {
  if (cap.registryState) return cap.registryState;
  switch (cap.integrationStatus) {
    case 'live_open_api':
    case 'configured_api_key':
      return 'live_and_operational';
    case 'requires_api_key':
      return 'live_auth_required';
    case 'restricted_manual_only':
      return 'public_access_unavailable';
    case 'public_directory_permit':
      return 'not_implemented';
    case 'unavailable':
    default:
      return 'offline_reference_only';
  }
}

export const CountryMatrixView: React.FC<CountryMatrixViewProps> = ({ onNavigateToDiscovery }) => {
  const [capabilities, setCapabilities] = useState<CountrySourceCapability[]>([]);
  const [stateSummary, setStateSummary] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedRegistryState, setSelectedRegistryState] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [auditedOnly, setAuditedOnly] = useState<boolean>(false);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  const fetchMatrix = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/geo/capability-matrix');
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data.matrix || []);
        setStateSummary(data.stateSummary || {});
      }
    } catch (err) {
      console.error('Failed to load capability matrix:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMatrix();
  }, []);

  const filtered = capabilities.filter((cap) => {
    const resolvedState = inferSevenStateFallback(cap);
    if (auditedOnly && !cap.auditDetails) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = cap.countryName.toLowerCase().includes(q);
      const matchCode = cap.countryCode.toLowerCase().includes(q);
      const matchProvider = cap.providerName.toLowerCase().includes(q);
      const matchNotes = cap.notes.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchProvider && !matchNotes) return false;
    }

    if (selectedRegistryState !== 'ALL' && resolvedState !== selectedRegistryState) return false;
    if (selectedType !== 'ALL' && cap.sourceType !== selectedType) return false;

    return true;
  });

  const countForState = (state: SevenStateRegistryStatus): number => {
    if (typeof stateSummary[state] === 'number') return stateSummary[state];
    return capabilities.filter((c) => inferSevenStateFallback(c) === state).length;
  };

  const renderStateBadge = (state: SevenStateRegistryStatus) => {
    const meta = SEVEN_STATE_META[state];
    let icon = <Globe2 className="w-3 h-3" />;
    if (state === 'live_and_operational') icon = <CheckCircle2 className="w-3 h-3" />;
    else if (state === 'live_auth_required') icon = <Key className="w-3 h-3" />;
    else if (state === 'configuration_required') icon = <Wrench className="w-3 h-3" />;
    else if (state === 'offline_reference_only') icon = <Database className="w-3 h-3" />;
    else if (state === 'public_access_unavailable') icon = <Lock className="w-3 h-3" />;
    else if (state === 'not_implemented') icon = <Info className="w-3 h-3" />;
    else if (state === 'temporarily_unavailable') icon = <AlertCircle className="w-3 h-3" />;

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold ${meta.badgeClass}`}>
        {icon}
        <span>{meta.label}</span>
      </span>
    );
  };

  const getSourceTypeLabel = (type: string) => {
    switch (type) {
      case 'official_open_registry':
        return 'Official Open Government Registry';
      case 'official_api_credentials':
        return 'Official Registry (API Credentials)';
      case 'public_geo_directory':
        return 'Public Commercial Geo POI';
      case 'web_inspector':
        return 'Public Website Inspector (SSRF Safe)';
      case 'manual_registry_portal':
        return 'Restricted Government Commercial Portal';
      case 'geographic_reference_only':
        return 'Geographic Reference Only (No Registry)';
      default:
        return 'Geographic & Address Standards';
    }
  };

  return (
    <div className="space-y-5">
      <WorkspaceToolbar
        meta="29 audited national & cross-border registries · 195 sovereign states"
        actions={
          <button
            type="button"
            onClick={fetchMatrix}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        }
      />

      {/* 7-State Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {(Object.keys(SEVEN_STATE_META) as SevenStateRegistryStatus[]).map((stateKey) => {
          const meta = SEVEN_STATE_META[stateKey];
          const count = countForState(stateKey);
          const isSelected = selectedRegistryState === stateKey;
          return (
            <button
              key={stateKey}
              type="button"
              onClick={() => setSelectedRegistryState(isSelected ? 'ALL' : stateKey)}
              className={`text-left border rounded-xl p-3 transition ${
                isSelected
                  ? 'bg-[#910303]/10 dark:bg-[#910303] border-[#CE0404] text-[#910303] dark:text-[#FAF4F4]'
                  : 'bg-white dark:bg-[#440303] border-slate-200 dark:border-[#7A1E1E] hover:border-[#CE0404] dark:hover:bg-[#690303]'
              }`}
            >
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                {meta.shortLabel}
              </div>
              <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50 mt-0.5">
                {formatNumberLocale(count)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{meta.label}</div>
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by country, registry name, authority, or audit notes..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 pl-9 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          <div className="sm:col-span-3">
            <select
              value={selectedRegistryState}
              onChange={(e) => setSelectedRegistryState(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All 7 Registry States</option>
              {(Object.keys(SEVEN_STATE_META) as SevenStateRegistryStatus[]).map((stateKey) => (
                <option key={stateKey} value={stateKey}>
                  {SEVEN_STATE_META[stateKey].label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Source Types</option>
              <option value="official_open_registry">Official Open Registry</option>
              <option value="official_api_credentials">Official Registry (Key)</option>
              <option value="public_geo_directory">Commercial POI Directory</option>
              <option value="web_inspector">Web Inspector (SSRF Safe)</option>
              <option value="manual_registry_portal">Manual Portal Only</option>
              <option value="geographic_reference_only">Geographic Reference Only</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span>
              Showing <span className="font-mono tabular-nums font-semibold">{filtered.length}</span> of{' '}
              <span className="font-mono tabular-nums font-semibold">{capabilities.length}</span> registry entries
            </span>
            <button
              type="button"
              onClick={() => setAuditedOnly((v) => !v)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition ${
                auditedOnly
                  ? 'bg-blue-600/10 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              {auditedOnly ? 'Showing Priority Audited (29)' : 'Priority Audited Only (29)'}
            </button>
          </div>
          <span className="text-[11px] text-slate-400">
            Last verified timestamps reflect actual recorded connector execution runs only
          </span>
        </div>
      </div>

      {/* Capabilities List */}
      <div className="space-y-3">
        {filtered.map((cap) => {
          const resolvedState = inferSevenStateFallback(cap);
          const isAuditOpen = expandedAuditId === cap.id;

          return (
            <div
              key={cap.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="text-xl">{cap.flag}</span>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {cap.providerName}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                      {cap.countryCode}
                    </span>
                    {cap.connectorId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-mono">
                        {cap.connectorId}
                      </span>
                    )}
                    {renderStateBadge(resolvedState)}
                  </div>

                  <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {getSourceTypeLabel(cap.sourceType)} · Auth:{' '}
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {cap.authRequirement}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {cap.notes}
                  </p>

                  {/* Features & Coverage Tags */}
                  {cap.coverageFeatures && cap.coverageFeatures.length > 0 && (
                    <div className="flex items-center flex-wrap gap-1.5 pt-1">
                      {cap.coverageFeatures.map((feat, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60"
                        >
                          {feat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action & Telemetry Column */}
                <div className="flex lg:flex-col items-start lg:items-end justify-between gap-2.5 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                  <div className="lg:text-right space-y-0.5">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Licensing</div>
                    <div
                      className="text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[240px] truncate"
                      title={cap.licensingInfo}
                    >
                      {cap.licensingInfo}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center lg:justify-end gap-1 font-mono tabular-nums">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        {cap.lastVerifiedAt
                          ? `Verified ${formatDateLocale(cap.lastVerifiedAt)}`
                          : 'Not verified yet'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {cap.auditDetails && (
                      <button
                        type="button"
                        onClick={() => setExpandedAuditId(isAuditOpen ? null : cap.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      >
                        <FileCheck2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>8-Point Audit</span>
                        {isAuditOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    )}

                    {cap.sourceUrl && (
                      <a
                        href={cap.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                        title="Open Official Source Portal"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}

                    {onNavigateToDiscovery && cap.countryCode !== 'GLOBAL' && (
                      <button
                        onClick={() => onNavigateToDiscovery(cap.countryCode)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition"
                      >
                        <span>Query</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable 8-Criteria Official Audit Drawer */}
              {isAuditOpen && cap.auditDetails && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-950/60 p-4 rounded-lg border border-slate-200/80 dark:border-slate-800">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      1. Official API Availability
                    </div>
                    <div className="mt-0.5 text-slate-800 dark:text-slate-200 flex items-start gap-1.5">
                      {cap.auditDetails.officialApiExists ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <Ban className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                      )}
                      <span>{cap.auditDetails.officialApiSummary}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      2. Public Access Permitted
                    </div>
                    <div className="mt-0.5 text-slate-800 dark:text-slate-200 flex items-start gap-1.5">
                      {cap.auditDetails.publicAccessPermitted ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                      )}
                      <span>{cap.auditDetails.publicAccessSummary}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      3. Authentication & Credentials
                    </div>
                    <div className="mt-0.5 text-slate-800 dark:text-slate-200">
                      {cap.auditDetails.authenticationAndCredentials}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      4. Documentation & Access Restrictions
                    </div>
                    <div className="mt-0.5 text-slate-800 dark:text-slate-200 space-y-1">
                      <div>{cap.auditDetails.accessRestrictions}</div>
                      {cap.auditDetails.documentationUrl && (
                        <a
                          href={cap.auditDetails.documentationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-mono text-[11px]"
                        >
                          <span>{cap.auditDetails.documentationUrl}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      5. Available Official Business Fields
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {cap.auditDetails.availableBusinessFields.map((field) => (
                        <span
                          key={field}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      6. Search & Verification Capabilities
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {cap.auditDetails.searchAndVerificationCapabilities.map((item) => (
                        <span
                          key={item}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      7. Rate Limits & Pagination
                    </div>
                    <div className="mt-0.5 text-slate-800 dark:text-slate-200">
                      {cap.auditDetails.rateLimitsAndPagination}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      8. Commercial Use & Redistribution
                    </div>
                    <div className="mt-0.5 text-slate-800 dark:text-slate-200">
                      {cap.auditDetails.commercialUseAndRedistribution}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8">
            <Globe2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No matching sources found</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Try adjusting your keyword, registry state, or source type filters.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
