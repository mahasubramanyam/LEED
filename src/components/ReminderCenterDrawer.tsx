import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  AlertTriangle,
  Clock,
  RefreshCw,
  X,
  Bot,
} from 'lucide-react';
import { AiAgentLaunchContext, CrmReminderCenterResponse, CrmReminderItem } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { SegmentedTabs } from './ui/SunsetUI.tsx';

interface ReminderCenterDrawerProps {
  onClose: () => void;
  onOpenCompany: (leadId: string) => void;
  onOpenPerson: (personId: string) => void;
  onNavigateTasks: () => void;
  onOpenAiAgent?: (ctx: AiAgentLaunchContext) => void;
}

export const ReminderCenterDrawer: React.FC<ReminderCenterDrawerProps> = ({
  onClose,
  onOpenCompany,
  onOpenPerson,
  onNavigateTasks,
  onOpenAiAgent,
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
    <div className="fixed inset-0 z-50 bg-[#0F181B]/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Reminders
          </h2>
          <div className="flex items-center gap-1.5">
            {onOpenAiAgent && (
              <button
                type="button"
                onClick={() => onOpenAiAgent({ tab: 'briefing' })}
                className="px-3 py-1.5 rounded-lg bg-[#335C67] hover:bg-[#25454E] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Bot className="w-3.5 h-3.5 text-[#FFF3B0]" />
                Briefing
              </button>
            )}
            <button
              type="button"
              onClick={load}
              aria-label="Refresh reminders"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close reminders"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2 border-b border-slate-200 dark:border-slate-800">
          <SegmentedTabs
            activeId={filterKind}
            onChange={setFilterKind}
            items={[
              { id: 'all', label: 'All', count: data?.counts.total ?? 0 },
              { id: 'overdue', label: 'Overdue', count: data?.counts.overdueTasks ?? 0 },
              { id: 'today', label: 'Today', count: data?.counts.todayFollowUps ?? 0 },
              { id: 'meetings', label: 'Meetings', count: data?.counts.upcomingMeetings ?? 0 },
              {
                id: 'attention',
                label: 'Attention',
                count: (data?.counts.relationshipReviews ?? 0) + (data?.counts.needsAttention ?? 0),
              },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loading && !data ? (
            <div className="p-8 text-center text-xs text-slate-500">Loading reminders...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No active reminders in this view.
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="px-5 py-3.5 hover:bg-[#FFF9D8]/50 dark:hover:bg-slate-800/50 transition-colors space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {item.severity === 'urgent' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-[#9E2A2B] dark:text-[#E09D9E] shrink-0" />
                      ) : item.kind === 'upcoming_meeting' ? (
                        <Calendar className="w-3.5 h-3.5 text-[#335C67] dark:text-[#8AB0BA] shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-[#E09F3E] shrink-0" />
                      )}
                      <span className="truncate">{item.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.detail}</p>
                  </div>
                  {item.dueAt && (
                    <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                      {new Date(item.dueAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  {item.leadId && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenCompany(item.leadId!);
                        onClose();
                      }}
                      className="text-[#335C67] dark:text-[#8AB0BA] font-semibold hover:underline"
                    >
                      {item.companyName || 'Company'}
                    </button>
                  )}
                  {item.personId && (
                    <button
                      type="button"
                      onClick={() => {
                        onOpenPerson(item.personId!);
                        onClose();
                      }}
                      className="text-[#956219] dark:text-[#E09F3E] font-semibold hover:underline"
                    >
                      {item.personName || 'Contact'}
                    </button>
                  )}
                  {item.taskId && (
                    <button
                      type="button"
                      onClick={() => {
                        onNavigateTasks();
                        onClose();
                      }}
                      className="text-slate-600 dark:text-slate-300 hover:underline"
                    >
                      Open Task
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
