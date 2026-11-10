import React, { useState } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  Building2,
  MapPin,
  ExternalLink,
  Mail,
  Phone,
  ShieldCheck,
  Tag,
  Trash2,
  MoreVertical,
  Check,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { CanonicalLead, PipelineStage } from '../types.js';

interface LeadsViewProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  onSelectLead: (lead: CanonicalLead) => void;
  onUpdateLeadStage: (leadId: string, stageId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onBatchUpdateStage: (leadIds: string[], stageId: string) => void;
  onBatchDelete: (leadIds: string[]) => void;
}

export const LeadsView: React.FC<LeadsViewProps> = ({
  leads,
  stages,
  onSelectLead,
  onUpdateLeadStage,
  onDeleteLead,
  onBatchUpdateStage,
  onBatchDelete,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('ALL');
  const [selectedStage, setSelectedStage] = useState('ALL');
  const [onlyWithWebsite, setOnlyWithWebsite] = useState(false);
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter leads
  const filtered = leads.filter((lead) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = lead.companyName.toLowerCase().includes(q);
      const matchCity = (lead.address?.city || '').toLowerCase().includes(q);
      const matchReg = (lead.registrationNumber || '').toLowerCase().includes(q);
      const matchDomain = (lead.domain || '').toLowerCase().includes(q);
      const matchTag = lead.tags.some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchCity && !matchReg && !matchDomain && !matchTag) {
        return false;
      }
    }

    if (selectedCountry !== 'ALL' && lead.address?.countryCode !== selectedCountry) {
      return false;
    }

    if (selectedStage !== 'ALL' && lead.pipelineStageId !== selectedStage) {
      return false;
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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter leads by company, CRN/ABN/OrgNr, city, domain, or tag..."
              className="w-full bg-slate-950 border border-slate-800 text-white text-xs rounded px-3 py-2 pl-9 focus:outline-none focus:border-indigo-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          <div className="md:col-span-3">
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white text-xs rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Countries ({leads.length})</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c === 'NO' ? '🇳🇴 Norway' : c === 'GB' ? '🇬🇧 United Kingdom' : c === 'AU' ? '🇦🇺 Australia' : c} (
                  {leads.filter((l) => l.address?.countryCode === c).length})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white text-xs rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Pipeline Stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({leads.filter((l) => l.pipelineStageId === s.id).length})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Attribute filter toggles */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800 text-xs">
          <div className="flex items-center gap-3 text-slate-300">
            <span className="text-slate-400 font-medium">Require:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithWebsite}
                onChange={(e) => setOnlyWithWebsite(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
              />
              <span>Has Website</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithEmail}
                onChange={(e) => setOnlyWithEmail(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
              />
              <span>Has Email</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithPhone}
                onChange={(e) => setOnlyWithPhone(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
              />
              <span>Has Phone</span>
            </label>
          </div>

          <div className="text-slate-400">
            Showing <span className="font-semibold text-white">{filtered.length}</span> of {leads.length} leads
          </div>
        </div>
      </div>

      {/* Batch Actions Bar (when items selected) */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-950/80 border border-indigo-700/60 rounded-lg px-4 py-2 flex items-center justify-between text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{selectedIds.size}</span>
            <span>leads selected</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Move to:</span>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  onBatchUpdateStage(Array.from(selectedIds), e.target.value);
                  setSelectedIds(new Set());
                }
              }}
              defaultValue=""
              className="bg-slate-900 border border-indigo-600 text-white text-xs rounded px-2 py-1"
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
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-medium transition"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Leads Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                  />
                </th>
                <th className="p-3">Company & Registration</th>
                <th className="p-3">Confidence & Signals</th>
                <th className="p-3">Location</th>
                <th className="p-3">Industry / Sector</th>
                <th className="p-3">Channels</th>
                <th className="p-3">Pipeline Stage</th>
                <th className="p-3 text-right">Value</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    No leads found matching your criteria. Try adjusting filters or discovering new leads in the Discovery Engine.
                  </td>
                </tr>
              ) : (
                filtered.map((lead) => {
                  const isSelected = selectedIds.has(lead.id);
                  const stage = stages.find((s) => s.id === lead.pipelineStageId);

                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-slate-800/40 transition cursor-pointer ${
                        isSelected ? 'bg-indigo-950/20' : ''
                      }`}
                      onClick={() => onSelectLead(lead)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(lead.id)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                        />
                      </td>

                      {/* Company Name & Reg */}
                      <td className="p-3">
                        <div className="font-semibold text-white group-hover:text-indigo-400 flex items-center gap-1.5">
                          <span>{lead.companyName}</span>
                          {lead.registrationNumber && (
                            <span className="text-[10px] text-cyan-400 bg-cyan-950/40 px-1 py-0.2 rounded border border-cyan-800/40">
                              {lead.registrationType || 'REG'}
                            </span>
                          )}
                        </div>
                        {lead.registrationNumber && (
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            {lead.registrationNumber}
                          </div>
                        )}
                      </td>

                      {/* Confidence Score & Signals */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                              lead.confidenceScore >= 80
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {lead.confidenceScore}%
                          </span>
                          <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                            {lead.confidenceSignals[0] || 'Unverified'}
                          </span>
                        </div>
                      </td>

                      {/* Location */}
                      <td className="p-3 text-slate-300">
                        <div className="flex items-center gap-1 truncate">
                          <span>
                            {lead.address?.countryCode === 'NO'
                              ? '🇳🇴'
                              : lead.address?.countryCode === 'GB'
                              ? '🇬🇧'
                              : lead.address?.countryCode === 'AU'
                              ? '🇦🇺'
                              : '🌐'}
                          </span>
                          <span>{lead.address?.city || lead.address?.country || 'Unknown'}</span>
                        </div>
                      </td>

                      {/* Industry */}
                      <td className="p-3 text-slate-400">
                        <div className="truncate max-w-[140px]" title={lead.industry}>
                          {lead.industry}
                        </div>
                      </td>

                      {/* Contact Channels */}
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          {lead.website ? (
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-400 hover:text-indigo-300 p-1 hover:bg-slate-800 rounded"
                              title={lead.website}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-slate-600 p-1">—</span>
                          )}

                          {lead.email ? (
                            <a
                              href={`mailto:${lead.email}`}
                              className="text-cyan-400 hover:text-cyan-300 p-1 hover:bg-slate-800 rounded"
                              title={lead.email}
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </a>
                          ) : null}

                          {lead.phone ? (
                            <a
                              href={`tel:${lead.phone}`}
                              className="text-emerald-400 hover:text-emerald-300 p-1 hover:bg-slate-800 rounded"
                              title={lead.phone}
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </td>

                      {/* Pipeline Stage Select */}
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.pipelineStageId}
                          onChange={(e) => onUpdateLeadStage(lead.id, e.target.value)}
                          className="bg-slate-950 border border-slate-800 text-slate-300 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-indigo-500 font-medium"
                          style={{
                            borderLeftColor: stage?.color || '#64748b',
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
                      <td className="p-3 text-right font-medium text-slate-300">
                        {lead.opportunityValue
                          ? `${lead.currency === 'GBP' ? '£' : lead.currency === 'EUR' ? '€' : lead.currency === 'NOK' ? 'kr ' : '$'}${lead.opportunityValue.toLocaleString()}`
                          : '—'}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onSelectLead(lead)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
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
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition"
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
};
