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
  Filter
} from 'lucide-react';
import { CanonicalLead, PipelineStage } from '../types.ts';

interface LeadsViewProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  onSelectLead: (lead: CanonicalLead) => void;
  onUpdateLeadStage: (leadId: string, stageId: string) => void;
  onDeleteLead: (leadId: string) => void;
  onBatchUpdateStage: (leadIds: string[], stageId: string) => void;
  onBatchDelete: (leadIds: string[]) => void;
}

export function LeadsView({
  leads,
  stages,
  onSelectLead,
  onUpdateLeadStage,
  onDeleteLead,
  onBatchUpdateStage,
  onBatchDelete,
}: LeadsViewProps) {
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter leads by company, CRN/ABN/OrgNr, city, domain..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 pl-9 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          <div className="md:col-span-3">
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-4 text-slate-600 dark:text-slate-300">
            <span className="text-slate-400 font-medium">Require:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithWebsite}
                onChange={(e) => setOnlyWithWebsite(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0"
              />
              <span>Has Website</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithEmail}
                onChange={(e) => setOnlyWithEmail(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0"
              />
              <span>Has Email</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithPhone}
                onChange={(e) => setOnlyWithPhone(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0"
              />
              <span>Has Phone</span>
            </label>
          </div>

          <div className="text-slate-500 dark:text-slate-400 text-xs">
            Showing <strong className="text-slate-900 dark:text-white font-mono">{filtered.length}</strong> of {leads.length} leads
          </div>
        </div>
      </div>

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
