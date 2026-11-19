import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Briefcase,
  Building2,
  CheckSquare,
  Lock,
  Mail,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  User,
  X,
  Bot,
  Send,
} from 'lucide-react';
import {
  AiAgentLaunchContext,
  OutreachLaunchContext,
  CrmInteractionType,
  CrmNoteCategory,
  CrmRelationshipStatus,
  PersonRelationshipProfile,
} from '../types.ts';
import {
  CRM_INTERACTION_TYPES,
  CRM_NOTE_CATEGORIES,
  CRM_RELATIONSHIP_STATUSES,
  CRM_TASK_STATUSES,
  getInteractionTypeLabel,
  getNoteCategoryLabel,
  getOpportunityStatusLabel,
  getRelationshipStatusLabel,
  getTaskStatusLabel,
} from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface PersonRelationshipDrawerProps {
  personId: string;
  onClose: () => void;
  onOpenCompany?: (leadId: string) => void;
  onOpenAiAgent?: (ctx: AiAgentLaunchContext) => void;
  onOpenOutreach?: (ctx: OutreachLaunchContext) => void;
  onDataMutated?: () => void;
}

export const PersonRelationshipDrawer: React.FC<PersonRelationshipDrawerProps> = ({
  personId,
  onClose,
  onOpenCompany,
  onOpenAiAgent,
  onOpenOutreach,
  onDataMutated,
}) => {
  const [profile, setProfile] = useState<PersonRelationshipProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'interactions' | 'notes' | 'tasks' | 'opportunities'>('overview');

  // Meta editor
  const [relStatus, setRelStatus] = useState<CrmRelationshipStatus>('new');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [overrideLevel, setOverrideLevel] = useState('');
  const [ownerAnnotation, setOwnerAnnotation] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Interaction composer
  const [intType, setIntType] = useState<CrmInteractionType>('phone_call');
  const [intLeadId, setIntLeadId] = useState('');
  const [intSummary, setIntSummary] = useState('');
  const [intNotes, setIntNotes] = useState('');
  const [intOutcome, setIntOutcome] = useState('');
  const [intNextAction, setIntNextAction] = useState('');
  const [intFollowUp, setIntFollowUp] = useState('');
  const [savingInt, setSavingInt] = useState(false);

  // Note composer
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState<CrmNoteCategory>('personal_context');
  const [noteTags, setNoteTags] = useState('');
  const [notePinned, setNotePinned] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  // Task composer
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState(() => new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10));
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [savingTask, setSavingTask] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/crm/person/${personId}/profile`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to load person relationship profile');
      }
      const data: PersonRelationshipProfile = await res.json();
      setProfile(data);
      setRelStatus(data.relationshipMeta.relationshipStatus);
      setNextFollowUp(data.relationshipMeta.nextFollowUpDate ? data.relationshipMeta.nextFollowUpDate.slice(0, 10) : '');
      setReviewDate(data.relationshipMeta.scheduledReviewDate ? data.relationshipMeta.scheduledReviewDate.slice(0, 10) : '');
      setTagsInput((data.relationshipMeta.tags || []).join(', '));
      setOverrideLevel(data.relationshipMeta.ownerOverrideLevel || '');
      setOwnerAnnotation(data.relationshipMeta.ownerAnnotation || '');
      setIntLeadId(data.currentCompanies[0]?.company?.id || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load person profile');
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMeta(true);
    try {
      const res = await apiFetch(`/api/crm/person/${personId}/relationship`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipStatus: relStatus,
          nextFollowUpDate: nextFollowUp ? `${nextFollowUp}T09:00:00.000Z` : '',
          scheduledReviewDate: reviewDate ? `${reviewDate}T09:00:00.000Z` : '',
          tags: tagsInput
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          ownerOverrideLevel: overrideLevel || '',
          ownerAnnotation,
        }),
      });
      if (res.ok) {
        await loadProfile();
        onDataMutated?.();
      }
    } finally {
      setSavingMeta(false);
    }
  };

  const handleLogInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intSummary.trim()) return;
    setSavingInt(true);
    try {
      const res = await apiFetch('/api/crm/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId,
          leadId: intLeadId || undefined,
          type: intType,
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

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      const res = await apiFetch('/api/crm/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'person',
          personId,
          leadId: profile?.currentCompanies[0]?.company?.id,
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

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: profile?.currentCompanies[0]?.company?.id || '',
          personId,
          title: taskTitle.trim(),
          dueDate: taskDue ? `${taskDue}T09:00:00.000Z` : new Date(Date.now() + 86400000 * 2).toISOString(),
          priority: taskPriority,
          category: 'follow_up',
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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-3xl bg-slate-900 border-l border-slate-800 h-full flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-indigo-400 shrink-0" />
              <h2 className="text-base font-bold text-white truncate">
                {profile?.person.fullName || 'Person Relationship Profile'}
              </h2>
            </div>
            {profile && (
              <div className="text-xs text-slate-400 mt-1 truncate">
                {[
                  profile.currentCompanies[0]?.relationship.jobTitle ||
                    profile.currentCompanies[0]?.relationship.designation ||
                    profile.person.decisionMakingFunction,
                  profile.currentCompanies[0]?.relationship.department || profile.person.seniority,
                  profile.currentCompanies[0]?.company?.companyName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenAiAgent && profile && (
              <>
                <button
                  onClick={() =>
                    onOpenAiAgent({
                      tab: 'meeting_prep',
                      personId: profile.person.id,
                      leadId: profile.currentCompanies[0]?.company?.id,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Bot className="w-3.5 h-3.5" />
                  AI Prep
                </button>
                <button
                  onClick={() =>
                    onOpenAiAgent({
                      tab: 'drafting',
                      personId: profile.person.id,
                      leadId: profile.currentCompanies[0]?.company?.id,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 text-xs font-medium whitespace-nowrap"
                >
                  AI Draft
                </button>
              </>
            )}
            {onOpenOutreach && profile && (
              <button
                onClick={() =>
                  onOpenOutreach({
                    personId: profile.person.id,
                    leadId: profile.currentCompanies[0]?.company?.id,
                    tab: 'campaigns',
                  })
                }
                className="px-2.5 py-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                Outreach
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              title="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && !profile ? (
            <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading person relationship profile...
            </div>
          ) : error || !profile ? (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300">
              {error || 'Unable to load person profile.'}
            </div>
          ) : (
            <>
              {/* Contact & Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="text-[11px] text-slate-400">Status</div>
                  <div className="text-xs font-semibold text-white mt-1">
                    {getRelationshipStatusLabel(profile.relationshipMeta.relationshipStatus)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="text-[11px] text-slate-400">Derived Engagement</div>
                  <div className="text-xs font-semibold text-white mt-1 capitalize">
                    {profile.engagement.effectiveLevel} ·{' '}
                    <span className="font-mono text-indigo-400">{profile.engagement.score}/100</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="text-[11px] text-slate-400">Last Contact</div>
                  <div className="text-xs font-semibold text-white mt-1">
                    {profile.lastContactDate ? new Date(profile.lastContactDate).toLocaleDateString() : 'None'}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <div className="text-[11px] text-slate-400">Next Follow-Up</div>
                  <div className="text-xs font-semibold text-white mt-1">
                    {profile.nextFollowUpDate ? new Date(profile.nextFollowUpDate).toLocaleDateString() : 'Unscheduled'}
                  </div>
                </div>
              </div>

              {/* Direct Professional Contact Info */}
              <div className="text-xs text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
                {profile.person.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span>{profile.person.email}</span>
                    <span className="text-[10px] text-slate-500">({profile.person.emailStatus || 'unverified'})</span>
                  </span>
                )}
                {profile.person.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    <span>{profile.person.phone}</span>
                  </span>
                )}
                {profile.person.decisionMakingFunction && (
                  <span className="text-slate-400">
                    Function: <strong className="text-slate-200">{profile.person.decisionMakingFunction.replace(/_/g, ' ')}</strong>
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-2.5">
                {[
                  { id: 'overview', label: 'Companies & Profile' },
                  { id: 'interactions', label: `Interactions (${profile.interactions.length})` },
                  { id: 'notes', label: `Private Notes (${profile.privateNotes.length})` },
                  { id: 'tasks', label: `Tasks (${profile.tasks.length})` },
                  { id: 'opportunities', label: `Opportunities (${profile.opportunities.length})` },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      tab === t.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* OVERVIEW TAB */}
              {tab === 'overview' && (
                <div className="space-y-4">
                  {/* Current & Historical Companies (M:N) */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                      Current &amp; Historical Company Relationships
                    </h4>

                    {profile.currentCompanies.length === 0 && profile.historicalCompanies.length === 0 ? (
                      <p className="text-xs text-slate-500">No linked company records yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {profile.currentCompanies.map(({ relationship, company }) => (
                          <div
                            key={relationship.id}
                            className="p-2.5 rounded-lg border border-slate-800 bg-slate-900/60 flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="text-xs font-semibold text-white">
                                {company?.companyName || relationship.leadId}
                                <span className="ml-2 text-[10px] text-emerald-400 font-normal">Current</span>
                                {relationship.isPrimaryContact && (
                                  <span className="ml-1.5 text-[10px] text-amber-400 font-normal">· Primary</span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {relationship.jobTitle || relationship.designation || relationship.relationshipType.replace(/_/g, ' ')}
                                {company?.industry ? ` · ${company.industry}` : ''}
                              </div>
                            </div>
                            {company && onOpenCompany && (
                              <button
                                onClick={() => onOpenCompany(company.id)}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-indigo-300"
                              >
                                Open Company
                              </button>
                            )}
                          </div>
                        ))}
                        {profile.historicalCompanies.map(({ relationship, company }) => (
                          <div
                            key={relationship.id}
                            className="p-2.5 rounded-lg border border-slate-800/60 bg-slate-950/40 flex items-center justify-between gap-2 opacity-80"
                          >
                            <div>
                              <div className="text-xs font-medium text-slate-300">
                                {company?.companyName || relationship.leadId}
                                <span className="ml-2 text-[10px] text-slate-500">Historical</span>
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {relationship.jobTitle || relationship.designation || relationship.relationshipType.replace(/_/g, ' ')}
                              </div>
                            </div>
                            {company && onOpenCompany && (
                              <button
                                onClick={() => onOpenCompany(company.id)}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300"
                              >
                                View
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Relationship Settings & Override */}
                  <form onSubmit={handleSaveMeta} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-white">Personal Relationship Controls</h4>
                      <span className="text-[10px] text-slate-500">{profile.engagement.transparencyLabel}</span>
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
                        <label className="block text-[11px] text-slate-400 mb-1">Engagement Override</label>
                        <select
                          value={overrideLevel}
                          onChange={(e) => setOverrideLevel(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value="">Use Derived ({profile.engagement.level})</option>
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
                        <label className="block text-[11px] text-slate-400 mb-1">Scheduled Check-In Date</label>
                        <input
                          type="date"
                          value={reviewDate}
                          onChange={(e) => setReviewDate(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="Tags (comma-separated, e.g. champion, conference-met)"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <textarea
                      rows={2}
                      value={ownerAnnotation}
                      onChange={(e) => setOwnerAnnotation(e.target.value)}
                      placeholder="Owner relationship annotation..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingMeta}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingMeta ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* INTERACTIONS TAB */}
              {tab === 'interactions' && (
                <div className="space-y-4">
                  <form onSubmit={handleLogInteraction} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-white">Log Manual Interaction with {profile.person.fullName}</h4>
                      <span className="text-[10px] text-slate-500">Manual entry only</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select
                        value={intType}
                        onChange={(e) => setIntType(e.target.value as CrmInteractionType)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      >
                        {CRM_INTERACTION_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={intLeadId}
                        onChange={(e) => setIntLeadId(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="">No company attached</option>
                        {profile.currentCompanies.map(({ company }) =>
                          company ? (
                            <option key={company.id} value={company.id}>
                              {company.companyName}
                            </option>
                          ) : null
                        )}
                      </select>
                    </div>
                    <input
                      type="text"
                      required
                      value={intSummary}
                      onChange={(e) => setIntSummary(e.target.value)}
                      placeholder="Summary of call, meeting, message, or referral..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={intOutcome}
                        onChange={(e) => setIntOutcome(e.target.value)}
                        placeholder="Outcome"
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                      <input
                        type="text"
                        value={intNextAction}
                        onChange={(e) => setIntNextAction(e.target.value)}
                        placeholder="Next action"
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                      <input
                        type="date"
                        value={intFollowUp}
                        onChange={(e) => setIntFollowUp(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={intNotes}
                      onChange={(e) => setIntNotes(e.target.value)}
                      placeholder="Detailed notes..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingInt}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {savingInt ? 'Saving...' : 'Record Interaction'}
                      </button>
                    </div>
                  </form>

                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950/40">
                    {profile.interactions.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">No interactions logged yet.</div>
                    ) : (
                      profile.interactions.map((i) => (
                        <div key={i.id} className="p-3.5 space-y-1">
                          <div className="text-xs font-semibold text-white">{i.summary}</div>
                          <div className="text-[11px] text-slate-400">
                            <span className="text-indigo-400">{getInteractionTypeLabel(i.type)}</span> ·{' '}
                            {new Date(i.occurredAt).toLocaleString()} · Manual Record
                          </div>
                          {i.detailedNotes && <p className="text-xs text-slate-300">{i.detailedNotes}</p>}
                          {(i.outcome || i.nextAction) && (
                            <div className="text-[11px] text-slate-400">
                              {i.outcome && <span>Outcome: {i.outcome}</span>}
                              {i.outcome && i.nextAction && ' · '}
                              {i.nextAction && <span>Next: {i.nextAction}</span>}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* PRIVATE NOTES TAB */}
              {tab === 'notes' && (
                <div className="space-y-4">
                  <form onSubmit={handleAddNote} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      Add Private Person Note (Owner-Only)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        placeholder="Title (optional)"
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
                      placeholder="Communication preferences, background context, meeting notes..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={notePinned}
                          onChange={(e) => setNotePinned(e.target.checked)}
                        />
                        Pin note
                      </label>
                      <button
                        type="submit"
                        disabled={savingNote}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                      >
                        {savingNote ? 'Saving...' : 'Save Private Note'}
                      </button>
                    </div>
                  </form>

                  <div className="space-y-2.5">
                    {profile.privateNotes.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                        No private notes yet for this contact.
                      </div>
                    ) : (
                      profile.privateNotes.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3.5 rounded-xl border ${
                            n.pinned ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-800 bg-slate-950/40'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                              {n.pinned && <Pin className="w-3 h-3 text-amber-400" />}
                              <span>{n.title || getNoteCategoryLabel(n.category)}</span>
                            </div>
                            <span className="text-[11px] text-slate-500">
                              {new Date(n.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-slate-200 mt-1.5 whitespace-pre-wrap">{n.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TASKS TAB */}
              {tab === 'tasks' && (
                <div className="space-y-4">
                  <form onSubmit={handleCreateTask} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-white">Add Follow-Up Task for {profile.person.fullName}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        required
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Task title..."
                        className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                      <input
                        type="date"
                        value={taskDue}
                        onChange={(e) => setTaskDue(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <select
                        value={taskPriority}
                        onChange={(e) => setTaskPriority(e.target.value as any)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="high">High Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="low">Low Priority</option>
                      </select>
                      <button
                        type="submit"
                        disabled={savingTask}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                      >
                        {savingTask ? 'Adding...' : 'Add Task'}
                      </button>
                    </div>
                  </form>

                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950/40">
                    {profile.tasks.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">No tasks assigned to this person.</div>
                    ) : (
                      profile.tasks.map((t) => (
                        <div key={t.id} className="p-3.5 flex items-center justify-between gap-3">
                          <div>
                            <div className={`text-xs font-medium ${t.completed ? 'line-through text-slate-500' : 'text-white'}`}>
                              {t.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Due {new Date(t.dueDate).toLocaleDateString()} · {getTaskStatusLabel(t.status)}
                            </div>
                          </div>
                          <select
                            value={t.status || (t.completed ? 'completed' : 'pending')}
                            onChange={(e) => handleUpdateTaskStatus(t.id, e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white"
                          >
                            {CRM_TASK_STATUSES.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* OPPORTUNITIES TAB */}
              {tab === 'opportunities' && (
                <div className="space-y-2.5">
                  {profile.opportunities.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                      No related opportunities found yet.
                    </div>
                  ) : (
                    profile.opportunities.map((opp) => (
                      <div key={opp.id} className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/40">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">{opp.title}</span>
                          <span className="text-xs font-mono text-emerald-400 font-semibold">
                            {opp.currency} {opp.estimatedValue.toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          {getOpportunityStatusLabel(opp.status)} · {opp.probability}% probability
                          {opp.expectedCloseDate && ` · Close ${new Date(opp.expectedCloseDate).toLocaleDateString()}`}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
