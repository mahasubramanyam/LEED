import React, { useState } from 'react';
import {
  CheckSquare,
  Plus,
  Calendar,
  AlertCircle,
  Building2,
  Trash2,
  Check,
} from 'lucide-react';
import { LeadTask, CanonicalLead } from '../types.js';

interface TasksViewProps {
  tasks: LeadTask[];
  leads: CanonicalLead[];
  onToggleTask: (taskId: string, completed: boolean) => void;
  onCreateTask: (task: Omit<LeadTask, 'id' | 'createdAt'>) => void;
  onDeleteTask: (taskId: string) => void;
  onSelectLead: (lead: CanonicalLead) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  leads,
  onToggleTask,
  onCreateTask,
  onDeleteTask,
  onSelectLead,
}) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('active');
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id || '');

  const filtered = tasks.filter((t) => {
    if (filter === 'active') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onCreateTask({
      title: title.trim(),
      dueDate: dueDate || new Date(Date.now() + 86400000 * 2).toISOString(),
      priority,
      completed: false,
      assignedTo: 'Lead Intelligence Operator',
      leadId: selectedLeadId,
    });

    setTitle('');
    setIsCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-indigo-400" />
            CRM Action Tasks & Follow-Up Reminders
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Keep track of discovery review, verification tasks, and follow-up deadlines for pipeline prospects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setFilter('active')}
              className={`px-3 py-1 rounded font-medium transition ${
                filter === 'active' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Active ({tasks.filter((t) => !t.completed).length})
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-3 py-1 rounded font-medium transition ${
                filter === 'completed' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Completed ({tasks.filter((t) => t.completed).length})
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded font-medium transition ${
                filter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({tasks.length})
            </button>
          </div>

          <button
            onClick={() => setIsCreating(!isCreating)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded flex items-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-white">Create New Lead Task</h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <label className="block text-[11px] text-slate-400 mb-1">Task Description</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Schedule discovery call with procurement team..."
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] text-slate-400 mb-1">Related Lead</label>
              <select
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
              >
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] text-slate-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded p-2 focus:outline-none focus:border-indigo-500"
              >
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1 bg-slate-800 text-slate-400 rounded text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded"
            >
              Add Task
            </button>
          </div>
        </form>
      )}

      {/* Tasks List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-800/80">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No tasks found in this view.
          </div>
        ) : (
          filtered.map((task) => {
            const lead = leads.find((l) => l.id === task.leadId);

            return (
              <div
                key={task.id}
                className={`p-3.5 flex items-center justify-between gap-4 hover:bg-slate-800/30 transition ${
                  task.completed ? 'opacity-60 bg-slate-950/40' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => onToggleTask(task.id, !task.completed)}
                    className={`w-5 h-5 rounded border flex items-center justify-center transition flex-shrink-0 ${
                      task.completed
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'border-slate-700 hover:border-indigo-500'
                    }`}
                  >
                    {task.completed && <Check className="w-3.5 h-3.5" />}
                  </button>

                  <div className="min-w-0">
                    <span
                      className={`text-xs font-medium block truncate ${
                        task.completed ? 'line-through text-slate-500' : 'text-slate-200'
                      }`}
                    >
                      {task.title}
                    </span>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      {lead && (
                        <button
                          onClick={() => onSelectLead(lead)}
                          className="hover:text-indigo-400 flex items-center gap-1 text-slate-300 font-semibold"
                        >
                          <Building2 className="w-3 h-3 text-slate-500" />
                          <span>{lead.companyName}</span>
                        </button>
                      )}

                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>Due {new Date(task.dueDate).toLocaleDateString()}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                      task.priority === 'high'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        : task.priority === 'medium'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {task.priority.toUpperCase()}
                  </span>

                  <button
                    onClick={() => onDeleteTask(task.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 transition"
                    title="Delete task"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
