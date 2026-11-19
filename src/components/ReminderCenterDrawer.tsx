import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Calendar,
  AlertTriangle,
  Clock,
  RefreshCw,
  X,
  Building2,
  User,
  Info,
} from 'lucide-react';
import { CrmReminderCenterResponse, CrmReminderItem } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface ReminderCenterDrawerProps {
  onClose: () => void;
  onOpenCompany: (leadId: string) => void;
  onOpenPerson: (personId: string) => void;
  onNavigateTasks: () => void;
}

export const ReminderCenterDrawer: React.FC<ReminderCenterDrawerProps> = ({
  onClose,
  onOpenCompany,
  onOpenPerson,
  onNavigateTasks,
}) => {
  const [data, setData] = useState<CrmReminderCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<'all' | 'overdue' | 'today' | 'meetings' | 'attention'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/crm/reminders');
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = (data?.reminders || []).filter((r: CrmReminderItem) => {
    if (filterKind === 'overdue') return r.kind === 'overdue_task' || (r.kind === 'interaction_follow_up' && r.severity === 'urgent');
    if (filterKind === 'today') return r.kind === 'today_task' || (r.kind === 'interaction_follow_up' && r.severity === 'high');
    if (filterKind === 'meetings') return r.kind === 'upcoming_meeting';
    if (filterKind === 'attention') return r.kind === 'needs_attention' || r.kind === 'relationship_review';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-400" />
              In-App Relationship Reminder Centre
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Live due dates, follow-ups, meetings, and relationship reviews
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={load}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              title="Refresh reminders"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Honest Scheduler Disclosure */}
        {data && (
          <div className="px-5 py-2.5 bg-slate-950/70 border-b border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
            <span>{data.schedulerStatus.honestNote}</span>
          </div>
        )}

        {/* Filter Bar */}
        <div className="px-5 py-2.5 border-b border-slate-800 flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: `All (${data?.counts.total ?? 0})` },
            { id: 'overdue', label: `Overdue (${data?.counts.overdueTasks ?? 0})` },
            { id: 'today', label: `Today (${data?.counts.todayFollowUps ?? 0})` },
            { id: 'meetings', label: `Meetings (${data?.counts.upcomingMeetings ?? 0})` },
            {
              id: 'attention',
              label: `Reviews & Attention (${(data?.counts.relationshipReviews ?? 0) + (data?.counts.needsAttention ?? 0)})`,
            },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterKind(f.id as any)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                filterKind === f.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Reminder List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {loading && !data ? (
            <div className="p-8 text-center text-xs text-slate-400">Computing live CRM reminders...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No active reminders in this view. Your follow-ups are up to date.
            </div>
          ) : (
            filtered.map((item) => (
              <div key={item.id} className="px-5 py-3.5 hover:bg-slate-800/40 transition space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      {item.severity === 'urgent' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      ) : item.kind === 'upcoming_meeting' ? (
                        <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      )}
                      <span className="truncate">{item.title}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{item.detail}</p>
                  </div>
                  {item.dueAt && (
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {new Date(item.dueAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-0.5 text-[11px]">
                  {item.leadId && (
                    <button
                      onClick={() => {
                        onOpenCompany(item.leadId!);
                        onClose();
                      }}
                      className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                    >
                      <Building2 className="w-3 h-3" />
                      {item.companyName || 'Open Company'}
                    </button>
                  )}
                  {item.personId && (
                    <button
                      onClick={() => {
                        onOpenPerson(item.personId!);
                        onClose();
                      }}
                      className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                    >
                      <User className="w-3 h-3" />
                      {item.personName || 'Open Contact'}
                    </button>
                  )}
                  {item.taskId && (
                    <button
                      onClick={() => {
                        onNavigateTasks();
                        onClose();
                      }}
                      className="text-slate-300 hover:text-white hover:underline"
                    >
                      Open in Tasks
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
