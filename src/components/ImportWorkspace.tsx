import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  History,
  BookmarkCheck,
  Users,
  Trash2,
  Download,
  RefreshCw,
  Search,
  Building2,
  Mail,
  Phone,
  Linkedin,
  Eye,
} from 'lucide-react';
import {
  CanonicalLead,
  ImportBatchRecord,
  ImportBatchRowRecord,
  ImportMappingTemplate,
  PersonRecord,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { ImportWizard } from './ImportWizard.tsx';

interface ImportWorkspaceProps {
  existingLeads: CanonicalLead[];
  onImportComplete: () => void;
  onSelectLead: (lead: CanonicalLead) => void;
}

interface EnrichedPersonItem extends PersonRecord {
  companies?: Array<{
    relationshipId: string;
    leadId: string;
    companyName: string;
    relationshipType: string;
    jobTitle?: string;
    isPrimaryContact: boolean;
  }>;
}

export const ImportWorkspace: React.FC<ImportWorkspaceProps> = ({
  existingLeads,
  onImportComplete,
  onSelectLead,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'wizard' | 'templates' | 'batches' | 'persons'>(
    'wizard'
  );

  // Templates
  const [templates, setTemplates] = useState<ImportMappingTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Batches
  const [batches, setBatches] = useState<ImportBatchRecord[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState<{
    batch: ImportBatchRecord;
    rows: ImportBatchRowRecord[];
  } | null>(null);

  // Persons directory
  const [persons, setPersons] = useState<EnrichedPersonItem[]>([]);
  const [personsSearch, setPersonsSearch] = useState('');
  const [loadingPersons, setLoadingPersons] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await apiFetch('/api/import/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const res = await apiFetch('/api/import/batches?page=1&pageSize=30');
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || []);
      }
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  const loadPersons = useCallback(async (search = '') => {
    setLoadingPersons(true);
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await apiFetch(`/api/persons${q}`);
      if (res.ok) {
        const data = await res.json();
        setPersons(data.persons || []);
      }
    } finally {
      setLoadingPersons(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === 'templates') loadTemplates();
    if (activeSubTab === 'batches') loadBatches();
    if (activeSubTab === 'persons') loadPersons(personsSearch);
  }, [activeSubTab, loadTemplates, loadBatches, loadPersons]);

  const handleDeleteTemplate = async (id: string) => {
    const res = await apiFetch(`/api/import/templates/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const handleInspectBatch = async (batchId: string) => {
    const res = await apiFetch(`/api/import/batches/${batchId}?page=1&pageSize=100`);
    if (res.ok) {
      const data = await res.json();
      setSelectedBatchDetail({ batch: data.batch, rows: data.rows || [] });
    }
  };

  const downloadBatchCsv = async (batchId: string, type: 'failed' | 'errors' | 'summary') => {
    const res = await apiFetch(`/api/import/batches/${batchId}/export?type=${type}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import_${batchId}_${type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Workspace Header & Sub-Navigation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            <span>Lead Import, Normalization &amp; Decision-Maker Processing</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Parse CSV &amp; Excel workbooks, normalize international entities &amp; contacts, inspect duplicates before saving, and manage M:N company-person relationships.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {[
            { id: 'wizard', label: 'Import Wizard', icon: FileSpreadsheet },
            { id: 'batches', label: 'Batch Audit Ledger', icon: History },
            { id: 'templates', label: 'Mapping Templates', icon: BookmarkCheck },
            { id: 'persons', label: 'Decision-Makers', icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border transition ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. WIZARD */}
      {activeSubTab === 'wizard' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6">
          <ImportWizard
            existingLeads={existingLeads}
            onImportComplete={() => {
              onImportComplete();
              loadBatches();
            }}
          />
        </div>
      )}

      {/* 2. TEMPLATES */}
      {activeSubTab === 'templates' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Saved Import Mapping Templates ({templates.length})
            </h3>
            <button
              type="button"
              onClick={loadTemplates}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTemplates ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {templates.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No saved mapping templates yet. Map a file in the Import Wizard and click &ldquo;Save Mapping Template&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{tpl.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {tpl.sourceFormat.toUpperCase()} · {tpl.columnMappings.length} columns ·{' '}
                        {tpl.mergeRules?.length || 0} merge rules
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="text-slate-400 hover:text-rose-500 p-1"
                      title="Delete template"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tpl.columnMappings
                      .filter((m) => m.targetField !== 'ignore')
                      .slice(0, 8)
                      .map((m, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[10px] font-mono"
                        >
                          {m.sourceHeader} → {m.targetField}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. BATCH AUDIT LEDGER */}
      {activeSubTab === 'batches' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Import Batch Audit History ({batches.length})
            </h3>
            <button
              type="button"
              onClick={loadBatches}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBatches ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {batches.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No import batches have been executed yet.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">File</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Companies (+ / ~ )</th>
                    <th className="px-3 py-2.5">Persons / Links</th>
                    <th className="px-3 py-2.5">Skipped / Failed</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {b.filename}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {b.fileFormat.toUpperCase()} · {b.totalRows} rows · {b.durationMs}ms
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            b.status === 'completed'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                              : b.status === 'partial_failed'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        +{b.createdCompanies} / ~{b.updatedCompanies}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        +{b.createdPersons} / {b.createdRelationships + b.updatedRelationships} links
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {b.skippedRows} skip · {b.failedRows} fail
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500 font-mono">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleInspectBatch(b.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Rows</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadBatchCsv(b.id, 'summary')}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3 h-3" />
                          <span>CSV</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedBatchDetail && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-900 dark:text-white">
                  Batch Row Ledger: {selectedBatchDetail.batch.filename} ({selectedBatchDetail.rows.length} rows shown)
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => downloadBatchCsv(selectedBatchDetail.batch.id, 'failed')}
                    className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700"
                  >
                    Export Failed CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBatchDetail(null)}
                    className="px-2.5 py-1 rounded bg-slate-200 dark:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-100 dark:bg-slate-900 sticky top-0">
                    <tr>
                      <th className="px-2.5 py-1.5">Row</th>
                      <th className="px-2.5 py-1.5">Company</th>
                      <th className="px-2.5 py-1.5">Person</th>
                      <th className="px-2.5 py-1.5">Classification</th>
                      <th className="px-2.5 py-1.5">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {selectedBatchDetail.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-2.5 py-1.5 font-mono">#{r.rowNumber}</td>
                        <td className="px-2.5 py-1.5 font-medium">{r.companyName || '—'}</td>
                        <td className="px-2.5 py-1.5">{r.personName || '—'}</td>
                        <td className="px-2.5 py-1.5 font-mono">{r.dedupeClassification}</td>
                        <td className="px-2.5 py-1.5 font-mono font-semibold">{r.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. DECISION-MAKERS DIRECTORY */}
      {activeSubTab === 'persons' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Decision-Makers &amp; Contacts Directory ({persons.length})
            </h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={personsSearch}
                  onChange={(e) => setPersonsSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadPersons(personsSearch)}
                  placeholder="Search person, email, or company..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <button
                type="button"
                onClick={() => loadPersons(personsSearch)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white"
              >
                {loadingPersons ? 'Loading...' : 'Search'}
              </button>
            </div>
          </div>

          {persons.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No decision-makers or contacts stored yet. Import a CSV/XLSX with contact columns or add decision-makers inside any Lead profile.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {persons.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white text-sm">
                        {p.fullName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {[p.city, p.countryCode].filter(Boolean).join(', ') || 'Location unspecified'}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {p.verificationStatus}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                    {p.email && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Mail className="w-3 h-3 text-cyan-500" />
                        {p.email}
                      </span>
                    )}
                    {(p.phoneNormalized || p.phone) && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Phone className="w-3 h-3 text-emerald-500" />
                        {p.phoneNormalized || p.phone}
                      </span>
                    )}
                    {p.linkedinUrl && (
                      <a
                        href={p.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-500 hover:underline"
                      >
                        <Linkedin className="w-3 h-3" />
                        LinkedIn
                      </a>
                    )}
                  </div>

                  {p.companies && p.companies.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
                      <div className="text-[10px] uppercase font-semibold text-slate-500">
                        Linked Companies (M:N)
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.companies.map((c) => {
                          const leadObj = existingLeads.find((l) => l.id === c.leadId);
                          return (
                            <button
                              key={c.relationshipId}
                              type="button"
                              onClick={() => leadObj && onSelectLead(leadObj)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] hover:border-blue-500 transition"
                            >
                              <Building2 className="w-3 h-3 text-blue-500" />
                              <span className="font-semibold">{c.companyName}</span>
                              <span className="text-slate-400">
                                ({c.jobTitle || c.relationshipType})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
