import React, { useCallback, useEffect, useState } from 'react';
import {
  Workflow,
  Plus,
  Play,
  RotateCcw,
  Trash2,
  Edit3,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  Bell,
  RefreshCw,
  Info,
  Power,
  Eye,
} from 'lucide-react';
import type {
  WorkflowActionConfig,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowExecutionRecord,
  WorkflowOwnerNotification,
  WorkflowTriggerConfig,
} from '../../shared/biWorkflowTypes.ts';
import {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_CONDITION_FIELDS,
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_PERMITTED_CRM_FIELDS,
  WORKFLOW_PROHIBITED_ACTIONS,
  WORKFLOW_TRIGGERS,
  type WorkflowActionType,
  type WorkflowConditionField,
  type WorkflowConditionOperator,
  type WorkflowTriggerType,
} from '../../shared/biWorkflowSpecs.ts';
import type { CanonicalLead, PipelineStage } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { ActionMenu, SegmentedTabs, WorkspaceToolbar } from './ui/SunsetUI.tsx';

type WorkflowSubTab = 'workflows' | 'history' | 'approvals';

interface WorkflowWorkspaceResponse {
  workflows: WorkflowDefinition[];
  executions: WorkflowExecutionRecord[];
  notifications: WorkflowOwnerNotification[];
  stats: {
    totalWorkflows: number;
    enabledWorkflows: number;
    totalExecutions: number;
    completedExecutions: number;
    failedExecutions: number;
    awaitingApprovalExecutions: number;
    unreadNotifications: number;
  };
  schedulingDisclosure: string;
}

interface WorkflowAutomationWorkspaceProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  onDataMutated?: () => void;
}

function emptyCondition(): WorkflowCondition {
  return {
    id: `cond-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    field: 'country',
    operator: 'equals',
    value: 'GB',
  };
}

function emptyAction(type: WorkflowActionType = 'create_task'): WorkflowActionConfig {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    type,
    taskTitle: type === 'create_task' ? 'Review {{company_name}}' : undefined,
    taskPriority: type === 'create_task' ? 'medium' : undefined,
    taskDueInDays: type === 'create_task' ? 2 : undefined,
    tag: type === 'add_tag' ? 'high-priority' : undefined,
    crmField: type === 'update_crm_field' ? 'relationshipStatus' : undefined,
    crmValue: type === 'update_crm_field' ? 'engaged' : undefined,
    notificationTitle: type === 'create_owner_notification' ? 'Workflow Alert: {{company_name}}' : undefined,
    notificationMessage:
      type === 'create_owner_notification' ? '{{company_name}} matched your automated workflow rule.' : undefined,
    notificationSeverity: type === 'create_owner_notification' ? 'info' : undefined,
    activityTitle: type === 'add_activity_record' ? 'Workflow milestone recorded' : undefined,
    activityDescription: type === 'add_activity_record' ? 'Triggered automatically by LEED workflow rule.' : undefined,
    enrichmentReason: type === 'request_enrichment' ? 'Workflow requested Phase 12 enrichment review.' : undefined,
    followUpDelayDays: type === 'create_follow_up_recommendation' ? 3 : undefined,
    followUpNote:
      type === 'create_follow_up_recommendation' ? 'Follow up with {{company_name}} based on workflow trigger.' : undefined,
    aiFocus:
      type === 'generate_ai_recommendation' ? 'Recommend next commercial step for {{company_name}}.' : undefined,
    approvalSummary:
      type === 'queue_owner_approval' ? 'Owner sign-off required for {{company_name}}.' : undefined,
    requiresOwnerApproval:
      type === 'update_crm_field' || type === 'request_enrichment' || type === 'queue_owner_approval',
  };
}

export const WorkflowAutomationWorkspace: React.FC<WorkflowAutomationWorkspaceProps> = ({
  leads,
  stages,
  onDataMutated,
}) => {
  const [subTab, setSubTab] = useState<WorkflowSubTab>('workflows');
  const [workspace, setWorkspace] = useState<WorkflowWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Builder state
  const [showBuilder, setShowBuilder] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wfName, setWfName] = useState<string>('');
  const [wfDescription, setWfDescription] = useState<string>('');
  const [wfEnabled, setWfEnabled] = useState<boolean>(true);
  const [wfMaxRunsPerHour, setWfMaxRunsPerHour] = useState<number>(20);
  const [wfTrigger, setWfTrigger] = useState<WorkflowTriggerConfig>({ type: 'lead_created' });
  const [wfConditionLogic, setWfConditionLogic] = useState<'all' | 'any'>('all');
  const [wfConditions, setWfConditions] = useState<WorkflowCondition[]>([]);
  const [wfActions, setWfActions] = useState<WorkflowActionConfig[]>([emptyAction('create_task')]);

  // Dry-run preview state
  const [testLeadId, setTestLeadId] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<WorkflowExecutionRecord | null>(null);

  // History filter
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/bi/workflows');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: WorkflowWorkspaceResponse = await res.json();
      setWorkspace(data);
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load workflows.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  useEffect(() => {
    if (!testLeadId && leads.length > 0) {
      setTestLeadId(leads[0].id);
    }
  }, [leads, testLeadId]);

  const resetBuilder = () => {
    setEditingId(null);
    setWfName('');
    setWfDescription('');
    setWfEnabled(true);
    setWfMaxRunsPerHour(20);
    setWfTrigger({ type: 'lead_created' });
    setWfConditionLogic('all');
    setWfConditions([]);
    setWfActions([emptyAction('create_task')]);
  };

  const openEditBuilder = (wf: WorkflowDefinition) => {
    setEditingId(wf.id);
    setWfName(wf.name);
    setWfDescription(wf.description || '');
    setWfEnabled(wf.enabled);
    setWfMaxRunsPerHour(wf.maxRunsPerHour);
    setWfTrigger({ ...wf.trigger });
    setWfConditionLogic(wf.conditionLogic);
    setWfConditions(wf.conditions.map((c) => ({ ...c })));
    setWfActions(wf.actions.map((a) => ({ ...a })));
    setShowBuilder(true);
  };

  const handleSaveWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const payload = {
        name: wfName.trim(),
        description: wfDescription.trim() || undefined,
        enabled: wfEnabled,
        maxRunsPerHour: wfMaxRunsPerHour,
        trigger: wfTrigger,
        conditionLogic: wfConditionLogic,
        conditions: wfConditions,
        actions: wfActions,
      };
      const url = editingId ? `/api/bi/workflows/${editingId}` : '/api/bi/workflows';
      const method = editingId ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.details?.join(' ') || data.error || 'Workflow validation failed.');
      }
      setNotice({
        type: 'success',
        text: editingId ? `Updated workflow "${data.workflow.name}".` : `Created workflow "${data.workflow.name}".`,
      });
      setShowBuilder(false);
      resetBuilder();
      await fetchWorkspace();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save workflow.' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleWorkflow = async (wf: WorkflowDefinition) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/bi/workflows/${wf.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !wf.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update workflow status.');
      await fetchWorkspace();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Toggle failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteWorkflow = async (wf: WorkflowDefinition) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/bi/workflows/${wf.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete workflow.');
      }
      setNotice({ type: 'success', text: `Deleted workflow "${wf.name}".` });
      await fetchWorkspace();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleTestRun = async (wf: WorkflowDefinition, dryRun: boolean) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/bi/workflows/${wf.id}/test-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          leadId: testLeadId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Workflow test run failed.');
      setDryRunResult(data.execution);
      setNotice({
        type: 'success',
        text: dryRun
          ? `Dry-run preview completed for "${wf.name}" (no CRM changes applied).`
          : `Executed "${wf.name}" -> ${data.execution?.status || 'completed'}.`,
      });
      if (!dryRun) {
        await fetchWorkspace();
        onDataMutated?.();
      }
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Test run failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleEvaluateTimers = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/bi/workflows/evaluate-timers', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Timer sweep failed.');
      const total =
        (data.stageDurationExecutions?.length || 0) + (data.overdueTaskExecutions?.length || 0);
      setNotice({
        type: 'success',
        text: `On-demand timer sweep completed: ${data.stageDurationExecutions?.length || 0} stage-duration run(s), ${data.overdueTaskExecutions?.length || 0} overdue-task run(s) (${total} total).`,
      });
      await fetchWorkspace();
      onDataMutated?.();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to evaluate timer triggers.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRetryExecution = async (execId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/bi/workflows/executions/${execId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed.');
      setNotice({
        type: 'success',
        text: `Retried failed steps -> status: ${data.execution?.status}.`,
      });
      await fetchWorkspace();
      onDataMutated?.();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Retry failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveStep = async (execId: string, stepIndex: number, decision: 'approve' | 'reject') => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/bi/workflows/executions/${execId}/approve-step/${stepIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval decision failed.');
      setNotice({
        type: 'success',
        text: decision === 'approve' ? 'Owner approved and applied workflow step.' : 'Owner rejected workflow step.',
      });
      await fetchWorkspace();
      onDataMutated?.();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Decision failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    try {
      const res = await apiFetch(`/api/bi/notifications/${id}/read`, { method: 'PATCH' });
      if (res.ok) await fetchWorkspace();
    } catch {
      // Ignore
    }
  };

  const pendingApprovals = (workspace?.executions || []).flatMap((ex) =>
    ex.steps
      .filter((s) => s.status === 'awaiting_owner_approval')
      .map((step) => ({ execution: ex, step }))
  );

  const filteredExecutions = (workspace?.executions || []).filter((ex) =>
    statusFilter === 'all' ? true : ex.status === statusFilter
  );

  return (
    <div className="space-y-5">
      <WorkspaceToolbar
        actions={
          <>
            <ActionMenu
              label="Actions"
              items={[
                {
                  label: 'Run Timer Sweep',
                  icon: <Clock className="w-3.5 h-3.5 text-slate-400" />,
                  onClick: handleEvaluateTimers,
                  disabled: busy,
                },
                {
                  label: 'Refresh',
                  icon: <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />,
                  onClick: fetchWorkspace,
                  disabled: loading,
                },
              ]}
            />
            <button
              type="button"
              onClick={() => {
                resetBuilder();
                setShowBuilder(true);
                setSubTab('workflows');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#D8DEDC] bg-[#335C67] hover:bg-[#3D6C79] rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Workflow</span>
            </button>
          </>
        }
      >
        <SegmentedTabs
          variant="segmented"
          activeId={subTab}
          onChange={(id) => setSubTab(id)}
          items={[
            { id: 'workflows' as WorkflowSubTab, label: 'Workflows', count: workspace?.stats.totalWorkflows },
            { id: 'history' as WorkflowSubTab, label: 'Run History', count: workspace?.stats.totalExecutions },
            {
              id: 'approvals' as WorkflowSubTab,
              label: 'Approvals & Alerts',
              count: pendingApprovals.length + (workspace?.stats.unreadNotifications || 0),
            },
          ]}
        />
      </WorkspaceToolbar>

      {/* Concise Safety Disclosure */}
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#344447] bg-slate-50/80 dark:bg-[#192629] text-xs text-slate-600 dark:text-[#A1ADAA]">
        <ShieldAlert className="w-3.5 h-3.5 text-[#335C67] dark:text-[#C49A52] shrink-0" />
        <span>
          Owner approval required for sensitive updates; automatic external sending and destructive deletes are blocked.
          {workspace?.schedulingDisclosure ? ` ${workspace.schedulingDisclosure}` : ''}
        </span>
      </div>

      {notice && (
        <div
          className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-xs ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="underline ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 1: WORKFLOWS & RULE BUILDER                                */}
      {/* ================================================================== */}
      {subTab === 'workflows' && (
        <div className="space-y-6">
          {/* Builder Form */}
          {showBuilder && (
            <form
              onSubmit={handleSaveWorkflow}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {editingId ? 'Edit Workflow Rule' : 'Create Workflow Rule'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowBuilder(false);
                    resetBuilder();
                  }}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  Cancel
                </button>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Workflow Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={wfName}
                    onChange={(e) => setWfName(e.target.value)}
                    placeholder="e.g. Verified UK Lead Onboarding"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={wfDescription}
                    onChange={(e) => setWfDescription(e.target.value)}
                    placeholder="Optional purpose of this rule"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Rate Limit (Runs/Hr)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={wfMaxRunsPerHour}
                      onChange={(e) => setWfMaxRunsPerHour(Math.max(1, Math.min(60, Number(e.target.value) || 20)))}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 pb-2">
                    <input
                      type="checkbox"
                      checked={wfEnabled}
                      onChange={(e) => setWfEnabled(e.target.checked)}
                    />
                    <span>Enabled</span>
                  </label>
                </div>
              </div>

              {/* STEP 1: TRIGGER */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">1. Trigger</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">When Event Occurs</label>
                    <select
                      value={wfTrigger.type}
                      onChange={(e) =>
                        setWfTrigger({
                          type: e.target.value as WorkflowTriggerType,
                          stageId: undefined,
                          durationDays: e.target.value === 'lead_stage_duration' ? 7 : undefined,
                          opportunityOutcome: undefined,
                        })
                      }
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      {WORKFLOW_TRIGGERS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label} ({t.executionMode === 'on_demand_sweep' ? 'On-Demand Sweep' : 'Event'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {(wfTrigger.type === 'lead_entered_stage' || wfTrigger.type === 'lead_stage_duration') && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Pipeline Stage (Optional)</label>
                      <select
                        value={wfTrigger.stageId || ''}
                        onChange={(e) =>
                          setWfTrigger((prev) => ({ ...prev, stageId: e.target.value || undefined }))
                        }
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        <option value="">Any Stage</option>
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {wfTrigger.type === 'lead_stage_duration' && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Minimum Days in Stage</label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={wfTrigger.durationDays ?? 7}
                        onChange={(e) =>
                          setWfTrigger((prev) => ({ ...prev, durationDays: Math.max(1, Number(e.target.value) || 7) }))
                        }
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  )}

                  {wfTrigger.type === 'opportunity_closed' && (
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Outcome Filter</label>
                      <select
                        value={wfTrigger.opportunityOutcome || ''}
                        onChange={(e) =>
                          setWfTrigger((prev) => ({
                            ...prev,
                            opportunityOutcome: (e.target.value || undefined) as 'won' | 'lost' | undefined,
                          }))
                        }
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        <option value="">Won or Lost</option>
                        <option value="won">Won Only</option>
                        <option value="lost">Lost Only</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* STEP 2: CONDITIONS */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">2. Conditions (Optional)</span>
                    <select
                      value={wfConditionLogic}
                      onChange={(e) => setWfConditionLogic(e.target.value as 'all' | 'any')}
                      className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                    >
                      <option value="all">Match ALL conditions (AND)</option>
                      <option value="any">Match ANY condition (OR)</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWfConditions((prev) => [...prev, emptyCondition()])}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    + Add Condition
                  </button>
                </div>

                {wfConditions.length === 0 ? (
                  <p className="text-xs text-slate-400">No conditions — rule applies to all matching trigger events.</p>
                ) : (
                  <div className="space-y-2">
                    {wfConditions.map((cond, idx) => (
                      <div key={cond.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <select
                          value={cond.field}
                          onChange={(e) =>
                            setWfConditions((prev) =>
                              prev.map((c, i) => (i === idx ? { ...c, field: e.target.value as WorkflowConditionField } : c))
                            )
                          }
                          className="sm:col-span-4 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                        >
                          {WORKFLOW_CONDITION_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                        <select
                          value={cond.operator}
                          onChange={(e) =>
                            setWfConditions((prev) =>
                              prev.map((c, i) =>
                                i === idx ? { ...c, operator: e.target.value as WorkflowConditionOperator } : c
                              )
                            )
                          }
                          className="sm:col-span-3 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                        >
                          {WORKFLOW_CONDITION_OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          disabled={cond.operator === 'exists' || cond.operator === 'not_exists'}
                          value={Array.isArray(cond.value) ? cond.value.join(', ') : String(cond.value ?? '')}
                          onChange={(e) =>
                            setWfConditions((prev) =>
                              prev.map((c, i) => (i === idx ? { ...c, value: e.target.value } : c))
                            )
                          }
                          placeholder="Value (e.g. GB, A, 5000)"
                          className="sm:col-span-4 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-40"
                        />
                        <button
                          type="button"
                          onClick={() => setWfConditions((prev) => prev.filter((_, i) => i !== idx))}
                          className="sm:col-span-1 p-1.5 text-slate-400 hover:text-red-500 justify-self-end"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* STEP 3: AUTHORIZED ACTIONS */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    3. Authorized Actions (Max 6)
                  </span>
                  <button
                    type="button"
                    disabled={wfActions.length >= 6}
                    onClick={() => setWfActions((prev) => [...prev, emptyAction('create_owner_notification')])}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium disabled:opacity-40"
                  >
                    + Add Action
                  </button>
                </div>

                <div className="space-y-3">
                  {wfActions.map((act, idx) => {
                    const spec = WORKFLOW_ACTION_TYPES.find((a) => a.value === act.type);
                    return (
                      <div
                        key={act.id}
                        className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-slate-400">Step #{idx + 1}</span>
                            <select
                              value={act.type}
                              onChange={(e) => {
                                const nextType = e.target.value as WorkflowActionType;
                                setWfActions((prev) => prev.map((a, i) => (i === idx ? emptyAction(nextType) : a)));
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            >
                              {WORKFLOW_ACTION_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label} {t.requiresApprovalByDefault ? '(Requires Owner Approval)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          {wfActions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setWfActions((prev) => prev.filter((_, i) => i !== idx))}
                              className="p-1 text-slate-400 hover:text-red-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {spec && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {spec.description}
                            {spec.requiresApprovalByDefault && ' · Queues for explicit owner approval before applying.'}
                          </p>
                        )}

                        {act.type === 'create_task' && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={act.taskTitle || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, taskTitle: e.target.value } : a))
                                )
                              }
                              placeholder="Task title (supports {{company_name}})"
                              className="sm:col-span-2 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                            <div className="flex gap-2">
                              <select
                                value={act.taskPriority || 'medium'}
                                onChange={(e) =>
                                  setWfActions((prev) =>
                                    prev.map((a, i) => (i === idx ? { ...a, taskPriority: e.target.value as any } : a))
                                  )
                                }
                                className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                              </select>
                              <input
                                type="number"
                                min={0}
                                max={90}
                                value={act.taskDueInDays ?? 2}
                                onChange={(e) =>
                                  setWfActions((prev) =>
                                    prev.map((a, i) =>
                                      i === idx ? { ...a, taskDueInDays: Math.max(0, Number(e.target.value) || 0) } : a
                                    )
                                  )
                                }
                                title="Due in days"
                                className="w-16 px-2 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                            </div>
                          </div>
                        )}

                        {act.type === 'add_tag' && (
                          <input
                            type="text"
                            value={act.tag || ''}
                            onChange={(e) =>
                              setWfActions((prev) =>
                                prev.map((a, i) => (i === idx ? { ...a, tag: e.target.value } : a))
                              )
                            }
                            placeholder="Tag label (e.g. vip-verified)"
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        )}

                        {act.type === 'update_crm_field' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select
                              value={act.crmField || 'relationshipStatus'}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, crmField: e.target.value as any } : a))
                                )
                              }
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              {WORKFLOW_PERMITTED_CRM_FIELDS.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={act.crmValue || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, crmValue: e.target.value } : a))
                                )
                              }
                              placeholder="New value (queued for owner approval)"
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        )}

                        {act.type === 'create_owner_notification' && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={act.notificationTitle || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, notificationTitle: e.target.value } : a))
                                )
                              }
                              placeholder="Notification title"
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                            <input
                              type="text"
                              value={act.notificationMessage || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, notificationMessage: e.target.value } : a))
                                )
                              }
                              placeholder="Message (supports {{company_name}})"
                              className="sm:col-span-2 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        )}

                        {act.type === 'add_activity_record' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={act.activityTitle || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, activityTitle: e.target.value } : a))
                                )
                              }
                              placeholder="Activity title"
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                            <input
                              type="text"
                              value={act.activityDescription || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, activityDescription: e.target.value } : a))
                                )
                              }
                              placeholder="Activity details"
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        )}

                        {act.type === 'request_enrichment' && (
                          <input
                            type="text"
                            value={act.enrichmentReason || ''}
                            onChange={(e) =>
                              setWfActions((prev) =>
                                prev.map((a, i) => (i === idx ? { ...a, enrichmentReason: e.target.value } : a))
                              )
                            }
                            placeholder="Reason for requesting Phase 12 enrichment review"
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        )}

                        {act.type === 'create_follow_up_recommendation' && (
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <input
                              type="number"
                              min={0}
                              max={60}
                              value={act.followUpDelayDays ?? 3}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) =>
                                    i === idx ? { ...a, followUpDelayDays: Math.max(0, Number(e.target.value) || 0) } : a
                                  )
                                )
                              }
                              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              placeholder="Delay days"
                            />
                            <input
                              type="text"
                              value={act.followUpNote || ''}
                              onChange={(e) =>
                                setWfActions((prev) =>
                                  prev.map((a, i) => (i === idx ? { ...a, followUpNote: e.target.value } : a))
                                )
                              }
                              placeholder="Follow-up recommendation note (respects suppression)"
                              className="sm:col-span-3 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        )}

                        {act.type === 'generate_ai_recommendation' && (
                          <input
                            type="text"
                            value={act.aiFocus || ''}
                            onChange={(e) =>
                              setWfActions((prev) =>
                                prev.map((a, i) => (i === idx ? { ...a, aiFocus: e.target.value } : a))
                              )
                            }
                            placeholder="Focus prompt for AI recommendation note"
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        )}

                        {act.type === 'queue_owner_approval' && (
                          <input
                            type="text"
                            value={act.approvalSummary || ''}
                            onChange={(e) =>
                              setWfActions((prev) =>
                                prev.map((a, i) => (i === idx ? { ...a, approvalSummary: e.target.value } : a))
                              )
                            }
                            placeholder="Approval summary for owner sign-off queue"
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Prohibited Actions Reminder */}
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Blocked actions: {Array.from(WORKFLOW_PROHIBITED_ACTIONS).slice(0, 6).join(', ')} (enforced server-side with HTTP 422).
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowBuilder(false);
                    resetBuilder();
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
                >
                  {busy ? 'Saving...' : editingId ? 'Save Workflow Changes' : 'Create Workflow'}
                </button>
              </div>
            </form>
          )}

          {/* Dry-Run Preview Target Selector */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-white">Preview / Dry-Run Target Company:</strong> Select a CRM
              company to test any workflow rule without modifying records.
            </div>
            <select
              value={testLeadId}
              onChange={(e) => setTestLeadId(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white min-w-[220px]"
            >
              {leads.length === 0 ? (
                <option value="">No CRM companies available</option>
              ) : (
                leads.slice(0, 50).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName} ({l.address?.countryCode || l.address?.country || 'N/A'})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Dry-Run Preview Output */}
          {dryRunResult && (
            <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  {dryRunResult.dryRun ? 'Dry-Run Preview' : 'Manual Test Result'}: {dryRunResult.workflowName} &rarr;{' '}
                  {dryRunResult.companyName || dryRunResult.entityId}
                </div>
                <button
                  type="button"
                  onClick={() => setDryRunResult(null)}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  Close
                </button>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Status: <span className="font-mono font-semibold">{dryRunResult.status}</span> · Conditions Matched:{' '}
                <span className="font-mono">{dryRunResult.conditionsMatched ? 'YES' : 'NO'}</span>
              </div>
              {dryRunResult.conditionDetails.length > 0 && (
                <div className="text-[11px] text-slate-500 space-y-1">
                  {dryRunResult.conditionDetails.map((cd, i) => (
                    <div key={i} className="font-mono">
                      [{cd.passed ? 'PASS' : 'FAIL'}] {cd.field} {cd.operator} {JSON.stringify(cd.expected)} (actual:{' '}
                      {JSON.stringify(cd.actual)})
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                {dryRunResult.steps.map((st) => (
                  <div
                    key={st.stepIndex}
                    className="text-xs px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-2"
                  >
                    <span>
                      <strong className="font-mono">{st.actionType}:</strong> {st.summary}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">{st.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Workflow List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {!workspace || workspace.workflows.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Workflow className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  No Workflows Configured Yet
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Create your first rule-based workflow to automate follow-up tasks, tags, owner notifications, and
                  approval-gated CRM updates.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {workspace.workflows.map((wf) => (
                  <div key={wf.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{wf.name}</span>
                        <span
                          className={`text-[11px] font-mono ${
                            wf.enabled
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {wf.enabled ? 'Active' : 'Paused'}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          · {wf.trigger.type} &rarr; {wf.actions.map((a) => a.type).join(', ')}
                        </span>
                      </div>
                      {wf.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{wf.description}</p>
                      )}
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {wf.conditions.length} condition(s) ({wf.conditionLogic.toUpperCase()}) · {wf.stats.totalRuns}{' '}
                        runs · {wf.stats.completedRuns} completed · {wf.stats.failedRuns} failed ·{' '}
                        {wf.stats.awaitingApprovalRuns} awaiting approval · Limit {wf.maxRunsPerHour}/hr
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTestRun(wf, true)}
                        disabled={busy || leads.length === 0}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Dry-Run</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTestRun(wf, false)}
                        disabled={busy || leads.length === 0}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-40"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Run Now</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleWorkflow(wf)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{wf.enabled ? 'Disable' : 'Enable'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditBuilder(wf)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg"
                        title="Edit workflow"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteWorkflow(wf)}
                        disabled={busy}
                        className="p-1.5 text-slate-500 hover:text-red-600 border border-slate-200 dark:border-slate-700 rounded-lg"
                        title="Delete workflow"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 2: EXECUTION HISTORY & RETRY RECOVERY                      */}
      {/* ================================================================== */}
      {subTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Workflow Execution Ledger ({filteredExecutions.length})
            </h3>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="partial_failure">Partial Failure</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>

          {filteredExecutions.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No workflow executions recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {filteredExecutions.map((ex) => (
                <div
                  key={ex.id}
                  className="border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white">{ex.workflowName}</span>
                      <span className="text-slate-400 font-mono ml-2">
                        {ex.triggerType} · {ex.companyName || ex.entityId}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <span
                        className={
                          ex.status === 'completed'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : ex.status === 'failed' || ex.status === 'partial_failure'
                            ? 'text-red-600 dark:text-red-400 font-semibold'
                            : ex.status === 'awaiting_approval'
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-slate-500'
                        }
                      >
                        {ex.status}
                      </span>
                      <span className="text-slate-400 tabular-nums">{ex.durationMs}ms</span>
                      <span className="text-slate-400">{new Date(ex.startedAt).toLocaleString()}</span>
                      {(ex.status === 'failed' || ex.status === 'partial_failure') && (
                        <button
                          type="button"
                          onClick={() => handleRetryExecution(ex.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-sans"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry Failed</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {ex.error && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Details: {ex.error}</p>
                  )}

                  {ex.steps.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {ex.steps.map((s) => (
                        <div
                          key={s.stepIndex}
                          className="text-[11px] flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-slate-50 dark:bg-slate-800/50"
                        >
                          <span className="text-slate-700 dark:text-slate-300">
                            <span className="font-mono text-slate-500">#{s.stepIndex + 1} {s.actionType}:</span>{' '}
                            {s.summary}
                            {s.error ? ` (Error: ${s.error})` : ''}
                          </span>
                          <span className="font-mono text-slate-500 shrink-0">{s.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 3: PENDING APPROVALS & OWNER NOTIFICATIONS                 */}
      {/* ================================================================== */}
      {subTab === 'approvals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pending Approvals */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Workflow Steps Awaiting Owner Approval ({pendingApprovals.length})
            </h3>
            {pendingApprovals.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No workflow actions awaiting approval.</p>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map(({ execution, step }) => (
                  <div
                    key={`${execution.id}-${step.stepIndex}`}
                    className="border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-2.5"
                  >
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {execution.workflowName} &middot; {execution.companyName || execution.entityId}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-1">{step.summary}</p>
                      <div className="text-[11px] font-mono text-slate-400 mt-1">
                        Action: {step.actionType} · Queued {new Date(execution.startedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleApproveStep(execution.id, step.stepIndex, 'approve')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve &amp; Apply</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApproveStep(execution.id, step.stepIndex, 'reject')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Owner Notifications */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-slate-400" />
              <span>Owner Workflow Notifications ({workspace?.notifications.length || 0})</span>
            </h3>
            {!workspace || workspace.notifications.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No workflow notifications recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[460px] overflow-y-auto">
                {workspace.notifications.map((n) => (
                  <div key={n.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="text-xs min-w-0">
                      <div className={`font-semibold ${n.read ? 'text-slate-500' : 'text-slate-900 dark:text-white'}`}>
                        {n.title}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">{n.message}</p>
                      <div className="text-[11px] text-slate-400 mt-1 font-mono">
                        {n.workflowName} · {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => handleMarkNotificationRead(n.id)}
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
