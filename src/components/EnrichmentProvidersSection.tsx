import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import {
  EnrichmentProviderCatalogEntry,
  ReverificationSchedulePolicy,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

function statusBadge(status: EnrichmentProviderCatalogEntry['operationalStatus']) {
  switch (status) {
    case 'operational':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
    case 'operational_with_credentials':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300';
    case 'missing_credentials':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
    case 'restricted':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300';
    case 'retired':
    case 'unavailable':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export const EnrichmentProvidersSection: React.FC = () => {
  const [providers, setProviders] = useState<EnrichmentProviderCatalogEntry[]>([]);
  const [policy, setPolicy] = useState<ReverificationSchedulePolicy | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySavedMsg, setPolicySavedMsg] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/enrichment/providers');
      if (res.ok) {
        const data = await res.json();
        setProviders(Array.isArray(data.providers) ? data.providers : []);
        setPolicy(data.schedulePolicy || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleSavePolicy = async () => {
    if (!policy) return;
    setSavingPolicy(true);
    setPolicySavedMsg(null);
    try {
      const res = await apiFetch('/api/enrichment/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      if (res.ok) {
        const data = await res.json();
        setPolicy(data.schedulePolicy);
        setPolicySavedMsg('Re-verification freshness policy saved.');
      }
    } finally {
      setSavingPolicy(false);
    }
  };

  const filteredProviders =
    statusFilter === 'all'
      ? providers
      : providers.filter((p) => p.operationalStatus === statusFilter);

  return (
    <div className="space-y-6 mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
      {/* Transparent Enrichment & Verification Provider Catalog */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              Enrichment &amp; Contact Verification Provider Catalog ({providers.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Honest runtime availability across official registries, built-in DNS/E.164 verifiers, authorized APIs, and retired/restricted methods.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Statuses ({providers.length})</option>
              <option value="operational">Operational</option>
              <option value="operational_with_credentials">Operational (Credentials)</option>
              <option value="missing_credentials">Missing Credentials</option>
              <option value="restricted">Restricted</option>
              <option value="retired">Retired</option>
              <option value="unavailable">Unavailable / Prohibited</option>
            </select>
            <button
              type="button"
              onClick={loadCatalog}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Reliability</th>
                <th className="py-2 px-3">Auth / Cost</th>
                <th className="py-2 pl-3">Honest Scope &amp; Limitations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredProviders.map((prov) => (
                <tr key={prov.providerId} className="align-top">
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold text-slate-900 dark:text-white">{prov.name}</div>
                    <div className="text-[11px] text-slate-500">{prov.category} · {prov.rateLimits}</div>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusBadge(prov.operationalStatus)}`}>
                      {prov.operationalStatus.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300 capitalize">
                    {prov.reliabilityClassification.replace(/_/g, ' ')}
                  </td>
                  <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                    <div>{prov.credentialRequirements}</div>
                    <div className="text-slate-400">{prov.costLimitations}</div>
                  </td>
                  <td className="py-2.5 pl-3 text-[11px] text-slate-600 dark:text-slate-400 max-w-md">
                    {prov.honestLimitationNote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Attribute-Specific Freshness & Re-Verification Policy */}
      {policy && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                Attribute Freshness &amp; Re-Verification Schedule Policy
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure maximum verification age in days before attributes are flagged as stale for owner-approved re-verification.
              </p>
            </div>
            <button
              type="button"
              disabled={savingPolicy}
              onClick={handleSavePolicy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#B30303] hover:bg-[#910303] text-white disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {savingPolicy ? 'Saving...' : 'Save Freshness Policy'}
            </button>
          </div>

          {policySavedMsg && (
            <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {policySavedMsg}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { key: 'emailMaxAgeDays', label: 'Business Email (days)' },
              { key: 'jobTitleMaxAgeDays', label: 'Decision-Maker Role (days)' },
              { key: 'companyStatusMaxAgeDays', label: 'Company Status (days)' },
              { key: 'phoneMaxAgeDays', label: 'Business Phone (days)' },
              { key: 'websiteMaxAgeDays', label: 'Website / Domain (days)' },
              { key: 'legalRegistryMaxAgeDays', label: 'Legal Registry Info (days)' },
              { key: 'maxBatchSize', label: 'Max Bulk Batch (≤ 20)' },
            ].map((field) => (
              <label key={field.key} className="space-y-1 block">
                <span className="text-slate-600 dark:text-slate-400 font-medium">{field.label}</span>
                <input
                  type="number"
                  min={field.key === 'maxBatchSize' ? 1 : 14}
                  max={field.key === 'maxBatchSize' ? 20 : 1095}
                  value={(policy as any)[field.key]}
                  onChange={(e) =>
                    setPolicy((prev) =>
                      prev ? { ...prev, [field.key]: Number(e.target.value) || 0 } : prev
                    )
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-900 dark:text-white font-mono"
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
