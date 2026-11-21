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
import { ActionMenu } from './ui/SunsetUI.tsx';

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
    <div className="fixed inset-0 z-50 bg-[#240202]/75 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-3xl bg-white dark:bg-[#240202] border-l border-[#DFD1D1] dark:border-[#7A1E1E] h-full flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#7A1E1E] bg-gradient-to-r from-[#240202] via-[#440303] to-[#690303] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#FF9492] shrink-0" />
              <h2 className="text-base font-extrabold text-white truncate">
                {profile?.person.fullName || 'Person Relationship Profile'}
              </h2>
            </div>
            {profile && (
              <div className="text-xs font-medium text-[#F5DADA] mt-1 truncate">
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
          <div className="flex items-center gap-2 shrink-0">
            {profile && (onOpenAiAgent || onOpenOutreach) && (
              <ActionMenu
                label="Engage"
                items={[
                  ...(onOpenAiAgent
                    ? [
                        {
                          label: 'AI Meeting Prep',
                          icon: <Bot className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () =>
                            onOpenAiAgent({
                              tab: 'meeting_prep',
                              personId: profile.person.id,
                              leadId: profile.currentCompanies[0]?.company?.id,
                            }),
                        },
                        {
                          label: 'Draft Message',
                          icon: <Mail className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () =>
                            onOpenAiAgent({
                              tab: 'drafting',
                              personId: profile.person.id,
                              leadId: profile.currentCompanies[0]?.company?.id,
                            }),
                        },
                      ]
                    : []),
                  ...(onOpenOutreach
                    ? [
                        {
                          label: 'Enroll in Outreach',
                          icon: <Send className="w-3.5 h-3.5 text-slate-400" />,
                          onClick: () =>
                            onOpenOutreach({
                              personId: profile.person.id,
                              leadId: profile.currentCompanies[0]?.company?.id,
                              tab: 'campaigns',
                            }),
                        },
                      ]
                    : []),
                ]}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#F5DADA] hover:text-white hover:bg-[#910303]/60"
              title="Close drawer"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && !profile ? (
            <div className="p-8 text-center text-xs text-[#543F3F] dark:text-[#DEC2C2] flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading person relationship profile...
            </div>
          ) : error || !profile ? (
            <div className="p-4 rounded-xl border border-[#F0B8B8] dark:border-[#E52825]/40 bg-[#FFF2F2] dark:bg-[#690303]/55 text-xs text-[#B30303] dark:text-[#FF9492]">
              {error || 'Unable to load person profile.'}
            </div>
          ) : (
            <>
              {/* Contact & Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]">
                  <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">Status</div>
                  <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] mt-1">
                    {getRelationshipStatusLabel(profile.relationshipMeta.relationshipStatus)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]">
                  <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">Derived Engagement</div>
                  <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] mt-1 capitalize">
                    {profile.engagement.effectiveLevel} ·{' '}
                    <span className="font-mono text-[#910303] dark:text-[#FF9492]">{profile.engagement.score}/100</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]">
                  <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">Last Contact</div>
                  <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] mt-1">
                    {profile.lastContactDate ? new Date(profile.lastContactDate).toLocaleDateString() : 'None'}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]">
                  <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">Next Follow-Up</div>
                  <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] mt-1">
                    {profile.nextFollowUpDate ? new Date(profile.nextFollowUpDate).toLocaleDateString() : 'Unscheduled'}
                  </div>
                </div>
              </div>

              {/* Direct Professional Contact Info */}
              <div className="text-xs text-[#422F2F] dark:text-[#EFE0E0] flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
                {profile.person.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[#7A6262] dark:text-[#C59D9D]" />
                    <span>{profile.person.email}</span>
                    <span className="text-[10px] text-[#7A6262] dark:text-[#C59D9D]">({profile.person.emailStatus || 'unverified'})</span>
                  </span>
                )}
                {profile.person.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-[#7A6262] dark:text-[#C59D9D]" />
                    <span>{profile.person.phone}</span>
                  </span>
                )}
                {profile.person.decisionMakingFunction && (
                  <span className="text-[#543F3F] dark:text-[#DEC2C2]">
                    Function: <strong className="text-[#240202] dark:text-[#FAF4F4]">{profile.person.decisionMakingFunction.replace(/_/g, ' ')}</strong>
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div className="flex flex-wrap gap-1.5 border-b border-[#E4DADA] dark:border-[#7A1E1E] pb-2.5">
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
                        ? 'bg-[#910303] text-white'
                        : 'text-[#543F3F] dark:text-[#DEC2C2] hover:text-[#910303] dark:hover:text-white hover:bg-[#EFE4E4] dark:hover:bg-[#690303]'
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
                  <div className="bg-[#FAF7F7] dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#910303] dark:text-[#FF9492]" />
                      Current &amp; Historical Company Relationships
                    </h4>

                    {profile.currentCompanies.length === 0 && profile.historicalCompanies.length === 0 ? (
                      <p className="text-xs text-[#7A6262] dark:text-[#C59D9D]">No linked company records yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {profile.currentCompanies.map(({ relationship, company }) => (
                          <div
                            key={relationship.id}
                            className="p-2.5 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303] flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4]">
                                {company?.companyName || relationship.leadId}
                                <span className="ml-2 text-[10px] text-emerald-700 dark:text-emerald-300 font-normal">Current</span>
                                {relationship.isPrimaryContact && (
                                  <span className="ml-1.5 text-[10px] text-amber-700 dark:text-amber-300 font-normal">· Primary</span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">
                                {relationship.jobTitle || relationship.designation || relationship.relationshipType.replace(/_/g, ' ')}
                                {company?.industry ? ` · ${company.industry}` : ''}
                              </div>
                            </div>
                            {company && onOpenCompany && (
                              <button
                                onClick={() => onOpenCompany(company.id)}
                                className="px-2.5 py-1 rounded bg-[#F4ECEC] dark:bg-[#690303] hover:bg-[#E7D8D8] dark:hover:bg-[#7A1212] text-[11px] text-[#910303] dark:text-[#FF9492]"
                              >
                                Open Company
                              </button>
                            )}
                          </div>
                        ))}
                        {profile.historicalCompanies.map(({ relationship, company }) => (
                          <div
                            key={relationship.id}
                            className="p-2.5 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]/80 flex items-center justify-between gap-2 opacity-80"
                          >
                            <div>
                              <div className="text-xs font-medium text-[#422F2F] dark:text-[#EFE0E0]">
                                {company?.companyName || relationship.leadId}
                                <span className="ml-2 text-[10px] text-[#7A6262] dark:text-[#C59D9D]">Historical</span>
                              </div>
                              <div className="text-[11px] text-[#7A6262] dark:text-[#C59D9D]">
                                {relationship.jobTitle || relationship.designation || relationship.relationshipType.replace(/_/g, ' ')}
                              </div>
                            </div>
                            {company && onOpenCompany && (
                              <button
                                onClick={() => onOpenCompany(company.id)}
                                className="px-2.5 py-1 rounded bg-[#F4ECEC] dark:bg-[#690303] hover:bg-[#E7D8D8] dark:hover:bg-[#7A1212] text-[11px] text-[#422F2F] dark:text-[#EFE0E0]"
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
                  <form onSubmit={handleSaveMeta} className="bg-[#FAF7F7] dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4]">Personal Relationship Controls</h4>
                      <span className="text-[10px] text-[#7A6262] dark:text-[#C59D9D]">{profile.engagement.transparencyLabel}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-[#543F3F] dark:text-[#DEC2C2] mb-1">Relationship Status</label>
                        <select
                          value={relStatus}
                          onChange={(e) => setRelStatus(e.target.value as CrmRelationshipStatus)}
                          className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                        >
                          {CRM_RELATIONSHIP_STATUSES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#543F3F] dark:text-[#DEC2C2] mb-1">Engagement Override</label>
                        <select
                          value={overrideLevel}
                          onChange={(e) => setOverrideLevel(e.target.value)}
                          className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
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
                        <label className="block text-[11px] text-[#543F3F] dark:text-[#DEC2C2] mb-1">Next Follow-Up Date</label>
                        <input
                          type="date"
                          value={nextFollowUp}
                          onChange={(e) => setNextFollowUp(e.target.value)}
                          className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#543F3F] dark:text-[#DEC2C2] mb-1">Scheduled Check-In Date</label>
                        <input
                          type="date"
                          value={reviewDate}
                          onChange={(e) => setReviewDate(e.target.value)}
                          className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                        />
                      </div>
                    </div>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="Tags (comma-separated, e.g. champion, conference-met)"
                      className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                    />
                    <textarea
                      rows={2}
                      value={ownerAnnotation}
                      onChange={(e) => setOwnerAnnotation(e.target.value)}
                      placeholder="Owner relationship annotation..."
                      className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingMeta}
                        className="px-3.5 py-1.5 rounded-lg bg-[#B30303] hover:bg-[#910303] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
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
                  <form onSubmit={handleLogInteraction} className="bg-[#FAF7F7] dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4]">Log Manual Interaction with {profile.person.fullName}</h4>
                      <span className="text-[10px] text-[#7A6262] dark:text-[#C59D9D]">Manual entry only</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select
                        value={intType}
                        onChange={(e) => setIntType(e.target.value as CrmInteractionType)}
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
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
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
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
                      className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={intOutcome}
                        onChange={(e) => setIntOutcome(e.target.value)}
                        placeholder="Outcome"
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                      <input
                        type="text"
                        value={intNextAction}
                        onChange={(e) => setIntNextAction(e.target.value)}
                        placeholder="Next action"
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                      <input
                        type="date"
                        value={intFollowUp}
                        onChange={(e) => setIntFollowUp(e.target.value)}
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={intNotes}
                      onChange={(e) => setIntNotes(e.target.value)}
                      placeholder="Detailed notes..."
                      className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingInt}
                        className="px-3.5 py-1.5 rounded-lg bg-[#B30303] hover:bg-[#910303] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {savingInt ? 'Saving...' : 'Record Interaction'}
                      </button>
                    </div>
                  </form>

                  <div className="divide-y divide-[#EDE3E3] dark:divide-[#7A1E1E]/60 border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl bg-[#FAF7F7] dark:bg-[#440303]/80">
                    {profile.interactions.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#7A6262] dark:text-[#C59D9D]">No interactions logged yet.</div>
                    ) : (
                      profile.interactions.map((i) => (
                        <div key={i.id} className="p-3.5 space-y-1">
                          <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4]">{i.summary}</div>
                          <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">
                            <span className="text-[#910303] dark:text-[#FF9492]">{getInteractionTypeLabel(i.type)}</span> ·{' '}
                            {new Date(i.occurredAt).toLocaleString()} · Manual Record
                          </div>
                          {i.detailedNotes && <p className="text-xs text-[#422F2F] dark:text-[#EFE0E0]">{i.detailedNotes}</p>}
                          {(i.outcome || i.nextAction) && (
                            <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">
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
                  <form onSubmit={handleAddNote} className="bg-[#FAF7F7] dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                      Add Private Person Note (Owner-Only)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        placeholder="Title (optional)"
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                      <select
                        value={noteCategory}
                        onChange={(e) => setNoteCategory(e.target.value as CrmNoteCategory)}
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
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
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                    </div>
                    <textarea
                      rows={3}
                      required
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Communication preferences, background context, meeting notes..."
                      className="w-full bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                    />
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 text-xs text-[#422F2F] dark:text-[#EFE0E0]">
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
                        className="px-3.5 py-1.5 rounded-lg bg-[#B30303] hover:bg-[#910303] text-white text-xs font-semibold"
                      >
                        {savingNote ? 'Saving...' : 'Save Private Note'}
                      </button>
                    </div>
                  </form>

                  <div className="space-y-2.5">
                    {profile.privateNotes.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#7A6262] dark:text-[#C59D9D] border border-dashed border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl">
                        No private notes yet for this contact.
                      </div>
                    ) : (
                      profile.privateNotes.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3.5 rounded-xl border ${
                            n.pinned ? 'border-amber-200 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/20' : 'border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]/80'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4] flex items-center gap-1.5">
                              {n.pinned && <Pin className="w-3 h-3 text-amber-700 dark:text-amber-300" />}
                              <span>{n.title || getNoteCategoryLabel(n.category)}</span>
                            </div>
                            <span className="text-[11px] text-[#7A6262] dark:text-[#C59D9D]">
                              {new Date(n.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-xs text-[#240202] dark:text-[#FAF4F4] mt-1.5 whitespace-pre-wrap">{n.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TASKS TAB */}
              {tab === 'tasks' && (
                <div className="space-y-4">
                  <form onSubmit={handleCreateTask} className="bg-[#FAF7F7] dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4]">Add Follow-Up Task for {profile.person.fullName}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        required
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Task title..."
                        className="sm:col-span-2 bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                      <input
                        type="date"
                        value={taskDue}
                        onChange={(e) => setTaskDue(e.target.value)}
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <select
                        value={taskPriority}
                        onChange={(e) => setTaskPriority(e.target.value as any)}
                        className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg px-2.5 py-1.5 text-xs text-[#240202] dark:text-[#FAF4F4]"
                      >
                        <option value="high">High Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="low">Low Priority</option>
                      </select>
                      <button
                        type="submit"
                        disabled={savingTask}
                        className="px-3.5 py-1.5 rounded-lg bg-[#B30303] hover:bg-[#910303] text-white text-xs font-semibold"
                      >
                        {savingTask ? 'Adding...' : 'Add Task'}
                      </button>
                    </div>
                  </form>

                  <div className="divide-y divide-[#EDE3E3] dark:divide-[#7A1E1E]/60 border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl bg-[#FAF7F7] dark:bg-[#440303]/80">
                    {profile.tasks.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#7A6262] dark:text-[#C59D9D]">No tasks assigned to this person.</div>
                    ) : (
                      profile.tasks.map((t) => (
                        <div key={t.id} className="p-3.5 flex items-center justify-between gap-3">
                          <div>
                            <div className={`text-xs font-medium ${t.completed ? 'line-through text-[#7A6262] dark:text-[#C59D9D]' : 'text-[#240202] dark:text-[#FAF4F4]'}`}>
                              {t.title}
                            </div>
                            <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2]">
                              Due {new Date(t.dueDate).toLocaleDateString()} · {getTaskStatusLabel(t.status)}
                            </div>
                          </div>
                          <select
                            value={t.status || (t.completed ? 'completed' : 'pending')}
                            onChange={(e) => handleUpdateTaskStatus(t.id, e.target.value)}
                            className="bg-white dark:bg-[#240202] border border-[#D4C2C2] dark:border-[#8C2828] rounded px-2 py-1 text-[11px] text-[#240202] dark:text-[#FAF4F4]"
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
                    <div className="p-6 text-center text-xs text-[#7A6262] dark:text-[#C59D9D] border border-dashed border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl">
                      No related opportunities found yet.
                    </div>
                  ) : (
                    profile.opportunities.map((opp) => (
                      <div key={opp.id} className="p-3.5 rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#440303]/80">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-[#240202] dark:text-[#FAF4F4]">{opp.title}</span>
                          <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300 font-semibold">
                            {opp.currency} {opp.estimatedValue.toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#543F3F] dark:text-[#DEC2C2] mt-1">
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
