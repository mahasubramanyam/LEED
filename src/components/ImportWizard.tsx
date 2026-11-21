import React, { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Save,
  Download,
  RefreshCw,
  Users,
  Building2,
  GitMerge,
  ShieldAlert,
  Sparkles,
  Plus,
  Trash2,
  Layers,
} from 'lucide-react';
import {
  CanonicalLead,
  ColumnMappingRule,
  ImportBatchRecord,
  ImportBatchRowRecord,
  ImportMappingTemplate,
  ImportNormalizationOptions,
  ImportPreviewRow,
  ImportRowDecisionAction,
  MappingAmbiguityWarning,
  MultiColumnMergeRule,
  ParsedImportFileSummary,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface ImportWizardProps {
  existingLeads: CanonicalLead[];
  onImportComplete: () => void;
  onClose?: () => void;
  compact?: boolean;
}

const TARGET_FIELD_GROUPS: Array<{
  group: string;
  options: Array<{ value: string; label: string }>;
}> = [
  {
    group: 'Ignore',
    options: [{ value: 'ignore', label: '— Ignore Column —' }],
  },
  {
    group: 'Company Identity & Legal',
    options: [
      { value: 'companyName', label: 'Company Name' },
      { value: 'legalName', label: 'Legal Name' },
      { value: 'tradingName', label: 'Trading / DBA Name' },
      { value: 'registrationNumber', label: 'Registration Number' },
      { value: 'registrationType', label: 'Registration Type' },
      { value: 'vatNumber', label: 'VAT / Tax ID' },
      { value: 'leiNumber', label: 'LEI (ISO 17442)' },
      { value: 'companyStatus', label: 'Company Legal Status' },
    ],
  },
  {
    group: 'Company Contact & Digital',
    options: [
      { value: 'website', label: 'Website / URL' },
      { value: 'domain', label: 'Domain' },
      { value: 'email', label: 'Company Email' },
      { value: 'phone', label: 'Company Phone' },
      { value: 'linkedinCompanyUrl', label: 'Company LinkedIn URL' },
    ],
  },
  {
    group: 'Location & Address',
    options: [
      { value: 'street', label: 'Street Address' },
      { value: 'city', label: 'City / Locality' },
      { value: 'region', label: 'Region / State / Province' },
      { value: 'postalCode', label: 'Postal / ZIP Code' },
      { value: 'country', label: 'Country Name' },
      { value: 'countryCode', label: 'Country ISO Alpha-2' },
    ],
  },
  {
    group: 'Commercial & Metadata',
    options: [
      { value: 'industry', label: 'Industry / Sector' },
      { value: 'category', label: 'Category' },
      { value: 'description', label: 'Business Description' },
      { value: 'employeeCount', label: 'Employee Count' },
      { value: 'employeeRange', label: 'Employee Range' },
      { value: 'foundedYear', label: 'Founded Year' },
      { value: 'annualRevenue', label: 'Annual Revenue' },
      { value: 'currency', label: 'Currency (ISO 4217)' },
      { value: 'opportunityValue', label: 'Opportunity Value' },
      { value: 'tags', label: 'Tags (semicolon/comma)' },
    ],
  },
  {
    group: 'Person / Decision-Maker',
    options: [
      { value: 'personFullName', label: 'Person Full Name' },
      { value: 'personFirstName', label: 'Person First Name' },
      { value: 'personLastName', label: 'Person Last Name' },
      { value: 'personEmail', label: 'Person Email' },
      { value: 'personPhone', label: 'Person Phone' },
      { value: 'personLinkedInUrl', label: 'Person LinkedIn URL' },
      { value: 'personJobTitle', label: 'Job Title' },
      { value: 'personDesignation', label: 'Designation' },
      { value: 'personRole', label: 'Role' },
      { value: 'personDepartment', label: 'Department' },
      { value: 'personCountry', label: 'Person Country' },
      { value: 'personCity', label: 'Person City' },
    ],
  },
  {
    group: 'Company–Person Relationship',
    options: [
      { value: 'associatedCompanyName', label: 'Associated Company Name' },
      { value: 'associatedCompanyRegNumber', label: 'Associated Company Reg No.' },
      { value: 'relationshipType', label: 'Relationship Type (founder/director/etc.)' },
      { value: 'relationshipPosition', label: 'Relationship Position' },
      { value: 'decisionMakerCategory', label: 'Decision-Maker Category' },
      { value: 'isPrimaryContact', label: 'Is Primary Contact (true/false)' },
    ],
  },
];

const SAMPLE_CSV = `Company Name,Registration Number,Website,Company Email,Company Phone,Street,City,Postal Code,Country,Industry,Opportunity Value,Contact First Name,Contact Last Name,Job Title,Contact Email,LinkedIn URL,Primary Contact
"Nordic Marine AS",974760673,https://nordic-marine.no,post@nordic-marine.no,"22 34 56 78",Karl Johans gate 1,Oslo,0154,Norway,Maritime & Engineering,145000,Astrid,Solberg,Managing Director,astrid@nordic-marine.no,https://linkedin.com/in/astrid-solberg,true
"Nordic Marine AS",974760673,https://nordic-marine.no,post@nordic-marine.no,"22 34 56 78",Karl Johans gate 1,Oslo,0154,Norway,Maritime & Engineering,145000,Henrik,Lindqvist,Head of Procurement,henrik@nordic-marine.no,https://linkedin.com/in/henrik-lindqvist,false
"Acme Precision Ltd",01234567,https://acme-precision.co.uk,info@acme-precision.co.uk,020 7946 0912,10 Fleet St,London,EC4Y 1AA,GB,Manufacturing,85000,Oliver,Bennett,Founder & CEO,oliver@acme-precision.co.uk,https://linkedin.com/in/oliver-bennett,true
"Sydney Health Partners",51 824 753 556,https://sydneyhealth.com.au,contact@sydneyhealth.com.au,02 9876 5432,120 Pitt St,Sydney,2000,Australia,Healthcare,62000,Claire,Mitchell,Practice Director,claire@sydneyhealth.com.au,https://linkedin.com/in/claire-mitchell,true`;

export const ImportWizard: React.FC<ImportWizardProps> = ({
  existingLeads,
  onImportComplete,
  onClose,
}) => {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'result'>('upload');
  const [templates, setTemplates] = useState<ImportMappingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [defaultCountryCode, setDefaultCountryCode] = useState<string>('GB');
  const [pastedCsv, setPastedCsv] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Active Staged Session State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileSummary, setFileSummary] = useState<ParsedImportFileSummary | null>(null);
  const [mappings, setMappings] = useState<ColumnMappingRule[]>([]);
  const [mergeRules, setMergeRules] = useState<MultiColumnMergeRule[]>([]);
  const [ambiguityWarnings, setAmbiguityWarnings] = useState<MappingAmbiguityWarning[]>([]);
  const [sampleRows, setSampleRows] = useState<Array<{ rowNumber: number; cells: string[] }>>([]);
  const [options, setOptions] = useState<ImportNormalizationOptions>({
    defaultCountryCode: 'GB',
    dateLocale: 'ISO',
    numberLocale: 'en-US',
    duplicatePolicy: 'merge_safe',
    preserveExistingCrmFields: true,
    atomicRollbackOnError: false,
    skipRowsWithErrors: true,
  });

  // Template saving
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [templateFeedback, setTemplateFeedback] = useState<string | null>(null);

  // Preview state
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSummary, setPreviewSummary] = useState<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    companyOnlyRows: number;
    personOnlyRows: number;
    companyAndPersonRows: number;
    newRecords: number;
    exactDuplicates: number;
    existingWithNewInfo: number;
    possibleDuplicates: number;
    conflicts: number;
    predictedCreatedCompanies: number;
    predictedUpdatedCompanies: number;
    predictedCreatedPersons: number;
    predictedLinkedRelationships: number;
    skippedRows: number;
  } | null>(null);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [previewFilter, setPreviewFilter] = useState<
    'all' | 'valid' | 'errors' | 'duplicates' | 'conflicts' | 'new' | 'updates' | 'persons'
  >('all');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewTotalPages, setPreviewTotalPages] = useState(1);
  const [rowOverrides, setRowOverrides] = useState<
    Record<string, { action?: ImportRowDecisionAction; resolveToLeadId?: string }>
  >({});

  // Confirm / Result state
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<{
    batch: ImportBatchRecord;
    rows: ImportBatchRowRecord[];
  } | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await apiFetch('/api/import/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleUploadSubmit = async (overrideCsvText?: string) => {
    setUploadError(null);
    const csvPayload = overrideCsvText ?? pastedCsv;
    if (!selectedFile && !csvPayload.trim()) {
      setUploadError('Please choose a .csv or .xlsx file, or paste CSV content first.');
      return;
    }

    setIsUploading(true);
    try {
      let res: Response;
      if (selectedFile && !overrideCsvText) {
        const form = new FormData();
        form.append('file', selectedFile);
        form.append('defaultCountryCode', defaultCountryCode);
        if (selectedTemplateId) form.append('templateId', selectedTemplateId);
        res = await apiFetch('/api/import/upload', {
          method: 'POST',
          body: form,
        });
      } else {
        res = await apiFetch('/api/import/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'pasted_leads.csv',
            contentText: csvPayload,
            defaultCountryCode,
            templateId: selectedTemplateId || undefined,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || `Upload failed (HTTP ${res.status})`);
        return;
      }

      setSessionId(data.sessionId);
      setFileSummary(data.fileSummary);
      setMappings(data.mappings || []);
      setMergeRules(data.mergeRules || []);
      setAmbiguityWarnings(data.ambiguityWarnings || []);
      setOptions(
        data.options || {
          defaultCountryCode,
          dateLocale: 'ISO',
          numberLocale: 'en-US',
          duplicatePolicy: 'merge_safe',
          preserveExistingCrmFields: true,
          atomicRollbackOnError: false,
          skipRowsWithErrors: true,
        }
      );
      setSampleRows(data.sampleRows || []);
      setRowOverrides({});
      setStep('mapping');
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSwitchWorksheet = async (worksheetName: string) => {
    if (!sessionId) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await apiFetch(`/api/import/sessions/${sessionId}/worksheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worksheetName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Failed to switch worksheet');
        return;
      }
      setFileSummary(data.fileSummary);
      setMappings(data.mappings || []);
      setMergeRules(data.mergeRules || []);
      setAmbiguityWarnings(data.ambiguityWarnings || []);
      setSampleRows(data.sampleRows || []);
      setRowOverrides({});
    } finally {
      setIsUploading(false);
    }
  };

  const handleRunPreview = async (
    targetPage = 1,
    targetFilter = previewFilter,
    overridesArg = rowOverrides
  ) => {
    if (!sessionId) return;
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await apiFetch(`/api/import/sessions/${sessionId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mappings,
          mergeRules,
          options,
          rowOverrides: overridesArg,
          page: targetPage,
          pageSize: 30,
          filter: targetFilter,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(data.error || `Preview failed (HTTP ${res.status})`);
        return;
      }
      setPreviewSummary(data.summary);
      setPreviewRows(data.rows || []);
      setAmbiguityWarnings(data.ambiguityWarnings || []);
      setPreviewPage(data.pagination?.page || 1);
      setPreviewTotalPages(data.pagination?.totalPages || 1);
      setStep('preview');
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to compute preview.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim() || !fileSummary) return;
    setTemplateFeedback(null);
    try {
      const res = await apiFetch('/api/import/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTemplateName.trim(),
          sourceFormat: fileSummary.format,
          headerSignature: fileSummary.headers,
          columnMappings: mappings.map((m) => ({
            sourceHeader: m.sourceHeader,
            targetField: m.targetField,
          })),
          mergeRules,
          normalizationOptions: options,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTemplateFeedback(data.error || 'Could not save template.');
        return;
      }
      setSelectedTemplateId(data.template.id);
      setShowSaveTemplate(false);
      setNewTemplateName('');
      setTemplateFeedback(`Saved template "${data.template.name}".`);
      await loadTemplates();
    } catch (err: any) {
      setTemplateFeedback(err?.message || 'Template save failed.');
    }
  };

  const handleRowOverrideChange = async (
    rowNumber: number,
    action: ImportRowDecisionAction,
    resolveToLeadId?: string
  ) => {
    const nextOverrides = {
      ...rowOverrides,
      [String(rowNumber)]: { action, resolveToLeadId },
    };
    setRowOverrides(nextOverrides);
    await handleRunPreview(previewPage, previewFilter, nextOverrides);
  };

  const handleConfirmImport = async () => {
    if (!sessionId) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const tpl = templates.find((t) => t.id === selectedTemplateId);
      const res = await apiFetch(`/api/import/sessions/${sessionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          rowOverrides,
          templateId: tpl?.id,
          templateName: tpl?.name,
          atomicRollbackOnError: options.atomicRollbackOnError,
        }),
      });
      const data = await res.json();
      if (!res.ok && !data.batch) {
        setConfirmError(data.error || `Import execution failed (HTTP ${res.status})`);
        return;
      }
      setExecutionResult({ batch: data.batch, rows: data.rows || [] });
      setStep('result');
      onImportComplete();
    } catch (err: any) {
      setConfirmError(err?.message || 'Import execution failed.');
    } finally {
      setIsConfirming(false);
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

  const addMergeRule = () => {
    if (!fileSummary || fileSummary.headers.length < 2) return;
    setMergeRules((prev) => [
      ...prev,
      {
        id: `merge-${Date.now()}`,
        targetField: 'personFullName',
        sourceColumnIndexes: [0, 1],
        separator: ' ',
      },
    ]);
  };

  const renderClassificationBadge = (c: string) => {
    switch (c) {
      case 'new_record':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
            New Record
          </span>
        );
      case 'existing_with_new_info':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30">
            Safe Enrichment
          </span>
        );
      case 'exact_crm_duplicate':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30">
            Exact Duplicate
          </span>
        );
      case 'possible_duplicate':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30">
            Possible Match
          </span>
        );
      case 'conflicting_identity':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30">
            Identity Conflict
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {c}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Step Progress Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs">
          {[
            { id: 'upload', label: '1. Upload CSV / Excel' },
            { id: 'mapping', label: '2. Map & Normalize' },
            { id: 'preview', label: '3. Dry-Run Preview & Dedupe' },
            { id: 'result', label: '4. Execution Ledger' },
          ].map((item, idx) => {
            const active = step === item.id;
            const stepsOrder = ['upload', 'mapping', 'preview', 'result'];
            const done = stepsOrder.indexOf(step) > idx;
            return (
              <div
                key={item.id}
                className={`px-2.5 py-1 rounded-lg font-medium border flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#910303] text-white border-[#910303]'
                    : done
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-100 dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800'
                }`}
              >
                {done && <CheckCircle2 className="w-3 h-3" />}
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>

        {fileSummary && (
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {fileSummary.filename} · {fileSummary.format.toUpperCase()} · {fileSummary.totalRows} rows
          </div>
        )}
      </div>

      {/* STEP 1: UPLOAD */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Apply Saved Mapping Template (Optional)
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="">Auto-detect columns automatically</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.sourceFormat.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Default Country ISO Fallback
              </label>
              <input
                type="text"
                maxLength={2}
                value={defaultCountryCode}
                onChange={(e) => setDefaultCountryCode(e.target.value.toUpperCase())}
                placeholder="GB"
                className="w-full px-3 py-2 text-xs font-mono uppercase rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-6 text-center bg-slate-50 dark:bg-slate-950/50 space-y-3">
            <FileSpreadsheet className="w-9 h-9 text-blue-500 mx-auto" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Upload CSV or Excel (.xlsx) Lead &amp; Decision-Maker File
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Server-parsed up to 15 MB / 10,000 rows with UTF-8/UTF-16 encoding detection, macro blocking, and formula sanitization. Zero CRM writes until you review and confirm.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-[#B30303] hover:bg-[#910303] text-white text-xs font-semibold rounded-lg shadow-xs transition">
                <Upload className="w-3.5 h-3.5" />
                <span>{selectedFile ? selectedFile.name : 'Choose .csv or .xlsx File'}</span>
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setSelectedFile(f);
                    setUploadError(null);
                  }}
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setPastedCsv(SAMPLE_CSV);
                  handleUploadSubmit(SAMPLE_CSV);
                }}
                disabled={isUploading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Load Multi-Country Sample (Companies + Decision-Makers)</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Or Paste Raw CSV Data Directly
            </label>
            <textarea
              rows={5}
              value={pastedCsv}
              onChange={(e) => {
                setPastedCsv(e.target.value);
                if (e.target.value.trim()) setSelectedFile(null);
              }}
              placeholder="Company Name,Registration Number,Website,Email,Phone,City,Country,Contact Full Name,Job Title..."
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          {uploadError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => handleUploadSubmit()}
              disabled={isUploading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#B30303] hover:bg-[#910303] disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition"
            >
              {isUploading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Parsing &amp; Analyzing Columns...</span>
                </>
              ) : (
                <>
                  <span>Parse &amp; Map Columns</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: COLUMN MAPPING & NORMALIZATION */}
      {step === 'mapping' && fileSummary && (
        <div className="space-y-4">
          {/* Worksheet selector for multi-sheet XLSX */}
          {fileSummary.format === 'xlsx' && fileSummary.worksheets.length > 1 && (
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-semibold">
                <Layers className="w-4 h-4" />
                <span>Excel Workbook Sheets ({fileSummary.worksheets.length}):</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {fileSummary.worksheets.map((ws) => (
                  <button
                    key={ws.name}
                    type="button"
                    onClick={() => handleSwitchWorksheet(ws.name)}
                    className={`px-2.5 py-1 rounded-md font-mono text-[11px] border transition ${
                      fileSummary.selectedWorksheet === ws.name
                        ? 'bg-[#910303] text-white border-[#910303]'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {ws.name} ({ws.rowCount}r)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ambiguity Warnings */}
          {ambiguityWarnings.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                <span>Column Mapping Ambiguity Notices ({ambiguityWarnings.length})</span>
              </div>
              <ul className="list-disc list-inside text-[11px] text-amber-700/90 dark:text-amber-200/90 space-y-0.5">
                {ambiguityWarnings.map((w, idx) => (
                  <li key={idx}>
                    <strong>{w.sourceHeader}</strong>: {w.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Normalization & Duplicate Policy Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Duplicate Handling Policy
              </label>
              <select
                value={options.duplicatePolicy}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    duplicatePolicy: e.target.value as ImportNormalizationOptions['duplicatePolicy'],
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="merge_safe">Safe Enrich (Preserve Existing CRM)</option>
                <option value="skip_existing">Skip Existing Duplicates</option>
                <option value="create_if_new_only">Create New Only</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Number / Currency Locale
              </label>
              <select
                value={options.numberLocale || 'en-US'}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    numberLocale: e.target.value as ImportNormalizationOptions['numberLocale'],
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="en-US">US / UK (1,250.50)</option>
                <option value="de-DE">European (1.250,50)</option>
                <option value="fr-FR">French (1 250,50)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Date Format Locale
              </label>
              <select
                value={options.dateLocale || 'ISO'}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    dateLocale: e.target.value as ImportNormalizationOptions['dateLocale'],
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="ISO">ISO (YYYY-MM-DD)</option>
                <option value="UK">UK / EU (DD/MM/YYYY)</option>
                <option value="US">US (MM/DD/YYYY)</option>
              </select>
            </div>

            <div className="flex flex-col justify-center gap-1.5">
              <label className="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.atomicRollbackOnError}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, atomicRollbackOnError: e.target.checked }))
                  }
                  className="rounded border-slate-300"
                />
                <span>Atomic Rollback on Any Row Error</span>
              </label>
              <span className="text-[10px] text-slate-500">
                Existing CRM stages, notes &amp; verified data are always preserved.
              </span>
            </div>
          </div>

          {/* Column Mapping Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Source Column</th>
                    <th className="px-3 py-2 font-semibold">Sample Values</th>
                    <th className="px-3 py-2 font-semibold">Target CRM / Person Field</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950">
                  {mappings.map((m, idx) => {
                    const samples = sampleRows
                      .slice(0, 2)
                      .map((r) => r.cells[m.sourceColumnIndex])
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <tr key={m.sourceColumnIndex}>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-white">
                          {m.sourceHeader || `Col ${m.sourceColumnIndex + 1}`}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 max-w-xs truncate">
                          {samples || <span className="italic opacity-60">empty</span>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={m.targetField}
                            onChange={(e) => {
                              const next = [...mappings];
                              next[idx] = {
                                ...next[idx],
                                targetField: e.target.value,
                                autoDetected: false,
                              };
                              setMappings(next);
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                          >
                            {TARGET_FIELD_GROUPS.map((grp) => (
                              <optgroup key={grp.group} label={grp.group}>
                                {grp.options.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                            <option
                              value={`customField:${m.sourceHeader
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, '_')}`}
                            >
                              Custom Field ({m.sourceHeader})
                            </option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Multi-Column Merge Rules & Save Template */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addMergeRule}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Multi-Column Merge Rule ({mergeRules.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSaveTemplate(!showSaveTemplate)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Mapping Template</span>
              </button>
            </div>

            {templateFeedback && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {templateFeedback}
              </span>
            )}
          </div>

          {mergeRules.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-700 dark:text-slate-300">
                Active Multi-Column Merge Rules
              </div>
              {mergeRules.map((rule, rIdx) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-2">
                  <select
                    value={rule.targetField}
                    onChange={(e) => {
                      const next = [...mergeRules];
                      next[rIdx] = { ...next[rIdx], targetField: e.target.value };
                      setMergeRules(next);
                    }}
                    className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="personFullName">Person Full Name</option>
                    <option value="companyName">Company Name</option>
                    <option value="street">Street Address</option>
                    <option value="description">Description</option>
                  </select>
                  <span className="text-slate-400">← columns:</span>
                  {rule.sourceColumnIndexes.map((colIdx, pos) => (
                    <select
                      key={pos}
                      value={colIdx}
                      onChange={(e) => {
                        const next = [...mergeRules];
                        const cols = [...next[rIdx].sourceColumnIndexes];
                        cols[pos] = Number(e.target.value);
                        next[rIdx] = { ...next[rIdx], sourceColumnIndexes: cols };
                        setMergeRules(next);
                      }}
                      className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {fileSummary.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Col ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMergeRules((prev) => prev.filter((_, i) => i !== rIdx))}
                    className="text-rose-500 hover:text-rose-400 p-1"
                    title="Remove rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showSaveTemplate && (
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex flex-wrap items-center gap-2 text-xs">
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="Template name (e.g. Nordic Registry + Contacts)"
                className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={handleSaveTemplate}
                className="px-3 py-1.5 bg-[#B30303] hover:bg-[#910303] text-white font-semibold rounded-lg"
              >
                Save Template
              </button>
            </div>
          )}

          {previewError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs">
              {previewError}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Upload</span>
            </button>
            <button
              type="button"
              onClick={() => handleRunPreview(1, 'all')}
              disabled={isPreviewLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#B30303] hover:bg-[#910303] disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs"
            >
              {isPreviewLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Validating &amp; Deduplicating...</span>
                </>
              ) : (
                <>
                  <span>Run Dry-Run Preview</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: DRY-RUN PREVIEW & DEDUPE REVIEW */}
      {step === 'preview' && previewSummary && (
        <div className="space-y-4">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] uppercase text-slate-500 font-semibold">Total Rows</div>
              <div className="text-base font-bold text-slate-900 dark:text-white font-mono">
                {previewSummary.totalRows}
              </div>
              <div className="text-[10px] text-slate-500">
                {previewSummary.validRows} valid · {previewSummary.invalidRows} invalid
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <div className="text-[10px] uppercase text-emerald-700 dark:text-emerald-300 font-semibold">
                New Companies
              </div>
              <div className="text-base font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                {previewSummary.predictedCreatedCompanies}
              </div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-300/80">
                Grouped across file
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30">
              <div className="text-[10px] uppercase text-blue-700 dark:text-blue-300 font-semibold">
                Safe Enrichments
              </div>
              <div className="text-base font-bold text-blue-700 dark:text-blue-300 font-mono">
                {previewSummary.predictedUpdatedCompanies}
              </div>
              <div className="text-[10px] text-blue-600/80 dark:text-blue-300/80">
                {previewSummary.exactDuplicates} exact dupes skipped
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-[#FDF4F4] dark:bg-[#690303]/60 border border-[#D8B4B4] dark:border-[#CE0404]/50">
              <div className="text-[10px] uppercase text-indigo-700 dark:text-indigo-300 font-semibold">
                Persons &amp; Links
              </div>
              <div className="text-base font-bold text-indigo-700 dark:text-indigo-300 font-mono">
                +{previewSummary.predictedCreatedPersons} / {previewSummary.predictedLinkedRelationships}
              </div>
              <div className="text-[10px] text-indigo-600/80 dark:text-indigo-300/80">
                M:N relationships
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300 font-semibold">
                Possible Dupes
              </div>
              <div className="text-base font-bold text-amber-700 dark:text-amber-300 font-mono">
                {previewSummary.possibleDuplicates}
              </div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-300/80">
                Needs review
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30">
              <div className="text-[10px] uppercase text-rose-700 dark:text-rose-300 font-semibold">
                Conflicts / Errors
              </div>
              <div className="text-base font-bold text-rose-700 dark:text-rose-300 font-mono">
                {previewSummary.conflicts + previewSummary.invalidRows}
              </div>
              <div className="text-[10px] text-rose-600/80 dark:text-rose-300/80">
                Never auto-merged
              </div>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ['all', 'All Rows'],
                ['new', 'New'],
                ['updates', 'Safe Enrich'],
                ['duplicates', 'Duplicates'],
                ['conflicts', 'Conflicts'],
                ['errors', 'Invalid'],
                ['persons', 'With Persons'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPreviewFilter(key);
                  handleRunPreview(1, key);
                }}
                className={`px-2.5 py-1 rounded-lg border font-medium transition ${
                  previewFilter === key
                    ? 'bg-[#910303] text-white border-[#910303]'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Preview Rows Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Company &amp; Identifiers</th>
                    <th className="px-3 py-2">Person / Relationship</th>
                    <th className="px-3 py-2">Dedupe &amp; Validation</th>
                    <th className="px-3 py-2">Action Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950">
                  {previewRows.map((row) => (
                    <tr key={row.rowNumber} className="align-top">
                      <td className="px-3 py-2.5 font-mono text-slate-500">#{row.rowNumber}</td>
                      <td className="px-3 py-2.5 space-y-0.5">
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{row.company?.companyName || row.person?.associatedCompanyName || 'Standalone Person'}</span>
                        </div>
                        {row.company && (
                          <div className="text-[11px] text-slate-500 font-mono">
                            {row.company.countryCode}
                            {row.company.registrationNumber ? ` · Reg: ${row.company.registrationNumber}` : ''}
                            {row.company.domain ? ` · ${row.company.domain}` : ''}
                          </div>
                        )}
                        {row.company?.phoneNormalized && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                            {row.company.phoneNormalized}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 space-y-0.5">
                        {row.person ? (
                          <>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                              <span>{row.person.fullName}</span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {row.person.jobTitle || row.person.relationshipType}
                              {row.person.isPrimaryContact ? ' · Primary' : ''}
                            </div>
                            {row.person.email && (
                              <div className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400">
                                {row.person.email}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Company only</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 space-y-1 max-w-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {renderClassificationBadge(row.dedupe.classification)}
                          {row.dedupe.matchedCrmLeadName && (
                            <span className="text-[10px] font-mono text-slate-500">
                              → {row.dedupe.matchedCrmLeadName}
                            </span>
                          )}
                        </div>
                        {row.errors.map((e, i) => (
                          <div key={i} className="text-[11px] text-rose-600 dark:text-rose-400">
                            Error: {e.message}
                          </div>
                        ))}
                        {row.warnings.map((w, i) => (
                          <div key={i} className="text-[10px] text-amber-600 dark:text-amber-400">
                            Warn: {w.message}
                          </div>
                        ))}
                        {row.dedupe.conflictDetails?.map((c, i) => (
                          <div key={i} className="text-[11px] text-rose-600 dark:text-rose-400">
                            {c}
                          </div>
                        ))}
                        {row.changesSummary.length > 0 && (
                          <div className="text-[10px] text-slate-500">
                            {row.changesSummary.join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 space-y-1">
                        <select
                          disabled={!row.valid}
                          value={row.proposedAction}
                          onChange={(e) =>
                            handleRowOverrideChange(
                              row.rowNumber,
                              e.target.value as ImportRowDecisionAction,
                              row.dedupe.matchedCrmLeadId
                            )
                          }
                          className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[11px]"
                        >
                          <option value="create_new">Create New Lead</option>
                          <option value="update_existing">Safe Merge into CRM Lead</option>
                          <option value="link_person_only">Link Person Only</option>
                          <option value="skip">Skip Row</option>
                          <option value="needs_review">Hold for Review</option>
                        </select>

                        {row.proposedAction === 'update_existing' && existingLeads.length > 0 && (
                          <select
                            value={row.dedupe.matchedCrmLeadId || ''}
                            onChange={(e) =>
                              handleRowOverrideChange(
                                row.rowNumber,
                                'update_existing',
                                e.target.value
                              )
                            }
                            className="block w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px]"
                          >
                            <option value="">Select target CRM lead...</option>
                            {existingLeads.slice(0, 100).map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.companyName} ({l.address?.countryCode})
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {previewTotalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Page {previewPage} of {previewTotalPages}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={previewPage <= 1}
                  onClick={() => handleRunPreview(previewPage - 1)}
                  className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={previewPage >= previewTotalPages}
                  onClick={() => handleRunPreview(previewPage + 1)}
                  className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {confirmError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs">
              {confirmError}
            </div>
          )}

          {/* Explicit Confirmation Footer */}
          <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep('mapping')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Adjust Mapping</span>
            </button>

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Dry-run complete — no CRM records modified yet.
              </span>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={isConfirming}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition"
              >
                {isConfirming ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Committing Transaction...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Execute Import to CRM</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: EXECUTION RESULT */}
      {step === 'result' && executionResult && (
        <div className="space-y-4">
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              executionResult.batch.status === 'completed'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : executionResult.batch.status === 'partial_failed'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
            }`}
          >
            {executionResult.batch.status === 'completed' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <div className="text-xs space-y-1">
              <div className="font-bold text-sm">
                Import Batch {executionResult.batch.status.replace(/_/g, ' ').toUpperCase()} —{' '}
                {executionResult.batch.filename}
              </div>
              <div>
                Batch ID: <code className="font-mono">{executionResult.batch.id}</code> · Completed in{' '}
                {executionResult.batch.durationMs}ms
              </div>
              {executionResult.batch.errorMessage && (
                <div className="font-medium">{executionResult.batch.errorMessage}</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Created Companies</div>
              <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {executionResult.batch.createdCompanies}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Enriched Companies</div>
              <div className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400">
                {executionResult.batch.updatedCompanies}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Created Persons</div>
              <div className="text-lg font-bold font-mono text-indigo-600 dark:text-indigo-400">
                {executionResult.batch.createdPersons}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">M:N Links</div>
              <div className="text-lg font-bold font-mono text-cyan-600 dark:text-cyan-400">
                {executionResult.batch.createdRelationships + executionResult.batch.updatedRelationships}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Skipped / Dupes</div>
              <div className="text-lg font-bold font-mono text-slate-600 dark:text-slate-300">
                {executionResult.batch.skippedRows}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Failed / Conflicts</div>
              <div className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400">
                {executionResult.batch.failedRows + executionResult.batch.conflictRows}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadBatchCsv(executionResult.batch.id, 'summary')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Batch Report CSV</span>
              </button>
              {(executionResult.batch.failedRows > 0 || executionResult.batch.conflictRows > 0) && (
                <button
                  type="button"
                  onClick={() => downloadBatchCsv(executionResult.batch.id, 'failed')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Failed / Conflict Rows CSV</span>
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('upload');
                  setSessionId(null);
                  setExecutionResult(null);
                  setSelectedFile(null);
                }}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
              >
                Import Another File
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#B30303] hover:bg-[#910303] text-white"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
