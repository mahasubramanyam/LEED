import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckSquare,
  Plus,
  Calendar,
  Building2,
  Trash2,
  Check,
  User,
  Repeat,
  Bell,
  Info,
  Save,
} from 'lucide-react';
import { LeadTask, CanonicalLead, PersonRecord, CrmOpportunity } from '../types.ts';
import {
  CRM_RECURRENCE_FREQUENCIES,
  CRM_TASK_CATEGORIES,
  CRM_TASK_STATUSES,
  getTaskStatusLabel,
} from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface TasksViewProps {
  tasks: LeadTask[];
  leads: CanonicalLead[];
  onToggleTask: (taskId: string, completed: boolean) => void;
  onCreateTask: (task: Omit<LeadTask, 'id' | 'createdAt'>) => void;
  onUpdateTask?: (taskId: string, updates: Partial<LeadTask>) => Promise<void> | void;
  onDeleteTask: (taskId: string) => void;
  onSelectLead: (lead: CanonicalLead) => void;
  onOpenPersonProfile?: (personId: string) => void;
  onOpenReminderCenter?: () => void;
}

type TaskFilterTab =
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'high_priority'
  | 'follow_ups'
  | 'missing_outcome'
  | 'completed'
  | 'all';

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  leads,
  onToggleTask,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onSelectLead,
  onOpenPersonProfile,
  onOpenReminderCenter,
}) => {
  const [filter, setFilter] = useState<TaskFilterTab>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [opportunities, setOpportunities] = useState<CrmOpportunity[]>([]);

  // Composer fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10));
  const [reminderDate, setReminderDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [category, setCategory] = useState<NonNullable<LeadTask['category']>>('follow_up');
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id || '');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedOppId, setSelectedOppId] = useState('');
  const [recurrenceFreq, setRecurrenceFreq] = useState<'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly'>('none');

  // Inline outcome editing
  const [editingOutcomeId, setEditingOutcomeId] = useState<string | null>(null);
  const [outcomeDraft, setOutcomeDraft] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [pRes, oRes] = await Promise.all([
          apiFetch('/api/persons'),
          apiFetch('/api/crm/opportunities'),
        ]);
        if (pRes.ok) {
          const pd = await pRes.json();
          setPersons(Array.isArray(pd.persons) ? pd.persons : []);
        }
        if (oRes.ok) {
          const od = await oRes.json();
          setOpportunities(Array.isArray(od.opportunities) ? od.opportunities : []);
        }
      } catch {
        // Non-blocking
      }
    })();
  }, []);

  const todayStartMs = useMemo(() => {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  }, []);
  const tomorrowStartMs = todayStartMs + 86_400_000;

  const isOpen = (t: LeadTask) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled';

  const counts = useMemo(() => {
    let overdue = 0;
    let today = 0;
    let upcoming = 0;
    let high = 0;
    let followUps = 0;
    let missingOutcome = 0;
    let completed = 0;
    for (const t of tasks) {
      const dueMs = new Date(t.dueDate).getTime();
      if (t.completed || t.status === 'completed') {
        completed++;
        if (!t.outcome || !t.outcome.trim()) missingOutcome++;
      } else if (t.status !== 'cancelled') {
        if (dueMs < todayStartMs) overdue++;
        else if (dueMs >= todayStartMs && dueMs < tomorrowStartMs) today++;
        else upcoming++;
        if (t.priority === 'high') high++;
        if ((t.category || 'follow_up') === 'follow_up' || dueMs < tomorrowStartMs) followUps++;
      }
    }
    return { overdue, today, upcoming, high, followUps, missingOutcome, completed };
  }, [tasks, todayStartMs, tomorrowStartMs]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      const dueMs = new Date(t.dueDate).getTime();
      switch (filter) {
        case 'overdue':
          return isOpen(t) && dueMs < todayStartMs;
        case 'today':
          return isOpen(t) && dueMs >= todayStartMs && dueMs < tomorrowStartMs;
        case 'upcoming':
          return isOpen(t) && dueMs >= tomorrowStartMs;
        case 'high_priority':
          return isOpen(t) && t.priority === 'high';
        case 'follow_ups':
          return isOpen(t) && ((t.category || 'follow_up') === 'follow_up' || dueMs < tomorrowStartMs);
        case 'missing_outcome':
          return (t.completed || t.status === 'completed') && (!t.outcome || !t.outcome.trim());
        case 'completed':
          return t.completed || t.status === 'completed';
        default:
          return true;
      }
    });
  }, [tasks, filter, todayStartMs, tomorrowStartMs]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onCreateTask({
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate: dueDate ? `${dueDate}T09:00:00.000Z` : new Date(Date.now() + 86400000 * 2).toISOString(),
      reminderDate: reminderDate ? `${reminderDate}T08:00:00.000Z` : undefined,
      priority,
      category,
      status: 'pending',
      completed: false,
      assignedTo: 'Owner',
      leadId: selectedLeadId,
      personId: selectedPersonId || undefined,
      opportunityId: selectedOppId || undefined,
      recurrence: recurrenceFreq !== 'none' ? { frequency: recurrenceFreq } : undefined,
    });

    setTitle('');
    setDescription('');
    setReminderDate('');
    setRecurrenceFreq('none');
    setIsCreating(false);
  };

  const handleStatusChange = async (task: LeadTask, nextStatus: NonNullable<LeadTask['status']>) => {
    if (onUpdateTask) {
      await onUpdateTask(task.id, { status: nextStatus, completed: nextStatus === 'completed' });
    } else {
      onToggleTask(task.id, nextStatus === 'completed');
    }
  };

  const handleSaveOutcome = async (task: LeadTask) => {
    if (onUpdateTask) {
      await onUpdateTask(task.id, { outcome: outcomeDraft.trim() });
    }
    setEditingOutcomeId(null);
    setOutcomeDraft('');
  };

  const leadOpps = opportunities.filter((o) => !selectedLeadId || o.leadId === selectedLeadId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-indigo-400" />
            Task &amp; Follow-Up Manager
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Track company, decision-maker, and opportunity follow-ups with priorities, recurrence, outcomes, and in-app reminders.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onOpenReminderCenter && (
            <button
              onClick={onOpenReminderCenter}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              Reminder Centre
            </button>
          )}
          <button
            onClick={() => setIsCreating(!isCreating)}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Task / Follow-Up</span>
          </button>
        </div>
      </div>

      {/* Honest Reminder / Manual Follow-Up Notice */}
      <div className="px-4 py-2.5 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px] text-slate-400 flex items-center gap-2">
        <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span>
          Follow-up tasks and recurring schedules are tracked strictly in-app for the owner — LEED never sends automated emails or messages without your explicit action.
        </span>
      </div>

      {/* 8 Filter Views */}
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 p-1.5 rounded-xl border border-slate-800 text-xs">
        {[
          { id: 'all', label: `All (${tasks.length})` },
          { id: 'overdue', label: `Overdue (${counts.overdue})` },
          { id: 'today', label: `Today (${counts.today})` },
          { id: 'upcoming', label: `Upcoming (${counts.upcoming})` },
          { id: 'high_priority', label: `High Priority (${counts.high})` },
          { id: 'follow_ups', label: `Follow-Ups Due (${counts.followUps})` },
          { id: 'missing_outcome', label: `Missing Outcome (${counts.missingOutcome})` },
          { id: 'completed', label: `Completed (${counts.completed})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as TaskFilterTab)}
            className={`px-3 py-1.5 rounded-lg font-medium transition ${
              filter === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* New Task Composer */}
      {isCreating && (
        <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3.5">
          <h3 className="text-xs font-bold text-white">Create Task or Recurring Follow-Up</h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <label className="block text-[11px] text-slate-400 mb-1">Task Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Call managing director to review proposal terms"
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
                required
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] text-slate-400 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              >
                {CRM_TASK_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] text-slate-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              >
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Company</label>
              <select
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              >
                <option value="">No company linked</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Decision-Maker (Optional)</label>
              <select
                value={selectedPersonId}
                onChange={(e) => setSelectedPersonId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              >
                <option value="">No person linked</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} {p.decisionMakingFunction ? `(${p.decisionMakingFunction})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Opportunity (Optional)</label>
              <select
                value={selectedOppId}
                onChange={(e) => setSelectedOppId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              >
                <option value="">No opportunity linked</option>
                {leadOpps.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">In-App Reminder Date (Optional)</label>
              <input
                type="date"
                value={reminderDate}
                onChange={(e) => setReminderDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] text-slate-400 mb-1">Recurrence</label>
              <select
                value={recurrenceFreq}
                onChange={(e) => setRecurrenceFreq(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              >
                {CRM_RECURRENCE_FREQUENCIES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-12">
              <label className="block text-[11px] text-slate-400 mb-1">Description / Context</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Preparation notes, questions to ask, or linked context..."
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg"
            >
              Save Task
            </button>
          </div>
        </form>
      )}

      {/* Tasks List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No tasks match this filter view.
          </div>
        ) : (
          filtered.map((task) => {
            const lead = leads.find((l) => l.id === task.leadId);
            const person = persons.find((p) => p.id === task.personId);
            const opp = opportunities.find((o) => o.id === task.opportunityId);
            const isOverdue = isOpen(task) && new Date(task.dueDate).getTime() < todayStartMs;
            const currentStatus = task.status || (task.completed ? 'completed' : 'pending');

            return (
              <div
                key={task.id}
                className={`p-4 space-y-2 hover:bg-slate-800/30 transition ${
                  task.completed ? 'opacity-70 bg-slate-950/30' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => handleStatusChange(task, task.completed ? 'pending' : 'completed')}
                      className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition shrink-0 ${
                        task.completed
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'border-slate-700 hover:border-indigo-500'
                      }`}
                    >
                      {task.completed && <Check className="w-3.5 h-3.5" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-semibold ${
                          task.completed ? 'line-through text-slate-500' : 'text-white'
                        }`}
                      >
                        {task.title}
                      </div>

                      {task.description && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{task.description}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 mt-1">
                        {lead && (
                          <button
                            onClick={() => onSelectLead(lead)}
                            className="hover:text-indigo-400 inline-flex items-center gap-1 text-slate-200 font-medium"
                          >
                            <Building2 className="w-3 h-3 text-slate-500" />
                            <span>{lead.companyName}</span>
                          </button>
                        )}
                        {person && (
                          <>
                            <span>·</span>
                            <button
                              onClick={() => onOpenPersonProfile?.(person.id)}
                              className="hover:text-emerald-400 inline-flex items-center gap-1 text-slate-300"
                            >
                              <User className="w-3 h-3 text-slate-500" />
                              <span>{person.fullName}</span>
                            </button>
                          </>
                        )}
                        {opp && (
                          <>
                            <span>·</span>
                            <span className="text-indigo-300">Deal: {opp.title}</span>
                          </>
                        )}
                        <span>·</span>
                        <span className={`inline-flex items-center gap-1 ${isOverdue ? 'text-rose-400 font-semibold' : ''}`}>
                          <Calendar className="w-3 h-3" />
                          Due {new Date(task.dueDate).toLocaleDateString()}
                          {isOverdue ? ' (Overdue)' : ''}
                        </span>
                        <span>·</span>
                        <span className="capitalize">{(task.category || 'follow_up').replace(/_/g, ' ')}</span>
                        <span>·</span>
                        <span
                          className={
                            task.priority === 'high'
                              ? 'text-rose-400 font-semibold'
                              : task.priority === 'medium'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                          }
                        >
                          {task.priority} priority
                        </span>
                        {task.recurrence && task.recurrence.frequency !== 'none' && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-indigo-400">
                              <Repeat className="w-3 h-3" />
                              {task.recurrence.frequency}
                            </span>
                          </>
                        )}
                      </div>

                      {task.outcome && editingOutcomeId !== task.id && (
                        <div className="text-[11px] text-emerald-400 mt-1">
                          Outcome: {task.outcome}
                        </div>
                      )}

                      {editingOutcomeId === task.id && (
                        <div className="mt-2 flex items-center gap-2 max-w-lg">
                          <input
                            type="text"
                            value={outcomeDraft}
                            onChange={(e) => setOutcomeDraft(e.target.value)}
                            placeholder="Record task / follow-up outcome..."
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white"
                          />
                          <button
                            onClick={() => handleSaveOutcome(task)}
                            className="px-2.5 py-1 bg-indigo-600 text-white rounded text-xs inline-flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" /> Save
                          </button>
                          <button
                            onClick={() => setEditingOutcomeId(null)}
                            className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={currentStatus}
                      onChange={(e) => handleStatusChange(task, e.target.value as any)}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                    >
                      {CRM_TASK_STATUSES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>

                    {onUpdateTask && (
                      <button
                        onClick={() => {
                          setEditingOutcomeId(task.id);
                          setOutcomeDraft(task.outcome || '');
                        }}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
                      >
                        {task.outcome ? 'Edit Outcome' : 'Log Outcome'}
                      </button>
                    )}

                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition"
                      title="Delete task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
