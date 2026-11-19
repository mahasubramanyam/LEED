import React, { useState } from 'react';
import {
  ShieldBan,
  ShieldCheck,
  Server,
  KeyRound,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { OUTREACH_SUPPRESSION_TYPES } from '../../../shared/outreachSpecs.ts';
import type {
  CanonicalLead,
  OutreachCampaignV2,
  OutreachComplianceConfig,
  OutreachProviderSettings,
  OutreachProviderStatus,
  OutreachSuppressionEntry,
  OutreachSuppressionScopeV2,
  OutreachSuppressionTypeV2,
} from '../../types.ts';
import { apiFetch } from '../../utils/apiFetch.ts';

interface SuppressionAndProvidersPanelProps {
  mode: 'suppression' | 'providers';
  suppressions: OutreachSuppressionEntry[];
  complianceConfig: OutreachComplianceConfig;
  providerSettings: OutreachProviderSettings;
  providers: OutreachProviderStatus[];
  campaigns: OutreachCampaignV2[];
  leads: CanonicalLead[];
  onRefresh: () => Promise<void>;
  onStatusNotice?: (notice: { type: 'success' | 'error'; text: string }) => void;
}

export const SuppressionAndProvidersPanel: React.FC<SuppressionAndProvidersPanelProps> = ({
  mode,
  suppressions,
  complianceConfig,
  providerSettings,
  providers,
  campaigns,
  leads,
  onRefresh,
  onStatusNotice,
}) => {
  // Suppression add form
  const [suppScope, setSuppScope] = useState<OutreachSuppressionScopeV2>('global');
  const [suppCampaignId, setSuppCampaignId] = useState('');
  const [suppType, setSuppType] = useState<OutreachSuppressionTypeV2>('do_not_contact');
  const [suppEmail, setSuppEmail] = useState('');
  const [suppDomain, setSuppDomain] = useState('');
  const [suppLeadId, setSuppLeadId] = useState('');
  const [suppReason, setSuppReason] = useState('');

  // Compliance form
  const [compForm, setCompForm] = useState<OutreachComplianceConfig>(complianceConfig);

  // Provider settings form
  const [provSettingsForm, setProvSettingsForm] = useState<OutreachProviderSettings>(providerSettings);
  const [credInputs, setCredInputs] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const handleAddSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch('/api/outreach/suppressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: suppScope,
          campaignId: suppScope === 'campaign' ? suppCampaignId : undefined,
          type: suppType,
          email: suppEmail || undefined,
          domain: suppDomain || undefined,
          leadId: suppLeadId || undefined,
          reason: suppReason || 'Owner-requested suppression',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add suppression.');
      setSuppEmail('');
      setSuppDomain('');
      setSuppLeadId('');
      setSuppReason('');
      onStatusNotice?.({
        type: 'success',
        text: 'Suppression entry added and enforced across active enrollments and follow-ups.',
      });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add suppression.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivateSuppression = async (id: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/outreach/suppressions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to deactivate suppression.');
      onStatusNotice?.({ type: 'success', text: 'Suppression entry deactivated.' });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Failed to deactivate.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCompliance = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch('/api/outreach/compliance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save compliance config.');
      onStatusNotice?.({ type: 'success', text: 'Compliance settings & frequency guardrails saved.' });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProviderSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch('/api/outreach/providers/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provSettingsForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save provider settings.');
      onStatusNotice?.({ type: 'success', text: 'Sender configuration & provider settings saved.' });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleStoreCredential = async (providerId: string) => {
    const creds = credInputs[providerId] || {};
    setBusy(true);
    try {
      const res = await apiFetch(`/api/outreach/providers/${providerId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: creds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save encrypted credentials.');
      setCredInputs((prev) => ({ ...prev, [providerId]: {} }));
      onStatusNotice?.({
        type: 'success',
        text: 'Credentials encrypted (AES-256-GCM) and stored in server vault.',
      });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Credential storage failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveCredential = async (providerId: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/outreach/providers/${providerId}/credentials`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove credentials.');
      onStatusNotice?.({ type: 'success', text: 'Stored provider credentials removed.' });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Remove failed.' });
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'suppression') {
    const activeSupps = suppressions.filter((s) => s.active);
    return (
      <div className="space-y-5">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
          <div>
            <strong className="font-semibold">B2B Outreach Compliance Notice:</strong> Publicly available business contact details do not equal blanket consent for unsolicited bulk marketing. LEED enforces global & campaign suppressions, frequency caps, sender transparency footers, and explicit owner approval before every dispatch.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Add Suppression */}
          <form
            onSubmit={handleAddSuppression}
            className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-4 space-y-3 h-fit"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
              <ShieldBan className="h-4 w-4 text-rose-600" />
              <h3 className="text-sm font-semibold text-slate-900">Add Suppression / Opt-Out Rule</h3>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Scope</label>
                <select
                  value={suppScope}
                  onChange={(e) => setSuppScope(e.target.value as OutreachSuppressionScopeV2)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="global">Global (All Campaigns)</option>
                  <option value="campaign">Specific Campaign</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Suppression Type</label>
                <select
                  value={suppType}
                  onChange={(e) => setSuppType(e.target.value as OutreachSuppressionTypeV2)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  {OUTREACH_SUPPRESSION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {suppScope === 'campaign' && (
              <div>
                <label className="block text-xs font-medium text-slate-700">Target Campaign</label>
                <select
                  value={suppCampaignId}
                  onChange={(e) => setSuppCampaignId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">Select campaign...</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700">Email Address (optional)</label>
              <input
                type="email"
                value={suppEmail}
                onChange={(e) => setSuppEmail(e.target.value)}
                placeholder="contact@company.com"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Domain (optional)</label>
                <input
                  type="text"
                  value={suppDomain}
                  onChange={(e) => setSuppDomain(e.target.value)}
                  placeholder="company.com"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Company (optional)</label>
                <select
                  value={suppLeadId}
                  onChange={(e) => setSuppLeadId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">None</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.companyName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Reason</label>
              <input
                type="text"
                required
                value={suppReason}
                onChange={(e) => setSuppReason(e.target.value)}
                placeholder="e.g., Recipient opted out via email"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy || (!suppEmail && !suppDomain && !suppLeadId)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add Active Suppression
            </button>
          </form>

          {/* Right: Active Suppressions Table */}
          <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Active Suppression List ({activeSupps.length})
            </h3>
            {activeSupps.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No active suppressions recorded.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeSupps.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {s.email || s.domain || s.companyName || s.personName}
                        </span>
                        <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
                          {s.type.replace(/_/g, ' ')}
                        </span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                          {s.scope}
                        </span>
                      </div>
                      <p className="mt-0.5 text-slate-600">{s.reason}</p>
                      <p className="text-[11px] text-slate-400">
                        Added by {s.createdBy} on {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeactivateSuppression(s.id)}
                      disabled={busy}
                      className="shrink-0 rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-rose-600"
                      title="Deactivate suppression"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Compliance Configuration Card */}
        <form
          onSubmit={handleSaveCompliance}
          className="rounded-lg border border-slate-200 bg-white p-4 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">Sender Identification, Footers & Contact Frequency Limits</h3>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Sender Display Name</label>
              <input
                type="text"
                value={compForm.senderDisplayName}
                onChange={(e) => setCompForm({ ...compForm, senderDisplayName: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Organization Name</label>
              <input
                type="text"
                value={compForm.senderOrganization}
                onChange={(e) => setCompForm({ ...compForm, senderOrganization: e.target.value })}
                placeholder="Your registered company name"
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Physical Business Address</label>
              <input
                type="text"
                value={compForm.senderPhysicalAddress}
                onChange={(e) => setCompForm({ ...compForm, senderPhysicalAddress: e.target.value })}
                placeholder="City, Country (recommended for CAN-SPAM / GDPR)"
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Unsubscribe Notice Footer</label>
              <textarea
                rows={2}
                value={compForm.unsubscribeNoticeText}
                onChange={(e) => setCompForm({ ...compForm, unsubscribeNoticeText: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Legal Basis / Outreach Policy Note</label>
              <textarea
                rows={2}
                value={compForm.legalBasisDefault}
                onChange={(e) => setCompForm({ ...compForm, legalBasisDefault: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Max / Company / 7 Days</label>
              <input
                type="number"
                min={1}
                max={20}
                value={compForm.maxContactsPerCompanyPerWeek}
                onChange={(e) => setCompForm({ ...compForm, maxContactsPerCompanyPerWeek: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Max / Person / 14 Days</label>
              <input
                type="number"
                min={1}
                max={10}
                value={compForm.maxContactsPerPersonPer14Days}
                onChange={(e) => setCompForm({ ...compForm, maxContactsPerPersonPer14Days: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Send Window Start (Hour)</label>
              <input
                type="number"
                min={6}
                max={20}
                value={compForm.sendWindowStartHour}
                onChange={(e) => setCompForm({ ...compForm, sendWindowStartHour: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs tabular-nums"
              />
            </div>
            <div className="flex flex-col justify-end gap-1.5 text-xs">
              <label className="inline-flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={compForm.businessDaysOnlyDefault}
                  onChange={(e) => setCompForm({ ...compForm, businessDaysOnlyDefault: e.target.checked })}
                />
                Skip weekends by default
              </label>
              <label className="inline-flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={compForm.includeUnsubscribeFooter}
                  onChange={(e) => setCompForm({ ...compForm, includeUnsubscribeFooter: e.target.checked })}
                />
                Auto-append unsubscribe notice
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Save Compliance Settings
            </button>
          </div>
        </form>
      </div>
    );
  }

  // PROVIDERS & HEALTH MODE
  return (
    <div className="space-y-5">
      {/* Sender Settings */}
      <form
        onSubmit={handleSaveProviderSettings}
        className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">Verified Sender Identity & Retry Controls</h3>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Lock className="h-3 w-3" /> Server-side AES-256-GCM vault or environment variables only
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Verified From Email</label>
            <input
              type="email"
              value={provSettingsForm.fromEmail}
              onChange={(e) => setProvSettingsForm({ ...provSettingsForm, fromEmail: e.target.value })}
              placeholder="owner@yourdomain.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Sender From Name</label>
            <input
              type="text"
              value={provSettingsForm.fromName}
              onChange={(e) => setProvSettingsForm({ ...provSettingsForm, fromName: e.target.value })}
              placeholder="Your Name"
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Reply-To Email (optional)</label>
            <input
              type="email"
              value={provSettingsForm.replyToEmail || ''}
              onChange={(e) => setProvSettingsForm({ ...provSettingsForm, replyToEmail: e.target.value })}
              placeholder="replies@yourdomain.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Default Email Provider</label>
            <select
              value={provSettingsForm.defaultEmailProviderId || ''}
              onChange={(e) => setProvSettingsForm({ ...provSettingsForm, defaultEmailProviderId: e.target.value || undefined })}
              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <option value="">Auto-select first configured</option>
              {providers
                .filter((p) => p.automatedSendingSupported)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Save Sender & Provider Settings
          </button>
        </div>
      </form>

      {/* Provider Catalog Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {providers.map((p) => {
          const formVals = credInputs[p.id] || {};
          const healthTone =
            p.healthState === 'operational'
              ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
              : p.healthState === 'policy_manual_only'
              ? 'text-slate-700 bg-slate-100 border-slate-200'
              : p.healthState === 'degraded' || p.healthState === 'rate_limited'
              ? 'text-amber-800 bg-amber-50 border-amber-200'
              : 'text-slate-600 bg-slate-50 border-slate-200';

          return (
            <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{p.name}</h4>
                  <p className="text-[11px] text-slate-500">
                    Channel: {p.channel.toUpperCase()} · Automated Sending:{' '}
                    {p.automatedSendingSupported ? 'Supported' : 'Disabled by Policy'} · Inbound Sync: Manual Only
                  </p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${healthTone}`}>
                  {p.healthState.replace(/_/g, ' ')}
                </span>
              </div>

              <p className="text-xs text-slate-600">{p.honestDisclosure}</p>

              {p.automatedSendingSupported && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 tabular-nums">
                  <span>
                    Credentials:{' '}
                    <strong className="text-slate-800">
                      {p.configured ? `${p.credentialSource} (${p.maskedHint || 'configured'})` : 'Not configured'}
                    </strong>
                  </span>
                  <span>
                    Hourly Usage: {p.sentInCurrentHour} / {p.rateLimitPerHour}
                  </span>
                </div>
              )}

              {p.lastError && (
                <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
                  Last error: {p.lastError}
                </p>
              )}

              {p.automatedSendingSupported && p.requiredCredentialFields.length > 0 && (
                <div className="space-y-2 border-t border-slate-100 pt-2.5">
                  {p.requiredCredentialFields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-[11px] font-medium text-slate-700">{field.label}</label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={formVals[field.key] || ''}
                        onChange={(e) =>
                          setCredInputs((prev) => ({
                            ...prev,
                            [p.id]: { ...(prev[p.id] || {}), [field.key]: e.target.value },
                          }))
                        }
                        placeholder={field.placeholder || `Enter ${field.label}`}
                        className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleStoreCredential(p.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Save Encrypted Key
                    </button>
                    {p.configured && p.credentialSource === 'database_encrypted' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCredential(p.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove Vault Key
                      </button>
                    )}
                    {p.configured && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
