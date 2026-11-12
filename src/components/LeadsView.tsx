import React, { useState } from 'react';
import {
  Search,
  Building2,
  ExternalLink,
  Mail,
  Phone,
  Trash2,
  Layers,
  ChevronDown,
  Download,
  Filter,
  Plus,
  X,
} from 'lucide-react';
import { CanonicalLead, PipelineStage } from '../types.ts';
import { GeoSelector } from './GeoSelector.tsx';
import { apiFetch } from '../utils/apiFetch.ts';

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
  onCreateLead?: (lead: CanonicalLead) => void;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // New Lead Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIndustry, setNewIndustry] = useState('Commercial Services');
  const [newWebsite, setNewWebsite] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newIdentType, setNewIdentType] = useState('CRN');
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
        if (addrData.postalValidation && !addrData.postalValidation.valid && newGeo.postalCode.trim()) {
          setCreateError(addrData.postalValidation.message || 'Invalid postal code format');
          setIsCreating(false);
          return;
        }
        if (addrData.formattedAddress) formattedAddress = addrData.formattedAddress;
      }

      let finalPhone = newPhone.trim() || undefined;
      if (finalPhone) {
        const pRes = await apiFetch('/api/geo/normalize-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: finalPhone, countryCode: newGeo.countryCode }),
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.e164) finalPhone = pData.e164;
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

      const identifiers: any[] = [];
      if (domain) {
        identifiers.push({ type: 'DOMAIN', value: domain, normalizedValue: domain, source: 'owner_manual_entry', status: 'user_provided', verified: false });
      }
      if (newIdentValue.trim()) {
        const valRes = await apiFetch('/api/identifiers/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: newIdentType, value: newIdentValue.trim(), countryCode: newGeo.countryCode }),
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
          type: newIdentType,
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
        registrationType: newIdentValue.trim() ? newIdentType : undefined,
        website: newWebsite.trim() || undefined,
        domain,
        email: newEmail.trim() || undefined,
        phone: finalPhone,
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
        pipelineStageId: stages[0]?.id || 'stage-discovered',
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

      onCreateLead(lead);
      setIsCreateOpen(false);
      setNewName('');
      setNewWebsite('');
      setNewEmail('');
      setNewPhone('');
      setNewIdentValue('');
    } catch (err) {
      console.error(err);
      setCreateError('Failed to create lead');
    } finally {
      setIsCreating(false);
    }
  };

  // Filter leads
  const filtered = leads.filter((lead) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = lead.companyName.toLowerCase().includes(q);
      const matchCity = (lead.address?.city || '').toLowerCase().includes(q);
      const matchRegion = (lead.address?.region || '').toLowerCase().includes(q);
      const matchReg = (lead.registrationNumber || '').toLowerCase().includes(q);
      const matchDomain = (lead.domain || '').toLowerCase().includes(q);
      const matchTag = lead.tags.some((t) => t.toLowerCase().includes(q));
      const matchIdVal = lead.identifiers?.some((id) => (id.value || '').toLowerCase().includes(q) || (id.normalizedValue || '').toLowerCase().includes(q));
      if (!matchName && !matchCity && !matchRegion && !matchReg && !matchDomain && !matchTag && !matchIdVal) {
        return false;
      }
    }

    if (selectedCountry !== 'ALL' && lead.address?.countryCode !== selectedCountry) {
      return false;
    }

    if (selectedRegion.trim()) {
      const r = selectedRegion.toLowerCase();
      if (!(lead.address?.region || '').toLowerCase().includes(r)) return false;
    }

    if (selectedCity.trim()) {
      const c = selectedCity.toLowerCase();
      if (!(lead.address?.city || '').toLowerCase().includes(c)) return false;
    }

    if (selectedStage !== 'ALL' && lead.pipelineStageId !== selectedStage) {
      return false;
    }

    if (selectedIdentifierType !== 'ALL') {
      const hasType =
        lead.identifiers?.some((id) => id.type.toUpperCase() === selectedIdentifierType.toUpperCase()) ||
        (selectedIdentifierType === 'CRN' && lead.registrationType === 'CRN') ||
        (selectedIdentifierType === 'ORGNR' && lead.registrationType === 'ORGNR') ||
        (selectedIdentifierType === 'ABN' && lead.registrationType === 'ABN');
      if (!hasType) return false;
    }

    if (onlyWithWebsite && !lead.website) return false;
    if (onlyWithEmail && !lead.email) return false;
    if (onlyWithPhone && !lead.phone) return false;

    return true;
  });

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
              <option value="CRN">CRN (UK)</option>
              <option value="ORGNR">ORGNR (NO)</option>
              <option value="ABN">ABN (AU)</option>
              <option value="EIN">EIN (US)</option>
              <option value="VAT">VAT / Tax</option>
              <option value="LEI">LEI (20-char)</option>
            </select>
          </div>
        </div>

        {/* Attribute filter toggles + New Lead Action */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-4 flex-wrap text-slate-600 dark:text-slate-300">
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
              Showing <strong className="text-slate-900 dark:text-white font-mono">{filtered.length}</strong> of {leads.length}
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
                  onChange={(geo) =>
                    setNewGeo({
                      countryCode: geo.countryCode,
                      countryName: geo.countryName,
                      region: geo.region || '',
                      city: geo.city || '',
                      postalCode: geo.postalCode || '',
                      street: geo.street || '',
                      currency: geo.currency || 'USD',
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Phone (Auto-normalizes E.164)</label>
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
                    <option value="CRN">CRN (UK)</option>
                    <option value="ORGNR">ORGNR (NO)</option>
                    <option value="ABN">ABN (AU)</option>
                    <option value="EIN">EIN (US)</option>
                    <option value="SIREN">SIREN (FR)</option>
                    <option value="VAT">VAT / Tax ID</option>
                    <option value="LEI">LEI (20-char)</option>
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
                              {lead.registrationType || 'REG'}
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

                          {lead.phone ? (
                            <a
                              href={`tel:${lead.phone}`}
                              className="text-emerald-600 dark:text-emerald-400 p-1"
                              title={lead.phone}
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </td>

                      {/* Pipeline Stage Select */}
                      <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.pipelineStageId}
                          onChange={(e) => onUpdateLeadStage(lead.id, e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-[11px] rounded px-2 py-1 focus:outline-hidden font-medium"
                          style={{
                            borderLeftColor: stage?.color || '#3b82f6',
                            borderLeftWidth: '3px',
                          }}
                        >
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
                          ? `$${lead.opportunityValue.toLocaleString()}`
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
      </div>
    </div>
  );
}
