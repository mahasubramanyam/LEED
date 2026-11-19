import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Briefcase,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Lock,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Sliders,
  Tag,
  Trash2,
  User,
  History,
  AlertCircle,
} from 'lucide-react';
import {
  CompanyRelationshipProfile,
  CrmInteractionType,
  CrmNoteCategory,
  CrmRelationshipStatus,
  PipelineStage,
} from '../types.ts';
import {
  CRM_INTERACTION_TYPES,
  CRM_NOTE_CATEGORIES,
  CRM_OPPORTUNITY_STATUSES,
  CRM_RELATIONSHIP_STATUSES,
  CRM_TASK_CATEGORIES,
  CRM_TASK_STATUSES,
  getInteractionTypeLabel,
  getNoteCategoryLabel,
  getOpportunityStatusLabel,
  getRelationshipStatusLabel,
  getTaskStatusLabel,
} from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface CompanyRelationshipPanelProps {
  leadId: string;
  stages: PipelineStage[];
  onOpenPersonProfile?: (personId: string) => void;
  onDataMutated?: () => void;
}

export const CompanyRelationshipPanel: React.FC<CompanyRelationshipPanelProps> = ({
  leadId,
  stages,
  onOpenPersonProfile,
  onDataMutated,
}) => {
  const [profile, setProfile] = useState<CompanyRelationshipProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<'overview' | 'timeline' | 'notes' | 'opportunities' | 'tasks'>('overview');

  // Relationship settings state
  const [relStatus, setRelStatus] = useState<CrmRelationshipStatus>('new');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [overrideLevel, setOverrideLevel] = useState<string>('');
  const [ownerAnnotation, setOwnerAnnotation] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Interaction composer state
  const [intType, setIntType] = useState<CrmInteractionType>('phone_call');
  const [intCustomLabel, setIntCustomLabel] = useState('');
  const [intPersonId, setIntPersonId] = useState('');
  const [intOccurredAt, setIntOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [intSummary, setIntSummary] = useState('');
  const [intNotes, setIntNotes] = useState('');
  const [intOutcome, setIntOutcome] = useState('');
  const [intNextAction, setIntNextAction] = useState('');
  const [intFollowUp, setIntFollowUp] = useState('');
  const [intFilterType, setIntFilterType] = useState('all');
  const [savingInt, setSavingInt] = useState(false);

  // Private note composer state
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState<CrmNoteCategory>('relationship');
  const [noteTags, setNoteTags] = useState('');
  const [notePinned, setNotePinned] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Opportunity composer state
  const [oppTitle, setOppTitle] = useState('');
  const [oppValue, setOppValue] = useState('');
  const [oppCurrency, setOppCurrency] = useState('USD');
  const [oppStageId, setOppStageId] = useState('');
  const [oppProb, setOppProb] = useState('35');
  const [oppCloseDate, setOppCloseDate] = useState('');
  const [oppPersonId, setOppPersonId] = useState('');
  const [oppNextAction, setOppNextAction] = useState('');
  const [oppDesc, setOppDesc] = useState('');
  const [savingOpp, setSavingOpp] = useState(false);
  const [expandedOppHistoryId, setExpandedOppHistoryId] = useState<string | null>(null);

  // Task composer state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState(() => new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10));
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [taskCategory, setTaskCategory] = useState<string>('follow_up');
  const [taskPersonId, setTaskPersonId] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/crm/company/${leadId}/profile`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to load relationship profile');
      }
      const data: CompanyRelationshipProfile = await res.json();
      setProfile(data);
      setRelStatus(data.relationshipMeta.relationshipStatus);
      setNextFollowUp(data.relationshipMeta.nextFollowUpDate ? data.relationshipMeta.nextFollowUpDate.slice(0, 10) : '');
      setReviewDate(data.relationshipMeta.scheduledReviewDate ? data.relationshipMeta.scheduledReviewDate.slice(0, 10) : '');
      setTagsInput((data.relationshipMeta.tags || []).join(', '));
      setOverrideLevel(data.relationshipMeta.ownerOverrideLevel || '');
      setOwnerAnnotation(data.relationshipMeta.ownerAnnotation || '');
      setOppCurrency(data.lead.currency || 'USD');
      setOppStageId(data.lead.pipelineStageId || stages[0]?.id || 'stage-new');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load relationship profile');
    } finally {
      setLoading(false);
    }
  }, [leadId, stages]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSaveRelationshipMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMeta(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await apiFetch(`/api/crm/company/${leadId}/relationship`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipStatus: relStatus,
          nextFollowUpDate: nextFollowUp ? `${nextFollowUp}T09:00:00.000Z` : '',
          scheduledReviewDate: reviewDate ? `${reviewDate}T09:00:00.000Z` : '',
          tags,
          ownerOverrideLevel: overrideLevel || '',
          ownerAnnotation,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (updated?.lead) setProfile(updated);
        else await loadProfile();
        onDataMutated?.();
      }
    } finally {
      setSavingMeta(false);
    }
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intSummary.trim()) return;
    setSavingInt(true);
    try {
      const res = await apiFetch('/api/crm/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          personId: intPersonId || undefined,
          type: intType,
          customTypeLabel: intType === 'custom' ? intCustomLabel : undefined,
          occurredAt: intOccurredAt ? new Date(intOccurredAt).toISOString() : undefined,
          summary: intSummary.trim(),
          detailedNotes: intNotes.trim() || undefined,
          outcome: intOutcome.trim() || undefined,
          nextAction: intNextAction.trim() || undefined,
          followUpDate: intFollowUp ? `${intFollowUp}T09:00:00.000Z` : undefined,
        }),
      });
      if (res.ok) {
        setIntSummary('');
        setIntNotes('');
        setIntOutcome('');
        setIntNextAction('');
        setIntFollowUp('');
        await loadProfile();
        onDataMutated?.();
      }
    } finally {
      setSavingInt(false);
    }
  };

  const handleDeleteInteraction = async (id: string) => {
    const res = await apiFetch(`/api/crm/interactions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadProfile();
      onDataMutated?.();
    }
  };

  const handleAddPrivateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      const res = await apiFetch('/api/crm/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'company',
          leadId,
          title: noteTitle.trim() || undefined,
          content: noteContent.trim(),
          category: noteCategory,
          tags: noteTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          pinned: notePinned,
        }),
      });
      if (res.ok) {
        setNoteTitle('');
        setNoteContent('');
        setNoteTags('');
        setNotePinned(false);
        await loadProfile();
      }
    } finally {
      setSavingNote(false);
    }
  };

  const handleTogglePinNote = async (id: string, pinned: boolean) => {
    const res = await apiFetch(`/api/crm/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !pinned }),
    });
    if (res.ok) await loadProfile();
  };

  const handleDeleteNote = async (id: string) => {
    const res = await apiFetch(`/api/crm/notes/${id}`, { method: 'DELETE' });
    if (res.ok) await loadProfile();
  };

  const handleCreateOpportunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oppTitle.trim()) return;
    setSavingOpp(true);
    try {
      const res = await apiFetch('/api/crm/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          personId: oppPersonId || undefined,
          title: oppTitle.trim(),
          description: oppDesc.trim() || undefined,
          estimatedValue: Number(oppValue) || 0,
          currency: oppCurrency || 'USD',
          pipelineStageId: oppStageId || stages[0]?.id,
          probability: Number(oppProb) || 30,
          expectedCloseDate: oppCloseDate ? `${oppCloseDate}T12:00:00.000Z` : undefined,
          nextAction: oppNextAction.trim() || undefined,
        }),
      });
      if (res.ok) {
        setOppTitle('');
        setOppValue('');
        setOppDesc('');
        setOppNextAction('');
        setOppCloseDate('');
        await loadProfile();
        onDataMutated?.();
      }
    } finally {
      setSavingOpp(false);
    }
  };

  const handleUpdateOppStageOrStatus = async (
    oppId: string,
    patch: { pipelineStageId?: string; status?: 'open' | 'won' | 'lost' | 'on_hold' }
  ) => {
    const res = await apiFetch(`/api/crm/opportunities/${oppId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await loadProfile();
      onDataMutated?.();
    }
  };

  const handleDeleteOpp = async (oppId: string) => {
    const res = await apiFetch(`/api/crm/opportunities/${oppId}`, { method: 'DELETE' });
    if (res.ok) {
      await loadProfile();
      onDataMutated?.();
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          personId: taskPersonId || undefined,
          title: taskTitle.trim(),
          dueDate: taskDue ? `${taskDue}T09:00:00.000Z` : new Date(Date.now() + 86400000 * 2).toISOString(),
          priority: taskPriority,
          category: taskCategory,
          status: 'pending',
          completed: false,
        }),
      });
      if (res.ok) {
        setTaskTitle('');
        await loadProfile();
        onDataMutated?.();
      }
    } finally {
      setSavingTask(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: string) => {
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, completed: status === 'completed' }),
    });
    if (res.ok) {
      await loadProfile();
      onDataMutated?.();
    }
  };

  if (loading && !profile) {
    return (
      <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading unified company relationship profile...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-6 rounded-xl border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300 flex items-center justify-between">
        <span>{error || 'Profile unavailable'}</span>
        <button onClick={loadProfile} className="px-3 py-1 bg-slate-800 rounded text-white hover:bg-slate-700">
          Retry
        </button>
      </div>
    );
  }

  const { engagement, decisionMakers, interactions, privateNotes, tasks, opportunities } = profile;

  const filteredInteractions = interactions.filter(
    (i) => intFilterType === 'all' || i.type === intFilterType
  );
  const filteredNotes = privateNotes.filter((n) => {
    if (!noteSearch.trim()) return true;
    const q = noteSearch.trim().toLowerCase();
    return (
      n.content.toLowerCase().includes(q) ||
      (n.title && n.title.toLowerCase().includes(q)) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-5">
      {/* Top Relationship Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60">
          <div className="text-[11px] text-slate-400">Relationship Status</div>
          <div className="mt-1 text-sm font-semibold text-white">
            {getRelationshipStatusLabel(profile.relationshipMeta.relationshipStatus)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {decisionMakers.length} decision-maker(s) linked
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60">
          <div className="text-[11px] text-slate-400">Derived Engagement</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white capitalize">
              {engagement.effectiveLevel}
            </span>
            <span className="text-xs font-mono text-indigo-400">{engagement.score}/100</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {engagement.ownerOverrideLevel ? 'Owner override active' : 'Derived from CRM activity'}
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60">
          <div className="text-[11px] text-slate-400">Last Interaction</div>
          <div className="mt-1 text-sm font-semibold text-white">
            {profile.lastInteractionAt
              ? new Date(profile.lastInteractionAt).toLocaleDateString()
              : 'None logged'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {interactions.length} manual record(s)
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60">
          <div className="text-[11px] text-slate-400">Next Planned Action</div>
          <div className="mt-1 text-sm font-semibold text-white truncate">
            {profile.nextPlannedInteractionAt
              ? new Date(profile.nextPlannedInteractionAt).toLocaleDateString()
              : 'Not scheduled'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 truncate" title={profile.nextPlannedSummary}>
            {profile.nextPlannedSummary || 'Set a follow-up or task'}
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-2.5">
        {[
          { id: 'overview', label: 'Relationship & Engagement', icon: Sliders },
          { id: 'timeline', label: `Interactions (${interactions.length})`, icon: Activity },
          { id: 'notes', label: `Private Notes (${privateNotes.length})`, icon: Lock },
          { id: 'opportunities', label: `Opportunities (${opportunities.length})`, icon: Briefcase },
          { id: 'tasks', label: `Tasks & Follow-Ups (${tasks.length})`, icon: CheckSquare },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = section === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSection(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION 1: OVERVIEW, SETTINGS & TRANSPARENT DERIVED ENGAGEMENT */}
      {section === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Relationship Status & Owner Override Form */}
          <form onSubmit={handleSaveRelationshipMeta} className="lg:col-span-6 space-y-3.5 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">Relationship Controls</h4>
              <span className="text-[11px] text-slate-500">Owner-only settings</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Relationship Status</label>
                <select
                  value={relStatus}
                  onChange={(e) => setRelStatus(e.target.value as CrmRelationshipStatus)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {CRM_RELATIONSHIP_STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Owner Engagement Override</label>
                <select
                  value={overrideLevel}
                  onChange={(e) => setOverrideLevel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="">Use Derived Score ({engagement.level})</option>
                  <option value="strong">Override: Strong</option>
                  <option value="active">Override: Active</option>
                  <option value="developing">Override: Developing</option>
                  <option value="cooling">Override: Cooling</option>
                  <option value="inactive">Override: Inactive</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Next Follow-Up Date</label>
                <input
                  type="date"
                  value={nextFollowUp}
                  onChange={(e) => setNextFollowUp(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Scheduled Relationship Review</label>
                <input
                  type="date"
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Relationship Tags (comma-separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. strategic, nordics, warm-intro"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Owner Relationship Annotation</label>
              <textarea
                rows={2}
                value={ownerAnnotation}
                onChange={(e) => setOwnerAnnotation(e.target.value)}
                placeholder="Context on why this relationship matters or override rationale..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingMeta}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {savingMeta ? 'Saving...' : 'Save Relationship Settings'}
              </button>
            </div>
          </form>

          {/* Right: Transparent Derived Engagement Breakdown + Linked People */}
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-white">Engagement Assessment (Derived)</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">{engagement.transparencyLabel}</p>
                </div>
                <span className="text-sm font-mono font-bold text-indigo-400 shrink-0">
                  {engagement.score}/100
                </span>
              </div>

              <div className="space-y-2">
                {engagement.factors.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-medium">{f.label}</span>
                      <span className="font-mono text-slate-400">
                        {f.points}/{f.maxPoints}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${Math.round((f.points / Math.max(1, f.maxPoints)) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">{f.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Linked Decision-Makers quick jump */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-semibold text-white">Linked Decision-Makers</h4>
              {decisionMakers.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No people linked yet. Add or discover decision-makers in the Decision-Makers tab.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {decisionMakers.map(({ person, relationship }) => (
                    <div key={relationship.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {person.fullName}
                          {relationship.isPrimaryContact && (
                            <span className="ml-2 text-[10px] text-amber-400">· Primary Contact</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {[relationship.jobTitle || relationship.designation || person.decisionMakingFunction, person.email].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {onOpenPersonProfile && (
                        <button
                          onClick={() => onOpenPersonProfile(person.id)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 shrink-0"
                        >
                          Relationship Profile
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: MANUAL INTERACTION & COMMUNICATION TIMELINE */}
      {section === 'timeline' && (
        <div className="space-y-4">
          <form onSubmit={handleAddInteraction} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="text-xs font-semibold text-white">Log Manual Interaction</h4>
              <span className="text-[11px] text-slate-400">
                Manual record only — LEED does not automatically send emails or messages here
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Interaction Type</label>
                <select
                  value={intType}
                  onChange={(e) => setIntType(e.target.value as CrmInteractionType)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {CRM_INTERACTION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Date &amp; Time</label>
                <input
                  type="datetime-local"
                  value={intOccurredAt}
                  onChange={(e) => setIntOccurredAt(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Person (Optional)</label>
                <select
                  value={intPersonId}
                  onChange={(e) => setIntPersonId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="">Company-wide interaction</option>
                  {decisionMakers.map(({ person, relationship }) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName} {relationship.jobTitle ? `(${relationship.jobTitle})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {intType === 'custom' && (
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Custom Interaction Label</label>
                <input
                  type="text"
                  value={intCustomLabel}
                  onChange={(e) => setIntCustomLabel(e.target.value)}
                  placeholder="e.g. Trade Show Booth Conversation"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Summary *</label>
              <input
                type="text"
                required
                value={intSummary}
                onChange={(e) => setIntSummary(e.target.value)}
                placeholder="e.g. Introductory call discussing Q3 supply partnership"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Outcome</label>
                <input
                  type="text"
                  value={intOutcome}
                  onChange={(e) => setIntOutcome(e.target.value)}
                  placeholder="e.g. Positive — requested pricing sheet"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Next Action</label>
                <input
                  type="text"
                  value={intNextAction}
                  onChange={(e) => setIntNextAction(e.target.value)}
                  placeholder="e.g. Prepare custom proposal"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Follow-Up Date</label>
                <input
                  type="date"
                  value={intFollowUp}
                  onChange={(e) => setIntFollowUp(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Detailed Notes</label>
              <textarea
                rows={2}
                value={intNotes}
                onChange={(e) => setIntNotes(e.target.value)}
                placeholder="Key takeaways, stakeholder concerns, pricing context..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingInt}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingInt ? 'Recording...' : 'Record Interaction'}
              </button>
            </div>
          </form>

          {/* Timeline Filter + Chronological List */}
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-white">Chronological Timeline ({filteredInteractions.length})</h4>
            <select
              value={intFilterType}
              onChange={(e) => setIntFilterType(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-300"
            >
              <option value="all">All Types</option>
              {CRM_INTERACTION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {filteredInteractions.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No interactions recorded yet for this filter.
            </div>
          ) : (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950/40">
              {filteredInteractions.map((item) => {
                const linkedPerson = decisionMakers.find((d) => d.person.id === item.personId)?.person;
                return (
                  <div key={item.id} className="p-3.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-white">{item.summary}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          <span className="text-indigo-400 font-medium">
                            {item.type === 'custom' && item.customTypeLabel
                              ? item.customTypeLabel
                              : getInteractionTypeLabel(item.type)}
                          </span>
                          {' · '}
                          <span>{new Date(item.occurredAt).toLocaleString()}</span>
                          {' · '}
                          <span>Manual Record</span>
                          {linkedPerson && (
                            <>
                              {' · '}
                              <button
                                onClick={() => onOpenPersonProfile?.(linkedPerson.id)}
                                className="text-slate-200 hover:text-indigo-400 underline"
                              >
                                {linkedPerson.fullName}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteInteraction(item.id)}
                        className="p-1 text-slate-500 hover:text-rose-400"
                        title="Delete interaction"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {item.detailedNotes && (
                      <p className="text-xs text-slate-300 whitespace-pre-wrap">{item.detailedNotes}</p>
                    )}
                    {(item.outcome || item.nextAction || item.followUpDate) && (
                      <div className="text-[11px] text-slate-400 pt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {item.outcome && (
                          <span>
                            <strong className="text-slate-300">Outcome:</strong> {item.outcome}
                          </span>
                        )}
                        {item.nextAction && (
                          <span>
                            <strong className="text-slate-300">Next Action:</strong> {item.nextAction}
                          </span>
                        )}
                        {item.followUpDate && (
                          <span className="text-amber-400">
                            Follow-up: {new Date(item.followUpDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: PRIVATE OWNER-ONLY NOTES */}
      {section === 'notes' && (
        <div className="space-y-4">
          <form onSubmit={handleAddPrivateNote} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                Add Private Owner-Only Note
              </h4>
              <span className="text-[11px] text-slate-500">Strictly owner-private · Never public</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Optional note title..."
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
              <select
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value as CrmNoteCategory)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                {CRM_NOTE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={noteTags}
                onChange={(e) => setNoteTags(e.target.value)}
                placeholder="Tags (comma-separated)"
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <textarea
              rows={3}
              required
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Write private relationship intelligence, negotiation nuances, or reminders..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
            />

            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notePinned}
                  onChange={(e) => setNotePinned(e.target.checked)}
                  className="rounded border-slate-700"
                />
                Pin to top of company profile
              </label>
              <button
                type="submit"
                disabled={savingNote}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingNote ? 'Saving...' : 'Save Private Note'}
              </button>
            </div>
          </form>

          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-white">Saved Notes ({filteredNotes.length})</h4>
            <input
              type="text"
              value={noteSearch}
              onChange={(e) => setNoteSearch(e.target.value)}
              placeholder="Filter notes by keyword or tag..."
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white w-56"
            />
          </div>

          {filteredNotes.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No private notes match your filter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  className={`p-3.5 rounded-xl border ${
                    note.pinned
                      ? 'border-amber-500/40 bg-amber-950/10'
                      : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                        {note.pinned && <Pin className="w-3 h-3 text-amber-400" />}
                        <span>{note.title || getNoteCategoryLabel(note.category)}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {getNoteCategoryLabel(note.category)} · {new Date(note.updatedAt).toLocaleString()}
                        {note.tags.length > 0 && ` · #${note.tags.join(' #')}`}
                      </div>
                    </div>
                    {!note.id.startsWith('legacy-note-') && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleTogglePinNote(note.id, note.pinned)}
                          className={`p-1 rounded ${
                            note.pinned ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'
                          }`}
                          title={note.pinned ? 'Unpin note' : 'Pin note'}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="p-1 text-slate-500 hover:text-rose-400"
                          title="Delete note"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-200 mt-2 whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 4: MULTIPLE OPPORTUNITIES PER COMPANY */}
      {section === 'opportunities' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateOpportunity} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-semibold text-white">Create Opportunity for This Company</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-slate-400 mb-1">Opportunity Title *</label>
                <input
                  type="text"
                  required
                  value={oppTitle}
                  onChange={(e) => setOppTitle(e.target.value)}
                  placeholder="e.g. 2027 Annual Distribution Agreement"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Decision-Maker</label>
                <select
                  value={oppPersonId}
                  onChange={(e) => setOppPersonId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="">Company-wide</option>
                  {decisionMakers.map(({ person }) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Estimated Value</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min="0"
                    value={oppValue}
                    onChange={(e) => setOppValue(e.target.value)}
                    placeholder="25000"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    maxLength={3}
                    value={oppCurrency}
                    onChange={(e) => setOppCurrency(e.target.value.toUpperCase())}
                    className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono text-center"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Pipeline Stage</label>
                <select
                  value={oppStageId}
                  onChange={(e) => setOppStageId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Prob. %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={oppProb}
                    onChange={(e) => setOppProb(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Est. Close</label>
                  <input
                    type="date"
                    value={oppCloseDate}
                    onChange={(e) => setOppCloseDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={oppNextAction}
                onChange={(e) => setOppNextAction(e.target.value)}
                placeholder="Next commercial action..."
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
              <input
                type="text"
                value={oppDesc}
                onChange={(e) => setOppDesc(e.target.value)}
                placeholder="Brief deal scope / description..."
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingOpp}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingOpp ? 'Creating...' : 'Add Opportunity'}
              </button>
            </div>
          </form>

          {opportunities.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No opportunities tracked for this company yet. You can track multiple parallel deals per company.
            </div>
          ) : (
            <div className="space-y-3">
              {opportunities.map((opp) => {
                const stage = stages.find((s) => s.id === opp.pipelineStageId);
                const person = decisionMakers.find((d) => d.person.id === opp.personId)?.person;
                const isHistoryOpen = expandedOppHistoryId === opp.id;
                return (
                  <div key={opp.id} className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-2.5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-xs font-bold text-white">{opp.title}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          <span className="font-mono text-emerald-400 font-semibold">
                            {opp.currency} {opp.estimatedValue.toLocaleString()}
                          </span>
                          {' · '}
                          <span>{opp.probability}% probability</span>
                          {' · '}
                          <span>Status: {getOpportunityStatusLabel(opp.status)}</span>
                          {opp.expectedCloseDate && ` · Close: ${new Date(opp.expectedCloseDate).toLocaleDateString()}`}
                          {person && ` · Contact: ${person.fullName}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={opp.pipelineStageId}
                          onChange={(e) => handleUpdateOppStageOrStatus(opp.id, { pipelineStageId: e.target.value })}
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white"
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={opp.status}
                          onChange={(e) =>
                            handleUpdateOppStageOrStatus(opp.id, { status: e.target.value as any })
                          }
                          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white"
                        >
                          {CRM_OPPORTUNITY_STATUSES.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => setExpandedOppHistoryId(isHistoryOpen ? null : opp.id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 inline-flex items-center gap-1"
                        >
                          <History className="w-3 h-3" />
                          History ({opp.stageHistory.length})
                        </button>
                        <button
                          onClick={() => handleDeleteOpp(opp.id)}
                          className="p-1 text-slate-500 hover:text-rose-400"
                          title="Delete opportunity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {opp.description && <p className="text-xs text-slate-300">{opp.description}</p>}
                    {opp.nextAction && (
                      <div className="text-[11px] text-slate-400">
                        <strong className="text-slate-300">Next Action:</strong> {opp.nextAction}
                      </div>
                    )}
                    {isHistoryOpen && (
                      <div className="pt-2 border-t border-slate-800 space-y-1">
                        <div className="text-[11px] font-semibold text-slate-300">
                          Stage Transition History ({stage?.name || opp.pipelineStageId})
                        </div>
                        {opp.stageHistory.map((ch) => (
                          <div key={ch.id} className="text-[11px] text-slate-400">
                            {new Date(ch.changedAt).toLocaleString()} ·{' '}
                            {ch.fromStageName ? `${ch.fromStageName} → ${ch.toStageName}` : ch.toStageName}
                            {ch.reason ? ` (${ch.reason})` : ''} · by {ch.changedBy}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 5: LINKED FOLLOW-UP TASKS */}
      {section === 'tasks' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateTask} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-semibold text-white">Add Follow-Up Task for This Company</h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input
                type="text"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Send revised commercial terms"
                className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
              <input
                type="date"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
              <select
                value={taskPriority}
                onChange={(e) => setTaskPriority(e.target.value as any)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
              <select
                value={taskCategory}
                onChange={(e) => setTaskCategory(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                {CRM_TASK_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={taskPersonId}
                onChange={(e) => setTaskPersonId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                <option value="">Company-level task</option>
                {decisionMakers.map(({ person }) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </select>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingTask}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {savingTask ? 'Adding...' : 'Add Task'}
                </button>
              </div>
            </div>
          </form>

          {tasks.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No tasks linked to this company yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950/40">
              {tasks.map((t) => {
                const person = decisionMakers.find((d) => d.person.id === t.personId)?.person;
                return (
                  <div key={t.id} className="p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`text-xs font-medium ${t.completed ? 'line-through text-slate-500' : 'text-white'}`}>
                        {t.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Due {new Date(t.dueDate).toLocaleDateString()} · Priority: {t.priority} ·{' '}
                        {getTaskStatusLabel(t.status)}
                        {person && ` · ${person.fullName}`}
                      </div>
                    </div>
                    <select
                      value={t.status || (t.completed ? 'completed' : 'pending')}
                      onChange={(e) => handleUpdateTaskStatus(t.id, e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white shrink-0"
                    >
                      {CRM_TASK_STATUSES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
