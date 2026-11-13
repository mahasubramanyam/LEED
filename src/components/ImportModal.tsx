import React, { useState, useEffect } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
  SlidersHorizontal,
} from 'lucide-react';
import { CanonicalLead, CountryReference } from '../types.js';
import { apiFetch } from '../utils/apiFetch.ts';
import { parseCsvRfc4180 } from '../../shared/csvUtils.ts';
import {
  canonicalizeIdentifierType,
  getDefaultIdentifierTypeForCountry,
} from '../../shared/identifierRegistry.ts';
import { formatCurrencyLocale, getLocaleForCountry } from '../../shared/localization.ts';

interface ImportModalProps {
  onClose: () => void;
  onImportComplete: (leads: CanonicalLead[]) => void;
  existingLeads: CanonicalLead[];
}

type TargetField =
  | 'ignore'
  | 'companyName'
  | 'legalName'
  | 'registrationNumber'
  | 'registrationType'
  | 'vat'
  | 'lei'
  | 'website'
  | 'email'
  | 'phone'
  | 'street'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'country'
  | 'countryCode'
  | 'industry'
  | 'category'
  | 'currency'
  | 'opportunityValue'
  | 'tags';

const TARGET_FIELD_OPTIONS: Array<{ value: TargetField; label: string }> = [
  { value: 'ignore', label: '— Ignore Column —' },
  { value: 'companyName', label: 'Company Name *' },
  { value: 'legalName', label: 'Legal Name' },
  { value: 'registrationNumber', label: 'Registration Number' },
  { value: 'registrationType', label: 'Registration Type' },
  { value: 'vat', label: 'VAT / Tax ID' },
  { value: 'lei', label: 'LEI (ISO 17442)' },
  { value: 'website', label: 'Website / URL' },
  { value: 'email', label: 'Public Email' },
  { value: 'phone', label: 'Telephone (Raw -> Normalized)' },
  { value: 'street', label: 'Street Address' },
  { value: 'city', label: 'City / Locality' },
  { value: 'region', label: 'Region / State / Province' },
  { value: 'postalCode', label: 'Postal / ZIP Code' },
  { value: 'country', label: 'Country Name / ISO' },
  { value: 'countryCode', label: 'Country ISO Code (Alpha-2)' },
  { value: 'industry', label: 'Industry / Sector' },
  { value: 'category', label: 'Category' },
  { value: 'currency', label: 'Currency (ISO 4217)' },
  { value: 'opportunityValue', label: 'Opportunity Value' },
  { value: 'tags', label: 'Tags (semicolon/comma separated)' },
];

function autoDetectField(header: string): TargetField {
  const h = header.toLowerCase().trim();
  if (!h) return 'ignore';
  if (h === 'legal name' || h.includes('legal_name')) return 'legalName';
  if (h.includes('company') || h === 'name' || h === 'organization') return 'companyName';
  if (h.includes('reg') && h.includes('type')) return 'registrationType';
  if (h.includes('reg') || h.includes('orgnr') || h.includes('crn') || h.includes('abn')) return 'registrationNumber';
  if (h.includes('vat') || h.includes('tax')) return 'vat';
  if (h === 'lei' || h.includes('lei ')) return 'lei';
  if (h.includes('web') || h.includes('url') || h.includes('domain')) return 'website';
  if (h.includes('mail')) return 'email';
  if (h.includes('phone') || h.includes('tel') || h.includes('mobile')) return 'phone';
  if (h.includes('street') || h === 'address') return 'street';
  if (h.includes('city') || h.includes('town') || h.includes('locality')) return 'city';
  if (h.includes('region') || h.includes('state') || h.includes('province') || h.includes('county')) return 'region';
  if (h.includes('postal') || h.includes('postcode') || h.includes('zip')) return 'postalCode';
  if (h === 'country code' || h === 'country_code' || h === 'iso' || h === 'alpha2') return 'countryCode';
  if (h.includes('country') || h.includes('nation')) return 'country';
  if (h.includes('industry') || h.includes('sector')) return 'industry';
  if (h.includes('category')) return 'category';
  if (h.includes('currency')) return 'currency';
  if (h.includes('value') || h.includes('amount') || h.includes('deal')) return 'opportunityValue';
  if (h.includes('tag')) return 'tags';
  return 'ignore';
}

interface PreviewRow {
  rowIndex: number;
  lead?: CanonicalLead;
  valid: boolean;
  warnings: string[];
  error?: string;
  isDuplicate: boolean;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onClose,
  onImportComplete,
  existingLeads,
}) => {
  const [csvText, setCsvText] = useState(
    `Company Name,Registration Number,Website,Email,Phone,Street,City,Postal Code,Country,Industry,Opportunity Value\n` +
      `"Nordic Marine, AS",974760673,https://nordic-marine.no,post@nordic-marine.no,"22 34 56 78",Karl Johans gate 1,Oslo,0154,Norway,Maritime & Engineering,145000\n` +
      `"Acme ""Precision"" Ltd",01234567,https://acme-precision.co.uk,info@acme-precision.co.uk,020 7946 0912,10 Fleet St,London,EC4Y 1AA,GB,Manufacturing,85000\n` +
      `Sydney Health Partners,51 824 753 556,https://sydneyhealth.com.au,contact@sydneyhealth.com.au,02 9876 5432,120 Pitt St,Sydney,2000,Australia,Healthcare,62000`
  );

  const [step, setStep] = useState<'input' | 'mapping' | 'preview' | 'summary'>('input');
  const [countries, setCountries] = useState<CountryReference[]>([]);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<number, TargetField>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [importMode, setImportMode] = useState<'merge' | 'skip'>('merge');
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    added: number;
    updated: number;
    skipped: number;
    failed: number;
    errors?: Array<{ row: number; error: string }>;
  } | null>(null);

  useEffect(() => {
    apiFetch('/api/geo/countries')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setCountries(data);
      })
      .catch(() => {});
  }, []);

  const resolveCountryRef = (rawCountry?: string, rawCode?: string): CountryReference | undefined => {
    const codeCandidate = (rawCode || '').trim().toUpperCase();
    const nameCandidate = (rawCountry || '').trim();
    const upperName = nameCandidate.toUpperCase();
    const lowerName = nameCandidate.toLowerCase();

    if (codeCandidate) {
      const byCode = countries.find(
        (c) => c.code === codeCandidate || c.alpha3 === codeCandidate
      );
      if (byCode) return byCode;
    }

    if (nameCandidate) {
      return countries.find(
        (c) =>
          c.code === upperName ||
          c.alpha3 === upperName ||
          c.name.toLowerCase() === lowerName ||
          c.officialName.toLowerCase() === lowerName ||
          (c.nativeName && c.nativeName.toLowerCase() === lowerName)
      );
    }

    return undefined;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setParseError(null);
  };

  const handleParseToMapping = () => {
    setParseError(null);
    const parsed = parseCsvRfc4180(csvText);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setParseError(parsed.errors[0] || 'CSV must contain a header row and at least one data row.');
      return;
    }
    if (parsed.errors.length > 0) {
      setParseError(parsed.errors.join(' '));
      return;
    }

    const initialMap: Record<number, TargetField> = {};
    parsed.headers.forEach((h, idx) => {
      initialMap[idx] = autoDetectField(h);
    });

    setParsedHeaders(parsed.headers);
    setParsedRows(parsed.rows);
    setColumnMappings(initialMap);
    setStep('mapping');
  };

  const handleValidateAndPreview = async () => {
    setIsValidating(true);
    setParseError(null);

    const hasCompanyMapping = Object.values(columnMappings).includes('companyName');
    if (!hasCompanyMapping) {
      setParseError('Please map at least one column to "Company Name *".');
      setIsValidating(false);
      return;
    }

    const existingDomains = new Set(existingLeads.map((l) => l.domain?.toLowerCase()).filter(Boolean));
    const existingRegs = new Set(
      existingLeads.map((l) => l.registrationNumber?.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).filter(Boolean)
    );
    const existingPhones = new Set(
      existingLeads.map((l) => l.phoneNormalized || l.phone).filter(Boolean)
    );

    const now = new Date().toISOString();
    const builtPreview: PreviewRow[] = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const fields: Partial<Record<TargetField, string>> = {};

      parsedHeaders.forEach((_, colIdx) => {
        const mapped = columnMappings[colIdx];
        if (mapped && mapped !== 'ignore' && row[colIdx] !== undefined) {
          fields[mapped] = row[colIdx]?.trim() || '';
        }
      });

      const companyName = fields.companyName?.trim();
      if (!companyName) {
        builtPreview.push({
          rowIndex: i + 1,
          valid: false,
          warnings: [],
          error: 'Missing required Company Name',
          isDuplicate: false,
        });
        continue;
      }

      const warnings: string[] = [];
      const resolvedCountry = resolveCountryRef(fields.country, fields.countryCode);
      if ((fields.country || fields.countryCode) && !resolvedCountry) {
        warnings.push(`Unrecognized country "${fields.countryCode || fields.country}"; defaulted safely.`);
      }

      const countryCode = resolvedCountry?.code || (fields.countryCode?.length === 2 ? fields.countryCode.toUpperCase() : 'US');
      const countryName = resolvedCountry?.name || fields.country || 'International';
      const currency = (fields.currency || resolvedCountry?.currency || 'USD').toUpperCase();

      // Website & domain extraction
      const website = fields.website || undefined;
      let domain: string | undefined;
      if (website) {
        try {
          const u = new URL(website.startsWith('http') ? website : `https://${website}`);
          domain = u.hostname.replace(/^www\./, '').toLowerCase();
        } catch {
          warnings.push(`Malformed website URL "${website}"`);
        }
      }

      // Phone normalization preserving raw phone separately
      const rawPhone = fields.phone || undefined;
      let phoneNormalized: string | undefined;
      if (rawPhone) {
        try {
          const pRes = await apiFetch('/api/geo/normalize-phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: rawPhone, countryCode }),
          });
          if (pRes.ok) {
            const pData = await pRes.json();
            if (pData.valid && pData.e164) {
              phoneNormalized = pData.e164;
            } else {
              warnings.push(`Telephone "${rawPhone}" could not be strictly validated for ${countryCode}`);
            }
          }
        } catch {
          // keep raw phone
        }
      }

      // Address formatting & postal check
      let formattedAddress = [fields.street, fields.city, fields.region, fields.postalCode, countryName]
        .filter(Boolean)
        .join(', ');
      try {
        const addrRes = await apiFetch('/api/geo/format-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            street: fields.street,
            city: fields.city,
            region: fields.region,
            postalCode: fields.postalCode,
            country: countryName,
            countryCode,
          }),
        });
        if (addrRes.ok) {
          const addrData = await addrRes.json();
          if (addrData.formattedAddress) formattedAddress = addrData.formattedAddress;
          if (fields.postalCode && addrData.postalValidation && !addrData.postalValidation.valid) {
            warnings.push(addrData.postalValidation.message || 'Postal code format warning');
          }
        }
      } catch {
        // fallback formatting already computed
      }

      // Identifiers & canonical syntax validation
      const reg = fields.registrationNumber || undefined;
      const regType = canonicalizeIdentifierType(
        fields.registrationType || getDefaultIdentifierTypeForCountry(countryCode),
        countryCode
      );
      const identifiers: any[] = [];
      if (domain) {
        identifiers.push({
          type: 'DOMAIN',
          value: domain,
          normalizedValue: domain,
          countryCode,
          source: 'csv_import',
          status: 'user_provided',
          verified: false,
        });
      }

      const validateAndPushIdent = async (type: string, val: string) => {
        const canonType = canonicalizeIdentifierType(type, countryCode);
        let status: 'user_provided' | 'syntax_validated' = 'user_provided';
        let normalizedValue = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        let issuingAuthority: string | undefined;
        try {
          const vRes = await apiFetch('/api/identifiers/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: canonType, value: val, countryCode }),
          });
          if (vRes.ok) {
            const vData = await vRes.json();
            status = vData.valid ? 'syntax_validated' : 'user_provided';
            normalizedValue = vData.normalizedValue || normalizedValue;
            issuingAuthority = vData.issuingAuthority;
            if (!vData.valid && vData.message) {
              warnings.push(`${canonType}: ${vData.message}`);
            }
          }
        } catch {
          // ignore
        }
        identifiers.push({
          type: canonType,
          value: val,
          normalizedValue,
          countryCode,
          issuingAuthority,
          source: 'csv_import',
          status,
          verified: false,
        });
      };

      if (reg) await validateAndPushIdent(regType, reg);
      if (fields.vat) await validateAndPushIdent('EU_VAT', fields.vat);
      if (fields.lei) await validateAndPushIdent('LEI', fields.lei);

      const normReg = reg ? reg.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
      const isDuplicate = Boolean(
        (domain && existingDomains.has(domain)) ||
          (normReg && existingRegs.has(normReg)) ||
          (phoneNormalized && existingPhones.has(phoneNormalized))
      );

      const signals = ['Imported via RFC 4180 CSV Processor'];
      let conf = 50;
      if (website) {
        conf += 15;
        signals.push('Domain & Website Present in File');
      }
      if (fields.email) {
        conf += 15;
        signals.push('Contact Email Included');
      }
      if (reg) {
        conf += 15;
        signals.push('Registration Identifier Included');
      }

      const oppValNum = fields.opportunityValue
        ? Number(fields.opportunityValue.replace(/[^0-9.-]/g, '')) || 0
        : undefined;

      const parsedTags = fields.tags
        ? fields.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean)
        : [];

      const lead: CanonicalLead = {
        id: `import-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
        companyName,
        legalName: fields.legalName || undefined,
        registrationNumber: reg,
        registrationType: reg ? regType : undefined,
        website,
        domain,
        email: fields.email || undefined,
        phone: rawPhone,
        phoneNormalized,
        address: {
          street: fields.street || undefined,
          city: fields.city || undefined,
          region: fields.region || undefined,
          postalCode: fields.postalCode || undefined,
          country: countryName,
          countryCode,
          formattedAddress,
        },
        industry: fields.industry || 'Commercial Services',
        category: fields.category || 'Imported Prospect',
        confidenceScore: Math.min(100, conf),
        confidenceSignals: signals,
        sources: [
          {
            sourceName: 'Customer File Import (CSV)',
            retrievedAt: now,
            attribution: 'User supplied RFC 4180 CSV file',
          },
        ],
        identifiers,
        status: 'new',
        pipelineStageId: undefined,
        currency,
        opportunityValue: oppValNum,
        tags: Array.from(new Set(['CSV Import', countryCode, ...parsedTags])),
        notes: [],
        activities: [
          {
            id: `act-import-${Date.now()}-${i}`,
            type: 'enrichment',
            title: 'Imported via CSV Data Processor',
            date: now,
            actor: 'Owner Import',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      builtPreview.push({
        rowIndex: i + 1,
        lead,
        valid: true,
        warnings,
        isDuplicate,
      });
    }

    setPreviewRows(builtPreview);
    setStep('preview');
    setIsValidating(false);
  };

  const validLeads = previewRows.filter((r) => r.valid && r.lead).map((r) => r.lead!) ;
  const invalidCount = previewRows.filter((r) => !r.valid).length;
  const duplicateCount = previewRows.filter((r) => r.valid && r.isDuplicate).length;

  const handleFinishImport = async () => {
    if (validLeads.length === 0) return;
    setIsImporting(true);
    setParseError(null);
    try {
      const res = await apiFetch('/api/leads/batch-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: validLeads, mode: importMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error || 'Batch import failed');
        return;
      }
      setImportSummary({
        added: data.added || 0,
        updated: data.updated || 0,
        skipped: data.skipped || 0,
        failed: (data.failed || 0) + invalidCount,
        errors: data.errors,
      });
      setStep('summary');
      onImportComplete(validLeads);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Batch import failed');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-sm font-bold text-white">International CSV Data Import & Field Mapper</h3>
              <p className="text-[11px] text-slate-400">
                RFC 4180 parser · ISO country resolution · E.164 phone normalization · Duplicate detection
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {parseError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800 rounded-lg text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* STEP 1: INPUT */}
          {step === 'input' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-slate-300">
                  Upload a UTF-8 CSV file or paste RFC 4180 CSV content (quoted commas, escaped quotes, international characters supported):
                </p>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer border border-slate-700 shrink-0">
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Upload .csv File</span>
                  <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
              <textarea
                rows={10}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white font-mono text-xs rounded-lg p-3 focus:outline-none focus:border-indigo-500"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleParseToMapping}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded flex items-center gap-1.5 transition"
                >
                  <span>Parse Headers & Map Columns</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: INTERACTIVE COLUMN MAPPING */}
          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-200">
                  <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                  <span>
                    Detected <strong>{parsedHeaders.length}</strong> columns across <strong>{parsedRows.length}</strong> data rows. Adjust target CRM field mappings:
                  </span>
                </div>
                <button onClick={() => setStep('input')} className="text-slate-400 hover:text-white">
                  Edit Raw CSV
                </button>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">CSV Column Header</th>
                      <th className="p-2.5">Sample Value (Row 1)</th>
                      <th className="p-2.5">CRM Target Field</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {parsedHeaders.map((header, idx) => (
                      <tr key={idx} className="bg-slate-900/40">
                        <td className="p-2.5 font-mono text-white font-medium">{header}</td>
                        <td className="p-2.5 text-slate-400 truncate max-w-[220px]">
                          {parsedRows[0]?.[idx] || '—'}
                        </td>
                        <td className="p-2.5">
                          <select
                            value={columnMappings[idx] || 'ignore'}
                            onChange={(e) =>
                              setColumnMappings((prev) => ({
                                ...prev,
                                [idx]: e.target.value as TargetField,
                              }))
                            }
                            className="w-full bg-slate-950 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                          >
                            {TARGET_FIELD_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep('input')}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded text-xs"
                >
                  Back
                </button>
                <button
                  onClick={handleValidateAndPreview}
                  disabled={isValidating}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded flex items-center gap-1.5"
                >
                  <span>{isValidating ? 'Normalizing & Validating...' : 'Validate & Preview Rows'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VALIDATION */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="space-y-1">
                  <div className="font-semibold text-white">
                    {validLeads.length} Valid Rows · {invalidCount} Invalid · {duplicateCount} Potential Duplicates
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {duplicateCount > 0 ? (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Duplicates matched by domain, normalized registration/secondary ID, or E.164 phone.
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Zero collision against existing CRM records.
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-400">On Duplicate:</label>
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as 'merge' | 'skip')}
                    className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                  >
                    <option value="merge">Merge & Update Existing</option>
                    <option value="skip">Skip Duplicates</option>
                  </select>
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-64">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase border-b border-slate-800 font-semibold">
                    <tr>
                      <th className="p-2">Row</th>
                      <th className="p-2">Company</th>
                      <th className="p-2">Identifier</th>
                      <th className="p-2">Phone (Raw / E.164)</th>
                      <th className="p-2">Location & Currency</th>
                      <th className="p-2">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {previewRows.map((row) => (
                      <tr key={row.rowIndex} className="hover:bg-slate-800/30">
                        <td className="p-2 font-mono text-slate-400">#{row.rowIndex}</td>
                        <td className="p-2 font-medium text-white">
                          {row.lead?.companyName || '—'}
                          {row.isDuplicate && (
                            <span className="ml-1.5 px-1.5 py-0.2 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded">
                              Duplicate
                            </span>
                          )}
                        </td>
                        <td className="p-2 font-mono text-cyan-400">
                          {row.lead?.registrationNumber
                            ? `${row.lead.registrationType || ''}: ${row.lead.registrationNumber}`
                            : '—'}
                        </td>
                        <td className="p-2 font-mono text-slate-300">
                          <div>{row.lead?.phone || '—'}</div>
                          {row.lead?.phoneNormalized && (
                            <div className="text-[10px] text-emerald-400">{row.lead.phoneNormalized}</div>
                          )}
                        </td>
                        <td className="p-2 text-slate-300">
                          <div>
                            {[row.lead?.address?.city, row.lead?.address?.countryCode].filter(Boolean).join(', ') || '—'}
                          </div>
                          {row.lead?.opportunityValue ? (
                            <div className="text-[10px] font-mono text-slate-400">
                              {formatCurrencyLocale(
                                row.lead.opportunityValue,
                                row.lead.currency,
                                getLocaleForCountry(row.lead.address?.countryCode, row.lead.currency)
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          {!row.valid ? (
                            <span className="text-rose-400">{row.error}</span>
                          ) : row.warnings.length > 0 ? (
                            <span className="text-amber-300" title={row.warnings.join('; ')}>
                              {row.warnings[0]}
                            </span>
                          ) : (
                            <span className="text-emerald-400">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep('mapping')}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded text-xs"
                >
                  Back to Mapping
                </button>
                <button
                  onClick={handleFinishImport}
                  disabled={isImporting || validLeads.length === 0}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded flex items-center gap-1.5 transition"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>{isImporting ? 'Importing into Database...' : `Import ${validLeads.length} Valid Lead(s)`}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: SUMMARY */}
          {step === 'summary' && importSummary && (
            <div className="space-y-4 py-4">
              <div className="text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <h4 className="text-base font-bold text-white">CSV Import Completed</h4>
                <p className="text-slate-400 text-xs">
                  Records have been normalized, deduplicated, and persisted to active storage.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono text-emerald-400">{importSummary.added}</div>
                  <div className="text-[11px] text-slate-400">Added</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono text-blue-400">{importSummary.updated}</div>
                  <div className="text-[11px] text-slate-400">Updated / Merged</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono text-amber-400">{importSummary.skipped}</div>
                  <div className="text-[11px] text-slate-400">Skipped</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono text-rose-400">{importSummary.failed}</div>
                  <div className="text-[11px] text-slate-400">Failed</div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
