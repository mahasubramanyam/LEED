import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Building2,
  ExternalLink,
  Mail,
  Phone,
  Trash2,
  Layers,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Plus,
  X,
} from 'lucide-react';
import { CanonicalLead, PipelineStage } from '../types.ts';
import { GeoSelector } from './GeoSelector.tsx';
import { apiFetch } from '../utils/apiFetch.ts';
import {
  getUiIdentifierOptions,
  canonicalizeIdentifierType,
  getDefaultIdentifierTypeForCountry,
} from '../../shared/identifierRegistry.ts';
import { formatCurrencyLocale, getLocaleForCountry } from '../../shared/localization.ts';

function getCountryFlag(code?: string): string {
  if (!code || code.length !== 2) return '🌐';
  try {
    const c = code.toUpperCase();
    const codePoints = [...c].map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

interface LeadsViewProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  onSelectLead: (lead: CanonicalLead) => void;
  onCreateLead?: (lead: CanonicalLead) => Promise<void> | void;
  onUpdateLeadStage: (leadId: string, stageId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onBatchUpdateStage: (leadIds: string[], stageId: string) => void;
  onBatchDelete: (leadIds: string[]) => void;
}

export function LeadsView({
  leads,
  stages,
  onSelectLead,
  onCreateLead,
  onUpdateLeadStage,
  onDeleteLead,
  onBatchUpdateStage,
  onBatchDelete,
}: LeadsViewProps) {
  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('ALL');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedStage, setSelectedStage] = useState('ALL');
  const [selectedIdentifierType, setSelectedIdentifierType] = useState('ALL');
  const [onlyWithWebsite, setOnlyWithWebsite] = useState(false);
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);
  const [sortBy, setSortBy] = useState<'createdAt' | 'companyName' | 'confidenceScore' | 'opportunityValue' | 'country' | 'updatedAt'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [serverLeads, setServerLeads] = useState<CanonicalLead[]>(leads);
  const [totalMatching, setTotalMatching] = useState<number>(leads.length);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isQuerying, setIsQuerying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const uiIdentifierOptions = getUiIdentifierOptions();

  const fetchServerLeads = useCallback(async () => {
    setIsQuerying(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (selectedCountry !== 'ALL') params.set('country', selectedCountry);
      if (selectedRegion.trim()) params.set('region', selectedRegion.trim());
      if (selectedCity.trim()) params.set('city', selectedCity.trim());
      if (selectedStage !== 'ALL') params.set('stage', selectedStage);
      if (selectedIdentifierType !== 'ALL') params.set('identifierType', selectedIdentifierType);
      if (onlyWithWebsite) params.set('hasWebsite', 'true');
      if (onlyWithEmail) params.set('hasEmail', 'true');
      if (onlyWithPhone) params.set('hasPhone', 'true');
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await apiFetch(`/api/leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setServerLeads(Array.isArray(data.leads) ? data.leads : []);
        setTotalMatching(typeof data.total === 'number' ? data.total : (data.leads?.length || 0));
        setTotalPages(typeof data.totalPages === 'number' ? Math.max(1, data.totalPages) : 1);
      }
    } catch (err) {
      console.error('Failed to query leads from server:', err);
    } finally {
      setIsQuerying(false);
    }
  }, [
    search,
    selectedCountry,
    selectedRegion,
    selectedCity,
    selectedStage,
    selectedIdentifierType,
    onlyWithWebsite,
    onlyWithEmail,
    onlyWithPhone,
    sortBy,
    sortDir,
    page,
    pageSize,
  ]);

  // Reset to page 1 when filter criteria change
  useEffect(() => {
    setPage(1);
  }, [
    search,
    selectedCountry,
    selectedRegion,
    selectedCity,
    selectedStage,
    selectedIdentifierType,
    onlyWithWebsite,
    onlyWithEmail,
    onlyWithPhone,
    sortBy,
    sortDir,
    pageSize,
  ]);

  // Query server with debounce for text filters and refresh when parent leads mutate
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchServerLeads();
    }, 180);
    return () => clearTimeout(timer);
  }, [fetchServerLeads, leads]);

  // New Lead Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIndustry, setNewIndustry] = useState('Commercial Services');
  const [newWebsite, setNewWebsite] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newIdentType, setNewIdentType] = useState<string>('UK_CRN');
  const [newIdentValue, setNewIdentValue] = useState('');
  const [newGeo, setNewGeo] = useState({
    countryCode: 'GB',
    countryName: 'United Kingdom',
    region: '',
    city: '',
    postalCode: '',
    street: '',
    currency: 'GBP',
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !onCreateLead) return;
    setIsCreating(true);
    setCreateError(null);

    try {
      let formattedAddress = [newGeo.street, newGeo.city, newGeo.region, newGeo.postalCode, newGeo.countryName]
        .filter(Boolean)
        .join(', ');
      const addrRes = await apiFetch('/api/geo/format-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: newGeo.street,
          city: newGeo.city,
          region: newGeo.region,
          postalCode: newGeo.postalCode,
          country: newGeo.countryName,
          countryCode: newGeo.countryCode,
        }),
      });
      if (addrRes.ok) {
        const addrData = await addrRes.json();
        if (addrData.postalValidation && !addrData.postalValidation.valid) {
          setCreateError(addrData.postalValidation.message || 'Postal code is required or invalid for this country');
          setIsCreating(false);
          return;
        }
        if (addrData.formattedAddress) formattedAddress = addrData.formattedAddress;
      }

      const rawPhone = newPhone.trim() || undefined;
      let normalizedPhone: string | undefined = undefined;
      if (rawPhone) {
        const pRes = await apiFetch('/api/geo/normalize-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: rawPhone, countryCode: newGeo.countryCode }),
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.valid && pData.e164) normalizedPhone = pData.e164;
        }
      }

      let domain: string | undefined;
      if (newWebsite.trim()) {
        try {
          const u = new URL(newWebsite.trim().startsWith('http') ? newWebsite.trim() : `https://${newWebsite.trim()}`);
          domain = u.hostname.replace(/^www\./, '');
        } catch {
          domain = undefined;
        }
      }

      const canonicalIdentType = canonicalizeIdentifierType(newIdentType, newGeo.countryCode);
      const identifiers: any[] = [];
      if (domain) {
        identifiers.push({ type: 'DOMAIN', value: domain, normalizedValue: domain, source: 'owner_manual_entry', status: 'user_provided', verified: false });
      }
      if (newIdentValue.trim()) {
        const valRes = await apiFetch('/api/identifiers/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: canonicalIdentType, value: newIdentValue.trim(), countryCode: newGeo.countryCode }),
        });
        let status = 'user_provided';
        let normalizedValue = newIdentValue.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        let issuingAuthority: string | undefined;
        if (valRes.ok) {
          const valData = await valRes.json();
          status = valData.status || (valData.valid ? 'syntax_validated' : 'user_provided');
          normalizedValue = valData.normalizedValue || normalizedValue;
          issuingAuthority = valData.issuingAuthority;
        }
        identifiers.push({
          type: canonicalIdentType,
          value: newIdentValue.trim(),
          normalizedValue,
          countryCode: newGeo.countryCode,
          issuingAuthority,
          source: 'owner_manual_entry',
          status,
          verified: false,
        });
      }

      const now = new Date().toISOString();
      const lead: CanonicalLead = {
        id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        companyName: newName.trim(),
        registrationNumber: newIdentValue.trim() || undefined,
        registrationType: newIdentValue.trim() ? canonicalIdentType : undefined,
        website: newWebsite.trim() || undefined,
        domain,
        email: newEmail.trim() || undefined,
        phone: rawPhone,
        phoneNormalized: normalizedPhone,
        address: {
          street: newGeo.street.trim() || undefined,
          city: newGeo.city.trim() || undefined,
          region: newGeo.region.trim() || undefined,
          postalCode: newGeo.postalCode.trim() || undefined,
          country: newGeo.countryName,
          countryCode: newGeo.countryCode,
          formattedAddress,
        },
        industry: newIndustry.trim() || 'Commercial Services',
        category: 'Manual Entry',
        confidenceScore: newIdentValue.trim() ? 70 : 55,
        confidenceSignals: ['Owner Manual Entry'],
        sources: [
          {
            sourceName: 'Owner Manual Entry',
            retrievedAt: now,
            attribution: 'Manually created by owner',
          },
        ],
        identifiers,
        status: 'new',
        pipelineStageId: stages[0]?.id || undefined,
        currency: newGeo.currency || 'USD',
        tags: [newGeo.countryCode],
        notes: [],
        activities: [
          {
            id: `act-${Date.now()}`,
            type: 'enrichment',
            title: 'Lead Created Manually',
            date: now,
            actor: 'Owner',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      if (onCreateLead) {
        await onCreateLead(lead);
      }
      setIsCreateOpen(false);
      setNewName('');
      setNewWebsite('');
      setNewEmail('');
      setNewPhone('');
      setNewIdentValue('');
    } catch (err) {
      console.error(err);
      setCreateError(err instanceof Error ? err.message : 'Failed to create lead');
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = serverLeads;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filtered.map((l) => l.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const countries = Array.from(
    new Set(leads.map((l) => l.address?.countryCode).filter(Boolean))
  ) as string[];

  return (
    <div className="space-y-4">
      {/* Search and Filters Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter leads by company, CRN/ABN/OrgNr, domain..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 pl-9 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          <div className="md:col-span-2">
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Countries ({leads.length})</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {getCountryFlag(c)} {c} ({leads.filter((l) => l.address?.countryCode === c).length})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <input
              type="text"
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              placeholder="Region / State..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <input
              type="text"
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              placeholder="City..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <select
              value={selectedIdentifierType}
              onChange={(e) => setSelectedIdentifierType(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All ID Types</option>
              {uiIdentifierOptions.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.shortLabel}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Attribute filter toggles, sorting & New Lead Action */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-3 flex-wrap text-slate-600 dark:text-slate-300">
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-1 focus:outline-hidden"
            >
              <option value="ALL">All Stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({leads.filter((l) => l.pipelineStageId === s.id).length})
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={`${sortBy}:${sortDir}`}
                onChange={(e) => {
                  const [sb, sd] = e.target.value.split(':');
                  setSortBy(sb as any);
                  setSortDir((sd as 'asc' | 'desc') || 'desc');
                }}
                className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-2 py-1 focus:outline-hidden"
              >
                <option value="createdAt:desc">Newest First</option>
                <option value="updatedAt:desc">Recently Updated</option>
                <option value="companyName:asc">Company A-Z</option>
                <option value="confidenceScore:desc">Confidence High-Low</option>
                <option value="opportunityValue:desc">Value High-Low</option>
                <option value="country:asc">Country A-Z</option>
              </select>
            </div>
            <span className="text-slate-400 font-medium">Require:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithWebsite}
                onChange={(e) => setOnlyWithWebsite(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0"
              />
              <span>Website</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithEmail}
                onChange={(e) => setOnlyWithEmail(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0"
              />
              <span>Email</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithPhone}
                onChange={(e) => setOnlyWithPhone(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0"
              />
              <span>Phone</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-slate-500 dark:text-slate-400 text-xs">
              {isQuerying ? (
                <span className="font-mono text-blue-500">Querying server...</span>
              ) : (
                <>
                  Showing <strong className="text-slate-900 dark:text-white font-mono">{filtered.length}</strong> of{' '}
                  <strong className="font-mono">{totalMatching}</strong> matching ({leads.length} total)
                </>
              )}
            </div>
            {onCreateLead && (
              <button
                onClick={() => setIsCreateOpen(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-1.5 text-xs transition shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Lead</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Create International Lead Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                Create International Organization Lead
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Company / Organization Name *</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Nordic Robotics AS"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Industry / Sector</label>
                  <input
                    type="text"
                    value={newIndustry}
                    onChange={(e) => setNewIndustry(e.target.value)}
                    placeholder="e.g. Manufacturing & Technology"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                <GeoSelector
                  countryCode={newGeo.countryCode}
                  region={newGeo.region}
                  city={newGeo.city}
                  postalCode={newGeo.postalCode}
                  street={newGeo.street}
                  onChange={(geo) => {
                    if (geo.countryCode !== newGeo.countryCode) {
                      setNewIdentType(getDefaultIdentifierTypeForCountry(geo.countryCode));
                    }
                    setNewGeo({
                      countryCode: geo.countryCode,
                      countryName: geo.countryName,
                      region: geo.region || '',
                      city: geo.city || '',
                      postalCode: geo.postalCode || '',
                      street: geo.street || '',
                      currency: geo.currency || 'USD',
                    });
                  }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone (Raw preserved; E.164 normalized separately)</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+44 20 7946 0912"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Public Email</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="contact@company.com"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Website</label>
                  <input
                    type="text"
                    value={newWebsite}
                    onChange={(e) => setNewWebsite(e.target.value)}
                    placeholder="https://company.com"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Primary ID Type</label>
                  <select
                    value={newIdentType}
                    onChange={(e) => setNewIdentType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5"
                  >
                    {uiIdentifierOptions.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.shortLabel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Business Identifier Number (Optional)</label>
                  <input
                    type="text"
                    value={newIdentValue}
                    onChange={(e) => setNewIdentValue(e.target.value)}
                    placeholder="e.g. 01234567 or 974760673"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2.5 py-1.5 font-mono"
                  />
                </div>
              </div>

              {createError && (
                <div className="p-2.5 bg-rose-950/50 border border-rose-800 rounded text-rose-300">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded"
                >
                  {isCreating ? 'Creating...' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Actions Bar (when items selected) */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/80 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-blue-900 dark:text-blue-200 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold font-mono text-blue-700 dark:text-blue-300">{selectedIds.size}</span>
            <span>leads selected</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Move to:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onBatchUpdateStage(Array.from(selectedIds), e.target.value);
                  setSelectedIds(new Set());
                }
              }}
              defaultValue=""
              className="bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-1"
            >
              <option value="" disabled>
                Select stage...
              </option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} selected leads?`)) {
                  onBatchDelete(Array.from(selectedIds));
                  setSelectedIds(new Set());
                }
              }}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Leads Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="p-3.5 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                  />
                </th>
                <th className="p-3.5">Company & Registration</th>
                <th className="p-3.5">Confidence</th>
                <th className="p-3.5">Location</th>
                <th className="p-3.5">Industry</th>
                <th className="p-3.5">Channels</th>
                <th className="p-3.5">Stage</th>
                <th className="p-3.5 text-right">Value</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-400">
                    <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    No leads found matching your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((lead) => {
                  const isSelected = selectedIds.has(lead.id);
                  const stage = stages.find((s) => s.id === lead.pipelineStageId);

                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition cursor-pointer ${
                        isSelected ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                      }`}
                      onClick={() => onSelectLead(lead)}
                    >
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(lead.id)}
                          className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                        />
                      </td>

                      {/* Company Name & Reg */}
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{lead.companyName}</span>
                          {lead.registrationNumber && (
                            <span className="text-[10px] text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.2 rounded font-mono border border-blue-200 dark:border-blue-900">
                              {canonicalizeIdentifierType(lead.registrationType, lead.address?.countryCode) || 'REG'}
                            </span>
                          )}
                        </div>
                        {lead.registrationNumber && (
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            {lead.registrationNumber}
                          </div>
                        )}
                      </td>

                      {/* Confidence Score */}
                      <td className="p-3.5">
                        <span
                          className={`font-mono text-xs font-bold ${
                            lead.confidenceScore >= 80
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {lead.confidenceScore}%
                        </span>
                      </td>

                      {/* Location */}
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-base" title={lead.address?.country || lead.address?.countryCode}>
                            {getCountryFlag(lead.address?.countryCode)}
                          </span>
                          <span className="truncate">
                            {[lead.address?.city, lead.address?.region, lead.address?.countryCode || lead.address?.country]
                              .filter(Boolean)
                              .join(', ') || 'Global'}
                          </span>
                        </div>
                      </td>

                      {/* Industry */}
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        <div className="truncate max-w-[130px]" title={lead.industry}>
                          {lead.industry}
                        </div>
                      </td>

                      {/* Contact Channels */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          {lead.website ? (
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline p-1"
                              title={lead.website}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 p-1">—</span>
                          )}

                          {lead.email ? (
                            <a
                              href={`mailto:${lead.email}`}
                              className="text-slate-600 dark:text-slate-300 hover:text-blue-600 p-1"
                              title={lead.email}
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </a>
                          ) : null}

                          {(lead.phone || lead.phoneNormalized) ? (
                            <a
                              href={`tel:${lead.phoneNormalized || lead.phone}`}
                              className="text-emerald-600 dark:text-emerald-400 p-1"
                              title={lead.phoneNormalized ? `${lead.phone || ''} (E.164: ${lead.phoneNormalized})` : lead.phone}
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </td>

                      {/* Pipeline Stage Select */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.pipelineStageId || ''}
                          onChange={(e) => {
                            if (e.target.value) onUpdateLeadStage(lead.id, e.target.value);
                          }}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-[11px] rounded px-2 py-1 focus:outline-hidden font-medium"
                          style={{
                            borderLeftColor: stage?.color || '#3b82f6',
                            borderLeftWidth: '3px',
                          }}
                        >
                          {(!lead.pipelineStageId || !stages.some((s) => s.id === lead.pipelineStageId)) && (
                            <option value="">Unassigned</option>
                          )}
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Opportunity Value */}
                      <td className="p-3.5 text-right font-medium font-mono text-slate-900 dark:text-white">
                        {lead.opportunityValue
                          ? formatCurrencyLocale(
                              lead.opportunityValue,
                              lead.currency || 'USD',
                              getLocaleForCountry(lead.address?.countryCode, lead.currency)
                            )
                          : '—'}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onSelectLead(lead)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                            title="Inspect Lead Details"
                          >
                            <Layers className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete lead "${lead.companyName}"?`)) {
                                onDeleteLead(lead.id);
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                            title="Delete Lead"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Server Pagination Footer */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono">
              Page {page} of {totalPages} ({totalMatching} matching)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Previous Page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Next Page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
