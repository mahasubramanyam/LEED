import React, { useState, useEffect } from 'react';
import {
  Globe2,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building2,
  Key,
  Lock,
  Layers,
  ArrowRight,
  Info,
  Clock,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { CountrySourceCapability } from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';

interface CountryMatrixViewProps {
  onNavigateToDiscovery?: (countryCode: string) => void;
}

export const CountryMatrixView: React.FC<CountryMatrixViewProps> = ({ onNavigateToDiscovery }) => {
  const [capabilities, setCapabilities] = useState<CountrySourceCapability[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL');

  const fetchMatrix = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/geo/capability-matrix');
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data.matrix || []);
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
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = cap.countryName.toLowerCase().includes(q);
      const matchCode = cap.countryCode.toLowerCase().includes(q);
      const matchProvider = cap.providerName.toLowerCase().includes(q);
      const matchNotes = cap.notes.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchProvider && !matchNotes) return false;
    }

    if (selectedStatus !== 'ALL' && cap.integrationStatus !== selectedStatus) return false;
    if (selectedType !== 'ALL' && cap.sourceType !== selectedType) return false;
    if (selectedCountry !== 'ALL' && cap.countryCode !== selectedCountry) return false;

    return true;
  });

  const liveOpenCount = capabilities.filter((c) => c.integrationStatus === 'live_open_api').length;
  const credentialedCount = capabilities.filter((c) => c.integrationStatus === 'configured_api_key' || c.integrationStatus === 'requires_api_key').length;
  const restrictedCount = capabilities.filter((c) => c.integrationStatus === 'restricted_manual_only' || c.integrationStatus === 'public_directory_permit').length;
  const geoOnlyCount = capabilities.filter((c) => c.integrationStatus === 'unavailable').length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'live_open_api':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            Live Open API
          </span>
        );
      case 'configured_api_key':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            <Key className="w-3 h-3 text-blue-500" />
            Key Configured
          </span>
        );
      case 'requires_api_key':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <Key className="w-3 h-3 text-amber-500" />
            Requires Credentials
          </span>
        );
      case 'public_directory_permit':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
            <Info className="w-3 h-3 text-indigo-500" />
            Directory / Account
          </span>
        );
      case 'restricted_manual_only':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            <Lock className="w-3 h-3 text-rose-500" />
            Restricted / Manual Portal
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            <Globe2 className="w-3 h-3 text-slate-400" />
            Geographic Data Only
          </span>
        );
    }
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
      default:
        return 'Geographic & Address Standards';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Global Country & Source Capability Matrix
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
            Audit-grade classification of international business data sources across all 195 sovereign states and territories.
            Distinguishes live open government APIs, credential-gated registries, public geospatial directories, and restricted manual portals.
          </p>
        </div>

        <button
          onClick={fetchMatrix}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Audit Matrix</span>
        </button>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Sovereign States</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">195 / 195</div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">100% UN Sovereignty Coverage</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Live Open Registries</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{liveOpenCount}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Brreg (NO), ABR (AU), OSM (195)</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Credentialed / Paid APIs</div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{credentialedCount}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">UK Companies House, SEC EDGAR</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Restricted / Manual Portals</div>
          <div className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">{restrictedCount}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Germany, France, Switzerland, etc.</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by country, registry name, authority, or notes..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 pl-9 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          <div className="sm:col-span-3">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Integration Statuses</option>
              <option value="live_open_api">Live Open API</option>
              <option value="configured_api_key">API Key Configured</option>
              <option value="requires_api_key">Requires API Credentials</option>
              <option value="public_directory_permit">Directory / Permit</option>
              <option value="restricted_manual_only">Restricted / Manual Only</option>
              <option value="unavailable">Geographic Data Only</option>
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
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
          <span>Showing {filtered.length} of {capabilities.length} international intelligence sources</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Live</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Key</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Manual</span>
          </div>
        </div>
      </div>

      {/* Capabilities List */}
      <div className="space-y-3">
        {filtered.map((cap) => (
          <div
            key={cap.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition"
          >
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center flex-wrap gap-2.5">
                  <span className="text-xl">{cap.flag}</span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {cap.providerName}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                    {cap.countryCode}
                  </span>
                  {getStatusBadge(cap.integrationStatus)}
                </div>

                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {getSourceTypeLabel(cap.sourceType)} • Auth:{' '}
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

              {/* Action column */}
              <div className="flex lg:flex-col items-center lg:items-end justify-between gap-2.5 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                <div className="text-right">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Licensing</div>
                  <div className="text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[200px] truncate" title={cap.licensingInfo}>
                    {cap.licensingInfo}
                  </div>
                </div>

                <div className="flex items-center gap-2">
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
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8">
            <Globe2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No matching sources found</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Try adjusting your keyword or status filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};
