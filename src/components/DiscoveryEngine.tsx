import React, { useState, useEffect } from 'react';
import {
  Search,
  Globe2,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Plus,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Info,
  Check,
  ChevronRight,
  Filter,
  ChevronLeft,
  Layers,
} from 'lucide-react';
import {
  CanonicalLead,
  CountryReference,
  AdministrativeDivision,
  CityReference,
  ConnectorStatus,
} from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';

interface DiscoveryEngineProps {
  onAddLeadToCrm: (lead: CanonicalLead) => void;
  onBatchAddLeads: (leads: CanonicalLead[]) => void;
  onInspectLead: (lead: CanonicalLead) => void;
  initialCountry?: string;
}

const FEATURED_COUNTRIES = [
  { code: 'NO', name: 'Norway', flag: '🇳🇴', defaultConnector: 'conn-brreg' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', defaultConnector: 'conn-companies-house' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', defaultConnector: 'conn-abn' },
  { code: 'US', name: 'United States', flag: '🇺🇸', defaultConnector: 'conn-osm' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', defaultConnector: 'conn-osm' },
  { code: 'FR', name: 'France', flag: '🇫🇷', defaultConnector: 'conn-osm' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', defaultConnector: 'conn-osm' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', defaultConnector: 'conn-osm' },
  { code: 'IN', name: 'India', flag: '🇮🇳', defaultConnector: 'conn-osm' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', defaultConnector: 'conn-osm' },
  { code: 'GLOBAL', name: 'Global', flag: '🌐', defaultConnector: 'conn-osm' },
];

const PRESET_CATEGORIES = [
  'Healthcare & Dental',
  'Software & Technology',
  'Legal & Law Practice',
  'Accounting & Finance',
  'Engineering & Consultancy',
  'Renewable Energy',
  'Manufacturing & Logistics',
];

export const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({
  onAddLeadToCrm,
  onBatchAddLeads,
  onInspectLead,
  initialCountry,
}) => {
  const [countries, setCountries] = useState<CountryReference[]>([]);
  const [selectedCountry, setSelectedCountry] = useState(initialCountry || 'NO');
  const [divisions, setDivisions] = useState<AdministrativeDivision[]>([]);
  const [selectedDivision, setSelectedDivision] = useState('');
  const [city, setCity] = useState(initialCountry && initialCountry !== 'NO' ? '' : 'Trondheim');
  const [citySuggestions, setCitySuggestions] = useState<CityReference[]>([]);
  const [query, setQuery] = useState('Semiconductor');
  const [connectorId, setConnectorId] = useState('conn-brreg');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<CanonicalLead[]>([]);
  const [attribution, setAttribution] = useState('');
  const [providerNote, setProviderNote] = useState('');
  const [abnLookupInfo, setAbnLookupInfo] = useState<{
    isLiveApi: boolean;
    lookupMode: string;
    isChecksumValid?: boolean;
  } | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<{
    region?: string;
    regionSupportedByConnector?: boolean;
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorStatus[]>([]);
  const [page, setPage] = useState<number>(1);
  const [fetchAllPages, setFetchAllPages] = useState<boolean>(false);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    totalItems?: number;
    totalPages?: number;
    hasMore: boolean;
  } | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  // Sync initialCountry when changed from Capability Matrix navigation
  useEffect(() => {
    if (initialCountry) {
      handleCountryChange(initialCountry);
    }
  }, [initialCountry]);

  // Load countries and searchable connectors on mount
  useEffect(() => {
    apiFetch('/api/geo/countries')
      .then((res) => res.json())
      .then((data: CountryReference[]) => {
        if (Array.isArray(data)) {
          setCountries(data);
        }
      })
      .catch((err) => console.error('Failed to load countries:', err));

    apiFetch('/api/connectors?capability=company_search')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.connectors)) {
          setAvailableConnectors(data.connectors);
        }
      })
      .catch((err) => console.error('Failed to load discovery connectors:', err));
  }, []);

  // When selected country changes, load divisions and adjust default connector
  useEffect(() => {
    if (selectedCountry === 'GLOBAL') {
      setDivisions([]);
      setSelectedDivision('');
      setConnectorId('conn-osm');
      return;
    }

    // Auto-select best connector
    if (selectedCountry === 'NO') {
      setConnectorId('conn-brreg');
    } else if (selectedCountry === 'GB') {
      setConnectorId('conn-companies-house');
    } else if (selectedCountry === 'AU') {
      setConnectorId('conn-abn');
    } else {
      setConnectorId('conn-osm');
    }

    // Fetch administrative divisions
    apiFetch(`/api/geo/divisions?country=${selectedCountry}`)
      .then((res) => res.json())
      .then((data) => {
        setDivisions(data.divisions || []);
        setSelectedDivision('');
      })
      .catch(() => setDivisions([]));

    // Fetch popular cities for quick selection
    apiFetch(`/api/geo/cities?country=${selectedCountry}&limit=8`)
      .then((res) => res.json())
      .then((data) => setCitySuggestions(data.cities || []))
      .catch(() => setCitySuggestions([]));
  }, [selectedCountry]);

  // When division or city search query changes, refresh city suggestions via server
  useEffect(() => {
    if (selectedCountry !== 'GLOBAL') {
      const params = new URLSearchParams();
      params.set('country', selectedCountry);
      if (selectedDivision) params.set('division', selectedDivision);
      if (city.trim()) params.set('query', city.trim());
      params.set('limit', '8');
      apiFetch(`/api/geo/cities?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => setCitySuggestions(data.cities || []))
        .catch(() => setCitySuggestions([]));
    }
  }, [selectedDivision, selectedCountry, city]);

  const currentCountryObj = countries.find((c) => c.code === selectedCountry);

  const handleCountryChange = (code: string) => {
    setSelectedCountry(code);
    if (code === 'NO') {
      setQuery('Semiconductor');
      setCity('Trondheim');
    } else if (code === 'GB') {
      setQuery('Artificial Intelligence');
      setCity('London');
    } else if (code === 'AU') {
      setQuery('Technology');
      setCity('Sydney');
    } else if (code === 'US') {
      setQuery('Biotech');
      setCity('Boston');
    } else if (code === 'DE') {
      setQuery('Engineering');
      setCity('Munich');
    } else {
      setQuery('Commercial');
      setCity('');
    }
  };

  const handleSearch = async (e?: React.FormEvent, targetPage?: number) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    const effectivePage = typeof targetPage === 'number' ? Math.max(1, targetPage) : 1;
    setPage(effectivePage);
    setIsLoading(true);
    setErrors([]);
    setResults([]);
    setAttribution('');
    setProviderNote('');
    setAbnLookupInfo(null);
    setAppliedFilters(null);
    setPagination(null);
    setLastRunId(null);

    const selectedDivisionObj = divisions.find((d) => d.code === selectedDivision);
    const regionValue = selectedDivisionObj?.name || selectedDivision || undefined;

    try {
      const res = await apiFetch('/api/discovery/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          countryCode: selectedCountry === 'GLOBAL' ? undefined : selectedCountry,
          region: regionValue,
          city: city.trim() || undefined,
          connectorId,
          page: effectivePage,
          fetchAllPages,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to search registry');
      }

      setResults(data.leads || []);
      setAttribution(data.attribution || '');
      setProviderNote(data.providerNote || '');
      setAbnLookupInfo(data.abnLookupInfo || null);
      setAppliedFilters(data.appliedFilters || null);
      setPagination(data.pagination || null);
      setLastRunId(data.runId || null);
      if (data.errors) {
        setErrors(data.errors);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors([msg]);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedConnectorMeta = availableConnectors.find((c) => c.id === connectorId);
  const accessModeBadgeLabel = (mode?: ConnectorStatus['accessMode']): string => {
    switch (mode) {
      case 'live_api':
        return 'Live API';
      case 'offline_reference':
        return 'Offline Reference';
      case 'public_directory':
        return 'Public Directory';
      case 'manual_portal':
        return 'Manual Portal';
      default:
        return 'Standard';
    }
  };

  const handleSaveIndividual = (lead: CanonicalLead) => {
    onAddLeadToCrm(lead);
    setAddedIds((prev) => new Set(prev).add(lead.id));
  };

  const handleSaveAll = () => {
    onBatchAddLeads(results);
    const newSet = new Set(addedIds);
    results.forEach((r) => newSet.add(r.id));
    setAddedIds(newSet);
  };

  return (
    <div className="space-y-6">
      {/* Top Search Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Globe2 className="w-5 h-5 text-indigo-400" />
              Global Business Discovery & Official Registry Engine
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Query official corporate registers, company numbers, and geographic POI across 195 sovereign states.
            </p>
          </div>

          {/* Quick Country Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {FEATURED_COUNTRIES.map((c) => {
              const isSelected = selectedCountry === c.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => handleCountryChange(c.code)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded font-medium transition ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span>{c.flag}</span>
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Global Country Picker & Info Badge */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{currentCountryObj?.flag || '🌐'}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">
                  {currentCountryObj?.name || 'Global Multilateral Jurisdiction'}
                </span>
                {currentCountryObj?.nativeName && (
                  <span className="text-[11px] text-slate-400 font-medium">
                    ({currentCountryObj.nativeName})
                  </span>
                )}
                {currentCountryObj?.isSovereignState && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                    Sovereign State
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                <span>ISO: {currentCountryObj?.code || 'GLOBAL'} / {currentCountryObj?.alpha3 || 'WLD'}</span>
                <span>•</span>
                <span>Dialing: {currentCountryObj?.callingCode || 'E.164'}</span>
                <span>•</span>
                <span>Currency: {currentCountryObj?.currency || 'USD'} ({currentCountryObj?.currencySymbol || '$'})</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="text-[11px] text-slate-400 font-medium">All 195 States:</label>
            <select
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-white text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 max-w-[200px]"
            >
              <option value="GLOBAL">🌐 Global / Any Jurisdiction</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Business Name, Keyword, or Registration Number
            </label>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Nordic Semiconductor, DeepMind, Clinic, 923609016..."
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-2 pl-9 focus:outline-none focus:border-indigo-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          {/* Administrative Division (if present) */}
          {divisions.length > 0 ? (
            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                {currentCountryObj?.addressFormat.regionLabel || 'Region'}
              </label>
              <select
                value={selectedDivision}
                onChange={(e) => setSelectedDivision(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
              >
                <option value="">All {currentCountryObj?.addressFormat.regionLabel || 'Regions'} ({divisions.length})</option>
                {divisions.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* City / Locality input */}
          <div className={divisions.length > 0 ? 'md:col-span-3' : 'md:col-span-4'}>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              City or Locality (Optional)
            </label>
            <div className="relative">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. London, Oslo, Sydney..."
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-2 pl-9 focus:outline-none focus:border-indigo-500"
              />
              <MapPin className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          {/* Connector Selector */}
          <div className={divisions.length > 0 ? 'md:col-span-3' : 'md:col-span-4'}>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Active Data Source Connector
            </label>
            <select
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              {availableConnectors.length > 0 ? (
                availableConnectors.map((conn) => {
                  const modeTag = accessModeBadgeLabel(conn.accessMode);
                  const disabledTag = conn.healthState === 'disabled' ? ' [Disabled]' : '';
                  const credTag =
                    conn.healthState === 'authentication_required' ? ' (Key Req.)' : '';
                  return (
                    <option key={conn.id} value={conn.id}>
                      {conn.shortName || conn.name} — {modeTag}
                      {credTag}
                      {disabledTag}
                    </option>
                  );
                })
              ) : (
                <>
                  <option value="conn-brreg">🇳🇴 Brreg (Norway Official Open Registry)</option>
                  <option value="conn-companies-house">🇬🇧 UK Companies House (API Key Req.)</option>
                  <option value="conn-abn">🇦🇺 AU ABN (Checksum Validator + 5-Record Ref)</option>
                  <option value="conn-osm">🌐 OpenStreetMap POI (Supports Region Filter)</option>
                </>
              )}
            </select>
            {selectedConnectorMeta?.healthState === 'disabled' && (
              <p className="text-[10px] text-rose-400 mt-1">
                Connector is disabled. Enable it in Connectors Hub before querying.
              </p>
            )}
            {selectedDivision &&
              !(selectedConnectorMeta ? selectedConnectorMeta.supportsRegionFilter : connectorId === 'conn-osm') && (
                <p className="text-[10px] text-amber-400 mt-1">
                  Region filter is not supported by this connector upstream; applied in OpenStreetMap POI only.
                </p>
              )}
          </div>

          {/* City Quick Suggestions */}
          {citySuggestions.length > 0 && (
            <div className="md:col-span-12 flex items-center gap-1.5 flex-wrap -mt-1">
              <span className="text-[10px] text-slate-400 font-medium">Popular Cities:</span>
              {citySuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCity(c.name)}
                  className={`text-[10px] px-2 py-0.5 rounded transition ${
                    city.toLowerCase() === c.name.toLowerCase()
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Action Row */}
          <div className="md:col-span-12 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400">Presets:</span>
              {PRESET_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setQuery(cat)}
                  className="px-2 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={fetchAllPages}
                  onChange={(e) => setFetchAllPages(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>Multi-page fetch</span>
              </label>

              <button
                type="submit"
                disabled={isLoading || selectedConnectorMeta?.healthState === 'disabled'}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded shadow-sm transition disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Querying Registry...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Discover Leads</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Attribution, Provider Notice & Capability Banner */}
      {(attribution || providerNote || abnLookupInfo) && (
        <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-slate-400 text-xs space-y-1.5">
          {attribution && (
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span>
                <strong>Legal Provenance:</strong> {attribution}
              </span>
            </div>
          )}
          {abnLookupInfo && !abnLookupInfo.isLiveApi && (
            <div className="flex items-center gap-2 text-amber-300">
              <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Offline Reference / Checksum Mode:</strong> Live Australian Business Register XML/JSON lookups require an official ABR GUID. Results reflect local ATO Modulo-89 validation and 5 sample reference entities only.
              </span>
            </div>
          )}
          {providerNote && (
            <div className="text-amber-400 text-[11px] pl-6">
              {providerNote}
            </div>
          )}
          {appliedFilters?.region && appliedFilters.regionSupportedByConnector === false && (
            <div className="text-slate-400 text-[11px] pl-6">
              Region filter &ldquo;{appliedFilters.region}&rdquo; was preserved for CRM tracking; upstream registry endpoint does not filter by state/county.
            </div>
          )}
        </div>
      )}

      {/* Errors Banner */}
      {errors.length > 0 && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded-lg text-red-300 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>Data Connector Notice:</span>
          </div>
          {errors.map((err, i) => (
            <div key={i} className="pl-6">
              • {err}
            </div>
          ))}
        </div>
      )}

      {/* Results Header & Pagination */}
      {results.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">Discovered Candidates</span>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 tabular-nums">
              {results.length} Organizations Found
            </span>
            {pagination && (
              <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-900 border border-slate-800 text-slate-400 tabular-nums">
                Page {pagination.page}
                {pagination.totalPages ? ` / ${pagination.totalPages}` : ''}
                {pagination.totalItems !== undefined ? ` (${pagination.totalItems} total)` : ''}
              </span>
            )}
            {lastRunId && (
              <span className="text-[10px] font-mono text-slate-500">Run {lastRunId}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {pagination && (pagination.page > 1 || pagination.hasMore) && !fetchAllPages && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isLoading || pagination.page <= 1}
                  onClick={() => handleSearch(undefined, pagination.page - 1)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs rounded transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={isLoading || !pagination.hasMore}
                  onClick={() => handleSearch(undefined, pagination.page + 1)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs rounded transition"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              onClick={handleSaveAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add All to CRM Pipeline</span>
            </button>
          </div>
        </div>
      )}

      {/* Results Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {results.map((lead) => {
          const isAdded = addedIds.has(lead.id);

          return (
            <div
              key={lead.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition flex flex-col justify-between"
            >
              <div className="space-y-2.5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <span>{lead.companyName}</span>
                    </h3>
                    {lead.legalName && lead.legalName !== lead.companyName && (
                      <p className="text-[11px] text-slate-400 mt-0.5">Legal: {lead.legalName}</p>
                    )}
                  </div>

                  {lead.confidenceScore >= 0 && (
                    <div
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        lead.confidenceScore >= 80
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : lead.confidenceScore >= 60
                          ? 'bg-blue-950 text-blue-400 border border-blue-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {lead.confidenceScore}% Confidence
                    </div>
                  )}
                </div>

                {/* Key Attributes */}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800/60">
                  {lead.registrationNumber && (
                    <div>
                      <span className="text-slate-500 text-[10px] block">REGISTRATION ID</span>
                      <span className="font-mono text-slate-200">
                        {lead.registrationType ? `${lead.registrationType}: ` : ''}
                        {lead.registrationNumber}
                      </span>
                    </div>
                  )}

                  {lead.address?.city && (
                    <div>
                      <span className="text-slate-500 text-[10px] block">LOCATION</span>
                      <span className="text-slate-200">
                        {lead.address.city}
                        {lead.address.region ? `, ${lead.address.region}` : ''} ({lead.address.countryCode})
                      </span>
                    </div>
                  )}

                  {lead.industry && (
                    <div className="col-span-2">
                      <span className="text-slate-500 text-[10px] block">INDUSTRY CLASSIFICATION</span>
                      <span className="text-slate-200">{lead.industry}</span>
                    </div>
                  )}
                </div>

                {/* Address Display */}
                {lead.address?.formattedAddress && (
                  <div className="text-[11px] text-slate-400 flex items-start gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                    <span>{lead.address.formattedAddress}</span>
                  </div>
                )}

                {/* Signals */}
                {lead.confidenceSignals && lead.confidenceSignals.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {lead.confidenceSignals.map((signal, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-2 py-0.5 bg-slate-950 text-slate-400 border border-slate-800 rounded"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  {lead.website && (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      <Globe2 className="w-3 h-3" />
                      <span>Website</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onInspectLead(lead)}
                    className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition"
                  >
                    View Details
                  </button>

                  <button
                    onClick={() => handleSaveIndividual(lead)}
                    disabled={isAdded}
                    className={`flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded transition ${
                      isAdded
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800 cursor-default'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Added to CRM</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3" />
                        <span>Add to CRM</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
