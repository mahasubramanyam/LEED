import React, { useState, useEffect, useCallback } from 'react';
import { sanitizeExternalUrl } from '../utils/safeUrl.ts';
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
  ExternalLink,
  AlertTriangle,
  Edit3,
  Link2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Info,
  X,
  Bookmark,
  Activity,
} from 'lucide-react';
import {
  CanonicalLead,
  ImportBatchRecord,
  ImportBatchRowRecord,
  ImportMappingTemplate,
  PersonRecord,
  SocialProviderDoc,
  CrmSavedView,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { ImportWizard } from './ImportWizard.tsx';
import { PersonEnrichmentInlinePanel } from './PersonEnrichmentInlinePanel.tsx';
import {
  EXPANDED_RELATIONSHIP_TYPES,
  ROLE_TAXONOMY_SPECS,
} from '../../shared/decisionMakerRoles.ts';
import { CRM_RELATIONSHIP_STATUSES } from '../../shared/crmSpecs.ts';

interface ImportWorkspaceProps {
  existingLeads: CanonicalLead[];
  onImportComplete: () => void;
  onSelectLead: (lead: CanonicalLead) => void;
  onOpenPersonProfile?: (personId: string) => void;
}

interface EnrichedPersonCompanyLink {
  relationshipId: string;
  leadId: string;
  companyName: string;
  companyCountryCode?: string;
  relationshipType: string;
  jobTitle?: string;
  designation?: string;
  department?: string;
  decisionMakerCategory?: string;
  isPrimaryContact: boolean;
  sourceName?: string;
  provenance?: Record<string, any>;
  confidenceScore?: number;
  verificationStatus?: string;
  employmentStatus?: 'current' | 'historical' | 'unknown';
  endedAt?: string;
}

interface EnrichedPersonItem extends PersonRecord {
  companies?: EnrichedPersonCompanyLink[];
  possibleDuplicatePersonIds?: string[];
}

function formatRoleLabel(role: string): string {
  const spec = ROLE_TAXONOMY_SPECS[role as keyof typeof ROLE_TAXONOMY_SPECS];
  return spec ? spec.label : role.replace(/_/g, ' ');
}

function formatVerificationLabel(status?: string): string {
  switch (status) {
    case 'officially_verified':
      return 'Officially Verified';
    case 'directory_listed':
      return 'Directory / Provider';
    case 'web_observed':
      return 'Company Website';
    case 'syntax_validated':
      return 'Syntax Validated';
    case 'unverified':
      return 'Unverified Search';
    default:
      return 'User Provided';
  }
}

export const ImportWorkspace: React.FC<ImportWorkspaceProps> = ({
  existingLeads,
  onImportComplete,
  onSelectLead,
  onOpenPersonProfile,
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

  // Persons directory & Phase 11/13 filters
  const [persons, setPersons] = useState<EnrichedPersonItem[]>([]);
  const [personsSearch, setPersonsSearch] = useState('');
  const [filterLeadId, setFilterLeadId] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterVerification, setFilterVerification] = useState('all');
  const [filterEmployment, setFilterEmployment] = useState('all');
  const [filterRelStatus, setFilterRelStatus] = useState('all');
  const [personSavedViews, setPersonSavedViews] = useState<CrmSavedView[]>([]);
  const [activePersonViewId, setActivePersonViewId] = useState('');
  const [newPersonViewName, setNewPersonViewName] = useState('');
  const [showSavePersonView, setShowSavePersonView] = useState(false);
  const [loadingPersons, setLoadingPersons] = useState(false);
  const [personActionFeedback, setPersonActionFeedback] = useState<string | null>(null);

  // Source coverage matrix
  const [showProvidersMatrix, setShowProvidersMatrix] = useState(false);
  const [socialProviders, setSocialProviders] = useState<SocialProviderDoc[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  // Inline Edit Person & Link Company & Provenance & Phase 12 Enrichment expansion
  const [expandedProvenanceId, setExpandedProvenanceId] = useState<string | null>(null);
  const [enrichingPersonId, setEnrichingPersonId] = useState<string | null>(null);
  const [qualitySummary, setQualitySummary] = useState<{
    averageCompanyQuality: number;
    averagePersonQuality: number;
    staleOrReverifyCompaniesCount: number;
    openConflictsCount: number;
    personScores: Record<string, { overallScore: number; grade: string; staleCount: number }>;
  } | null>(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editPersonForm, setEditPersonForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    city: '',
    countryCode: '',
    bioSummary: '',
  });
  const [savingPersonEdit, setSavingPersonEdit] = useState(false);

  const [linkingPersonId, setLinkingPersonId] = useState<string | null>(null);
  const [linkCompanyForm, setLinkCompanyForm] = useState({
    leadId: '',
    relationshipType: 'director',
    jobTitle: '',
    department: '',
    isPrimaryContact: false,
  });
  const [savingLink, setSavingLink] = useState(false);

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

  const loadPersonSavedViews = useCallback(async () => {
    try {
      const res = await apiFetch('/api/crm/saved-views?entityType=person');
      if (res.ok) {
        const data = await res.json();
        setPersonSavedViews(Array.isArray(data.views) ? data.views : []);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  const loadPersons = useCallback(async () => {
    setLoadingPersons(true);
    try {
      const params = new URLSearchParams();
      if (personsSearch.trim()) params.set('search', personsSearch.trim());
      if (filterLeadId) params.set('leadId', filterLeadId);
      if (filterCountry.trim()) params.set('countryCode', filterCountry.trim().toUpperCase());
      if (filterRole && filterRole !== 'all') params.set('relationshipType', filterRole);
      if (filterDepartment.trim()) params.set('department', filterDepartment.trim());
      if (filterVerification && filterVerification !== 'all') {
        params.set('verificationStatus', filterVerification);
      }
      if (filterEmployment && filterEmployment !== 'all') {
        params.set('employmentStatus', filterEmployment);
      }
      const qs = params.toString();
      const res = await apiFetch(`/api/persons${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        let list: EnrichedPersonItem[] = data.persons || [];
        if (filterRelStatus && filterRelStatus !== 'all') {
          const segRes = await apiFetch('/api/crm/search/persons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              search: personsSearch.trim() || undefined,
              leadId: filterLeadId || undefined,
              countryCode: filterCountry.trim() ? filterCountry.trim().toUpperCase() : undefined,
              relationshipStatus: filterRelStatus,
            }),
          });
          if (segRes.ok) {
            const segData = await segRes.json();
            const allowedIds = new Set<string>(
              (segData.items || []).map((r: any) => r.person?.id).filter(Boolean)
            );
            list = list.filter((p) => allowedIds.has(p.id));
          }
        }
        setPersons(list);
      }
    } finally {
      setLoadingPersons(false);
    }
  }, [
    personsSearch,
    filterLeadId,
    filterCountry,
    filterRole,
    filterDepartment,
    filterVerification,
    filterEmployment,
    filterRelStatus,
  ]);

  useEffect(() => {
    if (activeSubTab === 'persons') {
      loadPersonSavedViews();
    }
  }, [activeSubTab, loadPersonSavedViews]);

  const handleSavePersonView = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPersonViewName.trim()) return;
    const res = await apiFetch('/api/crm/saved-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newPersonViewName.trim(),
        entityType: 'person',
        filters: {
          search: personsSearch.trim() || undefined,
          leadId: filterLeadId || undefined,
          countryCode: filterCountry.trim() || undefined,
          role: filterRole !== 'all' ? filterRole : undefined,
          department: filterDepartment.trim() || undefined,
          relationshipStatus: filterRelStatus !== 'all' ? filterRelStatus : undefined,
        },
      }),
    });
    if (res.ok) {
      const created = await res.json();
      setNewPersonViewName('');
      setShowSavePersonView(false);
      await loadPersonSavedViews();
      if (created?.id) setActivePersonViewId(created.id);
    }
  };

  const handleApplyPersonView = (viewId: string) => {
    setActivePersonViewId(viewId);
    if (!viewId) {
      setPersonsSearch('');
      setFilterLeadId('');
      setFilterCountry('');
      setFilterRole('all');
      setFilterDepartment('');
      setFilterRelStatus('all');
      return;
    }
    const found = personSavedViews.find((v) => v.id === viewId);
    if (!found) return;
    const f = (found.filters || {}) as Record<string, any>;
    setPersonsSearch(String(f.search || ''));
    setFilterLeadId(String(f.leadId || ''));
    setFilterCountry(String(f.countryCode || ''));
    setFilterRole(String(f.role || 'all'));
    setFilterDepartment(String(f.department || ''));
    setFilterRelStatus(String(f.relationshipStatus || 'all'));
  };

  const loadSocialProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await apiFetch('/api/decision-makers/providers');
      if (res.ok) {
        const data = await res.json();
        setSocialProviders(data.providers || []);
      }
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  const loadQualitySummary = useCallback(async () => {
    try {
      const res = await apiFetch('/api/enrichment/quality/summary');
      if (res.ok) {
        const data = await res.json();
        setQualitySummary({
          averageCompanyQuality: data.averageCompanyQuality ?? 0,
          averagePersonQuality: data.averagePersonQuality ?? 0,
          staleOrReverifyCompaniesCount: data.staleOrReverifyCompaniesCount ?? 0,
          openConflictsCount: data.openConflictsCount ?? 0,
          personScores: data.personScores || {},
        });
      }
    } catch {
      // Non-blocking quality banner
    }
  }, []);

  useEffect(() => {
    loadQualitySummary();
  }, [loadQualitySummary, existingLeads.length]);

  useEffect(() => {
    if (activeSubTab === 'templates') loadTemplates();
    if (activeSubTab === 'batches') loadBatches();
    if (activeSubTab === 'persons') loadPersons();
  }, [activeSubTab, loadTemplates, loadBatches, loadPersons]);

  const handleToggleProvidersMatrix = () => {
    const next = !showProvidersMatrix;
    setShowProvidersMatrix(next);
    if (next && socialProviders.length === 0) {
      loadSocialProviders();
    }
  };

  const handleStartEditPerson = (p: EnrichedPersonItem) => {
    setEditingPersonId(p.id);
    setLinkingPersonId(null);
    setEditPersonForm({
      fullName: p.fullName || '',
      email: p.email || '',
      phone: p.phoneNormalized || p.phone || '',
      linkedinUrl: p.linkedinUrl || '',
      city: p.city || '',
      countryCode: p.countryCode || '',
      bioSummary: p.bioSummary || '',
    });
  };

  const handleSavePersonEdit = async (e: React.FormEvent, personId: string) => {
    e.preventDefault();
    setSavingPersonEdit(true);
    setPersonActionFeedback(null);
    try {
      const res = await apiFetch(`/api/persons/${personId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editPersonForm),
      });
      if (res.ok) {
        setEditingPersonId(null);
        setPersonActionFeedback('Updated person profile.');
        await loadPersons();
      } else {
        const err = await res.json().catch(() => ({}));
        setPersonActionFeedback(err.error || 'Failed to update person.');
      }
    } finally {
      setSavingPersonEdit(false);
    }
  };

  const handleStartLinkCompany = (personId: string) => {
    setLinkingPersonId(personId);
    setEditingPersonId(null);
    setLinkCompanyForm({
      leadId: existingLeads[0]?.id || '',
      relationshipType: 'director',
      jobTitle: '',
      department: '',
      isPrimaryContact: false,
    });
  };

  const handleSaveCompanyLink = async (e: React.FormEvent, personId: string) => {
    e.preventDefault();
    if (!linkCompanyForm.leadId) return;
    setSavingLink(true);
    setPersonActionFeedback(null);
    try {
      const res = await apiFetch(`/api/persons/${personId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(linkCompanyForm),
      });
      if (res.ok) {
        setLinkingPersonId(null);
        setPersonActionFeedback('Linked person to company.');
        await loadPersons();
      } else {
        const err = await res.json().catch(() => ({}));
        setPersonActionFeedback(err.error || 'Failed to link person to company.');
      }
    } finally {
      setSavingLink(false);
    }
  };

  const handleUnlinkCompany = async (leadId: string, relationshipId: string) => {
    const res = await apiFetch(`/api/leads/${leadId}/persons/${relationshipId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setPersonActionFeedback('Unlinked relationship.');
      await loadPersons();
    }
  };

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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border transition whitespace-nowrap shrink-0 ${
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

      {/* Phase 12: Portfolio Data Quality & Freshness Health Strip */}
      {qualitySummary && (
        <div className="bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>CRM Data Quality &amp; Freshness Intelligence</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-slate-600 dark:text-slate-300">
            <span>
              Avg Company Quality:{' '}
              <strong className="font-mono text-slate-900 dark:text-white">
                {qualitySummary.averageCompanyQuality}/100
              </strong>
            </span>
            <span>
              Avg Decision-Maker Quality:{' '}
              <strong className="font-mono text-slate-900 dark:text-white">
                {qualitySummary.averagePersonQuality}/100
              </strong>
            </span>
            <span>
              Stale / Re-Verify Queue:{' '}
              <strong className="font-mono text-amber-600 dark:text-amber-400">
                {qualitySummary.staleOrReverifyCompaniesCount}
              </strong>
            </span>
            <span>
              Open Source Conflicts:{' '}
              <strong className="font-mono text-rose-600 dark:text-rose-400">
                {qualitySummary.openConflictsCount}
              </strong>
            </span>
          </div>
        </div>
      )}

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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 whitespace-nowrap shrink-0"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 whitespace-nowrap shrink-0"
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
                      <td className="px-3 py-2.5 font-mono tabular-nums">
                        +{b.createdCompanies} / ~{b.updatedCompanies}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums">
                        +{b.createdPersons} / {b.createdRelationships + b.updatedRelationships} links
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums">
                        {b.skippedRows} skip · {b.failedRows} fail
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-slate-500 font-mono tabular-nums">
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

      {/* 4. DECISION-MAKERS GLOBAL DIRECTORY */}
      {activeSubTab === 'persons' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Decision-Makers &amp; Contacts Directory ({persons.length})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Global M:N person directory across all CRM companies with role taxonomy, employment status, and source provenance.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleProvidersMatrix}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Info className="w-3.5 h-3.5 text-blue-500" />
                <span>{showProvidersMatrix ? 'Hide Source Coverage' : 'Source Coverage'}</span>
              </button>
              <button
                type="button"
                onClick={() => loadPersons()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingPersons ? 'animate-spin' : ''}`} />
                <span>Apply Filters</span>
              </button>
            </div>
          </div>

          {/* Honest Decision-Maker Source Coverage Matrix */}
          {showProvidersMatrix && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Permitted Decision-Maker Intelligence Sources &amp; Compliance Boundaries
                </div>
                <button
                  type="button"
                  onClick={() => setShowProvidersMatrix(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {loadingProviders ? (
                <div className="text-slate-500">Loading provider matrix...</div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Coverage &amp; Auth</th>
                        <th className="px-3 py-2">Compliance &amp; Limitations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {socialProviders.map((prov) => (
                        <tr key={prov.id}>
                          <td className="px-3 py-2 align-top">
                            <div className="font-semibold text-slate-900 dark:text-white">{prov.name}</div>
                            <div className="text-[10px] text-slate-500">{prov.officialProvider}</div>
                          </td>
                          <td className="px-3 py-2 align-top font-mono">
                            <span
                              className={
                                prov.availability === 'operational'
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : prov.availability === 'credential_dependent'
                                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                  : 'text-rose-600 dark:text-rose-400 font-semibold'
                              }
                            >
                              {prov.availability.replace(/_/g, ' ')}
                            </span>
                            {prov.availability === 'credential_dependent' && (
                              <div className="text-[10px] text-slate-500">
                                {prov.configuredInVault ? 'Configured in Vault' : 'Needs Vault Key'}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                            <div>{prov.countryCoverage}</div>
                            <div className="text-[10px] text-slate-500">{prov.authentication}</div>
                          </td>
                          <td className="px-3 py-2 align-top text-slate-600 dark:text-slate-400">
                            {prov.honestStatusNote}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Multi-Dimensional Filter Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={personsSearch}
                onChange={(e) => setPersonsSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadPersons()}
                placeholder="Name, email, title, company..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>

            <select
              value={filterLeadId}
              onChange={(e) => setFilterLeadId(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="">All Companies ({existingLeads.length})</option>
              {existingLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.companyName}
                </option>
              ))}
            </select>

            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="all">All Decision-Maker Roles</option>
              {EXPANDED_RELATIONSHIP_TYPES.map((role) => (
                <option key={role} value={role}>
                  {formatRoleLabel(role)}
                </option>
              ))}
            </select>

            <select
              value={filterEmployment}
              onChange={(e) => setFilterEmployment(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="all">All Employment Statuses</option>
              <option value="current">Current Only</option>
              <option value="historical">Historical / Former</option>
              <option value="unknown">Unknown Tenure</option>
            </select>

            <input
              type="text"
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              placeholder="Filter department (e.g. Procurement)"
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            />

            <input
              type="text"
              maxLength={2}
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value.toUpperCase())}
              placeholder="Country ISO (e.g. NO, GB)"
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono uppercase"
            />

            <select
              value={filterVerification}
              onChange={(e) => setFilterVerification(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="all">All Verification Levels</option>
              <option value="officially_verified">Officially Verified</option>
              <option value="web_observed">Company Website</option>
              <option value="directory_listed">Directory / Provider</option>
              <option value="syntax_validated">Syntax Validated</option>
              <option value="user_provided">User Provided</option>
              <option value="unverified">Unverified Search</option>
            </select>

            <select
              value={filterRelStatus}
              onChange={(e) => setFilterRelStatus(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="all">All Relationship Statuses</option>
              {CRM_RELATIONSHIP_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={activePersonViewId}
                onChange={(e) => handleApplyPersonView(e.target.value)}
                className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="">Saved Views ({personSavedViews.length})</option>
                {personSavedViews.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {showSavePersonView ? (
                <form onSubmit={handleSavePersonView} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newPersonViewName}
                    onChange={(e) => setNewPersonViewName(e.target.value)}
                    placeholder="Name..."
                    required
                    className="w-20 px-1.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <button type="submit" className="px-2 py-1 text-[11px] bg-blue-600 text-white rounded">
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSavePersonView(true)}
                  className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  Save
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setPersonsSearch('');
                setFilterLeadId('');
                setFilterCountry('');
                setFilterRole('all');
                setFilterDepartment('');
                setFilterVerification('all');
                setFilterEmployment('all');
                setFilterRelStatus('all');
                setActivePersonViewId('');
              }}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Reset Filters
            </button>
          </div>

          {personActionFeedback && (
            <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>{personActionFeedback}</span>
              <button
                type="button"
                onClick={() => setPersonActionFeedback(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {persons.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No decision-makers match your filters. Discover decision-makers from any Lead profile or Discovery candidate, or import a contact spreadsheet.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {persons.map((p) => {
                const provExpanded = expandedProvenanceId === p.id;
                const isEditing = editingPersonId === p.id;
                const isLinking = linkingPersonId === p.id;

                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white text-sm truncate">
                          {p.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {[
                            p.seniority ? p.seniority.replace(/_/g, ' ') : undefined,
                            p.decisionMakingFunction,
                            [p.city, p.countryCode].filter(Boolean).join(', '),
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Location unspecified'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center justify-end gap-1">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{formatVerificationLabel(p.verificationStatus)}</span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                          {p.confidenceScore}% confidence
                          {qualitySummary?.personScores?.[p.id] && (
                            <span className="ml-1.5 px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold">
                              Q:{qualitySummary.personScores[p.id].overallScore} ({qualitySummary.personScores[p.id].grade})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {p.possibleDuplicatePersonIds && p.possibleDuplicatePersonIds.length > 0 && (
                      <div className="px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          Same name exists on {p.possibleDuplicatePersonIds.length} other person record(s). Not auto-merged without corroborating email/LinkedIn/company.
                        </span>
                      </div>
                    )}

                    {p.bioSummary && (
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {p.bioSummary}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
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
                      {sanitizeExternalUrl(p.linkedinUrl) && (
                        <a
                          href={sanitizeExternalUrl(p.linkedinUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Linkedin className="w-3 h-3" />
                          <span>LinkedIn</span>
                        </a>
                      )}
                      {sanitizeExternalUrl(p.officialBioUrl) && (
                        <a
                          href={sanitizeExternalUrl(p.officialBioUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Official Bio</span>
                        </a>
                      )}
                    </div>

                    {/* Linked Companies (M:N) */}
                    {p.companies && p.companies.length > 0 && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">
                          Linked Companies ({p.companies.length})
                        </div>
                        <div className="space-y-1">
                          {p.companies.map((c) => {
                            const leadObj = existingLeads.find((l) => l.id === c.leadId);
                            const isHistorical = c.employmentStatus === 'historical';
                            return (
                              <div
                                key={c.relationshipId}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                              >
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => leadObj && onSelectLead(leadObj)}
                                    className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition text-left"
                                  >
                                    <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
                                    <span className="truncate">{c.companyName}</span>
                                  </button>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    {c.jobTitle || formatRoleLabel(c.relationshipType)}
                                    {c.department ? ` · ${c.department}` : ''}
                                    {c.isPrimaryContact ? ' · Primary' : ''}
                                    {isHistorical
                                      ? ` · Historical${c.endedAt ? ` (ended ${c.endedAt})` : ''}`
                                      : c.employmentStatus === 'unknown'
                                      ? ' · Tenure unknown'
                                      : ' · Current'}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkCompany(c.leadId, c.relationshipId)}
                                  className="text-slate-400 hover:text-rose-500 p-1 shrink-0"
                                  title="Unlink relationship"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap text-[11px]">
                      <div className="flex items-center gap-2.5">
                        {onOpenPersonProfile && (
                          <button
                            type="button"
                            onClick={() => onOpenPersonProfile(p.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition"
                          >
                            <Activity className="w-3 h-3" />
                            <span>Relationship Profile</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            isEditing ? setEditingPersonId(null) : handleStartEditPerson(p)
                          }
                          className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>{isEditing ? 'Cancel Edit' : 'Edit'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            isLinking ? setLinkingPersonId(null) : handleStartLinkCompany(p.id)
                          }
                          className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                        >
                          <Link2 className="w-3 h-3" />
                          <span>{isLinking ? 'Cancel Link' : 'Link Company'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEnrichingPersonId(enrichingPersonId === p.id ? null : p.id)
                          }
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>{enrichingPersonId === p.id ? 'Close Enrichment' : 'Enrich & Verify'}</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedProvenanceId(provExpanded ? null : p.id)}
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        <span>Provenance</span>
                        {provExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {enrichingPersonId === p.id && (
                      <PersonEnrichmentInlinePanel
                        personId={p.id}
                        leadId={p.companies?.[0]?.leadId}
                        onApplied={() => {
                          loadPersons();
                          loadQualitySummary();
                        }}
                      />
                    )}

                    {/* Inline Edit Form */}
                    {isEditing && (
                      <form
                        onSubmit={(e) => handleSavePersonEdit(e, p.id)}
                        className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 space-y-2"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            required
                            value={editPersonForm.fullName}
                            onChange={(e) =>
                              setEditPersonForm((f) => ({ ...f, fullName: e.target.value }))
                            }
                            placeholder="Full name"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                          />
                          <input
                            type="email"
                            value={editPersonForm.email}
                            onChange={(e) =>
                              setEditPersonForm((f) => ({ ...f, email: e.target.value }))
                            }
                            placeholder="Business email"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                          />
                          <input
                            type="text"
                            value={editPersonForm.phone}
                            onChange={(e) =>
                              setEditPersonForm((f) => ({ ...f, phone: e.target.value }))
                            }
                            placeholder="Phone"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                          />
                          <input
                            type="url"
                            value={editPersonForm.linkedinUrl}
                            onChange={(e) =>
                              setEditPersonForm((f) => ({ ...f, linkedinUrl: e.target.value }))
                            }
                            placeholder="https://linkedin.com/in/..."
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                          />
                        </div>
                        <textarea
                          rows={2}
                          value={editPersonForm.bioSummary}
                          onChange={(e) =>
                            setEditPersonForm((f) => ({ ...f, bioSummary: e.target.value }))
                          }
                          placeholder="Executive summary / public bio note"
                          className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingPersonId(null)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingPersonEdit}
                            className="px-3 py-1 rounded bg-blue-600 text-white font-semibold text-xs disabled:opacity-50"
                          >
                            {savingPersonEdit ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Inline Link to Existing Company Form */}
                    {isLinking && (
                      <form
                        onSubmit={(e) => handleSaveCompanyLink(e, p.id)}
                        className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 space-y-2"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            required
                            value={linkCompanyForm.leadId}
                            onChange={(e) =>
                              setLinkCompanyForm((f) => ({ ...f, leadId: e.target.value }))
                            }
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                          >
                            <option value="">Select CRM company...</option>
                            {existingLeads.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.companyName}
                              </option>
                            ))}
                          </select>
                          <select
                            value={linkCompanyForm.relationshipType}
                            onChange={(e) =>
                              setLinkCompanyForm((f) => ({
                                ...f,
                                relationshipType: e.target.value,
                              }))
                            }
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                          >
                            {EXPANDED_RELATIONSHIP_TYPES.map((role) => (
                              <option key={role} value={role}>
                                {formatRoleLabel(role)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={linkCompanyForm.jobTitle}
                            onChange={(e) =>
                              setLinkCompanyForm((f) => ({ ...f, jobTitle: e.target.value }))
                            }
                            placeholder="Job Title (e.g. Board Chair)"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                          />
                          <input
                            type="text"
                            value={linkCompanyForm.department}
                            onChange={(e) =>
                              setLinkCompanyForm((f) => ({ ...f, department: e.target.value }))
                            }
                            placeholder="Department"
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={linkCompanyForm.isPrimaryContact}
                              onChange={(e) =>
                                setLinkCompanyForm((f) => ({
                                  ...f,
                                  isPrimaryContact: e.target.checked,
                                }))
                              }
                            />
                            <span>Set as Primary Contact</span>
                          </label>
                          <button
                            type="submit"
                            disabled={savingLink || !linkCompanyForm.leadId}
                            className="px-3 py-1 rounded bg-indigo-600 text-white font-semibold text-xs disabled:opacity-50"
                          >
                            {savingLink ? 'Linking...' : 'Link to Company'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Expandable Provenance & Attribution Ledger */}
                    {provExpanded && (
                      <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5 text-[11px]">
                        <div className="font-semibold text-slate-700 dark:text-slate-200">
                          Sources &amp; Attribute Provenance
                        </div>
                        {p.sources && p.sources.length > 0 ? (
                          <div className="space-y-1">
                            {p.sources.map((s, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2 text-slate-500">
                                <span className="truncate">
                                  {s.sourceName}
                                  {s.attribution ? ` · ${s.attribution}` : ''}
                                </span>
                                <span className="font-mono text-[10px] shrink-0 tabular-nums">
                                  {s.retrievedAt ? new Date(s.retrievedAt).toLocaleDateString() : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-500">No external discovery sources recorded.</div>
                        )}
                        {p.attributeProvenance && Object.keys(p.attributeProvenance).length > 0 && (
                          <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 space-y-1">
                            {Object.values(p.attributeProvenance).map((ap, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                                <span className="font-mono text-slate-700 dark:text-slate-300">
                                  {ap.attribute}: {ap.sourceType}
                                </span>
                                <span className="truncate">{ap.sourceName}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

