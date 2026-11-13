import React, { useState } from 'react';
import {
  Kanban,
  Building2,
  MapPin,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  AlertTriangle,
  X,
  CheckCircle2,
} from 'lucide-react';
import { CanonicalLead, PipelineStage } from '../types.js';
import {
  summarizeValuesByCurrency,
  formatCurrencyLocale,
  getLocaleForCountry,
} from '../../shared/localization.ts';

interface PipelineBoardProps {
  stages: PipelineStage[];
  leads: CanonicalLead[];
  onSelectLead: (lead: CanonicalLead) => void;
  onMoveLeadStage: (leadId: string, stageId: string, lostReason?: string) => void;
}

export const PipelineBoard: React.FC<PipelineBoardProps> = ({
  stages,
  leads,
  onSelectLead,
  onMoveLeadStage,
}) => {
  const [lostModalLeadId, setLostModalLeadId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('No Response after Follow-ups');

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

  const boardSummary = summarizeValuesByCurrency(leads, 'USD');

  return (
    <div className="space-y-4">
      {/* Board Summary */}
      <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-900 px-4 py-2.5 rounded-lg border border-slate-800 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Kanban className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-white">Interactive Sales Pipeline Kanban</span>
          <span>— Move prospects through active qualification and conversion touchpoints.</span>
        </div>
        <div>
          Total Active Pipeline:{' '}
          <span className="font-semibold text-emerald-400" title={boardSummary.isMixed ? boardSummary.totals.map((b) => b.formatted).join(' + ') : undefined}>
            {boardSummary.primaryFormatted}
            {boardSummary.isMixed ? ' (Mixed currencies)' : ''}
          </span>
        </div>
      </div>

      {/* Kanban Columns Horizontal Scroller */}
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
              {/* Column Header */}
              <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <h3 className="text-xs font-bold text-white tracking-wide">{stage.name}</h3>
                  <span className="text-[10px] bg-slate-800 text-slate-400 font-mono px-1.5 py-0.2 rounded-full">
                    {stageLeads.length}
                  </span>
                </div>

                <div className="text-[11px] font-mono font-semibold text-slate-300 truncate max-w-[140px]" title={stageSummary.primaryFormatted}>
                  {stageHasValue ? stageSummary.primaryFormatted : '—'}
                </div>
              </div>

              {/* Cards Container */}
              <div className="p-2 space-y-2.5 overflow-y-auto flex-1 scrollbar-thin">
                {stageLeads.length === 0 ? (
                  <div className="p-6 text-center text-slate-600 text-xs border border-dashed border-slate-800/80 rounded-lg">
                    No leads in this stage
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => onSelectLead(lead)}
                      className="bg-slate-950 border border-slate-800/90 hover:border-slate-700 p-3 rounded-lg shadow-sm cursor-pointer group transition space-y-2.5"
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

                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            lead.confidenceScore >= 80
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}
                        >
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

                      {/* Value & Probability */}
                      <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-800 text-slate-300">
                        <span className="font-semibold text-emerald-400">
                          {formatCurrencyLocale(
                            lead.opportunityValue || 0,
                            lead.currency || 'USD',
                            getLocaleForCountry(lead.address?.countryCode, lead.currency)
                          )}
                        </span>
                        {lead.winProbability !== undefined && (
                          <span className="text-slate-400 text-[10px]">
                            {lead.winProbability}% Win Prob
                          </span>
                        )}
                      </div>

                      {/* Navigation Controls between Stages */}
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

                        <span className="text-[10px] text-slate-500 font-medium">Stage Action</span>

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
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lost Reason Modal */}
      {lostModalLeadId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Record Deal Loss Reason
              </h3>
              <button
                onClick={() => setLostModalLeadId(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Please specify why this deal was marked as Closed Lost for accurate conversion analytics:
            </p>

            <select
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
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
