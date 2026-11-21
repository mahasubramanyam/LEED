import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Calendar,
  Trash2,
  Check,
  Repeat,
  Save,
  Bot,
} from 'lucide-react';
import { LeadTask, CanonicalLead, PersonRecord, CrmOpportunity, AiAgentLaunchContext } from '../types.ts';
import {
  CRM_RECURRENCE_FREQUENCIES,
  CRM_TASK_CATEGORIES,
  CRM_TASK_STATUSES,
} from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { EmptyState, SegmentedTabs, SurfaceCard, WorkspaceToolbar } from './ui/SunsetUI.tsx';

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
  onOpenAiAgent?: (ctx: AiAgentLaunchContext) => void;
}

type TaskFilterTab =
  | 'all'
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'high_priority'
  | 'follow_ups'
  | 'missing_outcome'
  | 'completed';

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  leads,
  onToggleTask,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onSelectLead,
  onOpenPersonProfile,
  onOpenAiAgent,
}) => {
  const [filter, setFilter] = useState<TaskFilterTab>('all');
  const [isCreating, setIsCreating] = useState(false);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [opportunities, setOpportunities] = useState<CrmOpportunity[]>([]);

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

  const inputClass =
    'w-full bg-slate-50 dark:bg-[#240202] border border-slate-300 dark:border-[#8C2828] text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] text-sm font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#CE0404]';

  return (
    <div className="space-y-5">
      {/* Streamlined Action Toolbar */}
      <WorkspaceToolbar
        meta={`${tasks.length} total · ${counts.overdue} overdue · ${counts.today} due today`}
        actions={
          <>
            {onOpenAiAgent && (
              <button
                type="button"
                onClick={() => onOpenAiAgent({ tab: 'briefing' })}
                className="px-3 py-1.5 border border-[#D4C2C2] dark:border-[#8C2828] bg-white dark:bg-[#440303] text-[#440303] dark:text-[#FAF4F4] hover:border-[#910303] hover:bg-[#FDF6F6] dark:hover:bg-[#690303] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <Bot className="w-3.5 h-3.5 text-[#B30303] dark:text-[#FF9492]" />
                <span>AI Briefing</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsCreating((v) => !v)}
              className="px-3.5 py-1.5 bg-[#B30303] hover:bg-[#910303] text-white text-xs font-bold rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Task</span>
            </button>
          </>
        }
      />

      {/* Filter Tabs */}
      <SegmentedTabs
        activeId={filter}
        onChange={setFilter}
        items={[
          { id: 'all', label: 'All', count: tasks.length },
          { id: 'overdue', label: 'Overdue', count: counts.overdue },
          { id: 'today', label: 'Today', count: counts.today },
          { id: 'upcoming', label: 'Upcoming', count: counts.upcoming },
          { id: 'high_priority', label: 'High Priority', count: counts.high },
          { id: 'follow_ups', label: 'Follow-Ups', count: counts.followUps },
          { id: 'missing_outcome', label: 'Needs Outcome', count: counts.missingOutcome },
          { id: 'completed', label: 'Completed', count: counts.completed },
        ]}
      />

      {/* New Task Composer */}
      {isCreating && (
        <SurfaceCard>
          <form onSubmit={handleCreate} className="space-y-4">
            <h3 className="text-base font-bold text-[#440303] dark:text-[#FAF4F4]">
              New Task
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Call managing director to review proposal"
                  className={inputClass}
                  required
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className={inputClass}
                >
                  {CRM_TASK_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className={inputClass}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Company
                </label>
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">None</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Contact
                </label>
                <select
                  value={selectedPersonId}
                  onChange={(e) => setSelectedPersonId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">None</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Opportunity
                </label>
                <select
                  value={selectedOppId}
                  onChange={(e) => setSelectedOppId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">None</option>
                  {leadOpps.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Reminder Date
                </label>
                <input
                  type="date"
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Recurrence
                </label>
                <select
                  value={recurrenceFreq}
                  onChange={(e) => setRecurrenceFreq(e.target.value as any)}
                  className={inputClass}
                >
                  {CRM_RECURRENCE_FREQUENCIES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-12">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Context or preparation notes..."
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-[#B30303] hover:bg-[#CE0404] text-white text-xs font-bold rounded-lg"
              >
                Save Task
              </button>
            </div>
          </form>
        </SurfaceCard>
      )}

      {/* Task List */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No matching tasks"
          description="Create a task or choose another filter."
        />
      ) : (
        <SurfaceCard padding="none" className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((task) => {
            const lead = leads.find((l) => l.id === task.leadId);
            const person = persons.find((p) => p.id === task.personId);
            const opp = opportunities.find((o) => o.id === task.opportunityId);
            const isOverdue = isOpen(task) && new Date(task.dueDate).getTime() < todayStartMs;
            const currentStatus = task.status || (task.completed ? 'completed' : 'pending');

            return (
              <div
                key={task.id}
                className={`px-5 py-3.5 hover:bg-slate-100/70 dark:hover:bg-[#690303] transition-colors ${
                  task.completed ? 'opacity-65' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleStatusChange(task, task.completed ? 'pending' : 'completed')}
                      aria-label={task.completed ? 'Mark pending' : 'Mark completed'}
                      className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${
                        task.completed
                          ? 'bg-[#B30303] border-[#B30303] text-white'
                          : 'border-slate-300 dark:border-[#8C2828] hover:border-[#CE0404]'
                      }`}
                    >
                      {task.completed && <Check className="w-3.5 h-3.5" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm font-semibold ${
                          task.completed
                            ? 'line-through text-slate-500 dark:text-[#C9A7A7]'
                            : 'text-slate-950 dark:text-[#FAF4F4]'
                        }`}
                      >
                        {task.title}
                      </div>
                      {task.description && (
                        <p className="text-xs font-medium text-slate-600 dark:text-[#E6D2D2] mt-0.5">
                          {task.description}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-600 dark:text-[#E6D2D2] mt-1">
                        {lead && (
                          <button
                            type="button"
                            onClick={() => onSelectLead(lead)}
                            className="text-[#B30303] dark:text-[#FF9492] font-bold hover:underline"
                          >
                            {lead.companyName}
                          </button>
                        )}
                        {person && (
                          <>
                            {lead && <span>·</span>}
                            <button
                              type="button"
                              onClick={() => onOpenPersonProfile?.(person.id)}
                              className="hover:underline font-semibold text-slate-800 dark:text-[#FAF4F4]"
                            >
                              {person.fullName}
                            </button>
                          </>
                        )}
                        {opp && (
                          <>
                            <span>·</span>
                            <span>{opp.title}</span>
                          </>
                        )}
                        {(lead || person || opp) && <span>·</span>}
                        <span
                          className={`inline-flex items-center gap-1 tabular-nums ${
                            isOverdue ? 'text-[#CE0404] dark:text-[#FF8A87] font-bold' : ''
                          }`}
                        >
                          <Calendar className="w-3 h-3" />
                          {new Date(task.dueDate).toLocaleDateString()}
                          {isOverdue ? ' (Overdue)' : ''}
                        </span>
                        <span>·</span>
                        <span
                          className={
                            task.priority === 'high'
                              ? 'text-[#CE0404] dark:text-[#FF8A87] font-bold'
                              : task.priority === 'medium'
                              ? 'text-amber-700 dark:text-amber-300 font-semibold'
                              : ''
                          }
                        >
                          {task.priority}
                        </span>
                        {task.recurrence && task.recurrence.frequency !== 'none' && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-[#B30303] dark:text-[#FF9492]">
                              <Repeat className="w-3 h-3" />
                              {task.recurrence.frequency}
                            </span>
                          </>
                        )}
                      </div>

                      {task.outcome && editingOutcomeId !== task.id && (
                        <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                          Outcome: {task.outcome}
                        </div>
                      )}

                      {editingOutcomeId === task.id && (
                        <div className="mt-2 flex items-center gap-2 max-w-lg">
                          <input
                            type="text"
                            value={outcomeDraft}
                            onChange={(e) => setOutcomeDraft(e.target.value)}
                            placeholder="Record outcome..."
                            className="flex-1 bg-slate-50 dark:bg-[#240202] border border-slate-200 dark:border-[#8C2828] rounded-lg px-3 py-1 text-xs text-slate-900 dark:text-[#FAF4F4] focus:outline-none focus:border-[#CE0404]"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveOutcome(task)}
                            className="px-2.5 py-1 bg-[#B30303] hover:bg-[#CE0404] text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOutcomeId(null)}
                            className="px-2.5 py-1 border border-slate-200 dark:border-[#7A1E1E] text-slate-600 dark:text-[#E6D2D2] rounded-lg text-xs"
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
                      className="bg-slate-50 dark:bg-[#240202] border border-slate-200 dark:border-[#7A1E1E] rounded-lg px-2 py-1 text-xs text-slate-700 dark:text-[#FAF4F4]"
                    >
                      {CRM_TASK_STATUSES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label}
                        </option>
                      ))}
                    </select>

                    {onUpdateTask && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingOutcomeId(task.id);
                          setOutcomeDraft(task.outcome || '');
                        }}
                        className="px-2.5 py-1 border border-slate-200 dark:border-[#7A1E1E] hover:bg-slate-50 dark:hover:bg-[#690303] text-slate-700 dark:text-[#FAF4F4] rounded-lg text-xs font-medium"
                      >
                        {task.outcome ? 'Edit Outcome' : 'Outcome'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteTask(task.id)}
                      className="p-1.5 text-slate-400 dark:text-[#C9A7A7] hover:text-[#CE0404] dark:hover:text-[#FF8A87] transition-colors"
                      title="Delete task"
                      aria-label="Delete task"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </SurfaceCard>
      )}
    </div>
  );
};
