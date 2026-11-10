import React, { useState } from 'react';
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
} from 'lucide-react';
import { CanonicalLead } from '../types.js';

interface DiscoveryEngineProps {
  onAddLeadToCrm: (lead: CanonicalLead) => void;
  onBatchAddLeads: (leads: CanonicalLead[]) => void;
  onInspectLead: (lead: CanonicalLead) => void;
}

const COUNTRIES = [
  { code: 'NO', name: 'Norway', flag: '🇳🇴', defaultConnector: 'conn-brreg', note: '100% Free Open API (Brreg)' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', defaultConnector: 'conn-companies-house', note: 'Companies House Official Registry' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', defaultConnector: 'conn-abn', note: 'ABN Checksum & Official Register' },
  { code: 'US', name: 'United States', flag: '🇺🇸', defaultConnector: 'conn-osm', note: 'OpenStreetMap POI & Web Crawler' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', defaultConnector: 'conn-osm', note: 'Commercial Register & OSM POI' },
  { code: 'FR', name: 'France', flag: '🇫🇷', defaultConnector: 'conn-osm', note: 'SIRENE & OpenStreetMap' },
  { code: 'GLOBAL', name: 'Global / Any', flag: '🌐', defaultConnector: 'conn-osm', note: 'Multi-source Geographic Discovery' },
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
}) => {
  const [selectedCountry, setSelectedCountry] = useState('NO');
  const [city, setCity] = useState('');
  const [query, setQuery] = useState('Semiconductor');
  const [connectorId, setConnectorId] = useState('conn-brreg');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<CanonicalLead[]>([]);
  const [attribution, setAttribution] = useState('');
  const [providerNote, setProviderNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const handleCountryChange = (code: string) => {
    setSelectedCountry(code);
    const countryObj = COUNTRIES.find((c) => c.code === code);
    if (countryObj) {
      setConnectorId(countryObj.defaultConnector);
      if (code === 'NO') {
        setQuery('Semiconductor');
        setCity('Trondheim');
      } else if (code === 'GB') {
        setQuery('Artificial Intelligence');
        setCity('London');
      } else if (code === 'AU') {
        setQuery('Technology');
        setCity('Sydney');
      } else {
        setQuery('Clinic');
        setCity('Berlin');
      }
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setErrors([]);
    setResults([]);
    setAttribution('');
    setProviderNote('');

    try {
      const res = await fetch('/api/discovery/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          countryCode: selectedCountry === 'GLOBAL' ? undefined : selectedCountry,
          city: city.trim() || undefined,
          connectorId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to search registry');
      }

      setResults(data.leads || []);
      setAttribution(data.attribution || '');
      setProviderNote(data.providerNote || '');
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
              Query official corporate registers and geographic POI data sources with transparent provenance.
            </p>
          </div>

          {/* Country Selection Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {COUNTRIES.map((c) => {
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
                placeholder="e.g. Nordic Semiconductor, DeepMind, Dental..."
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-2 pl-9 focus:outline-none focus:border-indigo-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              City or Region (Optional)
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

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Active Data Source Connector
            </label>
            <select
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="conn-brreg">🇳🇴 Brreg (Norway Official Registry)</option>
              <option value="conn-companies-house">🇬🇧 UK Companies House (Official)</option>
              <option value="conn-abn">🇦🇺 ABN Lookup (Australia Business Register)</option>
              <option value="conn-osm">🌐 OpenStreetMap / Nominatim POI (Global)</option>
            </select>
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded flex items-center justify-center gap-2 transition"
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Querying...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Discover Leads</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Quick Category Chips */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-400">Quick Sectors:</span>
          {PRESET_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setQuery(cat.split('&')[0].trim());
                handleSearch();
              }}
              className="text-[11px] px-2 py-0.5 bg-slate-950 text-slate-400 hover:text-indigo-300 border border-slate-800 rounded transition"
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications / Error Banners */}
      {errors.length > 0 && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold">Discovery Connector Alert:</div>
            {errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        </div>
      )}

      {providerNote && (
        <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-amber-200 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>{providerNote}</div>
        </div>
      )}

      {/* Search Results Section */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 px-4 py-3 rounded-lg border border-slate-800">
            <div>
              <span className="text-xs font-semibold text-white">
                Discovered {results.length} Verified Real Business Records
              </span>
              {attribution && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  License: <span className="text-slate-300">{attribution}</span>
                </p>
              )}
            </div>

            <button
              onClick={handleSaveAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import All to CRM Pipeline</span>
            </button>
          </div>

          {/* Results Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((lead) => {
              const isAdded = addedIds.has(lead.id);
              const source = lead.sources[0];

              return (
                <div
                  key={lead.id}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg p-4 flex flex-col justify-between transition group shadow-sm"
                >
                  <div className="space-y-2.5">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate group-hover:text-indigo-400 transition">
                          {lead.companyName}
                        </h3>
                        {lead.registrationNumber && (
                          <div className="flex items-center gap-1 text-[11px] text-cyan-400 font-mono mt-0.5">
                            <span className="text-slate-500">{lead.registrationType}:</span>
                            <span>{lead.registrationNumber}</span>
                          </div>
                        )}
                      </div>

                      {/* Confidence Score */}
                      <div className="text-right flex-shrink-0">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded ${
                            lead.confidenceScore >= 80
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {lead.confidenceScore}% Conf
                        </span>
                      </div>
                    </div>

                    {/* Metadata attributes */}
                    <div className="space-y-1 text-xs text-slate-300">
                      {lead.address?.formattedAddress && (
                        <div className="flex items-start gap-1.5 text-slate-400">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                          <span className="truncate">{lead.address.formattedAddress}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Building2 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{lead.industry}</span>
                      </div>

                      {lead.website && (
                        <div className="flex items-center gap-1.5 text-indigo-400">
                          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline truncate"
                          >
                            {lead.domain || lead.website}
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Signals preview */}
                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1">
                      {lead.confidenceSignals.slice(0, 2).map((sig, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 text-[10px] bg-slate-950 text-slate-400 rounded border border-slate-800"
                        >
                          {sig}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                    <button
                      onClick={() => onInspectLead(lead)}
                      className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-medium transition"
                    >
                      <span>Deep Inspect</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleSaveIndividual(lead)}
                      disabled={isAdded}
                      className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition ${
                        isAdded
                          ? 'bg-slate-800 text-slate-400 cursor-default'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>In Pipeline</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>Add Lead</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Initial Explanatory Card when empty */}
      {results.length === 0 && !isLoading && (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center mx-auto text-indigo-400">
            <Globe2 className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-sm font-semibold text-white">Ready for Real Lead Discovery</h3>
            <p className="text-xs text-slate-400 mt-1">
              Select any country above, enter an industry keyword or company name, and query real open registries
              (Norway Brreg, UK Companies House, Australia ABN, OpenStreetMap).
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> No mockups
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Official Registries
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Transparent Attributions
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
