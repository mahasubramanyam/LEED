import React, { useState, useEffect } from 'react';
import {
  Target,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Play,
  Save,
  Sparkles,
  Building2,
} from 'lucide-react';
import type {
  CanonicalLead,
  IcpMatchResult,
  IcpProfile,
  OwnerSalesGoals,
} from '../../types.ts';
import { AI_DRAFT_TONES } from '../../../shared/aiAgentSpecs.ts';
import { apiFetch } from '../../utils/apiFetch.ts';

interface IcpAndGoalsPanelProps {
  leads: CanonicalLead[];
  icpProfiles: IcpProfile[];
  onRefreshIcps: () => Promise<void>;
  onOpenCompany?: (leadId: string) => void;
}

const splitCsv = (val: string): string[] =>
  val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const IcpAndGoalsPanel: React.FC<IcpAndGoalsPanelProps> = ({
  leads,
  icpProfiles,
  onRefreshIcps,
  onOpenCompany,
}) => {
  const [goals, setGoals] = useState<OwnerSalesGoals>({
    businessName: '',
    valueProposition: '',
    productsAndServices: [],
    targetRegions: [],
    preferredDealSize: '',
    salesPriorities: [],
    communicationStyle: 'consultative',
    updatedAt: '',
  });
  const [productsInput, setProductsInput] = useState('');
  const [regionsInput, setRegionsInput] = useState('');
  const [prioritiesInput, setPrioritiesInput] = useState('');
  const [savingGoals, setSavingGoals] = useState(false);
  const [goalsSavedNotice, setGoalsSavedNotice] = useState<string | null>(null);

  // ICP Editor State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetIndustries, setTargetIndustries] = useState('');
  const [excludedIndustries, setExcludedIndustries] = useState('');
  const [targetCountries, setTargetCountries] = useState('');
  const [targetBusinessTypes, setTargetBusinessTypes] = useState('');
  const [preferredKeywords, setPreferredKeywords] = useState('');
  const [targetRoles, setTargetRoles] = useState('Founder, CEO, Managing Director, Procurement Manager');
  const [minDataQualityScore, setMinDataQualityScore] = useState<string>('50');
  const [requireWebsite, setRequireWebsite] = useState(true);
  const [requireVerifiedContact, setRequireVerifiedContact] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [savingIcp, setSavingIcp] = useState(false);

  // Evaluation State
  const [evaluatingIcpId, setEvaluatingIcpId] = useState<string | null>(null);
  const [evalResults, setEvalResults] = useState<IcpMatchResult[]>([]);
  const [evalIcpName, setEvalIcpName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/ai/goals');
        if (res.ok) {
          const data = await res.json();
          if (data.goals) {
            setGoals(data.goals);
            setProductsInput((data.goals.productsAndServices || []).join(', '));
            setRegionsInput((data.goals.targetRegions || []).join(', '));
            setPrioritiesInput((data.goals.salesPriorities || []).join(', '));
          }
        }
      } catch {
        // non-blocking
      }
    })();
  }, []);

  const handleSaveGoals = async () => {
    setSavingGoals(true);
    setErrorMsg(null);
    setGoalsSavedNotice(null);
    try {
      const res = await apiFetch('/api/ai/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...goals,
          productsAndServices: splitCsv(productsInput),
          targetRegions: splitCsv(regionsInput),
          salesPriorities: splitCsv(prioritiesInput),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save owner sales goals.');
      setGoals(data.goals);
      setGoalsSavedNotice('Owner sales goals saved for AI context.');
      setTimeout(() => setGoalsSavedNotice(null), 3000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGoals(false);
    }
  };

  const resetIcpForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setTargetIndustries('');
    setExcludedIndustries('');
    setTargetCountries('');
    setTargetBusinessTypes('');
    setPreferredKeywords('');
    setTargetRoles('Founder, CEO, Managing Director, Procurement Manager');
    setMinDataQualityScore('50');
    setRequireWebsite(true);
    setRequireVerifiedContact(false);
    setIsDefault(icpProfiles.length === 0);
  };

  const loadIcpForEdit = (icp: IcpProfile) => {
    setEditingId(icp.id);
    setName(icp.name);
    setDescription(icp.description || '');
    setTargetIndustries(icp.targetIndustries.join(', '));
    setExcludedIndustries(icp.excludedIndustries.join(', '));
    setTargetCountries(icp.targetCountries.join(', '));
    setTargetBusinessTypes(icp.targetBusinessTypes.join(', '));
    setPreferredKeywords(icp.preferredKeywords.join(', '));
    setTargetRoles(icp.targetDecisionMakerRoles.join(', '));
    setMinDataQualityScore(icp.minDataQualityScore !== undefined ? String(icp.minDataQualityScore) : '');
    setRequireWebsite(Boolean(icp.requireWebsite));
    setRequireVerifiedContact(Boolean(icp.requireVerifiedContact));
    setIsDefault(icp.isDefault);
  };

  const handleSaveIcp = async () => {
    if (!name.trim()) {
      setErrorMsg('Provide an ICP profile name.');
      return;
    }
    setSavingIcp(true);
    setErrorMsg(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        isDefault,
        targetIndustries: splitCsv(targetIndustries),
        excludedIndustries: splitCsv(excludedIndustries),
        targetCountries: splitCsv(targetCountries).map((c) => c.toUpperCase()),
        targetBusinessTypes: splitCsv(targetBusinessTypes),
        preferredKeywords: splitCsv(preferredKeywords),
        targetDecisionMakerRoles: splitCsv(targetRoles),
        minDataQualityScore: minDataQualityScore ? Number(minDataQualityScore) : undefined,
        requireWebsite,
        requireVerifiedContact,
      };
      const url = editingId ? `/api/ai/icp/${editingId}` : '/api/ai/icp';
      const res = await apiFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save ICP profile.');
      await onRefreshIcps();
      resetIcpForm();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingIcp(false);
    }
  };

  const handleDeleteIcp = async (id: string) => {
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/ai/icp/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to delete ICP.');
      }
      await onRefreshIcps();
      if (editingId === id) resetIcpForm();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEvaluateIcp = async (icp: IcpProfile) => {
    setEvaluatingIcpId(icp.id);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/ai/icp/${icp.id}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ICP evaluation failed.');
      setEvalResults(data.results || []);
      setEvalIcpName(icp.name);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setEvaluatingIcpId(null);
    }
  };

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Owner Sales Context & Offerings */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Owner Business Profile & Sales Goals
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Grounds AI recommendations, company strategy, and draft messaging in your real business offering.
            </p>
          </div>
          <button
            onClick={handleSaveGoals}
            disabled={savingGoals}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            {savingGoals ? 'Saving...' : 'Save Goals'}
          </button>
        </div>

        {goalsSavedNotice && (
          <div className="mt-3 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {goalsSavedNotice}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Your Business / Brand Name
            </label>
            <input
              type="text"
              value={goals.businessName || ''}
              onChange={(e) => setGoals({ ...goals, businessName: e.target.value })}
              placeholder="e.g., Meridian Industrial Advisory"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Default Communication Style
            </label>
            <select
              value={goals.communicationStyle || 'consultative'}
              onChange={(e) => setGoals({ ...goals, communicationStyle: e.target.value as any })}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            >
              {AI_DRAFT_TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Core Value Proposition
            </label>
            <textarea
              rows={2}
              value={goals.valueProposition || ''}
              onChange={(e) => setGoals({ ...goals, valueProposition: e.target.value })}
              placeholder="Concise summary of the concrete problem you solve for B2B buyers..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Products & Services (comma-separated)
            </label>
            <input
              type="text"
              value={productsInput}
              onChange={(e) => setProductsInput(e.target.value)}
              placeholder="Compliance audits, workflow software, supply chain advisory"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Target Markets / Regions (comma-separated)
            </label>
            <input
              type="text"
              value={regionsInput}
              onChange={(e) => setRegionsInput(e.target.value)}
              placeholder="UK, Nordics, DACH, North America"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Current Sales Priorities (comma-separated)
            </label>
            <input
              type="text"
              value={prioritiesInput}
              onChange={(e) => setPrioritiesInput(e.target.value)}
              placeholder="Expand mid-market logistics clients, close Q2 renewals, book technical discovery calls"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>
        </div>
      </section>

      {/* ICP Profiles List + Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-600" />
              {editingId ? 'Edit ICP Profile' : 'Create Ideal Customer Profile'}
            </h3>
            {editingId && (
              <button onClick={resetIcpForm} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
                Cancel Edit
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Profile Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., European Industrial SaaS Buyers"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Target Industries (comma-separated)</label>
              <input
                type="text"
                value={targetIndustries}
                onChange={(e) => setTargetIndustries(e.target.value)}
                placeholder="Manufacturing, Logistics, Engineering, Software"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Excluded Industries</label>
              <input
                type="text"
                value={excludedIndustries}
                onChange={(e) => setExcludedIndustries(e.target.value)}
                placeholder="Gambling, Hospitality, Retail"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Target Countries (ISO/Name)</label>
                <input
                  type="text"
                  value={targetCountries}
                  onChange={(e) => setTargetCountries(e.target.value)}
                  placeholder="GB, NO, DE, US"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Min Data Quality (0–100)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={minDataQualityScore}
                  onChange={(e) => setMinDataQualityScore(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Preferred Keywords / Signals</label>
              <input
                type="text"
                value={preferredKeywords}
                onChange={(e) => setPreferredKeywords(e.target.value)}
                placeholder="B2B, automation, supply chain, cloud, enterprise"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Target Decision-Maker Roles</label>
              <input
                type="text"
                value={targetRoles}
                onChange={(e) => setTargetRoles(e.target.value)}
                placeholder="Founder, CEO, Director, Head of Procurement"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="flex flex-wrap gap-4 pt-1 text-xs text-slate-700 dark:text-slate-300">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={requireWebsite} onChange={(e) => setRequireWebsite(e.target.checked)} />
                Require Website
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireVerifiedContact}
                  onChange={(e) => setRequireVerifiedContact(e.target.checked)}
                />
                Require Verified Contact
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                Default ICP
              </label>
            </div>
            <button
              onClick={handleSaveIcp}
              disabled={savingIcp}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {savingIcp ? 'Saving...' : editingId ? 'Update ICP Profile' : 'Save ICP Profile'}
            </button>
          </div>
        </div>

        {/* Saved ICP Profiles & Live Evaluation */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Configured ICP Profiles ({icpProfiles.length})
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">{leads.length} CRM companies ready</span>
            </div>

            {icpProfiles.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No Ideal Customer Profiles created yet. Define your first ICP on the left to score CRM accounts and discovered businesses.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 mt-2">
                {icpProfiles.map((icp) => (
                  <div key={icp.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white">{icp.name}</span>
                        {icp.isDefault && (
                          <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">Default</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {[
                          icp.targetIndustries.length ? `Industries: ${icp.targetIndustries.slice(0, 3).join(', ')}` : null,
                          icp.targetCountries.length ? `Countries: ${icp.targetCountries.slice(0, 4).join(', ')}` : null,
                          icp.minDataQualityScore ? `Min DQ: ${icp.minDataQualityScore}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'General criteria'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleEvaluateIcp(icp)}
                        disabled={evaluatingIcpId === icp.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
                      >
                        <Play className="w-3 h-3" />
                        {evaluatingIcpId === icp.id ? 'Scoring...' : 'Evaluate CRM'}
                      </button>
                      <button
                        onClick={() => loadIcpForEdit(icp)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteIcp(icp.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600"
                        title="Delete ICP"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ICP Evaluation Results Table */}
          {evalResults.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    ICP Evaluation Results — {evalIcpName}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Derived analytical scores based strictly on recorded LEED attributes (missing data is disclosed, never guessed).
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 mt-2 max-h-96 overflow-y-auto">
                {evalResults.map((res) => (
                  <div key={`${res.icpId}-${res.leadId || res.companyName}`} className="py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => res.leadId && onOpenCompany?.(res.leadId)}
                        className="text-xs font-semibold text-slate-900 dark:text-white hover:text-blue-600 inline-flex items-center gap-1.5 text-left"
                      >
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        {res.companyName}
                      </button>
                      <div className="flex items-center gap-3 text-xs tabular-nums">
                        <span
                          className={
                            res.fitLabel === 'strong_fit' || res.fitLabel === 'good_fit'
                              ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                              : res.fitLabel === 'excluded' || res.fitLabel === 'poor_fit'
                                ? 'font-semibold text-red-600 dark:text-red-400'
                                : 'font-semibold text-amber-600 dark:text-amber-400'
                          }
                        >
                          {res.overallScore}/100 · {res.fitLabel.replace('_', ' ')}
                        </span>
                        <span className="text-slate-500">Conf {res.confidenceScore}%</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400">
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">Matched:</span>{' '}
                      {res.matchingCriteria.length
                        ? res.matchingCriteria.map((c) => `${c.criterion} (${c.pointsAwarded}/${c.maxPoints})`).join(' · ')
                        : 'None'}
                    </div>
                    {res.missingInformation.length > 0 && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400">
                        <span className="font-medium">Missing info:</span> {res.missingInformation.join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
