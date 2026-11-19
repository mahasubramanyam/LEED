import React, { useState, useEffect, useCallback } from 'react';
import {
  Kanban,
  Building2,
  MapPin,
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
import { CRM_OPPORTUNITY_STATUSES, getOpportunityStatusLabel } from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';

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

  // Phase 13 Multi-Opportunity state
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

  return (
    <div className="space-y-4">
      {/* Board Summary + Mode Switcher */}
      <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-900 px-4 py-3 rounded-xl border border-slate-800 gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setBoardMode('companies')}
              className={`px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition ${
                boardMode === 'companies' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              Company Pipeline ({leads.length})
            </button>
            <button
              onClick={() => setBoardMode('opportunities')}
              className={`px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition ${
                boardMode === 'opportunities' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              Opportunities ({opportunities.length})
            </button>
          </div>
          <span className="text-[11px] text-slate-500">
            Track multiple commercial opportunities per company with stage history
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div>
            Company Pipeline:{' '}
            <span className="font-semibold text-emerald-400 font-mono">
              {boardSummary.primaryFormatted}
            </span>
          </div>
          {boardMode === 'opportunities' && leads.length > 0 && (
            <button
              onClick={() => setIsCreatingOpp(!isCreatingOpp)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              New Opportunity
            </button>
          )}
        </div>
      </div>

      {/* Create Opportunity Form */}
      {boardMode === 'opportunities' && isCreatingOpp && (
        <form onSubmit={handleCreateOpp} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-white">Create Commercial Opportunity</h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Company *</label>
              <select
                value={oppLeadId}
                onChange={(e) => setOppLeadId(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Opportunity Title *</label>
              <input
                type="text"
                required
                value={oppTitle}
                onChange={(e) => setOppTitle(e.target.value)}
                placeholder="e.g. Regional Distribution Contract"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Estimated Value &amp; Currency</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  value={oppValue}
                  onChange={(e) => setOppValue(e.target.value)}
                  placeholder="45000"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
                <input
                  type="text"
                  maxLength={3}
                  value={oppCurrency}
                  onChange={(e) => setOppCurrency(e.target.value.toUpperCase())}
                  className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Stage</label>
              <select
                value={oppStageId}
                onChange={(e) => setOppStageId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Decision-Maker</label>
              <select
                value={oppPersonId}
                onChange={(e) => setOppPersonId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
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
              <label className="block text-[11px] text-slate-400 mb-1">Probability %</label>
              <input
                type="number"
                min="0"
                max="100"
                value={oppProb}
                onChange={(e) => setOppProb(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Expected Close Date</label>
              <input
                type="date"
                value={oppCloseDate}
                onChange={(e) => setOppCloseDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Next Action</label>
              <input
                type="text"
                value={oppNextAction}
                onChange={(e) => setOppNextAction(e.target.value)}
                placeholder="e.g. Send draft agreement"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreatingOpp(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg"
            >
              Create Opportunity
            </button>
          </div>
        </form>
      )}

      {/* Empty Pipeline Initialization Banner */}
      {stages.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
            <Kanban className="w-5 h-5 text-indigo-400" />
          </div>
          <h3 className="text-sm font-bold text-white">No Pipeline Stages Configured</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Initialize the standard 8-stage sales pipeline or save your first lead to create default stages automatically.
          </p>
          {initStageError && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800 rounded-lg px-3 py-2 max-w-md mx-auto">
              {initStageError}
            </div>
          )}
          {onInitializeStages && (
            <button
              onClick={onInitializeStages}
              disabled={isInitializingStages}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition inline-flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isInitializingStages ? 'Initializing Stages...' : 'Initialize Default Pipeline Stages'}
            </button>
          )}
        </div>
      ) : boardMode === 'companies' ? (
        /* EXISTING COMPANY PIPELINE KANBAN (100% preserved) */
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
          {stages.map((stage, idx) => {
            const stageLeads = leads.filter((l) => l.pipelineStageId === stage.id);
            const stageSummary = summarizeValuesByCurrency(stageLeads, 'USD');
            const stageHasValue = stageLeads.some((l) => (l.opportunityValue || 0) > 0);
            const prevStage = idx > 0 ? stages[idx - 1] : null;
            const nextStage = idx < stages.length - 1 ? stages[idx + 1] : null;

            return (
              <div
                key={stage.id}
                className="flex-shrink-0 w-80 bg-slate-900 border border-slate-800 rounded-xl flex flex-col max-h-[750px]"
              >
                <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-xs font-bold text-white tracking-wide">{stage.name}</h3>
                    <span className="text-[11px] text-slate-400 font-mono">({stageLeads.length})</span>
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-slate-300 truncate max-w-[140px]">
                    {stageHasValue ? stageSummary.primaryFormatted : '—'}
                  </div>
                </div>

                <div className="p-2 space-y-2.5 overflow-y-auto flex-1 scrollbar-thin">
                  {stageLeads.length === 0 ? (
                    <div className="p-6 text-center text-slate-600 text-xs border border-dashed border-slate-800/80 rounded-lg">
                      No leads in this stage
                    </div>
                  ) : (
                    stageLeads.map((lead) => {
                      const companyOppsCount = opportunities.filter((o) => o.leadId === lead.id && o.status === 'open').length;
                      return (
                        <div
                          key={lead.id}
                          onClick={() => onSelectLead(lead)}
                          className="bg-slate-950 border border-slate-800/90 hover:border-slate-700 p-3 rounded-lg cursor-pointer group transition space-y-2"
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="min-w-0">
                              <h4 className="text-xs font-semibold text-white group-hover:text-indigo-400 transition truncate">
                                {lead.companyName}
                              </h4>
                              {lead.registrationNumber && (
                                <span className="text-[10px] text-cyan-400 font-mono">
                                  {lead.registrationType}: {lead.registrationNumber}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono font-semibold text-emerald-400">
                              {lead.confidenceScore}%
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                              <span className="truncate">
                                {lead.address?.city || lead.address?.country || 'Unknown City'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3 h-3 text-slate-500 flex-shrink-0" />
                              <span className="truncate">{lead.industry}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-800 text-slate-300">
                            <span className="font-semibold text-emerald-400 font-mono">
                              {formatCurrencyLocale(
                                lead.opportunityValue || 0,
                                lead.currency || 'USD',
                                getLocaleForCountry(lead.address?.countryCode, lead.currency)
                              )}
                            </span>
                            <span className="text-slate-400 text-[10px]">
                              {companyOppsCount > 0
                                ? `${companyOppsCount} deal(s)`
                                : lead.winProbability !== undefined
                                  ? `${lead.winProbability}% Prob`
                                  : ''}
                            </span>
                          </div>

                          <div
                            className="flex items-center justify-between pt-1 border-t border-slate-800/60"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {prevStage ? (
                              <button
                                onClick={() => handleMove(lead.id, prevStage.id)}
                                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition"
                                title={`Move back to ${prevStage.name}`}
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <div className="w-4" />
                            )}
                            <span className="text-[10px] text-slate-500 font-medium">Move Stage</span>
                            {nextStage ? (
                              <button
                                onClick={() => handleMove(lead.id, nextStage.id)}
                                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition"
                                title={`Advance to ${nextStage.name}`}
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <div className="w-4" />
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
        /* PHASE 13 MULTI-OPPORTUNITY KANBAN BOARD */
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
          {stages.map((stage, idx) => {
            const stageOpps = opportunities.filter((o) => o.pipelineStageId === stage.id);
            const prevStage = idx > 0 ? stages[idx - 1] : null;
            const nextStage = idx < stages.length - 1 ? stages[idx + 1] : null;
            const totalStageVal = stageOpps.reduce((s, o) => s + (o.estimatedValue || 0), 0);

            return (
              <div
                key={stage.id}
                className="flex-shrink-0 w-80 bg-slate-900 border border-slate-800 rounded-xl flex flex-col max-h-[750px]"
              >
                <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-xs font-bold text-white">{stage.name}</h3>
                    <span className="text-[11px] text-slate-400 font-mono">({stageOpps.length})</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-300">
                    {totalStageVal > 0 ? totalStageVal.toLocaleString() : '—'}
                  </div>
                </div>

                <div className="p-2 space-y-2.5 overflow-y-auto flex-1 scrollbar-thin">
                  {stageOpps.length === 0 ? (
                    <div className="p-6 text-center text-slate-600 text-xs border border-dashed border-slate-800/80 rounded-lg">
                      No opportunities in {stage.name}
                    </div>
                  ) : (
                    stageOpps.map((opp) => {
                      const company = leads.find((l) => l.id === opp.leadId);
                      const person = persons.find((p) => p.id === opp.personId);
                      return (
                        <div
                          key={opp.id}
                          className="bg-slate-950 border border-slate-800/90 hover:border-slate-700 p-3 rounded-lg space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{opp.title}</div>
                              {company && (
                                <button
                                  onClick={() => onSelectLead(company)}
                                  className="text-[11px] text-indigo-400 hover:underline truncate block mt-0.5"
                                >
                                  {company.companyName}
                                </button>
                              )}
                            </div>
                            <button
                              onClick={() => handleDeleteOpp(opp.id)}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Delete opportunity"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="text-[11px] text-slate-400 flex items-center justify-between">
                            <span className="font-mono font-semibold text-emerald-400">
                              {opp.currency} {opp.estimatedValue.toLocaleString()}
                            </span>
                            <span>{opp.probability}% prob</span>
                          </div>

                          <div className="text-[11px] text-slate-500 space-y-0.5">
                            {person && <div>Contact: {person.fullName}</div>}
                            {opp.expectedCloseDate && (
                              <div>Close: {new Date(opp.expectedCloseDate).toLocaleDateString()}</div>
                            )}
                            {opp.nextAction && <div className="truncate">Next: {opp.nextAction}</div>}
                          </div>

                          <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80 gap-2">
                            <select
                              value={opp.status}
                              onChange={(e) => handleUpdateOppStatus(opp.id, e.target.value as any)}
                              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200"
                            >
                              {CRM_OPPORTUNITY_STATUSES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>

                            <button
                              onClick={() => setHistoryOpp(opp)}
                              className="text-[10px] text-slate-400 hover:text-white inline-flex items-center gap-1"
                            >
                              <History className="w-3 h-3" />
                              History ({opp.stageHistory.length})
                            </button>

                            <div className="flex items-center gap-1">
                              {prevStage && (
                                <button
                                  onClick={() => handleMoveOppStage(opp.id, prevStage.id)}
                                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded"
                                  title={`Move to ${prevStage.name}`}
                                >
                                  <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {nextStage && (
                                <button
                                  onClick={() => handleMoveOppStage(opp.id, nextStage.id)}
                                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded"
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

      {/* Opportunity Stage History Modal */}
      {historyOpp && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Stage History — {historyOpp.title}</h3>
              <button onClick={() => setHistoryOpp(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {historyOpp.stageHistory.map((ch) => (
                <div key={ch.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                  <div className="font-semibold text-white">
                    {ch.fromStageName ? `${ch.fromStageName} → ${ch.toStageName}` : ch.toStageName}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Record Deal Loss Reason
              </h3>
              <button onClick={() => setLostModalLeadId(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Please specify why this deal was marked as Closed Lost for accurate conversion analytics:
            </p>
            <select
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2"
            >
              <option value="No Response after Follow-ups">No Response after Multiple Follow-ups</option>
              <option value="Budget Constraint">Budget Constraint / Unqualified Spend</option>
              <option value="Chose Competitor">Chose Competitor</option>
              <option value="Not a Fit (Product Capability)">Not a Fit (Product Capability Mismatch)</option>
              <option value="Project Cancelled / Postponed">Project Cancelled or Indefinitely Postponed</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setLostModalLeadId(null)}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs rounded"
              >
                Cancel
              </button>
              <button
                onClick={confirmLostReason}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded"
              >
                Confirm Closed Lost
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
