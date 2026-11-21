import React, { useState, useEffect, useCallback } from 'react';
import {
  Kanban,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  X,
  CheckCircle2,
  Briefcase,
  Plus,
  History,
  Trash2,
} from 'lucide-react';
import { CanonicalLead, PipelineStage, CrmOpportunity, PersonRecord } from '../types.ts';
import {
  summarizeValuesByCurrency,
  formatCurrencyLocale,
  getLocaleForCountry,
} from '../../shared/localization.ts';
import { CRM_OPPORTUNITY_STATUSES } from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { SegmentedTabs, SurfaceCard, WorkspaceToolbar } from './ui/SunsetUI.tsx';

interface PipelineBoardProps {
  stages: PipelineStage[];
  leads: CanonicalLead[];
  onSelectLead: (lead: CanonicalLead) => void;
  onMoveLeadStage: (leadId: string, stageId: string, lostReason?: string) => void;
  onInitializeStages?: () => Promise<void>;
  isInitializingStages?: boolean;
  initStageError?: string | null;
}

export const PipelineBoard: React.FC<PipelineBoardProps> = ({
  stages,
  leads,
  onSelectLead,
  onMoveLeadStage,
  onInitializeStages,
  isInitializingStages = false,
  initStageError = null,
}) => {
  const [boardMode, setBoardMode] = useState<'companies' | 'opportunities'>('companies');
  const [lostModalLeadId, setLostModalLeadId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('No Response after Follow-ups');

  const [opportunities, setOpportunities] = useState<CrmOpportunity[]>([]);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [isCreatingOpp, setIsCreatingOpp] = useState(false);
  const [oppLeadId, setOppLeadId] = useState(leads[0]?.id || '');
  const [oppPersonId, setOppPersonId] = useState('');
  const [oppTitle, setOppTitle] = useState('');
  const [oppValue, setOppValue] = useState('');
  const [oppCurrency, setOppCurrency] = useState('USD');
  const [oppStageId, setOppStageId] = useState(stages[0]?.id || 'stage-new');
  const [oppProb, setOppProb] = useState('35');
  const [oppCloseDate, setOppCloseDate] = useState('');
  const [oppNextAction, setOppNextAction] = useState('');
  const [historyOpp, setHistoryOpp] = useState<CrmOpportunity | null>(null);

  const loadOpportunities = useCallback(async () => {
    try {
      const [oRes, pRes] = await Promise.all([
        apiFetch('/api/crm/opportunities'),
        apiFetch('/api/persons'),
      ]);
      if (oRes.ok) {
        const od = await oRes.json();
        setOpportunities(Array.isArray(od.opportunities) ? od.opportunities : []);
      }
      if (pRes.ok) {
        const pd = await pRes.json();
        setPersons(Array.isArray(pd.persons) ? pd.persons : []);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    loadOpportunities();
  }, [loadOpportunities, leads.length]);

  useEffect(() => {
    if (!oppLeadId && leads[0]?.id) setOppLeadId(leads[0].id);
    if (!oppStageId && stages[0]?.id) setOppStageId(stages[0].id);
  }, [leads, stages, oppLeadId, oppStageId]);

  const handleMove = (leadId: string, targetStageId: string) => {
    if (targetStageId === 'stage-lost') {
      setLostModalLeadId(leadId);
    } else {
      onMoveLeadStage(leadId, targetStageId);
    }
  };

  const confirmLostReason = () => {
    if (lostModalLeadId) {
      onMoveLeadStage(lostModalLeadId, 'stage-lost', lostReason);
      setLostModalLeadId(null);
    }
  };

  const handleCreateOpp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oppLeadId || !oppTitle.trim()) return;
    const res = await apiFetch('/api/crm/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: oppLeadId,
        personId: oppPersonId || undefined,
        title: oppTitle.trim(),
        estimatedValue: Number(oppValue) || 0,
        currency: oppCurrency || 'USD',
        pipelineStageId: oppStageId || stages[0]?.id,
        probability: Number(oppProb) || 35,
        expectedCloseDate: oppCloseDate ? `${oppCloseDate}T12:00:00.000Z` : undefined,
        nextAction: oppNextAction.trim() || undefined,
      }),
    });
    if (res.ok) {
      setOppTitle('');
      setOppValue('');
      setOppNextAction('');
      setOppCloseDate('');
      setIsCreatingOpp(false);
      await loadOpportunities();
    }
  };

  const handleMoveOppStage = async (oppId: string, targetStageId: string) => {
    const res = await apiFetch(`/api/crm/opportunities/${oppId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineStageId: targetStageId }),
    });
    if (res.ok) await loadOpportunities();
  };

  const handleUpdateOppStatus = async (oppId: string, status: CrmOpportunity['status']) => {
    const res = await apiFetch(`/api/crm/opportunities/${oppId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await loadOpportunities();
  };

  const handleDeleteOpp = async (oppId: string) => {
    const res = await apiFetch(`/api/crm/opportunities/${oppId}`, { method: 'DELETE' });
    if (res.ok) await loadOpportunities();
  };

  const boardSummary = summarizeValuesByCurrency(leads, 'USD');

  const inputClass =
    'w-full bg-slate-50 dark:bg-[#101719] border border-slate-300 dark:border-[#3E5256] rounded-lg px-3 py-1.5 text-sm font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:outline-none focus:border-[#C49A52]';

  return (
    <div className="space-y-5">
      {/* Unified Light/Dark Toolbar */}
      <WorkspaceToolbar
        actions={
          <>
            <span className="text-xs font-medium text-slate-600 dark:text-[#B8C7C4]">
              Total{' '}
              <strong className="font-bold font-mono tabular-nums text-[#25464F] dark:text-[#DFB76D]">
                {boardSummary.primaryFormatted}
              </strong>
            </span>
            {boardMode === 'opportunities' && leads.length > 0 && (
              <button
                type="button"
                onClick={() => setIsCreatingOpp((v) => !v)}
                className="px-3.5 py-1.5 bg-[#335C67] hover:bg-[#3D6C79] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Opportunity</span>
              </button>
            )}
          </>
        }
      >
        <SegmentedTabs
          variant="segmented"
          activeId={boardMode}
          onChange={setBoardMode}
          items={[
            { id: 'companies', label: 'Companies', count: leads.length, icon: <Kanban className="w-3.5 h-3.5" /> },
            { id: 'opportunities', label: 'Opportunities', count: opportunities.length, icon: <Briefcase className="w-3.5 h-3.5" /> },
          ]}
        />
      </WorkspaceToolbar>

      {/* Create Opportunity Form */}
      {boardMode === 'opportunities' && isCreatingOpp && (
        <SurfaceCard>
          <form onSubmit={handleCreateOpp} className="space-y-4">
            <h3 className="text-base font-bold text-slate-950 dark:text-[#F2F6F5]">
              New Opportunity
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Company *
                </label>
                <select
                  value={oppLeadId}
                  onChange={(e) => setOppLeadId(e.target.value)}
                  required
                  className={inputClass}
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={oppTitle}
                  onChange={(e) => setOppTitle(e.target.value)}
                  placeholder="Regional Distribution Contract"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Value &amp; Currency
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min="0"
                    value={oppValue}
                    onChange={(e) => setOppValue(e.target.value)}
                    placeholder="45000"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    maxLength={3}
                    value={oppCurrency}
                    onChange={(e) => setOppCurrency(e.target.value.toUpperCase())}
                    className="w-16 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white font-mono text-center"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Stage
                </label>
                <select
                  value={oppStageId}
                  onChange={(e) => setOppStageId(e.target.value)}
                  className={inputClass}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Contact
                </label>
                <select
                  value={oppPersonId}
                  onChange={(e) => setOppPersonId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Company-wide</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Probability %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={oppProb}
                  onChange={(e) => setOppProb(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Expected Close
                </label>
                <input
                  type="date"
                  value={oppCloseDate}
                  onChange={(e) => setOppCloseDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Next Action
                </label>
                <input
                  type="text"
                  value={oppNextAction}
                  onChange={(e) => setOppNextAction(e.target.value)}
                  placeholder="Send draft agreement"
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreatingOpp(false)}
                className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-[#335C67] hover:bg-[#3D6C79] text-white text-xs font-bold rounded-lg"
              >
                Save Opportunity
              </button>
            </div>
          </form>
        </SurfaceCard>
      )}

      {/* Empty Stage State */}
      {stages.length === 0 ? (
        <SurfaceCard padding="lg" className="text-center space-y-3">
          <h3 className="text-lg font-bold text-slate-950 dark:text-[#F2F6F5]">
            No Pipeline Stages Configured
          </h3>
          <p className="text-xs font-medium text-slate-600 dark:text-[#B8C7C4] max-w-md mx-auto">
            Initialize the default stages or save your first company to create them automatically.
          </p>
          {initStageError && (
            <div className="text-xs font-medium text-[#8F3438] dark:text-[#F0C9CB] bg-[#F9EFEF] dark:bg-[#280D0F]/90 border border-[#8F3438]/70 rounded-lg px-3 py-2 max-w-md mx-auto">
              {initStageError}
            </div>
          )}
          {onInitializeStages && (
            <button
              type="button"
              onClick={onInitializeStages}
              disabled={isInitializingStages}
              className="px-4 py-2 bg-[#335C67] hover:bg-[#3D6C79] disabled:opacity-60 text-white text-xs font-bold rounded-lg inline-flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isInitializingStages ? 'Initializing...' : 'Initialize Default Pipeline Stages'}
            </button>
          )}
        </SurfaceCard>
      ) : boardMode === 'companies' ? (
        <div className="flex gap-3.5 overflow-x-auto pb-4 scrollbar-thin">
          {stages.map((stage, idx) => {
            const stageLeads = leads.filter((l) => l.pipelineStageId === stage.id);
            const stageSummary = summarizeValuesByCurrency(stageLeads, 'USD');
            const stageHasValue = stageLeads.some((l) => (l.opportunityValue || 0) > 0);
            const prevStage = idx > 0 ? stages[idx - 1] : null;
            const nextStage = idx < stages.length - 1 ? stages[idx + 1] : null;

            return (
              <div
                key={stage.id}
                className="shrink-0 w-76 bg-slate-100/80 dark:bg-[#192629] border border-slate-200 dark:border-[#3A4D50] rounded-xl flex flex-col max-h-[740px]"
              >
                <div className="px-3.5 py-3 border-b border-slate-200 dark:border-[#3A4D50] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-bold text-slate-950 dark:text-[#F2F6F5] truncate">
                      {stage.name}
                    </h3>
                    <span className="text-xs font-bold text-slate-600 dark:text-[#B8C7C4] font-mono tabular-nums">
                      {stageLeads.length}
                    </span>
                  </div>
                  <div className="text-xs font-bold font-mono tabular-nums text-[#25464F] dark:text-[#DFB76D] truncate">
                    {stageHasValue ? stageSummary.primaryFormatted : '—'}
                  </div>
                </div>

                <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1 scrollbar-thin">
                  {stageLeads.length === 0 ? (
                    <div className="p-5 text-center text-slate-500 dark:text-[#B8C7C4] text-xs font-medium border border-dashed border-slate-300 dark:border-[#3E5256] rounded-lg">
                      Empty stage
                    </div>
                  ) : (
                    stageLeads.map((lead) => {
                      const companyOppsCount = opportunities.filter(
                        (o) => o.leadId === lead.id && o.status === 'open'
                      ).length;
                      return (
                        <div
                          key={lead.id}
                          onClick={() => onSelectLead(lead)}
                          className="bg-white dark:bg-[#101719] border border-slate-200 dark:border-[#3A4D50] hover:border-[#C49A52] dark:hover:bg-[#243638] p-3.5 rounded-lg cursor-pointer group transition-colors space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-slate-950 dark:text-[#F2F6F5] group-hover:text-[#25464F] dark:group-hover:text-[#DFB76D] transition-colors truncate">
                                {lead.companyName}
                              </h4>
                              <p className="text-xs font-medium text-slate-600 dark:text-[#B8C7C4] truncate mt-0.5">
                                {[lead.address?.city || lead.address?.country, lead.industry]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                            <span className="text-xs font-bold font-mono tabular-nums text-[#25464F] dark:text-[#86BCC9] shrink-0">
                              {lead.confidenceScore}%
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/80 dark:border-[#3A4D50]">
                            <span className="font-bold font-mono tabular-nums text-slate-950 dark:text-[#F2F6F5]">
                              {formatCurrencyLocale(
                                lead.opportunityValue || 0,
                                lead.currency || 'USD',
                                getLocaleForCountry(lead.address?.countryCode, lead.currency)
                              )}
                            </span>
                            <span className="text-slate-500 dark:text-[#A1ADAA] tabular-nums">
                              {companyOppsCount > 0
                                ? `${companyOppsCount} deal${companyOppsCount > 1 ? 's' : ''}`
                                : lead.winProbability !== undefined
                                ? `${lead.winProbability}%`
                                : ''}
                            </span>
                          </div>

                          <div
                            className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-[#344447]/70"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {prevStage ? (
                              <button
                                type="button"
                                onClick={() => handleMove(lead.id, prevStage.id)}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#335C67]/40 text-slate-500 dark:text-[#A1ADAA] hover:text-[#335C67] dark:hover:text-[#C49A52] transition-colors"
                                title={`Move to ${prevStage.name}`}
                                aria-label={`Move to ${prevStage.name}`}
                              >
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                            ) : (
                              <div className="w-6" />
                            )}
                            <span className="text-[11px] text-slate-400 dark:text-[#A1ADAA]">Move</span>
                            {nextStage ? (
                              <button
                                type="button"
                                onClick={() => handleMove(lead.id, nextStage.id)}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-[#335C67]/40 text-slate-500 dark:text-[#A1ADAA] hover:text-[#335C67] dark:hover:text-[#C49A52] transition-colors"
                                title={`Advance to ${nextStage.name}`}
                                aria-label={`Advance to ${nextStage.name}`}
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            ) : (
                              <div className="w-6" />
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-3.5 overflow-x-auto pb-4 scrollbar-thin">
          {stages.map((stage, idx) => {
            const stageOpps = opportunities.filter((o) => o.pipelineStageId === stage.id);
            const prevStage = idx > 0 ? stages[idx - 1] : null;
            const nextStage = idx < stages.length - 1 ? stages[idx + 1] : null;
            const totalStageVal = stageOpps.reduce((s, o) => s + (o.estimatedValue || 0), 0);

            return (
              <div
                key={stage.id}
                className="shrink-0 w-76 bg-slate-100/70 dark:bg-[#192629] border border-slate-200 dark:border-[#344447] rounded-xl flex flex-col max-h-[740px]"
              >
                <div className="px-3.5 py-3 border-b border-slate-200 dark:border-[#3A4D50] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-bold text-slate-950 dark:text-[#F2F6F5] truncate">
                      {stage.name}
                    </h3>
                    <span className="text-xs font-bold text-slate-600 dark:text-[#B8C7C4] font-mono tabular-nums">
                      {stageOpps.length}
                    </span>
                  </div>
                  <div className="text-xs font-bold font-mono tabular-nums text-[#25464F] dark:text-[#DFB76D]">
                    {totalStageVal > 0 ? totalStageVal.toLocaleString() : '—'}
                  </div>
                </div>

                <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1 scrollbar-thin">
                  {stageOpps.length === 0 ? (
                    <div className="p-5 text-center text-slate-500 dark:text-[#B8C7C4] text-xs font-medium border border-dashed border-slate-300 dark:border-[#3E5256] rounded-lg">
                      No opportunities
                    </div>
                  ) : (
                    stageOpps.map((opp) => {
                      const company = leads.find((l) => l.id === opp.leadId);
                      const person = persons.find((p) => p.id === opp.personId);
                      return (
                        <div
                          key={opp.id}
                          className="bg-white dark:bg-[#101719] border border-slate-200 dark:border-[#3A4D50] hover:border-[#C49A52] dark:hover:bg-[#243638] p-3.5 rounded-lg space-y-2 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-950 dark:text-[#F2F6F5] truncate">
                                {opp.title}
                              </div>
                              {company && (
                                <button
                                  type="button"
                                  onClick={() => onSelectLead(company)}
                                  className="text-xs font-semibold text-[#25464F] dark:text-[#86BCC9] hover:underline truncate block mt-0.5"
                                >
                                  {company.companyName}
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteOpp(opp.id)}
                              className="p-1 text-slate-400 dark:text-[#A1ADAA] hover:text-[#8F3438] dark:hover:text-[#C66D71]"
                              title="Delete opportunity"
                              aria-label="Delete opportunity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="text-xs flex items-center justify-between">
                            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-[#D8DEDC]">
                              {opp.currency} {opp.estimatedValue.toLocaleString()}
                            </span>
                            <span className="text-slate-500 dark:text-[#A1ADAA] tabular-nums">
                              {opp.probability}%
                            </span>
                          </div>

                          {(person || opp.expectedCloseDate || opp.nextAction) && (
                            <div className="text-xs text-slate-500 dark:text-[#A1ADAA] space-y-0.5">
                              {person && <div className="truncate">{person.fullName}</div>}
                              {opp.expectedCloseDate && (
                                <div className="tabular-nums">
                                  Close {new Date(opp.expectedCloseDate).toLocaleDateString()}
                                </div>
                              )}
                              {opp.nextAction && <div className="truncate">{opp.nextAction}</div>}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-[#344447] gap-2">
                            <select
                              value={opp.status}
                              onChange={(e) => handleUpdateOppStatus(opp.id, e.target.value as any)}
                              className="bg-slate-50 dark:bg-[#192629] border border-slate-200 dark:border-[#344447] rounded px-2 py-0.5 text-xs text-slate-700 dark:text-[#D8DEDC]"
                            >
                              {CRM_OPPORTUNITY_STATUSES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => setHistoryOpp(opp)}
                              className="text-xs text-slate-500 dark:text-[#A1ADAA] hover:text-slate-900 dark:hover:text-[#D8DEDC] inline-flex items-center gap-1"
                            >
                              <History className="w-3 h-3" />
                              {opp.stageHistory.length}
                            </button>

                            <div className="flex items-center gap-0.5">
                              {prevStage && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveOppStage(opp.id, prevStage.id)}
                                  className="p-1 hover:bg-slate-100 dark:hover:bg-[#335C67]/40 text-slate-500 dark:text-[#A1ADAA] hover:text-[#C49A52] rounded"
                                  title={`Move to ${prevStage.name}`}
                                >
                                  <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {nextStage && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveOppStage(opp.id, nextStage.id)}
                                  className="p-1 hover:bg-slate-100 dark:hover:bg-[#335C67]/40 text-slate-500 dark:text-[#A1ADAA] hover:text-[#C49A52] rounded"
                                  title={`Advance to ${nextStage.name}`}
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stage History Modal */}
      {historyOpp && (
        <div className="fixed inset-0 bg-[#0B1113]/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#192629] border border-slate-200 dark:border-[#344447] rounded-xl p-5 max-w-md w-full space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#344447] pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-[#D8DEDC] truncate">
                Stage History · {historyOpp.title}
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpp(null)}
                className="text-slate-400 dark:text-[#A1ADAA] hover:text-slate-900 dark:hover:text-[#D8DEDC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {historyOpp.stageHistory.map((ch) => (
                <div
                  key={ch.id}
                  className="p-3 rounded-lg bg-slate-50 dark:bg-[#101719] border border-slate-200 dark:border-[#344447] text-xs"
                >
                  <div className="font-semibold text-slate-900 dark:text-[#D8DEDC]">
                    {ch.fromStageName ? `${ch.fromStageName} → ${ch.toStageName}` : ch.toStageName}
                  </div>
                  <div className="text-slate-500 dark:text-[#A1ADAA] mt-0.5 tabular-nums">
                    {new Date(ch.changedAt).toLocaleString()} · {ch.changedBy}
                    {ch.reason ? ` · ${ch.reason}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lost Reason Modal */}
      {lostModalLeadId && (
        <div className="fixed inset-0 bg-[#0B1113]/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#192629] border border-slate-200 dark:border-[#344447] rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#344447]">
              <h3 className="text-base font-semibold text-slate-900 dark:text-[#D8DEDC] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#C49A52]" />
                Closed Lost Reason
              </h3>
              <button
                type="button"
                onClick={() => setLostModalLeadId(null)}
                className="text-slate-400 dark:text-[#A1ADAA] hover:text-slate-900 dark:hover:text-[#D8DEDC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              className={inputClass}
            >
              <option value="No Response after Follow-ups">No Response after Follow-ups</option>
              <option value="Budget Constraint">Budget Constraint</option>
              <option value="Chose Competitor">Chose Competitor</option>
              <option value="Not a Fit (Product Capability)">Not a Fit</option>
              <option value="Project Cancelled / Postponed">Project Cancelled or Postponed</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLostModalLeadId(null)}
                className="px-3.5 py-1.5 border border-slate-200 dark:border-[#344447] text-slate-700 dark:text-[#D8DEDC] text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLostReason}
                className="px-3.5 py-1.5 bg-[#8F3438] hover:bg-[#73282C] text-[#D8DEDC] text-xs font-semibold rounded-lg"
              >
                Confirm Lost
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
