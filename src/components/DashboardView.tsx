import React from 'react';
import {
  TrendingUp,
  Building2,
  DollarSign,
  CheckCircle2,
  Radio,
  ArrowRight,
  ShieldCheck,
  Search,
  Upload,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Clock,
  Layers
} from 'lucide-react';
import { CanonicalLead, PipelineStage, LeadTask, ConnectorStatus } from '../types.ts';

interface DashboardViewProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  tasks: LeadTask[];
  connectors: ConnectorStatus[];
  onNavigateTab: (tab: string) => void;
  onSelectLead: (lead: CanonicalLead) => void;
  onOpenImport: () => void;
}

export function DashboardView({
  leads,
  stages,
  tasks,
  connectors,
  onNavigateTab,
  onSelectLead,
  onOpenImport,
}: DashboardViewProps) {
  const totalPipelineValue = leads.reduce((sum, l) => sum + (l.opportunityValue || 0), 0);
  const activeConnectorsCount = connectors.filter((c) => c.status === 'healthy').length;
  const pendingTasks = tasks.filter((t) => !t.completed);
  const verifiedLeads = leads.filter((l) => l.confidenceScore >= 70);

  // Stage distribution
  const stageCounts = stages.map((stage) => {
    const stageLeads = leads.filter((l) => l.pipelineStageId === stage.id);
    const value = stageLeads.reduce((sum, l) => sum + (l.opportunityValue || 0), 0);
    return {
      stage,
      count: stageLeads.length,
      value,
    };
  });

  const isEmpty = leads.length === 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Leads */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-all hover:border-slate-300 dark:hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Leads</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tight">
              {leads.length}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              ({verifiedLeads.length} verified)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Official government registry backed
          </p>
        </div>

        {/* Pipeline Value */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-all hover:border-slate-300 dark:hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Pipeline Value</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tight">
              ${totalPipelineValue.toLocaleString()}
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              USD
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Across active deal stages
          </p>
        </div>

        {/* Pending Follow-ups */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-all hover:border-slate-300 dark:hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Follow-up Tasks</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tight">
              {pendingTasks.length}
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              pending
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Scheduled owner follow-ups
          </p>
        </div>

        {/* Connectors Status */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-all hover:border-slate-300 dark:hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Registry Connectors</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tight">
              {activeConnectorsCount}/6
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              Operational
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Brreg, CH, ABN, OSM, Crawler, AI
          </p>
        </div>
      </div>

      {/* Onboarding State for Empty Database */}
      {isEmpty ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-xs">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-4 border border-blue-200 dark:border-blue-900">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              Welcome to LEED Intelligence Platform
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Your single-owner Neon PostgreSQL database is connected and ready. Begin by discovering verified businesses or importing existing pipeline records.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 max-w-4xl mx-auto">
            {/* Step 1: Discover */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between hover:border-blue-300 dark:hover:border-blue-700 transition-all">
              <div>
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 flex items-center justify-center font-bold text-xs mb-3 font-mono">
                  01
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Discover Global Leads</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Query official registries in Norway (Brreg), UK (Companies House), Australia (ABN), and OpenStreetMap.
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('discovery')}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
              >
                Open Discovery Engine <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step 2: Batch Import */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between hover:border-emerald-300 dark:hover:border-emerald-700 transition-all">
              <div>
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 flex items-center justify-center font-bold text-xs mb-3 font-mono">
                  02
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Import Existing Data</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Upload existing leads via CSV or JSON with automatic column mapping, duplicate detection, and schema validation.
                </p>
              </div>
              <button
                onClick={onOpenImport}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                Upload CSV/JSON File <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step 3: Configure Connectors */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between hover:border-purple-300 dark:hover:border-purple-700 transition-all">
              <div>
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300 flex items-center justify-center font-bold text-xs mb-3 font-mono">
                  03
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Configure & Calibrate</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Configure Companies House API credentials, review deduplication thresholds, and inspect active sessions in Owner Control Centre.
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('control-centre')}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
              >
                Open Owner Control Centre <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Pipeline Stage Distribution */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Pipeline Stage Distribution</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Real-time deal progression across stages
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('pipeline')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                View Pipeline Kanban <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {stageCounts.map(({ stage, count, value }) => (
                <div
                  key={stage.id}
                  className="p-3.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: stage.color || '#3b82f6' }}
                    />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                      {stage.name}
                    </span>
                  </div>
                  <div className="mt-2 text-lg font-bold font-mono text-slate-900 dark:text-white">
                    {count}
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
                    ${value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Leads / High Confidence Prospects */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recently Discovered Leads</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Latest verified records added to the pipeline
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('leads')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All Leads <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {leads.slice(0, 5).map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => onSelectLead(lead)}
                  className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {lead.companyName}
                      </span>
                      {lead.registrationNumber && (
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          CRN: {lead.registrationNumber}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">·</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {lead.address?.city || lead.address?.country}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      <span>{lead.industry || 'General Business'}</span>
                      <span>·</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        {lead.confidenceScore}% confidence
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                      ${(lead.opportunityValue || 0).toLocaleString()}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
