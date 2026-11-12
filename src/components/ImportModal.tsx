import React, { useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
} from 'lucide-react';
import { CanonicalLead } from '../types.js';

interface ImportModalProps {
  onClose: () => void;
  onImportComplete: (leads: CanonicalLead[]) => void;
  existingLeads: CanonicalLead[];
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onClose,
  onImportComplete,
  existingLeads,
}) => {
  const [csvText, setCsvText] = useState(
    `Company Name,Registration Number,Website,Email,Phone,City,Country,Industry\n` +
      `Acme Industrial Ltd,CRN-1928374,https://acme-industry.co.uk,info@acme-industry.co.uk,+442079460912,Birmingham,United Kingdom,Manufacturing\n` +
      `Bergen Marine AS,998877665,https://bergen-marine.no,post@bergen-marine.no,+4755123456,Bergen,Norway,Maritime & Shipping\n` +
      `Sydney Health Partners,12345678901,https://sydneyhealth.com.au,contact@sydneyhealth.com.au,+61298765432,Sydney,Australia,Healthcare`
  );

  const [previewLeads, setPreviewLeads] = useState<CanonicalLead[]>([]);
  const [parsed, setParsed] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);

  const parseCsv = () => {
    const lines = csvText
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      alert('CSV must contain a header and at least one data row.');
      return;
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('company'));
    const regIdx = headers.findIndex((h) => h.includes('reg') || h.includes('number') || h.includes('crn') || h.includes('org'));
    const webIdx = headers.findIndex((h) => h.includes('web') || h.includes('url') || h.includes('domain'));
    const emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('mail'));
    const phoneIdx = headers.findIndex((h) => h.includes('phone') || h.includes('tel'));
    const streetIdx = headers.findIndex((h) => h.includes('street') || h.includes('address'));
    const cityIdx = headers.findIndex((h) => h.includes('city') || h.includes('town'));
    const regionIdx = headers.findIndex((h) => h.includes('region') || h.includes('state') || h.includes('province') || h.includes('county'));
    const postalIdx = headers.findIndex((h) => h.includes('postal') || h.includes('postcode') || h.includes('zip'));
    const countryIdx = headers.findIndex((h) => h.includes('country') || h.includes('nation') || h.includes('iso'));
    const indIdx = headers.findIndex((h) => h.includes('industry') || h.includes('sector') || h.includes('category'));
    const vatIdx = headers.findIndex((h) => h.includes('vat') || h.includes('tax'));
    const leiIdx = headers.findIndex((h) => h.includes('lei'));

    const existingDomains = new Set(existingLeads.map((l) => l.domain?.toLowerCase()).filter(Boolean));
    const existingRegs = new Set(existingLeads.map((l) => l.registrationNumber?.replace(/\s+/g, '')).filter(Boolean));

    let dupes = 0;
    const now = new Date().toISOString();

    const result: CanonicalLead[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      const companyName = nameIdx >= 0 ? parts[nameIdx] : parts[0];
      if (!companyName) continue;

      const website = webIdx >= 0 ? parts[webIdx] : undefined;
      let domain: string | undefined;
      if (website) {
        try {
          const u = new URL(website.startsWith('http') ? website : `https://${website}`);
          domain = u.hostname.replace(/^www\./, '');
        } catch {
          domain = undefined;
        }
      }

      const reg = regIdx >= 0 ? parts[regIdx] : undefined;
      const email = emailIdx >= 0 ? parts[emailIdx] : undefined;
      const phone = phoneIdx >= 0 ? parts[phoneIdx] : undefined;
      const street = streetIdx >= 0 ? parts[streetIdx] : undefined;
      const city = cityIdx >= 0 ? parts[cityIdx] : 'Unknown';
      const region = regionIdx >= 0 ? parts[regionIdx] : undefined;
      const postalCode = postalIdx >= 0 ? parts[postalIdx] : undefined;
      const rawCountry = countryIdx >= 0 ? parts[countryIdx] : 'International';
      const industry = indIdx >= 0 ? parts[indIdx] : 'Commercial Services';
      const vatVal = vatIdx >= 0 ? parts[vatIdx] : undefined;
      const leiVal = leiIdx >= 0 ? parts[leiIdx] : undefined;

      // Deduce country code
      let countryCode = 'US';
      const clower = rawCountry.toLowerCase();
      if (rawCountry.length === 2) {
        countryCode = rawCountry.toUpperCase();
      } else if (clower.includes('norway') || clower.includes('norge')) {
        countryCode = 'NO';
      } else if (clower.includes('kingdom') || clower.includes('britain') || clower.includes('england') || clower.includes('scotland')) {
        countryCode = 'GB';
      } else if (clower.includes('australia')) {
        countryCode = 'AU';
      } else if (clower.includes('germany') || clower.includes('deutschland')) {
        countryCode = 'DE';
      } else if (clower.includes('france')) {
        countryCode = 'FR';
      } else if (clower.includes('canada')) {
        countryCode = 'CA';
      } else if (clower.includes('india')) {
        countryCode = 'IN';
      }

      // Check duplicate
      const isDomainDupe = domain && existingDomains.has(domain.toLowerCase());
      const isRegDupe = reg && existingRegs.has(reg.replace(/\s+/g, ''));
      if (isDomainDupe || isRegDupe) {
        dupes++;
      }

      const signals = ['Imported from User CSV / Data File'];
      let conf = 50;
      if (website) {
        conf += 20;
        signals.push('Domain & Website Present in File');
      }
      if (email) {
        conf += 15;
        signals.push('Contact Email Included');
      }
      if (reg) {
        conf += 15;
        signals.push('Registration Identifier Included');
      }

      const identifiers: any[] = [];
      if (domain) {
        identifiers.push({ type: 'DOMAIN', value: domain, verified: false, source: 'csv_import', status: 'user_provided' });
      }
      if (reg) {
        identifiers.push({
          type: countryCode === 'NO' ? 'ORGNR' : countryCode === 'GB' ? 'CRN' : countryCode === 'AU' ? 'ABN' : 'REG',
          value: reg,
          normalizedValue: reg.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
          countryCode,
          source: 'csv_import',
          status: 'user_provided',
          verified: false,
        });
      }
      if (vatVal) {
        identifiers.push({
          type: 'VAT',
          value: vatVal,
          normalizedValue: vatVal.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
          countryCode,
          source: 'csv_import',
          status: 'user_provided',
          verified: false,
        });
      }
      if (leiVal) {
        identifiers.push({
          type: 'LEI',
          value: leiVal,
          normalizedValue: leiVal.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
          countryCode,
          source: 'csv_import',
          status: 'user_provided',
          verified: false,
        });
      }

      result.push({
        id: `import-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
        companyName,
        registrationNumber: reg,
        registrationType: countryCode === 'NO' ? 'ORGNR' : countryCode === 'GB' ? 'CRN' : countryCode === 'AU' ? 'ABN' : 'REG',
        website,
        domain,
        email,
        phone,
        address: {
          street,
          city,
          region,
          postalCode,
          country: rawCountry,
          countryCode,
          formattedAddress: [street, city, region, postalCode, rawCountry].filter(Boolean).join(', '),
        },
        industry,
        category: 'Imported Prospect',
        confidenceScore: conf,
        confidenceSignals: signals,
        sources: [
          {
            sourceName: 'Customer File Import (CSV)',
            retrievedAt: now,
            attribution: 'User supplied data file',
          },
        ],
        identifiers,
        status: 'new',
        pipelineStageId: 'stage-discovered',
        currency: countryCode === 'GB' ? 'GBP' : countryCode === 'NO' ? 'NOK' : countryCode === 'AU' ? 'AUD' : countryCode === 'DE' || countryCode === 'FR' ? 'EUR' : 'USD',
        tags: ['CSV Import', countryCode].filter(Boolean),
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
      });
    }

    setPreviewLeads(result);
    setDuplicateCount(dupes);
    setParsed(true);
  };

  const handleFinishImport = async () => {
    try {
      const token = localStorage.getItem('leed_session_token');
      const csrfMatch = document.cookie.match(/leed_csrf=([^;]+)/);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (csrfMatch) headers['x-leed-csrf-token'] = csrfMatch[1];

      const res = await fetch('/api/leads/batch-import', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ leads: previewLeads }),
      });
      if (res.ok) {
        onImportComplete(previewLeads);
        onClose();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Import Leads from CSV / Spreadsheets</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {!parsed ? (
            <div className="space-y-3">
              <p className="text-slate-300">
                Paste your CSV content below or use our sample template. Header row will be auto-detected:
              </p>
              <textarea
                rows={10}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white font-mono text-xs rounded-lg p-3 focus:outline-none focus:border-indigo-500"
              />
              <div className="flex justify-end">
                <button
                  onClick={parseCsv}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded flex items-center gap-1.5 transition"
                >
                  <span>Preview & Validate Rows</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="space-y-0.5">
                  <span className="font-semibold text-white">
                    Validated {previewLeads.length} Rows Ready for Ingestion
                  </span>
                  <div className="text-[11px] text-slate-400">
                    {duplicateCount > 0 ? (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {duplicateCount} potential duplicate(s) detected against existing database (will be updated or flagged).
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Zero collision against existing database.
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setParsed(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Edit CSV
                </button>
              </div>

              {/* Preview Grid */}
              <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase border-b border-slate-800 font-semibold">
                    <tr>
                      <th className="p-2">Company</th>
                      <th className="p-2">Reg Number</th>
                      <th className="p-2">Website</th>
                      <th className="p-2">Email</th>
                      <th className="p-2">City</th>
                      <th className="p-2">Country</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {previewLeads.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-800/30">
                        <td className="p-2 font-medium text-white">{l.companyName}</td>
                        <td className="p-2 font-mono text-cyan-400">{l.registrationNumber || '—'}</td>
                        <td className="p-2 font-mono text-indigo-400">{l.domain || l.website || '—'}</td>
                        <td className="p-2 font-mono text-slate-300">{l.email || '—'}</td>
                        <td className="p-2 text-slate-300">{l.address?.city || '—'}</td>
                        <td className="p-2 text-slate-300">{l.address?.country || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setParsed(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded text-xs"
                >
                  Back
                </button>
                <button
                  onClick={handleFinishImport}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded flex items-center gap-1.5 transition"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Execute Ingestion into CRM</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
